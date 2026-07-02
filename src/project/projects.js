"use strict";

const fs = require("fs");
const path = require("path");
const { DREAMSHADER_EXTENSIONS } = require("../languageData");
const { normalizeFsPath } = require("../common/path");

function getVscode() {
    try {
        return require("vscode");
    } catch (_error) {
        return null;
    }
}

function getConfiguredProjectRoot() {
    const vscode = getVscode();
    if (!vscode) {
        return "";
    }
    const configured = vscode.workspace.getConfiguration("dreamshader").get("projectRoot", "");
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

function invalidateProjectRootCache() {
    projectRootCache.clear();
    knownProjectRootsCache.clear();
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
        : getVscode()?.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const discovered = findUp(startPath, (directory) =>
        fs.readdirSync(directory, { withFileTypes: true }).some((entry) =>
            entry.isFile() && entry.name.toLowerCase().endsWith(".uproject")));
    if (discovered) {
        return normalizeFsPath(discovered);
    }

    for (const folder of getVscode()?.workspace.workspaceFolders || []) {
        const root = findUp(folder.uri.fsPath, (directory) =>
            fs.readdirSync(directory, { withFileTypes: true }).some((entry) =>
                entry.isFile() && entry.name.toLowerCase().endsWith(".uproject")));
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

    const vscode = getVscode();
    const candidates = [];
    const document = vscode?.window.activeTextEditor?.document;
    if (document?.uri?.fsPath) {
        candidates.push(document.uri.fsPath);
    }

    for (const openDocument of vscode?.workspace.textDocuments || []) {
        if (openDocument?.uri?.fsPath) {
            candidates.push(openDocument.uri.fsPath);
        }
    }

    for (const folder of vscode?.workspace.workspaceFolders || []) {
        if (folder?.uri?.fsPath) {
            candidates.push(folder.uri.fsPath);
        }
    }

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
    for (const folder of getVscode()?.workspace.workspaceFolders || []) {
        const root = findProjectRoot(folder.uri.fsPath);
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
    return normalizeFsPath(path.join(getDShaderRoot(projectRoot), "Packages"));
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
    isDreamShaderDocument
};
