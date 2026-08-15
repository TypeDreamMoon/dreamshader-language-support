"use strict";

const fs = require("fs");
const path = require("path");
const { DREAMSHADER_EXTENSIONS } = require("../languageData");
const { normalizeFsPath, isSameOrSubPath } = require("../common/path");
const { host } = require("../host");

function getConfiguredProjectRoot() {
    const configured = host().getSetting("projectRoot", "");
    return configured ? path.resolve(configured) : "";
}

// Walking up from a file to find its .uproject is a handful of fs.readdirSync calls per ancestor
// directory -- cheap once, but every totally-independent completion/hover/diagnostics call re-runs
// it from scratch (there's no other shared per-document cache upstream of these functions), and a
// language-server completion trigger fires on every keystroke. A project's root relative to a given
// file/workspace practically never changes mid-session, so this is memoized by input path/root and
// only invalidated when something that could actually change the answer happens (workspace folders
// or the dreamshader.projectRoot setting changing) -- see invalidateProjectRootCache().
const projectRootCache = new Map();
const knownProjectRootsCache = new Map();
const sourceRootsCache = new Map();
const ancestorSourceRootCache = new Map();

function invalidateProjectRootCache() {
    projectRootCache.clear();
    knownProjectRootsCache.clear();
    sourceRootsCache.clear();
    ancestorSourceRootCache.clear();
}

function findProjectRoot(inputPath = "") {
    if (projectRootCache.has(inputPath)) {
        return projectRootCache.get(inputPath);
    }
    const result = computeProjectRoot(inputPath);
    projectRootCache.set(inputPath, result);
    return result;
}

function computeProjectRoot(inputPath) {
    const configured = getConfiguredProjectRoot();
    if (configured && fs.existsSync(configured)) {
        return normalizeFsPath(configured);
    }

    const startPath = inputPath
        ? (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory() ? inputPath : path.dirname(inputPath))
        : host().getWorkspaceFolderPaths()[0] || "";
    const discovered = findUp(startPath, containsUproject);
    if (discovered) {
        return normalizeFsPath(discovered);
    }

    for (const folderPath of host().getWorkspaceFolderPaths()) {
        const root = findUp(folderPath, containsUproject);
        if (root) {
            return normalizeFsPath(root);
        }
    }

    return "";
}

function findProjectRootForCommand() {
    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        return configuredRoot;
    }

    // Commands only, which is why this is the one place that reaches for the focused editor. On the
    // server side every one of these is empty and the configured root above is the only answer --
    // correctly so: nothing here is reachable from a language request.
    const candidates = [
        host().getActiveDocumentPath(),
        ...host().getOpenDocumentPaths(),
        ...host().getWorkspaceFolderPaths()
    ].filter(Boolean);

    for (const candidate of candidates) {
        const root = findProjectRootFromCandidate(candidate);
        if (root) {
            return root;
        }
    }

    return "";
}

function findProjectRootFromCandidate(candidatePath) {
    if (!candidatePath) {
        return "";
    }

    let resolvedCandidate = path.resolve(candidatePath);
    try {
        if (!fs.existsSync(resolvedCandidate)) {
            return "";
        }
        if (fs.statSync(resolvedCandidate).isFile()) {
            resolvedCandidate = path.dirname(resolvedCandidate);
        }
    } catch (_error) {
        return "";
    }

    return findProjectRootFromDirectory(resolvedCandidate);
}

function findProjectRootFromDirectory(startDirectory) {
    return findUp(startDirectory, containsUproject);
}

function collectKnownProjectRoots(activePath = "") {
    if (knownProjectRootsCache.has(activePath)) {
        return knownProjectRootsCache.get(activePath);
    }

    const roots = new Set();
    const configured = getConfiguredProjectRoot();
    if (configured && fs.existsSync(configured)) {
        roots.add(normalizeFsPath(configured));
    }
    const activeRoot = findProjectRoot(activePath);
    if (activeRoot) {
        roots.add(normalizeFsPath(activeRoot));
    }
    for (const folderPath of host().getWorkspaceFolderPaths()) {
        const root = findProjectRoot(folderPath);
        if (root) {
            roots.add(normalizeFsPath(root));
        }
    }

    const result = Array.from(roots);
    knownProjectRootsCache.set(activePath, result);
    return result;
}

function getDShaderRoot(projectRoot) {
    return projectRoot ? normalizeFsPath(path.join(projectRoot, "DShader")) : "";
}

function getPackagesDirectory(projectRoot) {
    const dshaderRoot = getDShaderRoot(projectRoot);
    return dshaderRoot ? normalizeFsPath(path.join(dshaderRoot, "Packages")) : "";
}

// ------------------------------------------------------------------------- source roots

// Source discovery runs over a list of roots, not a single directory -- the plugin's
// `FDreamShaderSourceRoot`, mirrored. The project always contributes `<Project>/DShader`; every
// plugin that ships a `DShader` folder contributes one more, with its own `Packages` beside it.
//
// A root is the unit of import resolution: an unqualified specifier is resolved against the bases of
// the root that owns the importing file and never against another root's, so adding a plugin cannot
// change what an existing import means. Before this list existed everything resolved against
// `<Project>/DShader` and was containment-checked against it, which made every import inside a
// plugin's own tree report as unresolvable. See the plugin's Docs/language/import.md#roots.

/** Directories below `<Project>/Plugins` that are searched for a `.uplugin`. `Plugins/Category/Foo/`. */
const PLUGIN_SCAN_MAX_DEPTH = 3;

function makeSourceRoot(directory, { displayName = "", pluginName = "", isProjectRoot = false } = {}) {
    const resolved = normalizeFsPath(path.resolve(directory));
    return {
        directory: resolved,
        packagesDirectory: normalizeFsPath(path.join(resolved, "Packages")),
        displayName: displayName || pluginName || "Project",
        pluginName,
        isProjectRoot
    };
}

