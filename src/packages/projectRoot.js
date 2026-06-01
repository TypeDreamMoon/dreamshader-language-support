"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function normalizeFsPath(value) {
    return String(value || "").replace(/\\/g, "/");
}

function findProjectRootForCommand() {
    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        return configuredRoot;
    }

    const candidates = [];
    const document = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    if (document && document.uri && document.uri.fsPath) {
        candidates.push(document.uri.fsPath);
    }

    for (const openDocument of vscode.workspace.textDocuments || []) {
        if (openDocument && openDocument.uri && openDocument.uri.fsPath) {
            candidates.push(openDocument.uri.fsPath);
        }
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
        if (folder && folder.uri && folder.uri.fsPath) {
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

function getConfiguredProjectRoot() {
    const configuredRoot = vscode.workspace.getConfiguration("dreamshader").get("projectRoot", "");
    if (!configuredRoot) {
        return "";
    }

    const resolvedRoot = path.resolve(configuredRoot);
    return fs.existsSync(resolvedRoot) ? normalizeFsPath(resolvedRoot) : "";
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
    let current = path.resolve(startDirectory);
    while (true) {
        if (containsUproject(current)) {
            return normalizeFsPath(current);
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return "";
        }
        current = parent;
    }
}

function containsUproject(directory) {
    try {
        return fs.readdirSync(directory).some((entry) => entry.toLowerCase().endsWith(".uproject"));
    } catch (_error) {
        return false;
    }
}

module.exports = {
    findProjectRootForCommand,
    normalizeFsPath
};
