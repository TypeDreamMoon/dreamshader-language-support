"use strict";

const fs = require("fs");
const https = require("https");
const childProcess = require("child_process");
const path = require("path");
const vscode = require("vscode");
const {
    DEFAULT_PACKAGE_INDEX_URL,
    PACKAGE_LOCK_NAME,
    PACKAGE_MANIFEST_NAME
} = require("../languageData");
const { normalizeFsPath } = require("./projectRoot");

function getPackagesDirectory(projectRoot) {
    return path.join(projectRoot, "DShader", "Packages");
}

function getPackageLockPath(projectRoot) {
    return path.join(projectRoot, "DShader", PACKAGE_LOCK_NAME);
}

function getPackageInstallDirectory(projectRoot, packageName) {
    const packagesDirectory = path.resolve(getPackagesDirectory(projectRoot));
    const installDirectory = path.resolve(packagesDirectory, ...normalizePackageName(packageName).split("/"));
    const relative = path.relative(packagesDirectory, installDirectory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Package '${packageName}' resolves outside DShader/Packages.`);
    }
    return installDirectory;
}

function resolveInstalledPackageDirectory(projectRoot, entry) {
    if (!entry || !projectRoot) {
        throw new Error("Installed package entry is invalid.");
    }

    const normalizedProjectRoot = path.resolve(projectRoot);
    const recordedInstallPath = typeof entry.installPath === "string" ? entry.installPath.trim() : "";
    if (recordedInstallPath) {
        const resolvedFromLock = path.resolve(normalizedProjectRoot, recordedInstallPath);
        const relativeToProject = path.relative(normalizedProjectRoot, resolvedFromLock);
        if (!relativeToProject.startsWith("..") && !path.isAbsolute(relativeToProject)) {
            return resolvedFromLock;
        }
    }

    return getPackageInstallDirectory(projectRoot, entry.name);
}

function normalizePackageName(packageName) {
    return String(packageName || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function isValidPackageName(packageName) {
    return /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(packageName) && !packageName.includes("..");
}

function isValidIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || "").trim());
}

function packageNameToDisplayName(packageName) {
    const baseName = normalizePackageName(packageName).split("/").pop() || "dreamshader-package";
    return baseName
        .replace(/^dreamshader[-_]/i, "")
        .split(/[-_.]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function packageNameToNamespace(packageName) {
    const displayName = packageNameToDisplayName(packageName);
    const namespaceName = displayName.replace(/[^A-Za-z0-9_]/g, "");
    if (!namespaceName || /^[0-9]/.test(namespaceName)) {
        return "DreamPackage";
    }
    return namespaceName;
}

function readPackageLock(projectRoot) {
    const lockPath = getPackageLockPath(projectRoot);
    if (!fs.existsSync(lockPath)) {
        return { version: 1, packages: {} };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (!parsed || typeof parsed !== "object") {
            return { version: 1, packages: {} };
        }

        if (!parsed.packages || typeof parsed.packages !== "object" || Array.isArray(parsed.packages)) {
            parsed.packages = {};
        }

        parsed.version = 1;
        return parsed;
    } catch (_error) {
        return { version: 1, packages: {} };
    }
}

function writePackageLock(projectRoot, lock) {
    const lockPath = getPackageLockPath(projectRoot);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const normalizedLock = {
        version: 1,
        packages: lock && lock.packages && typeof lock.packages === "object" ? lock.packages : {}
    };
    fs.writeFileSync(lockPath, `${JSON.stringify(normalizedLock, null, 2)}\n`, "utf8");
}

function readPackageManifest(packageDirectory) {
    const manifestPath = path.join(packageDirectory, PACKAGE_MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Repository is not a DreamShader package. Missing ${PACKAGE_MANIFEST_NAME}.`);
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
        throw new Error(`Invalid ${PACKAGE_MANIFEST_NAME}: ${formatError(error)}`);
    }

    if (!manifest || typeof manifest.name !== "string" || !manifest.name.trim()) {
        throw new Error(`${PACKAGE_MANIFEST_NAME} must declare a non-empty string field 'name'.`);
    }

    manifest.name = normalizePackageName(manifest.name);
    if (!isValidPackageName(manifest.name)) {
        throw new Error(`Invalid DreamShader package name '${manifest.name}'. Use 'name' or '@scope/name'.`);
    }

    if (manifest.version !== undefined && typeof manifest.version !== "string") {
        throw new Error(`${PACKAGE_MANIFEST_NAME} field 'version' must be a string.`);
    }

    return manifest;
}

