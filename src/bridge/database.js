"use strict";

// Reading what the Unreal editor generates for tools (spec section 12.3):
//
//   <Project>/Intermediate/DreamSource/shader.db     the current plugin
//   <Project>/Saved/DreamShader/Bridge/bridge.db     a plugin from before DreamSource (it dual-wrote json beside it)
//
// Through `node:sqlite`, which is real SQLite: a read sees what is still in `-wal`, takes the shared lock,
// and so never reads half of a write. sql.js, which this replaces, loaded the whole file into memory and
// saw nothing a WAL had not checkpointed yet.
//
// Read-only, one connection per read: holding a handle open would keep Windows from deleting or replacing
// the file (the old plugin deletes bridge.db at startup; anyone may delete Intermediate/). What makes that
// cheap is the cache below: a database is only opened when its file or its `-wal` changed, and a part's
// result is only recomputed when that part's revision in `meta` moved.
//
// `node:sqlite` is required lazily and its absence is an answer, not an error: every query returns null
// and the callers read the old json files the way they always did. No `vscode` here -- the language
// server and the smoke tests use this module as it is.

const fs = require("fs");
const { host } = require("../host");
const { getShaderDatabasePath, getLegacyBridgeDatabasePath, usesLegacyLayout } = require("./paths");

/** The shader.db schema this extension reads; any other is left alone and said so. */
const SUPPORTED_SCHEMA = 1;

/** The names the `documents` table keeps the former whole-file manifests under. */
const DOCUMENTS = Object.freeze({
    materialExpressions: "material-expressions",
    settings: "settings",
    substrateBuiltins: "substrate-builtins",
    passKeys: "pass-keys",
    preprocessorDefines: "preprocessor-defines",
    builtinCatalog: "builtin-catalog",
    preview: "preview"
});

let loadedSqlite;

/** The module, or null when this Node has none. Asked once. */
function loadSqlite() {
    if (loadedSqlite === undefined) {
        try {
            loadedSqlite = require("node:sqlite");
        } catch (_error) {
            loadedSqlite = null;
        }
    }
    return loadedSqlite;
}

function isSqliteAvailable() {
    return Boolean(loadSqlite());
}

/** `read(db)` on a fresh read-only connection, or undefined when the file cannot be read as a database. */
function withDatabase(databasePath, read) {
    const sqlite = loadSqlite();
    if (!sqlite || !databasePath) {
        return undefined;
    }
    let database;
    try {
        database = new sqlite.DatabaseSync(databasePath, { readOnly: true });
        try {
            // A write in flight holds the lock for a moment; wait it out rather than read nothing.
            database.exec("PRAGMA busy_timeout = 2000;");
        } catch (_error) {
            // Not fatal: the read below either gets through or throws into the catch.
        }
        return read(database);
    } catch (_error) {
        return undefined;
    } finally {
        try {
            database?.close();
        } catch (_error) {
            // Closing a connection that failed to open: nothing to release.
        }
    }
}

function fileTag(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return `${stat.mtimeMs}:${stat.size}`;
    } catch (_error) {
        return "-";
    }
}

// ---- telling the author, once ---------------------------------------------------------------------

const toldAlready = new Set();

function tellOnce(key, level, message) {
    if (toldAlready.has(key)) {
        return;
    }
    toldAlready.add(key);
    try {
        host().notify(level, message);
    } catch (_error) {
        // A host that cannot show it: the fallback still works, nobody is told.
    }
}

/** Says, once per project, that the old layout is being read; called by whoever actually read it. */
function noteLegacyLayoutRead(projectRoot) {
    if (!projectRoot || !usesLegacyLayout(projectRoot)) {
        return;
    }
    tellOnce(`legacy|${projectRoot.toLowerCase()}`, "info",
        "DreamShader: this project's editor output is still in Saved/DreamShader/. Update the DreamShader plugin "
        + "to move it to Intermediate/DreamSource/ (shader.db); until then it is read from the old place.");
}

// ---- shader.db --------------------------------------------------------------------------------------