/** The project root first, then one root per plugin under `<Project>/Plugins` that has a `DShader`. */
function collectSourceRoots(projectRoot) {
    if (sourceRootsCache.has(projectRoot)) {
        return sourceRootsCache.get(projectRoot);
    }

    const roots = [];
    const dshaderRoot = getDShaderRoot(projectRoot);
    if (dshaderRoot) {
        roots.push(makeSourceRoot(dshaderRoot, { displayName: "Project", isProjectRoot: true }));
        collectPluginSourceRoots(projectRoot, roots);
    }

    sourceRootsCache.set(projectRoot, roots);
    return roots;
}

function collectPluginSourceRoots(projectRoot, roots) {
    for (const plugin of collectPluginDirectories(path.join(projectRoot, "Plugins"), 0, [])) {
        const candidate = path.join(plugin.directory, "DShader");
        if (!isDirectory(candidate)) {
            continue;
        }
        const root = makeSourceRoot(candidate, { displayName: plugin.name, pluginName: plugin.name });
        // Overlapping roots would hand the same file to two owners and make resolution depend on
        // scan order -- the plugin drops them with a warning, and so do we, silently.
        if (roots.some((existing) => overlaps(existing.directory, root.directory))) {
            continue;
        }
        roots.push(root);
    }
}

function collectPluginDirectories(directory, depth, found) {
    if (depth > PLUGIN_SCAN_MAX_DEPTH || !isDirectory(directory)) {
        return found;
    }

    let entries = [];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_error) {
        return found;
    }

    const descriptor = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".uplugin"));
    if (descriptor) {
        // A plugin's own tree is not searched for further plugins: `Content` and `Intermediate` are
        // deep, and this walk sits under every import resolution.
        found.push({ name: path.basename(descriptor.name, path.extname(descriptor.name)), directory });
        return found;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            collectPluginDirectories(path.join(directory, entry.name), depth + 1, found);
        }
    }
    return found;
}

/**
 * The root owning `filePath`, or null when the path is under none.
 *
 * Roots never overlap, so the longest match is only a defensive tie-break -- the same one the plugin
 * makes in `FindSourceRootForFile`.
 */
function findSourceRootForFile(filePath, roots) {
    if (!filePath) {
        return null;
    }
    let best = null;
    for (const root of roots) {
        if (isSameOrSubPath(root.directory, filePath)
            && (!best || root.directory.length > best.directory.length)) {
            best = root;
        }
    }
    return best;
}

/**
 * Editor-side fallback for a file the root list does not cover.
 *
 * The plugin asks `IPluginManager` which plugins are mounted; an editor has no such list. A plugin
 * outside `<Project>/Plugins`, an engine plugin, or a bare `DShader` folder opened as a workspace
 * folder with no `.uproject` above it therefore contribute no root here even though the engine
 * compiles them. Walking up to the nearest ancestor named `DShader` recovers the root the engine
 * would have contributed; without it every import in those files reports as unresolvable, which is
 * the worse of the two ways to disagree with the compiler.
 */
function findAncestorSourceRoot(filePath) {
    if (!filePath) {
        return null;
    }
    const startDirectory = normalizeFsPath(path.dirname(path.resolve(filePath)));
    if (ancestorSourceRootCache.has(startDirectory)) {
        return ancestorSourceRootCache.get(startDirectory);
    }

    let root = null;
    let current = startDirectory;
    while (current) {
        if (path.basename(current).toLowerCase() === "dshader" && isDirectory(current)) {
            root = makeSourceRoot(current, describeSourceRootOwner(path.dirname(current)));
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    ancestorSourceRootCache.set(startDirectory, root);
    return root;
}

/** Whether the directory holding a `DShader` folder is a plugin, a project, or neither. */
function describeSourceRootOwner(ownerDirectory) {
    let entries = [];
    try {
        entries = fs.readdirSync(ownerDirectory, { withFileTypes: true });
    } catch (_error) {
        return { displayName: path.basename(ownerDirectory) };
    }

    const descriptor = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".uplugin"));
    if (descriptor) {
        const name = path.basename(descriptor.name, path.extname(descriptor.name));
        return { displayName: name, pluginName: name };
    }
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".uproject"))) {
        return { displayName: "Project", isProjectRoot: true };
    }
    return { displayName: path.basename(ownerDirectory) };
}

function overlaps(firstDirectory, secondDirectory) {
    return isSameOrSubPath(firstDirectory, secondDirectory) || isSameOrSubPath(secondDirectory, firstDirectory);
}

function isDirectory(candidate) {
    try {
        return Boolean(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch (_error) {
        return false;
    }
}

function isDreamShaderDocument(document) {
    return Boolean(document && document.languageId === "dreamshaderlang"
        && DREAMSHADER_EXTENSIONS.has(path.extname(document.fileName).toLowerCase()));
}

function containsUproject(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).some((entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith(".uproject"));
}

function findUp(startDirectory, predicate) {
    let current = path.resolve(startDirectory || ".");
    while (current && fs.existsSync(current)) {
        try {
            if (predicate(current)) {
                return current;
            }
        } catch (_error) {
            return "";
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return "";
}

module.exports = {
    getConfiguredProjectRoot,
    findProjectRoot,
    findProjectRootForCommand,
    findProjectRootFromCandidate,
    findProjectRootFromDirectory,
    collectKnownProjectRoots,
    invalidateProjectRootCache,
    getDShaderRoot,
    getPackagesDirectory,
    collectSourceRoots,
    findSourceRootForFile,
    findAncestorSourceRoot,
    isDreamShaderDocument
};
