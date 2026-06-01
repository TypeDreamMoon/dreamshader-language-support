"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { findProjectRootForCommand, normalizeFsPath } = require("../../packages/projectRoot");
const {
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
} = require("../../packages");
const { createPackageScaffold } = require("../../packages/scaffold");

function registerPackageCommands(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("dreamshader.installPackageFromGitHub", async () => {
            await installPackageFromGitHubCommand();
        }),
        vscode.commands.registerCommand("dreamshader.browsePackages", async () => {
            await browsePackagesCommand();
        }),
        vscode.commands.registerCommand("dreamshader.updatePackages", async () => {
            await updatePackagesCommand();
        }),
        vscode.commands.registerCommand("dreamshader.removePackage", async () => {
            await removePackageCommand();
        }),
        vscode.commands.registerCommand("dreamshader.openPackagesFolder", async () => {
            await openPackagesFolderCommand();
        }),
        vscode.commands.registerCommand("dreamshader.addPackageStoreIndex", async () => {
            await addPackageStoreIndexCommand();
        }),
        vscode.commands.registerCommand("dreamshader.removePackageStoreIndex", async () => {
            await removePackageStoreIndexCommand();
        }),
        vscode.commands.registerCommand("dreamshader.createPackage", async () => {
            await createPackageCommand();
        })
    );
}

async function installPackageFromGitHubCommand() {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const repositorySpecifier = await vscode.window.showInputBox({
        title: "Install DreamShader Package",
        prompt: "GitHub repository URL or owner/repo, for example TypeDreamMoon/dream-noise.",
        placeHolder: "TypeDreamMoon/dream-noise"
    });

    if (!repositorySpecifier) {
        return;
    }

    try {
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Installing DreamShader package",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: repositorySpecifier });
            return installPackageFromRepository(projectRoot, repositorySpecifier, { askBeforeReplace: true });
        });

        vscode.window.showInformationMessage(`Installed DreamShader package ${result.name}@${result.version}.`);
    } catch (error) {
        vscode.window.showErrorMessage(`DreamShader package install failed: ${formatError(error)}`);
    }
}

async function browsePackagesCommand() {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        "dreamshaderPackageStore",
        "DreamShader Package Store",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        });

    panel.webview.html = renderPackageStoreHtml({
        entries: [],
        installed: collectInstalledPackages(projectRoot),
        sources: getPackageIndexSources(),
        loading: true,
        status: "Loading package store..."
    });

    panel.webview.onDidReceiveMessage(async (message) => {
        await handlePackageStoreWebviewMessage(panel, projectRoot, message);
    });

    await refreshPackageStorePanel(panel, projectRoot);
}

async function updatePackagesCommand() {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const installed = collectInstalledPackages(projectRoot).filter((entry) => entry.repository);
    if (installed.length === 0) {
        vscode.window.showInformationMessage("No installed DreamShader packages with repository metadata were found.");
        return;
    }

    const confirmation = await vscode.window.showQuickPick([
        { label: "$(cloud-download) Update all packages", description: `${installed.length} package(s)`, value: "update" },
        { label: "$(circle-slash) Cancel", value: "cancel" }
    ], {
        title: "Update DreamShader Packages",
        placeHolder: `${installed.length} package(s) will be reinstalled from their Git repositories.`
    });

    if (!confirmation || confirmation.value !== "update") {
        return;
    }

    const failures = [];
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Updating DreamShader packages",
        cancellable: false
    }, async (progress) => {
        for (const entry of installed) {
            progress.report({ message: entry.name });
            try {
                await installPackageFromRepository(projectRoot, entry.repository, { forceReplace: true });
            } catch (error) {
                failures.push(`${entry.name}: ${formatError(error)}`);
            }
        }
    });

    if (failures.length > 0) {
        vscode.window.showWarningMessage(`DreamShader updated with ${failures.length} failure(s). Check the output log for details.`);
        const channel = vscode.window.createOutputChannel("DreamShader Packages");
        channel.appendLine("DreamShader package update failures:");
        for (const failure of failures) {
            channel.appendLine(`- ${failure}`);
        }
        channel.show();
        return;
    }

    vscode.window.showInformationMessage(`Updated ${installed.length} DreamShader package(s).`);
}

