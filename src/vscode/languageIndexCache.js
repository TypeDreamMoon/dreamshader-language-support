"use strict";

const fs = require("fs");
const languageCore = require("../language");
const { normalizeFsPath } = require("../common/path");
const { resolveImportPath } = require("../project/imports");

function createLanguageIndexCache() {
    const entries = new Map();

    function get(document) {
        const key = getDocumentKey(document);
        const cached = entries.get(key);
        if (cached && dependenciesAreFresh(cached.dependencies)) {
            return cached.index;
        }

        if (cached) {
            entries.delete(key);
        }

        const dependencies = new Map();
        const rootPath = normalizeFsPath(document.fileName);
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
        const uriText = getUriText(uri);
        for (const key of Array.from(entries.keys())) {
            if (key.startsWith(`${uriText}#`)) {
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

function getDocumentKey(document) {
    return `${getUriText(document.uri)}#${document.version}`;
}

function getUriText(uri) {
    return typeof uri?.toString === "function" ? uri.toString() : String(uri || "");
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