/** databasePath -> { tag, meta: Map, schema, supported, results: Map<cacheKey, { version, value }> } */
const shaderStates = new Map();

function readMeta(database) {
    const rows = database.prepare("SELECT key, value FROM meta").all();
    return new Map(rows.map((row) => [String(row.key), String(row.value)]));
}

/**
 * The state of a project's shader.db: null when there is none (or no `node:sqlite` to read it with),
 * else `{ supported, meta, ... }`. The file is opened only when it or its `-wal` changed since last time.
 */
function getShaderDatabaseState(projectRoot) {
    const databasePath = getShaderDatabasePath(projectRoot);
    if (!databasePath || !isSqliteAvailable()) {
        return null;
    }
    const mainTag = fileTag(databasePath);
    if (mainTag === "-") {
        shaderStates.delete(databasePath);
        return null;
    }
    const tag = `${mainTag}|${fileTag(`${databasePath}-wal`)}`;
    const cached = shaderStates.get(databasePath);
    if (cached && cached.tag === tag) {
        return cached;
    }
    const meta = withDatabase(databasePath, readMeta);
    if (!meta) {
        // Mid-creation, or not a database at all. Not cached: the next question tries again.
        return cached ? { ...cached, tag: "" } : { path: databasePath, tag: "", meta: new Map(), schema: undefined, supported: false, results: new Map() };
    }
    const schema = Number(meta.get("schema"));
    const supported = schema === SUPPORTED_SCHEMA;
    if (!supported) {
        tellOnce(`schema|${databasePath.toLowerCase()}|${meta.get("schema")}`, "warning",
            `DreamShader: ${databasePath} has schema ${meta.get("schema") || "(none)"}, and this extension reads schema `
            + `${SUPPORTED_SCHEMA}. Update the DreamShader plugin or this extension; until then the editor's output is not shown.`);
    }
    const state = {
        path: databasePath,
        tag,
        meta,
        schema,
        supported,
        results: cached && cached.supported === supported ? cached.results : new Map()
    };
    shaderStates.set(databasePath, state);
    return state;
}

/**
 * `absent` (no shader.db, or no `node:sqlite` -- read the old layout), `unsupported` (a schema this
 * extension does not know: read nothing), or `ready`.
 */
function getShaderDatabaseStatus(projectRoot) {
    const state = getShaderDatabaseState(projectRoot);
    if (!state) {
        return "absent";
    }
    return state.supported ? "ready" : "unsupported";
}

/** A part's revision as the cache compares it; the overall `revision` stands in for a part that has none. */
function partVersion(state, part) {
    const own = state.meta.get(`${part}_revision`);
    return own !== undefined ? `${part}:${own}` : `all:${state.meta.get("revision") || ""}`;
}

/**
 * `compute(db)` against shader.db, reused until `part`'s revision moves. Null when shader.db is not
 * `ready`; the caller decides whether that means "read the old layout" (absent) or "nothing" (unsupported).
 */
function queryShaderPart(projectRoot, part, cacheKey, compute) {
    const state = getShaderDatabaseState(projectRoot);
    if (!state || !state.supported) {
        return null;
    }
    const version = partVersion(state, part);
    const cached = state.results.get(cacheKey);
    if (cached && cached.version === version) {
        return cached.value;
    }
    let value = withDatabase(state.path, (database) => {
        try {
            return compute(database);
        } catch (_error) {
            return null;
        }
    });
    if (value === undefined) {
        value = null;
    }
    state.results.set(cacheKey, { version, value });
    return value;
}

/**
 * A cheap fingerprint of what a reader's answer depends on, for the memoized readers in manifests.js:
 * the part's revision when shader.db is in use, else the old files' modification times.
 */
function getDataVersionTag(projectRoot, part, legacyFiles = []) {
    if (!projectRoot) {
        return "0";
    }
    const state = getShaderDatabaseState(projectRoot);
    if (state) {
        return `${projectRoot}|shader|${state.supported ? partVersion(state, part) : "unsupported"}`;
    }
    return [projectRoot, "legacy", fileTag(getLegacyBridgeDatabasePath(projectRoot)), ...legacyFiles.map(fileTag)].join("|");
}

