"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeFsPath, isSameOrSubPath } = require("../common/path");
const {
    findProjectRoot,
    collectSourceRoots,
    findSourceRootForFile,
    findAncestorSourceRoot,
    getDShaderRoot,
    getPackagesDirectory
} = require("./projects");

// Resolution only. WHICH specifiers arrive here is decided in `language/parser.js`, and it is the
// union over every `#if` branch in the file -- an import inside a branch this build would cut is
// resolved, indexed and watched like any other, matching what the plugin's dependency graph does
// with the raw text. Nothing here may start filtering on a condition: this side has no define table
// to evaluate one against, so the only alternatives to the union are a guess or a hole.

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

/**
 * The roots an import from `fromFilePath` may see, and which of them owns the file.
 *
 * `roots` is the project's discovered list plus, when the file sits under none of them, the ancestor
 * `DShader` folder that the engine's plugin manager would have contributed and this side cannot see
 * -- so a plugin's own tree is a root here whether or not it was discoverable from a `.uproject`.
 */
function getResolutionContext(fromFilePath) {
    const projectRoot = findProjectRoot(fromFilePath);
    const discovered = collectSourceRoots(projectRoot);
    const owningRoot = findSourceRootForFile(fromFilePath, discovered);
    if (owningRoot) {
        return { projectRoot, roots: discovered, owningRoot };
    }

    const ancestorRoot = findAncestorSourceRoot(fromFilePath);
    return {
        projectRoot,
        roots: ancestorRoot ? [...discovered, ancestorRoot] : discovered,
        owningRoot: ancestorRoot
    };
}

/**
 * Recognizes the text before a `:` as a source-root qualifier: `Project`, or `Plugin`/`Plugins`
 * joined to a name by `.` or `/`. Anything else is not a qualifier, which is what keeps
 * `import "C:/Shared/Common.dsh"` an ordinary (failing) path rather than an unknown-root error.
 */
function parseRootQualifier(text) {
    const normalized = String(text || "").trim().replace(/\\/g, "/");
    if (/^project$/i.test(normalized)) {
        return { isProjectRoot: true, pluginName: "" };
    }
    const match = /^plugins?[./](.+)$/i.exec(normalized);
    if (!match) {
        return null;
    }
    const pluginName = match[1].trim();
    if (!pluginName || pluginName.includes("/")) {
        return null;
    }
    return { isProjectRoot: false, pluginName };
}

function findSourceRootByQualifier(roots, qualifier) {
    return roots.find((root) => (qualifier.isProjectRoot
        ? root.isProjectRoot
        : root.pluginName.toLowerCase() === qualifier.pluginName.toLowerCase())) || null;
}

/**
 * The directory a file's own-directory-relative import is confined to: the longest of every root's
 * source and Packages directories that contains the file. A `../` chain may walk up to that boundary
 * and no further. A file outside every root is confined to its own directory.
 */
function getImportBaseDirectory(fromFilePath, roots) {
    let best = "";
    const consider = (directory) => {
        if (directory && isSameOrSubPath(directory, fromFilePath) && directory.length > best.length) {
            best = directory;
        }
    };
    for (const root of roots) {
        consider(root.directory);
        consider(root.packagesDirectory);
    }
    return best || normalizeFsPath(path.dirname(fromFilePath));
}