async function installPackageFromRepository(projectRoot, repositorySpecifier, options = {}) {
    const localSourceDirectory = resolveExistingLocalPackageDirectory(repositorySpecifier);
    if (localSourceDirectory) {
        return installPackageFromLocalDirectory(projectRoot, localSourceDirectory, options);
    }

    const repository = normalizeRepositorySpecifier(repositorySpecifier);
    const installRoot = path.join(projectRoot, "Saved", "DreamShader", "PackageInstall", `${Date.now()}-${Math.floor(Math.random() * 100000)}`);
    const checkoutDirectory = path.join(installRoot, "source");
    fs.mkdirSync(installRoot, { recursive: true });

    try {
        await runGit(["clone", "--depth", "1", repository, checkoutDirectory], projectRoot);

        const manifest = readPackageManifest(checkoutDirectory);
        const commit = (await runGit(["-C", checkoutDirectory, "rev-parse", "HEAD"], projectRoot)).stdout.trim();
        const resolvedRepository = getPackageRepository(manifest) || repository;
        const installDirectory = getPackageInstallDirectory(projectRoot, manifest.name);

        if (fs.existsSync(installDirectory) && !options.forceReplace) {
            await confirmPackageReplace(manifest.name, installDirectory, options);
        }

        fs.mkdirSync(path.dirname(installDirectory), { recursive: true });
        fs.rmSync(installDirectory, { recursive: true, force: true });
        fs.cpSync(checkoutDirectory, installDirectory, { recursive: true });
        fs.rmSync(path.join(installDirectory, ".git"), { recursive: true, force: true });

        const lock = readPackageLock(projectRoot);
        lock.packages[manifest.name] = buildPackageLockEntry(projectRoot, installDirectory, manifest, resolvedRepository, repository, commit);
        writePackageLock(projectRoot, lock);

        return lock.packages[manifest.name];
    } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
    }
}

async function installPackageFromLocalDirectory(projectRoot, sourceDirectory, options = {}) {
    const normalizedSourceDirectory = normalizeFsPath(path.resolve(sourceDirectory));
    const manifest = readPackageManifest(normalizedSourceDirectory);
    const installDirectory = getPackageInstallDirectory(projectRoot, manifest.name);
    const normalizedInstallDirectory = normalizeFsPath(path.resolve(installDirectory));

    if (normalizedInstallDirectory.toLowerCase() === normalizedSourceDirectory.toLowerCase()) {
        const lock = readPackageLock(projectRoot);
        lock.packages[manifest.name] = buildPackageLockEntry(projectRoot, installDirectory, manifest, "local", normalizedSourceDirectory, "local");
        writePackageLock(projectRoot, lock);
        return lock.packages[manifest.name];
    }

    if (fs.existsSync(installDirectory) && !options.forceReplace) {
        await confirmPackageReplace(manifest.name, installDirectory, options);
    }

    fs.mkdirSync(path.dirname(installDirectory), { recursive: true });
    fs.rmSync(installDirectory, { recursive: true, force: true });
    fs.cpSync(normalizedSourceDirectory, installDirectory, { recursive: true });
    fs.rmSync(path.join(installDirectory, ".git"), { recursive: true, force: true });

    const lock = readPackageLock(projectRoot);
    lock.packages[manifest.name] = buildPackageLockEntry(projectRoot, installDirectory, manifest, "local", normalizedSourceDirectory, "local");
    writePackageLock(projectRoot, lock);
    return lock.packages[manifest.name];
}

