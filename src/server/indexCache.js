"use strict";

// The cross-file index, cached per document version.
//
// A near-verbatim move of what was `vscode/languageIndexCache.js`: the key was already
// `uri#version`, and uri and version are exactly what the protocol's `TextDocument` carries, so the
// cache came across without a change of shape. The only edit is the source of the root path --
// `document.fileName` became a conversion from the uri, because there is no `fileName` here.
//
// Dependency freshness is still stat-based rather than watcher-based. A watcher would be tidier but
// would also be trusting an event to have arrived; an import edited by a tool outside the editor is
// exactly the case where it would not have.

const fs = require("fs");
const languageCore = require("../language");
const { normalizeFsPath } = require("../common/path");
const { resolveImportPath } = require("../project/imports");
const { toFsPath } = require("./documents");

function createLanguageIndexCache() {
    const entries = new Map();

    function get(document) {
        const key = `${document.uri}#${document.version}`;
        const cached = entries.get(key);
        if (cached && dependenciesAreFresh(cached.dependencies)) {
            return cached.index;
        }

        if (cached) {
            entries.delete(key);
        }

        const dependencies = new Map();
        const rootPath = normalizeFsPath(toFsPath(document.uri));
        const index = languageCore.buildDocumentIndex({
            fileName: rootPath,
            text: document.getText(),
            resolveImportPath(importPath, fromFilePath) {
                return resolveImportPath(fromFilePath || rootPath, importPath);
            },
            readFileText(filePath) {
                const text = fs.readFileSync(filePath, "utf8");
                dependencies.set(normalizeFsPath(filePath), getFileStamp(filePath));
                return text;
            }
        });

        entries.set(key, { index, dependencies });
        return index;
    }

    function invalidateDocument(uri) {
        const prefix = `${uri}#`;
        for (const key of Array.from(entries.keys())) {
            if (key.startsWith(prefix)) {
                entries.delete(key);
            }
        }
    }

    function invalidatePath(filePath) {
        const normalized = normalizeFsPath(filePath);
        for (const [key, entry] of Array.from(entries.entries())) {
            if ((entry.index.files || []).some((file) => normalizeFsPath(file.fsPath) === normalized)
                || entry.dependencies.has(normalized)) {
                entries.delete(key);
            }
        }
    }

    function invalidateAll() {
        entries.clear();
    }

    return {
        get,
        invalidateDocument,
        invalidatePath,
        invalidateAll
    };
}

function dependenciesAreFresh(dependencies) {
    for (const [filePath, stamp] of dependencies.entries()) {
        const current = getFileStamp(filePath);
        if (!current || !stamp || current.mtimeMs !== stamp.mtimeMs || current.size !== stamp.size) {
            return false;
        }
    }
    return true;
}

function getFileStamp(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch (_error) {
        return null;
    }
}

module.exports = {
    createLanguageIndexCache
};