function resolveImportPath(fromFilePath, importPath) {
    const specifier = String(importPath || "").trim();
    if (!specifier) {
        return "";
    }

    // A qualified specifier -- `Plugin.MoonToon:Shared/Common.dsh` -- is the one way to leave the
    // importing file's own root, and it is rooted by construction: no relative candidate, and the
    // importing file's own root is not consulted.
    const separatorIndex = specifier.indexOf(":");
    if (separatorIndex > 0) {
        const qualifier = parseRootQualifier(specifier.slice(0, separatorIndex));
        const qualifiedPath = specifier.slice(separatorIndex + 1).trim();
        if (qualifier && qualifiedPath) {
            const targetRoot = findSourceRootByQualifier(getResolutionContext(fromFilePath).roots, qualifier);
            const raw = targetRoot ? normalizeImportSpecifier(qualifiedPath) : "";
            return raw
                ? firstExistingCandidate([
                    { candidate: path.resolve(targetRoot.directory, raw), containment: targetRoot.directory },
                    { candidate: path.resolve(targetRoot.packagesDirectory, raw), containment: targetRoot.packagesDirectory }
                ])
                : "";
        }
    }

    const raw = normalizeImportSpecifier(specifier);
    if (!raw) {
        return "";
    }

    // An unqualified import never crosses roots. A file that belongs to no root at all -- a test
    // fixture, a scratch file outside the tree -- still resolves against the project root, which is
    // what every file did before roots existed.
    const { projectRoot, roots, owningRoot } = getResolutionContext(fromFilePath);
    const rootDirectory = owningRoot ? owningRoot.directory : getDShaderRoot(projectRoot);
    const packagesDirectory = owningRoot ? owningRoot.packagesDirectory : getPackagesDirectory(projectRoot);
    const fromDirectory = fromFilePath ? path.dirname(fromFilePath) : "";

    const candidates = [];
    if (fromDirectory) {
        candidates.push({
            candidate: path.resolve(fromDirectory, raw),
            containment: getImportBaseDirectory(fromFilePath, roots)
        });
    }
    if (rootDirectory) {
        candidates.push({ candidate: path.resolve(rootDirectory, raw), containment: rootDirectory });
    }
    if (packagesDirectory) {
        candidates.push({ candidate: path.resolve(packagesDirectory, raw), containment: packagesDirectory });
    }
    return firstExistingCandidate(candidates);
}

// Containment is checked before existence and skips rather than fails, so a `../` that climbs out of
// one candidate's root still lets the next candidate answer.
function firstExistingCandidate(candidates) {
    for (const { candidate, containment } of candidates) {
        const normalized = normalizeFsPath(path.resolve(candidate));
        if (containment && !isSameOrSubPath(containment, normalized)) {
            continue;
        }
        if (!isFile(normalized)) {
            continue;
        }
        return normalized;
    }
    return "";
}

function isFile(candidate) {
    try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch (_error) {
        return false;
    }
}

/**
 * Every specifier that would resolve from `fromFilePath`, in the spelling that resolves it.
 *
 * The owning root's files are offered bare, because that is the only form an unqualified import
 * accepts; every other root's are offered qualified, because that is the only form that reaches
 * them. Offering a bare path from a root the file cannot see would complete straight into the
 * unresolved-import diagnostic.
 */
function collectAvailableImports(fromFilePath) {
    const { roots, owningRoot } = getResolutionContext(fromFilePath);
    const owning = owningRoot || roots.find((root) => root.isProjectRoot) || null;
    const imports = [];

    if (owning) {
        collectImportFiles(owning.directory, owning.directory, imports, "");
        collectImportFiles(owning.packagesDirectory, owning.packagesDirectory, imports, "");
    }

    for (const root of roots) {
        if (owning && root.directory === owning.directory) {
            continue;
        }
        const prefix = root.isProjectRoot ? "Project:" : `Plugin.${root.pluginName}:`;
        collectImportFiles(root.directory, root.directory, imports, prefix);
        collectImportFiles(root.packagesDirectory, root.packagesDirectory, imports, prefix);
    }

    return Array.from(new Set(imports)).sort();
}

function collectImportFiles(root, directory, imports, prefix) {
    if (!directory || !fs.existsSync(directory)) {
        return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectImportFiles(root, fullPath, imports, prefix);
            continue;
        }
        if (!/\.(dsh|dsf)$/i.test(entry.name)) {
            continue;
        }
        imports.push(`${prefix}${normalizeFsPath(path.relative(root, fullPath))}`);
    }
}

module.exports = {
    resolveImportPath,
    normalizeImportSpecifier,
    collectAvailableImports
};