async function confirmPackageReplace(packageName, installDirectory, options) {
    if (options.askBeforeReplace) {
        const choice = await vscode.window.showQuickPick([
            { label: "$(replace) Replace existing package", description: packageName, value: "replace" },
            { label: "$(circle-slash) Cancel", value: "cancel" }
        ], {
            title: `Package ${packageName} is already installed`,
            placeHolder: installDirectory
        });
        if (!choice || choice.value !== "replace") {
            throw new Error("Install cancelled.");
        }
        return;
    }

    throw new Error(`Package '${packageName}' is already installed.`);
}

function buildPackageLockEntry(projectRoot, installDirectory, manifest, resolvedRepository, resolvedSource, commit) {
    return {
        name: manifest.name,
        version: manifest.version || "0.0.0",
        displayName: manifest.displayName || manifest.name,
        description: manifest.description || "",
        repository: getPackageRepository(manifest) || resolvedRepository || "",
        resolved: resolvedSource,
        commit,
        installedAtUtc: new Date().toISOString(),
        installPath: normalizeFsPath(path.relative(projectRoot, installDirectory)),
        entry: manifest.dreamshader && typeof manifest.dreamshader.entry === "string" ? manifest.dreamshader.entry : ""
    };
}

function collectInstalledPackages(projectRoot) {
    const entries = new Map();
    const lock = readPackageLock(projectRoot);
    for (const [name, entry] of Object.entries(lock.packages)) {
        entries.set(name, { ...entry, name });
    }

    const packagesDirectory = getPackagesDirectory(projectRoot);
    for (const manifestPath of findPackageManifestFiles(packagesDirectory, 4)) {
        try {
            const manifest = readPackageManifest(path.dirname(manifestPath));
            const existing = entries.get(manifest.name) || {};
            entries.set(manifest.name, {
                ...existing,
                name: manifest.name,
                version: manifest.version || existing.version || "0.0.0",
                displayName: manifest.displayName || existing.displayName || manifest.name,
                description: manifest.description || existing.description || "",
                repository: getPackageRepository(manifest) || existing.repository || "",
                installPath: normalizeFsPath(path.relative(projectRoot, path.dirname(manifestPath)))
            });
        } catch (_error) {
            // Ignore malformed packages in list views.
        }
    }

    return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findPackageManifestFiles(rootDirectory, maxDepth) {
    const results = [];
    if (!fs.existsSync(rootDirectory) || maxDepth < 0) {
        return results;
    }

    let entries = [];
    try {
        entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
    } catch (_error) {
        return results;
    }

    for (const entry of entries) {
        const absolutePath = path.join(rootDirectory, entry.name);
        if (entry.isFile() && entry.name === PACKAGE_MANIFEST_NAME) {
            results.push(absolutePath);
            continue;
        }

        if (entry.isDirectory() && maxDepth > 0) {
            results.push(...findPackageManifestFiles(absolutePath, maxDepth - 1));
        }
    }

    return results;
}

async function loadPackageStoreEntries() {
    const entriesByRepository = new Map();
    const addEntry = (entry, source) => {
        if (!entry) {
            return;
        }

        const repository = getPackageRepository(entry);
        const localPath = getPackageLocalPath(entry);
        if (!repository && !localPath) {
            return;
        }

        let normalizedRepository = "";
        if (repository) {
            try {
                normalizedRepository = normalizeRepositorySpecifier(repository);
            } catch (_error) {
                if (!localPath) {
                    return;
                }
            }
        }

        const installSource = localPath || normalizedRepository;
        const key = (entry.name || installSource).toLowerCase();
        if (entriesByRepository.has(key)) {
            return;
        }

        entriesByRepository.set(key, {
            name: typeof entry.name === "string" ? entry.name : getRepositoryDisplayName(installSource),
            displayName: typeof entry.displayName === "string" ? entry.displayName : "",
            description: typeof entry.description === "string" ? entry.description : "",
            repository: normalizedRepository,
            localPath,
            installSource,
            tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
            source: source === "github" ? "GitHub" : "Index",
            sourceUrl: source
        });
    };

    for (const entry of await loadConfiguredPackageIndexEntries()) {
        addEntry(entry, "index");
    }

    for (const entry of await loadGitHubTopicPackageEntries()) {
        addEntry(entry, "github");
    }

    return Array.from(entriesByRepository.values()).sort((a, b) => {
        const left = (a.displayName || a.name || "").toLowerCase();
        const right = (b.displayName || b.name || "").toLowerCase();
        return left.localeCompare(right);
    });
}

async function loadConfiguredPackageIndexEntries() {
    const entries = [];
    for (const source of getPackageIndexSources()) {
        try {
            const parsed = await readJsonFromUrlOrFile(source);
            const sourceEntries = Array.isArray(parsed)
                ? parsed
                : parsed && Array.isArray(parsed.packages)
                    ? parsed.packages
                    : [];

            for (const entry of sourceEntries) {
                if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                    entries.push({ ...entry, source, localPath: resolvePackageEntryLocalPath(entry, source) });
                }
            }
        } catch (_error) {
            // Keep the store usable if one source is unavailable.
        }
    }

    return entries;
}

