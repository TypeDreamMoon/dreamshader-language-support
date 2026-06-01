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

function findProjectRoot(inputPath = "") {
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

function collectKnownProjectRoots(activePath = "") {
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
    return Array.from(roots);
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
    collectKnownProjectRoots,
    getDShaderRoot,
    getPackagesDirectory,
    isDreamShaderDocument
};