async function removePackageCommand() {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const installed = collectInstalledPackages(projectRoot);
    if (installed.length === 0) {
        vscode.window.showInformationMessage("No installed DreamShader packages were found.");
        return;
    }

    const picked = await vscode.window.showQuickPick(installed.map((entry) => ({
        label: `$(package) ${entry.name}`,
        description: entry.version || "",
        detail: entry.description || entry.repository || "",
        entry
    })), {
        title: "Remove DreamShader Package",
        placeHolder: "Select an installed package to remove"
    });

    if (!picked) {
        return;
    }

    const confirmation = await vscode.window.showQuickPick([
        { label: "$(trash) Remove package", description: picked.entry.name, value: "remove" },
        { label: "$(circle-slash) Cancel", value: "cancel" }
    ], {
        title: `Remove ${picked.entry.name}?`,
        placeHolder: "This deletes the package folder under DShader/Packages."
    });

    if (!confirmation || confirmation.value !== "remove") {
        return;
    }

    try {
        const targetDirectory = resolveInstalledPackageDirectory(projectRoot, picked.entry);
        if (fs.existsSync(targetDirectory)) {
            fs.rmSync(targetDirectory, { recursive: true, force: true });
        }

        const lock = readPackageLock(projectRoot);
        delete lock.packages[picked.entry.name];
        writePackageLock(projectRoot, lock);
        vscode.window.showInformationMessage(`Removed DreamShader package ${picked.entry.name}.`);
    } catch (error) {
        vscode.window.showErrorMessage(`DreamShader package remove failed: ${formatError(error)}`);
    }
}

async function openPackagesFolderCommand() {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const packagesDirectory = getPackagesDirectory(projectRoot);
    fs.mkdirSync(packagesDirectory, { recursive: true });
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(packagesDirectory));
}

async function addPackageStoreIndexCommand() {
    const source = await vscode.window.showInputBox({
        title: "Add DreamShader Package Store Source",
        prompt: "Enter a packages.json URL or local file path.",
        placeHolder: "https://raw.githubusercontent.com/TypeDreamMoon/dreamshader-package-index/main/packages.json"
    });

    if (!source) {
        return;
    }

    await addPackageIndexSource(source);
    vscode.window.showInformationMessage("DreamShader package store source added.");
}

async function removePackageStoreIndexCommand() {
    const sources = getPackageIndexSources();
    if (sources.length === 0) {
        vscode.window.showInformationMessage("No DreamShader package store sources are configured.");
        return;
    }

    const picked = await vscode.window.showQuickPick(sources.map((source) => ({
        label: "$(link) Package index source",
        description: source,
        source
    })), {
        title: "Remove DreamShader Package Store Source",
        placeHolder: "Select an index source to remove"
    });

    if (!picked) {
        return;
    }

    await removePackageIndexSource(picked.source);
    vscode.window.showInformationMessage("DreamShader package store source removed.");
}

async function createPackageCommand() {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const packageNameInput = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Package Name",
        prompt: "Use 'name' or '@scope/name'.",
        placeHolder: "@typedreammoon/my-shader-pack",
        validateInput: (value) => {
            const normalized = normalizePackageName(value);
            if (!normalized) {
                return "Package name is required.";
            }
            return isValidPackageName(normalized) ? undefined : "Use 'name' or '@scope/name' with letters, numbers, '.', '_' or '-'.";
        }
    });
    if (!packageNameInput) {
        return;
    }

    const packageName = normalizePackageName(packageNameInput);
    const defaultDisplayName = packageNameToDisplayName(packageName);
    const displayName = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Display Name",
        prompt: "Human-readable package name.",
        value: defaultDisplayName
    });
    if (displayName === undefined) {
        return;
    }

    const description = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Description",
        prompt: "Short package description.",
        value: `Reusable DreamShaderLang functions for ${displayName || defaultDisplayName}.`
    });
    if (description === undefined) {
        return;
    }

    const namespaceName = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Namespace",
        prompt: "Default Namespace(Name=\"...\") used by the generated entry header.",
        value: packageNameToNamespace(packageName),
        validateInput: (value) => isValidIdentifier(value) ? undefined : "Namespace must be a valid identifier."
    });
    if (!namespaceName) {
        return;
    }

    const author = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Author",
        prompt: "Package author.",
        value: "TypeDreamMoon"
    });
    if (author === undefined) {
        return;
    }

    const repository = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Repository",
        prompt: "Optional GitHub repository URL. You can leave this empty for a local draft package.",
        placeHolder: `https://github.com/TypeDreamMoon/${packageName.split("/").pop()}`
    });
    if (repository === undefined) {
        return;
    }

    const targetPick = await vscode.window.showQuickPick([
        {
            label: "$(folder-library) Create in current project DShader/Packages",
            description: "Recommended",
            target: "project"
        },
        {
            label: "$(folder-opened) Choose another parent folder",
            description: "Creates the package folder under the selected parent folder",
            target: "custom"
        }
    ], {
        title: "Create DreamShader Package - Target Folder"
    });
    if (!targetPick) {
        return;
    }

    let targetDirectory = "";
    let isProjectPackage = false;
    if (targetPick.target === "project") {
        targetDirectory = getPackageInstallDirectory(projectRoot, packageName);
        isProjectPackage = true;
    } else {
        const folders = await vscode.window.showOpenDialog({
            title: "Select Package Parent Folder",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        });
        if (!folders || folders.length === 0) {
            return;
        }
        targetDirectory = path.join(folders[0].fsPath, ...packageName.split("/"));
    }

    const examplePick = await vscode.window.showQuickPick([
        { label: "$(file-code) Create example material", description: "Recommended", picked: true, value: true },
        { label: "$(circle-slash) No example material", value: false }
    ], {
        title: "Create DreamShader Package - Examples"
    });
    if (!examplePick) {
        return;
    }

    if (fs.existsSync(targetDirectory)) {
        const replace = await vscode.window.showQuickPick([
            { label: "$(replace) Replace existing folder", description: path.basename(targetDirectory), value: "replace" },
            { label: "$(circle-slash) Cancel", value: "cancel" }
        ], {
            title: "Package folder already exists",
            placeHolder: targetDirectory
        });
        if (!replace || replace.value !== "replace") {
            return;
        }
        fs.rmSync(targetDirectory, { recursive: true, force: true });
    }

    const manifest = {
        name: packageName,
        version: "0.1.0",
        displayName: displayName || defaultDisplayName,
        description: description || "",
        author: author || "",
        repository: repository || "",
        license: "MIT",
        dreamshader: {
            language: "DreamShaderLang",
            version: ">=1.0.0",
            entry: `Library/${namespaceName}.dsh`
        },
        keywords: ["dreamshader", "dreamshader-package"]
    };

    createPackageScaffold(targetDirectory, manifest, namespaceName, Boolean(examplePick.value));

    if (isProjectPackage) {
        const lock = readPackageLock(projectRoot);
        lock.packages[packageName] = {
            name: packageName,
            version: manifest.version,
            displayName: manifest.displayName,
            description: manifest.description,
            repository: manifest.repository,
            resolved: "local",
            commit: "local",
            installedAtUtc: new Date().toISOString(),
            installPath: normalizeFsPath(path.relative(projectRoot, targetDirectory)),
            entry: manifest.dreamshader.entry
        };
        writePackageLock(projectRoot, lock);
    }

    const entryHeader = path.join(targetDirectory, manifest.dreamshader.entry);
    await vscode.window.showTextDocument(vscode.Uri.file(entryHeader));
    vscode.window.showInformationMessage(`Created DreamShader package ${packageName}.`);
}