function getPackageIndexSources() {
    const configuration = vscode.workspace.getConfiguration("dreamshader");
    const configuredSources = configuration.get("packageStoreIndexUrls", []);
    const sourceInspection = configuration.inspect("packageStoreIndexUrls");
    const hasExplicitSourceList = Boolean(sourceInspection && (
        Array.isArray(sourceInspection.globalValue)
        || Array.isArray(sourceInspection.workspaceValue)
        || Array.isArray(sourceInspection.workspaceFolderValue)));
    const legacyInspection = configuration.inspect("packageStoreIndexUrl");
    const legacySource = legacyInspection
        ? (legacyInspection.workspaceFolderValue || legacyInspection.workspaceValue || legacyInspection.globalValue || "")
        : "";
    const sources = [];

    if (Array.isArray(configuredSources)) {
        for (const source of configuredSources) {
            addUniquePackageSource(sources, source);
        }
    }

    addUniquePackageSource(sources, legacySource);

    if (sources.length === 0 && !hasExplicitSourceList) {
        sources.push(DEFAULT_PACKAGE_INDEX_URL);
    }

    return sources;
}

async function addPackageIndexSource(source) {
    const sources = getPackageIndexSources();
    addUniquePackageSource(sources, source);
    await vscode.workspace.getConfiguration("dreamshader").update("packageStoreIndexUrls", sources, vscode.ConfigurationTarget.Global);
}

async function removePackageIndexSource(source) {
    const normalizedSource = normalizePackageSource(source);
    const sources = getPackageIndexSources().filter((entry) => normalizePackageSource(entry).toLowerCase() !== normalizedSource.toLowerCase());
    await vscode.workspace.getConfiguration("dreamshader").update("packageStoreIndexUrls", sources, vscode.ConfigurationTarget.Global);
}

function addUniquePackageSource(sources, source) {
    const normalized = normalizePackageSource(source);
    if (!normalized) {
        return;
    }

    if (!sources.some((entry) => normalizePackageSource(entry).toLowerCase() === normalized.toLowerCase())) {
        sources.push(normalized);
    }
}

function normalizePackageSource(source) {
    return String(source || "").trim();
}

