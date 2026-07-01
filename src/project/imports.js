"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeFsPath, isSameOrSubPath } = require("../common/path");
const { findProjectRoot, getDShaderRoot, getPackagesDirectory } = require("./projects");

// Mirror the plugin's NormalizeImportSpecifier: normalize slashes, strip leading "./", and append
// ".dsh" when the specifier has no extension, so `import "ColorLib"` resolves to ColorLib.dsh.
function normalizeImportSpecifier(importPath) {
    let normalized = String(importPath || "").trim().replace(/\\/g, "/");
    while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
    }
    if (normalized && !/\.[A-Za-z0-9]+$/.test(normalized)) {
        normalized += ".dsh";
    }
    return normalized;
}

function resolveImportPath(fromFilePath, importPath) {
    const raw = normalizeImportSpecifier(importPath);
    if (!raw) {
        return "";
    }

    const fromDirectory = fromFilePath ? path.dirname(fromFilePath) : "";
    const projectRoot = findProjectRoot(fromFilePath);
    const dshaderRoot = getDShaderRoot(projectRoot);
    const packageRoot = getPackagesDirectory(projectRoot);
    const candidates = [];

    if (raw.startsWith("@")) {
        candidates.push(path.join(packageRoot, raw));
    } else {
        if (fromDirectory) {
            candidates.push(path.resolve(fromDirectory, raw));
        }
        if (dshaderRoot) {
            candidates.push(path.resolve(dshaderRoot, raw));
        }
        if (packageRoot) {
            candidates.push(path.resolve(packageRoot, raw));
        }
    }

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
            continue;
        }
        if (dshaderRoot && !isSameOrSubPath(dshaderRoot, candidate)) {
            continue;
        }
        return normalizeFsPath(candidate);
    }
    return "";
}

function collectAvailableImports(fromFilePath) {
    const projectRoot = findProjectRoot(fromFilePath);
    const dshaderRoot = getDShaderRoot(projectRoot);
    const packageRoot = getPackagesDirectory(projectRoot);
    const imports = [];
    if (dshaderRoot) {
        collectImportFiles(dshaderRoot, dshaderRoot, imports, "");
    }
    if (packageRoot && fs.existsSync(packageRoot)) {
        collectImportFiles(packageRoot, packageRoot, imports, "@");
    }
    return Array.from(new Set(imports)).sort();
}

function collectImportFiles(root, directory, imports, packagePrefix) {
    if (!fs.existsSync(directory)) {
        return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectImportFiles(root, fullPath, imports, packagePrefix);
            continue;
        }
        if (!/\.(dsh|dsf)$/i.test(entry.name)) {
            continue;
        }
        const relative = normalizeFsPath(path.relative(root, fullPath));
        imports.push(packagePrefix && !relative.startsWith("@") ? `${packagePrefix}${relative}` : relative);
    }
}

module.exports = {
    resolveImportPath,
    normalizeImportSpecifier,
    collectAvailableImports
};