/** The text of one former manifest file, from the `documents` table; null when it is not there. */
function readShaderDocumentText(projectRoot, name) {
    return queryShaderPart(projectRoot, "documents", `documentText:${name}`, (database) => {
        const row = database.prepare("SELECT json FROM documents WHERE name = ?").get(name);
        return row ? String(row.json) : null;
    });
}

/** One former manifest, parsed; null when it is not there or does not parse. */
function readShaderDocument(projectRoot, name) {
    return queryShaderPart(projectRoot, "documents", `document:${name}`, (database) => {
        const row = database.prepare("SELECT json FROM documents WHERE name = ?").get(name);
        if (!row) {
            return null;
        }
        try {
            return JSON.parse(String(row.json).replace(/^﻿/, ""));
        } catch (_error) {
            return null;
        }
    });
}

/** Every row of `source_index`: `{ root, path, json, updatedUtc }`. Null when shader.db is not ready. */
function readSourceIndexRows(projectRoot) {
    return queryShaderPart(projectRoot, "index", "sourceIndex", (database) =>
        database.prepare("SELECT root, path, json, updated_utc FROM source_index").all().map((row) => ({
            root: String(row.root),
            path: String(row.path),
            json: String(row.json),
            updatedUtc: String(row.updated_utc || "")
        })));
}

/** One source's row of `source_index`, by its root name and its root-relative path (forward slashes). */
function readSourceIndexRow(projectRoot, rootName, relativePath) {
    const rows = readSourceIndexRows(projectRoot);
    if (!rows) {
        return null;
    }
    const wantedRoot = String(rootName).toLowerCase();
    const wantedPath = String(relativePath).replace(/\\/g, "/").toLowerCase();
    return rows.find((row) => row.root.toLowerCase() === wantedRoot && row.path.replace(/\\/g, "/").toLowerCase() === wantedPath) || null;
}

// ---- the old bridge.db ------------------------------------------------------------------------------

/** databasePath -> { tag, results: Map<cacheKey, value> } */
const legacyStates = new Map();

function queryLegacyDatabase(projectRoot, cacheKey, compute) {
    const databasePath = getLegacyBridgeDatabasePath(projectRoot);
    if (!databasePath || !isSqliteAvailable()) {
        return null;
    }
    const tag = `${fileTag(databasePath)}|${fileTag(`${databasePath}-wal`)}`;
    if (tag.startsWith("-|")) {
        legacyStates.delete(databasePath);
        return null;
    }
    let state = legacyStates.get(databasePath);
    if (!state || state.tag !== tag) {
        state = { tag, results: new Map() };
        legacyStates.set(databasePath, state);
    }
    if (state.results.has(cacheKey)) {
        return state.results.get(cacheKey);
    }
    let value = withDatabase(databasePath, (database) => {
        try {
            return compute(database);
        } catch (_error) {
            return null;
        }
    });
    if (value === undefined) {
        value = null;
    }
    state.results.set(cacheKey, value);
    if (value) {
        noteLegacyLayoutRead(projectRoot);
    }
    return value;
}

// ---- the tables both databases have -----------------------------------------------------------------

function parseJsonColumn(row) {
    try {
        return JSON.parse(row.json);
    } catch (_error) {
        return null;
    }
}

function materialExpressionsOf(database) {
    return {
        expressions: database.prepare("SELECT json FROM material_expressions ORDER BY name;").all()
            .map(parseJsonColumn)
            .filter(Boolean)
    };
}

function substrateBuiltinsOf(database) {
    return {
        builtins: database.prepare("SELECT json FROM substrate_builtins ORDER BY name;").all()
            .map(parseJsonColumn)
            .filter(Boolean)
    };
}