async function refreshPackageStorePanel(panel, projectRoot, status = "") {
    try {
        const entries = await loadPackageStoreEntries();
        panel.webview.html = renderPackageStoreHtml({
            entries,
            installed: collectInstalledPackages(projectRoot),
            sources: getPackageIndexSources(),
            loading: false,
            status
        });
    } catch (error) {
        panel.webview.html = renderPackageStoreHtml({
            entries: [],
            installed: collectInstalledPackages(projectRoot),
            sources: getPackageIndexSources(),
            loading: false,
            status: `Failed to load package store: ${formatError(error)}`
        });
    }
}

async function handlePackageStoreWebviewMessage(panel, projectRoot, message) {
    if (!message || typeof message.command !== "string") {
        return;
    }

    switch (message.command) {
        case "refresh":
            panel.webview.postMessage({ type: "status", text: "Refreshing package store..." });
            await refreshPackageStorePanel(panel, projectRoot);
            return;
        case "install":
            if (message.repository) {
                await installPackageFromStorePanel(panel, projectRoot, message.repository);
            }
            return;
        case "addSource":
            if (message.source) {
                await addPackageIndexSource(message.source);
                await refreshPackageStorePanel(panel, projectRoot, "Package source added.");
            }
            return;
        case "removeSource":
            if (message.source) {
                await removePackageIndexSource(message.source);
                await refreshPackageStorePanel(panel, projectRoot, "Package source removed.");
            }
            return;
        case "openRepository":
            if (message.repository) {
                await vscode.env.openExternal(vscode.Uri.parse(normalizeRepositoryWebUrl(message.repository)));
            }
            return;
        case "openSettings":
            await vscode.commands.executeCommand("workbench.action.openSettings", "dreamshader.packageStoreIndexUrls");
            return;
        case "createPackage":
            await createPackageCommand();
            await refreshPackageStorePanel(panel, projectRoot, "Package scaffold created.");
            return;
        default:
            return;
    }
}

async function installPackageFromStorePanel(panel, projectRoot, packageSource) {
    try {
        panel.webview.postMessage({ type: "status", text: `Installing ${getRepositoryDisplayName(packageSource)}...` });
        const result = await installPackageFromRepository(projectRoot, packageSource, { askBeforeReplace: true });
        await refreshPackageStorePanel(panel, projectRoot, `Installed ${result.name}@${result.version}.`);
        vscode.window.showInformationMessage(`Installed DreamShader package ${result.name}@${result.version}.`);
    } catch (error) {
        const message = `DreamShader package install failed: ${formatError(error)}`;
        panel.webview.postMessage({ type: "status", text: message, isError: true });
        vscode.window.showErrorMessage(message);
    }
}

module.exports = {
    addPackageStoreIndexCommand,
    browsePackagesCommand,
    createPackageCommand,
    installPackageFromGitHubCommand,
    openPackagesFolderCommand,
    registerPackageCommands,
    removePackageCommand,
    removePackageStoreIndexCommand,
    updatePackagesCommand
};
