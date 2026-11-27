"use strict";

// The symbol index of one `.dsp`, found where the plugin writes it.
//
// The index of a source is the row (`<root>`, `<path relative to the root>`) of `source_index` in the project's
// `Intermediate/DreamSource/shader.db` -- or, for a plugin from before DreamSource, the file
// `<Project>/Saved/DreamShader/Index/<root>/<path relative to the root>.index.json`. `<root>` is `Project` for the
// project's own source directory and the plugin's name for a plugin's, whichever root the source is in
// (Docs/tools/bridge.md, "Symbol index"). That key is computed from the source roots and looked up directly rather
// than by a walk of every index of the project. Only a source under no root this side knows of -- a plugin outside
// `<Project>/Plugins` -- has every index searched for the one that names it, as the .dss features do.
//
// What comes back is only trusted as far as its schema and version: an index of a version this code does not know is
// handed back flagged, and the providers leave it unread rather than misread it. No `vscode` here: the smoke tests run
// this under plain node.

const fs = require("fs");
const path = require("path");
const { normalizeFsPath } = require("../common/path");
const { getIndexDirectory, normalizeIndex, pathKey, createIndexStore, databaseIndexPath, INDEX_SUFFIX } = require("../dss/indexStore");
const { isShaderDatabasePresent, readSourceIndexRow } = require("../bridge/database");
const { collectSourceRoots, findSourceRootForFile, findAncestorSourceRoot } = require("../project/projects");

const INDEX_VERSION = 1;
const FALLBACK_REFRESH_MS = 2000;

/** `{ rootName, relative }` (forward slashes) that the plugin keys the index of `sourceFile` by; null when under no root. */
function expectedIndexKey(projectRoot, sourceFile) {
    if (!projectRoot || !sourceFile) {
        return null;
    }
    const root = findSourceRootForFile(sourceFile, collectSourceRoots(projectRoot)) || findAncestorSourceRoot(sourceFile);
    if (!root) {
        return null;
    }
    const rootName = root.isProjectRoot ? "Project" : (root.pluginName || root.displayName || "");
    const relative = path.relative(path.resolve(root.directory), path.resolve(sourceFile));
    if (!rootName || !relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }
    return { rootName, relative: relative.replace(/\\/g, "/") };
}

/**
 * Where the plugin writes the index of `sourceFile` -- `<shader.db>#<root>/<relative>` when the project has a
 * shader.db, the old `.index.json` path otherwise -- or "" when the file is under no source root.
 */
function expectedIndexPath(projectRoot, sourceFile) {
    const key = expectedIndexKey(projectRoot, sourceFile);
    if (!key) {
        return "";
    }
    if (isShaderDatabasePresent(projectRoot)) {
        return databaseIndexPath(projectRoot, key.rootName, key.relative);
    }
    return normalizeFsPath(path.join(getIndexDirectory(projectRoot), key.rootName, `${key.relative}${INDEX_SUFFIX}`));
}

/** One project's `.dsp` indices, each re-read when its modification time changes. */
function createPipelineIndexReader(projectRoot) {
    /** indexPath -> { mtimeMs, index } */
    const cache = new Map();
    let fallback = null;
    let fallbackRefreshedAt = 0;

    function readFromDatabase(sourceFile, indexPath) {
        const key = expectedIndexKey(projectRoot, sourceFile);
        const row = key ? readSourceIndexRow(projectRoot, key.rootName, key.relative) : null;
        if (!row) {
            cache.delete(indexPath);
            return null;
        }
        const known = cache.get(indexPath);
        if (known && known.json === row.json) {
            return known.index;
        }
        let index = null;
        try {
            index = normalizeIndex(JSON.parse(row.json.replace(/^﻿/, "")), indexPath);
        } catch (_error) {
            index = null;
        }
        cache.set(indexPath, { json: row.json, index });
        return index;
    }

    function read(indexPath, sourceFile) {
        if (isShaderDatabasePresent(projectRoot)) {
            return readFromDatabase(sourceFile, indexPath);
        }
        let mtimeMs = -1;
        try {
            mtimeMs = fs.statSync(indexPath).mtimeMs;
        } catch (_error) {
            cache.delete(indexPath);
            return null;
        }
        const known = cache.get(indexPath);
        if (known && known.mtimeMs === mtimeMs) {
            return known.index;
        }
        let index = null;
        try {
            index = normalizeIndex(JSON.parse(fs.readFileSync(indexPath, "utf8").replace(/^﻿/, "")), indexPath);
        } catch (_error) {
            // Half-written while the editor saves it: the next question reads it whole.
            index = null;
        }
        cache.set(indexPath, { mtimeMs, index });
        return index;
    }

    function searchEverywhere(sourceFile) {
        if (!isShaderDatabasePresent(projectRoot) && !fs.existsSync(getIndexDirectory(projectRoot))) {
            return null;
        }
        if (!fallback) {
            fallback = createIndexStore(projectRoot);
        }
        const now = Date.now();
        if (now - fallbackRefreshedAt > FALLBACK_REFRESH_MS) {
            fallback.refresh();
            fallbackRefreshedAt = now;
        }
        return fallback.findForSource(sourceFile).find((index) => index.fileKey === pathKey(sourceFile)) || null;
    }

    /**
     * `{ index, path, problem }` for a source: `index` null when there is none (the editor never compiled it, or the
     * file is unreadable), `problem` naming why one that exists is not used.
     */
    function lookup(sourceFile) {
        const direct = expectedIndexPath(projectRoot, sourceFile);
        let index = direct ? read(direct, sourceFile) : null;
        if (index && index.fileKey !== pathKey(sourceFile)) {
            index = null;
        }
        if (!index && !direct) {
            // Only when the source is under no root this side knows of. A root that is known but has no index for the
            // file yet is the common case -- a pipeline nobody has compiled -- and walking every index of the project
            // on each keystroke would not find one either.
            index = searchEverywhere(sourceFile);
        }
        if (!index) {
            return { index: null, path: direct, problem: "" };
        }
        if (index.version !== INDEX_VERSION) {
            return { index: null, path: index.indexPath, problem: `version ${index.version}`, version: index.version };
        }
        return { index, path: index.indexPath, problem: "" };
    }

    return {
        projectRoot: normalizeFsPath(projectRoot || ""),
        lookup
    };
}

module.exports = {
    INDEX_VERSION,
    expectedIndexKey,
    expectedIndexPath,
    createPipelineIndexReader
};