function settingsMappingsOf(database) {
    const rows = database.prepare("SELECT kind, alias, value, name, display_name, source FROM settings_mappings ORDER BY kind, alias;").all();
    const mappings = {};
    for (const row of rows) {
        const kind = String(row.kind || "");
        if (!kind) {
            continue;
        }
        if (!mappings[kind]) {
            mappings[kind] = [];
        }
        mappings[kind].push({
            alias: row.alias,
            value: row.value,
            name: row.name,
            displayName: row.display_name,
            source: row.source
        });
    }
    return { mappings };
}

function diagnosticsOf(database, updatedAtFromMeta) {
    const rows = database.prepare("SELECT json, updated_at_utc FROM diagnostics;").all();
    const files = rows.map(parseJsonColumn).filter(Boolean);
    let updatedAtUtc = updatedAtFromMeta || "";
    if (!updatedAtUtc) {
        for (const row of rows) {
            const rowUpdatedAt = String(row.updated_at_utc || "");
            if (rowUpdatedAt > updatedAtUtc) {
                updatedAtUtc = rowUpdatedAt;
            }
        }
    }
    return { version: 1, updatedAtUtc, files };
}

/**
 * shader.db when it is ready; nothing when it is there with a schema this extension does not read; the
 * old bridge.db otherwise. Null means "not from a database": the caller reads the old json (which, when
 * shader.db is present, the caller must not do -- see isShaderDatabasePresent).
 */
function queryEither(projectRoot, part, cacheKey, compute) {
    const status = getShaderDatabaseStatus(projectRoot);
    if (status === "ready") {
        return queryShaderPart(projectRoot, part, cacheKey, compute);
    }
    if (status === "unsupported") {
        return null;
    }
    return queryLegacyDatabase(projectRoot, cacheKey, compute);
}

/** Whether shader.db exists and is readable at all: then it is the only source, and the old json is stale. */
function isShaderDatabasePresent(projectRoot) {
    return getShaderDatabaseStatus(projectRoot) !== "absent";
}

// Each returns the shape the old json file had, or null.

function queryMaterialExpressionsFromDatabase(projectRoot) {
    return queryEither(projectRoot, "material_expressions", "materialExpressions", materialExpressionsOf);
}

function querySubstrateBuiltinsFromDatabase(projectRoot) {
    return queryEither(projectRoot, "substrate_builtins", "substrateBuiltins", substrateBuiltinsOf);
}

function querySettingsMappingsFromDatabase(projectRoot) {
    return queryEither(projectRoot, "settings_mappings", "settingsMappings", settingsMappingsOf);
}

function queryDiagnosticsFromDatabase(projectRoot) {
    const state = getShaderDatabaseState(projectRoot);
    const updatedAt = state && state.supported ? state.meta.get("diagnostics_updated_utc") || "" : "";
    return queryEither(projectRoot, "diagnostics", "diagnostics", (database) => diagnosticsOf(database, updatedAt));
}

/** preprocessor-defines.json, which only shader.db carries as a document; the old bridge.db never had it. */
function queryPreprocessorDefinesFromDatabase(projectRoot) {
    return readShaderDocument(projectRoot, DOCUMENTS.preprocessorDefines);
}

function invalidateBridgeDatabaseCache(projectRoot) {
    if (!projectRoot) {
        shaderStates.clear();
        legacyStates.clear();
        return;
    }
    shaderStates.delete(getShaderDatabasePath(projectRoot));
    legacyStates.delete(getLegacyBridgeDatabasePath(projectRoot));
}

module.exports = {
    SUPPORTED_SCHEMA,
    DOCUMENTS,
    loadSqlite,
    isSqliteAvailable,
    withDatabase,
    getShaderDatabaseState,
    getShaderDatabaseStatus,
    isShaderDatabasePresent,
    getDataVersionTag,
    queryShaderPart,
    readShaderDocument,
    readShaderDocumentText,
    readSourceIndexRows,
    readSourceIndexRow,
    noteLegacyLayoutRead,
    invalidateBridgeDatabaseCache,
    queryMaterialExpressionsFromDatabase,
    querySubstrateBuiltinsFromDatabase,
    querySettingsMappingsFromDatabase,
    queryDiagnosticsFromDatabase,
    queryPreprocessorDefinesFromDatabase
};