async function loadGitHubTopicPackageEntries() {
    const enabled = vscode.workspace.getConfiguration("dreamshader").get("enableGitHubPackageSearch", true);
    if (!enabled) {
        return [];
    }

    try {
        const response = await fetchJson("https://api.github.com/search/repositories?q=topic:dreamshader-package&sort=stars&order=desc&per_page=50");
        if (!response || !Array.isArray(response.items)) {
            return [];
        }

        return response.items.map((repo) => ({
            name: repo.full_name,
            displayName: repo.name,
            description: repo.description || "",
            repository: repo.clone_url || repo.html_url,
            tags: Array.isArray(repo.topics) ? repo.topics : []
        }));
    } catch (_error) {
        return [];
    }
}

function getPackageRepository(entry) {
    if (!entry) {
        return "";
    }

    if (typeof entry.repository === "string") {
        return entry.repository;
    }

    if (entry.repository && typeof entry.repository.url === "string") {
        return entry.repository.url;
    }

    if (typeof entry.github === "string") {
        return entry.github;
    }

    return "";
}

function getPackageLocalPath(entry) {
    if (!entry) {
        return "";
    }

    if (typeof entry.localPath === "string" && entry.localPath.trim()) {
        return normalizeFsPath(entry.localPath.trim());
    }

    if (typeof entry.path === "string" && entry.path.trim()) {
        return normalizeFsPath(entry.path.trim());
    }

    return "";
}

function resolvePackageEntryLocalPath(entry, source) {
    const rawPath = getPackageLocalPath(entry);
    if (!rawPath) {
        return "";
    }

    const directPath = rawPath.startsWith("file://")
        ? vscode.Uri.parse(rawPath).fsPath
        : rawPath;
    if (path.isAbsolute(directPath)) {
        return fs.existsSync(directPath) ? normalizeFsPath(path.resolve(directPath)) : "";
    }

    const sourceFilePath = getLocalIndexSourceFilePath(source);
    if (sourceFilePath) {
        const resolvedPath = path.resolve(path.dirname(sourceFilePath), directPath);
        return fs.existsSync(resolvedPath) ? normalizeFsPath(resolvedPath) : "";
    }

    return "";
}

function getLocalIndexSourceFilePath(source) {
    const text = String(source || "").trim();
    if (!text || /^https?:\/\//i.test(text)) {
        return "";
    }

    if (text.startsWith("file://")) {
        return vscode.Uri.parse(text).fsPath;
    }

    return path.resolve(text);
}

function resolveExistingLocalPackageDirectory(source) {
    const text = String(source || "").trim();
    if (!text || /^https?:\/\//i.test(text) || /^git@/i.test(text) || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
        return "";
    }

    const candidate = text.startsWith("file://")
        ? vscode.Uri.parse(text).fsPath
        : text;
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) {
        return "";
    }

    const stat = fs.statSync(resolved);
    const directory = stat.isFile() && path.basename(resolved) === PACKAGE_MANIFEST_NAME
        ? path.dirname(resolved)
        : resolved;

    if (!fs.existsSync(path.join(directory, PACKAGE_MANIFEST_NAME))) {
        return "";
    }

    return directory;
}

function normalizeRepositorySpecifier(repositorySpecifier) {
    const value = String(repositorySpecifier || "").trim().replace(/^git\+/i, "");
    if (!value) {
        throw new Error("Repository is empty.");
    }

    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\.git\/?$/i.test(value)) {
        return value.replace(/\/$/, "");
    }

    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
        return `https://github.com/${value}.git`;
    }

    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(value)) {
        return `${value.replace(/\/$/, "")}.git`;
    }

    if (/^https?:\/\//i.test(value) || /^git@/i.test(value)) {
        return value;
    }

    throw new Error(`Unsupported repository specifier '${value}'. Use a GitHub URL or owner/repo.`);
}

function getRepositoryDisplayName(repository) {
    const text = String(repository || "").replace(/\.git$/i, "").replace(/\/$/, "");
    const match = text.match(/github\.com[:/]([^/]+\/[^/]+)$/i);
    if (match) {
        return match[1];
    }
    return path.basename(text) || text;
}

function normalizeRepositoryWebUrl(repository) {
    const text = String(repository || "").trim().replace(/^git\+/i, "").replace(/\.git$/i, "");
    const sshMatch = text.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
    if (sshMatch) {
        return `https://github.com/${sshMatch[1]}`;
    }
    return text;
}

function runGit(args, cwd) {
    return new Promise((resolve, reject) => {
        childProcess.execFile("git", args, { cwd, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error((stderr || stdout || error.message).trim()));
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

async function readJsonFromUrlOrFile(source) {
    const text = String(source || "").trim();
    if (!text) {
        throw new Error("Empty package index URL.");
    }

    if (/^https?:\/\//i.test(text)) {
        return fetchJson(text);
    }

    const filePath = text.startsWith("file://") ? vscode.Uri.parse(text).fsPath : text;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "DreamShaderLang-VSCode"
            }
        }, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                fetchJson(response.headers.location).then(resolve, reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }

            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                body += chunk;
            });
            response.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

function renderPackageStoreHtml(state) {
    const safeState = JSON.stringify({
        entries: state.entries || [],
        installed: (state.installed || []).map((entry) => ({
            name: entry.name,
            version: entry.version || "",
            repository: entry.repository || ""
        })),
        sources: state.sources || [],
        loading: Boolean(state.loading),
        status: state.status || ""
    }).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DreamShader Package Store</title>
    <style>
        body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; padding: 20px; }
        .toolbar, .sources { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
        input { flex: 1; min-width: 220px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); padding: 7px 9px; }
        button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 7px 11px; cursor: pointer; }
        button.secondary { color: var(--vscode-editor-foreground); background: transparent; border: 1px solid var(--vscode-panel-border); }
        .status { color: var(--vscode-descriptionForeground); min-height: 20px; }
        .status.error { color: var(--vscode-errorForeground); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 12px; }
        .card { border: 1px solid var(--vscode-panel-border); padding: 12px; border-radius: 6px; background: var(--vscode-sideBar-background); }
        .name { font-weight: 700; overflow-wrap: anywhere; }
        .muted { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
        .actions { display: flex; gap: 8px; margin-top: 10px; }
        .source { display: flex; gap: 8px; align-items: center; border: 1px solid var(--vscode-panel-border); padding: 6px 8px; }
    </style>
</head>
<body>
    <h1>DreamShader Package Store</h1>
    <div class="muted">Installed packages, configured package indexes, and GitHub topic results.</div>
    <div class="toolbar">
        <input id="search" placeholder="Search packages..." />
        <button id="refresh">Refresh</button>
        <button id="createPackage" class="secondary">Create Package</button>
    </div>
    <div class="toolbar">
        <input id="sourceInput" placeholder="packages.json URL or local path" />
        <button id="addSource">Add Source</button>
        <button id="settings" class="secondary">Settings</button>
    </div>
    <div id="sources" class="sources"></div>
    <div id="status" class="status"></div>
    <div id="cards" class="grid"></div>
    <script>
        const vscode = acquireVsCodeApi();
        const state = ${safeState};
        const installedNames = new Set(state.installed.map((entry) => String(entry.name || "").toLowerCase()));
        const search = document.getElementById("search");
        const cards = document.getElementById("cards");
        const sources = document.getElementById("sources");
        const status = document.getElementById("status");
        const sourceInput = document.getElementById("sourceInput");

        function escapeHtml(value) {
            return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
        }

        function setStatus(text, isError) {
            status.textContent = text || "";
            status.className = isError ? "status error" : "status";
        }

        function renderSources() {
            sources.innerHTML = state.sources.length ? "" : '<span class="muted">No index sources configured.</span>';
            for (const source of state.sources) {
                const node = document.createElement("div");
                node.className = "source";
                node.innerHTML = '<span class="muted">' + escapeHtml(source) + '</span><button class="secondary" data-remove-source="' + escapeHtml(source) + '">Remove</button>';
                sources.appendChild(node);
            }
        }

        function renderCards() {
            const query = search.value.trim().toLowerCase();
            const entries = state.entries.filter((entry) => [entry.name, entry.displayName, entry.description, entry.repository, entry.localPath, ...(entry.tags || [])].join(" ").toLowerCase().includes(query));
            cards.innerHTML = "";
            if (state.loading) {
                cards.innerHTML = '<div class="muted">Loading package store...</div>';
                return;
            }
            if (!entries.length) {
                cards.innerHTML = '<div class="muted">No packages found.</div>';
                return;
            }
            for (const entry of entries) {
                const installed = installedNames.has(String(entry.name || "").toLowerCase());
                const node = document.createElement("article");
                node.className = "card";
                node.innerHTML = [
                    '<div class="name">' + escapeHtml(entry.displayName || entry.name || "Unnamed Package") + (installed ? ' <span class="muted">(installed)</span>' : '') + '</div>',
                    '<div class="muted">' + escapeHtml(entry.name || "") + '</div>',
                    '<p>' + escapeHtml(entry.description || "No description provided.") + '</p>',
                    '<div class="muted">' + escapeHtml(entry.localPath || entry.repository || "") + '</div>',
                    '<div class="actions"><button data-install="' + escapeHtml(entry.installSource || entry.localPath || entry.repository || "") + '">' + (installed ? "Reinstall" : "Install") + '</button>',
                    entry.repository ? '<button class="secondary" data-repo="' + escapeHtml(entry.repository) + '">Repository</button>' : '',
                    '</div>'
                ].join("");
                cards.appendChild(node);
            }
        }

        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!target || !target.dataset) {
                return;
            }
            if (target.dataset.install) {
                setStatus("Installing " + target.dataset.install + "...");
                vscode.postMessage({ command: "install", repository: target.dataset.install });
            } else if (target.dataset.repo) {
                vscode.postMessage({ command: "openRepository", repository: target.dataset.repo });
            } else if (target.dataset.removeSource) {
                vscode.postMessage({ command: "removeSource", source: target.dataset.removeSource });
            }
        });
        document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ command: "refresh" }));
        document.getElementById("createPackage").addEventListener("click", () => vscode.postMessage({ command: "createPackage" }));
        document.getElementById("settings").addEventListener("click", () => vscode.postMessage({ command: "openSettings" }));
        document.getElementById("addSource").addEventListener("click", () => {
            const source = sourceInput.value.trim();
            if (!source) {
                setStatus("Enter an index source first.", true);
                return;
            }
            vscode.postMessage({ command: "addSource", source });
        });
        search.addEventListener("input", renderCards);
        window.addEventListener("message", (event) => {
            if (event.data && event.data.type === "status") {
                setStatus(event.data.text, event.data.isError);
            }
        });
        renderSources();
        renderCards();
        setStatus(state.status || (state.entries.length ? state.entries.length + " package(s) loaded." : ""));
    </script>
</body>
</html>`;
}

function formatError(error) {
    return error && error.message ? error.message : String(error);
}

module.exports = {
    addPackageIndexSource,
    collectInstalledPackages,
    formatError,
    getPackageIndexSources,
    getPackageInstallDirectory,
    getPackagesDirectory,
    getRepositoryDisplayName,
    installPackageFromRepository,
    isValidIdentifier,
    isValidPackageName,
    loadPackageStoreEntries,
    normalizePackageName,
    normalizeRepositoryWebUrl,
    packageNameToDisplayName,
    packageNameToNamespace,
    readPackageLock,
    removePackageIndexSource,
    renderPackageStoreHtml,
    resolveInstalledPackageDirectory,
    writePackageLock
};
