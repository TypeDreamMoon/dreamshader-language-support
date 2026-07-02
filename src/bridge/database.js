"use strict";

const fs = require("fs");
const path = require("path");
const { getBridgeDatabasePath } = require("./paths");

// sql.js's WASM module must be instantiated asynchronously once; every query after that is
// synchronous. `initializeBridgeDatabaseSupport()` is awaited once at extension activation so the
// rest of the codebase (which is fully synchronous, matching the JSON-reading code it replaces)
// can call the query functions below without becoming async themselves. Until that initialization
// resolves -- or if it fails for any reason -- every query function below simply returns null,
// and callers fall back to the legacy JSON Bridge files exactly as they did before this module
// existed, so there's no hard dependency on sql.js loading successfully.
let sqlModule = null;
let sqlModuleLoadPromise = null;

function initializeBridgeDatabaseSupport() {
    if (sqlModule) {
        return Promise.resolve(sqlModule);
    }
    if (!sqlModuleLoadPromise) {
        sqlModuleLoadPromise = Promise.resolve()
            .then(() => require("sql.js"))
            .then((initSqlJs) => initSqlJs({
                // require.resolve("sql.js") resolves to its main entry, dist/sql-wasm.js -- sql-wasm.wasm
                // lives right next to it, so this works from both node_modules and a packaged .vsix
                // without depending on sql.js exposing "./package.json" as a resolvable exports subpath.
                locateFile: (fileName) => path.join(path.dirname(require.resolve("sql.js")), fileName)
            }))
            .then((SQL) => {
                sqlModule = SQL;
                return SQL;
            })
            .catch((_error) => {
                sqlModuleLoadPromise = null;
                return null;
            });
    }
    return sqlModuleLoadPromise;
}

// path -> { mtimeMs, size, db, queryResults }. A project's bridge.db is re-opened, and its query
// results re-parsed, only when its mtime/size changes -- both opening the file (sql.js has to load
// it whole into memory) and re-running a SELECT + JSON.parse-ing every row are worth avoiding on
// every completion/hover request (every keystroke re-triggers one), not just the file open itself.
const databaseCacheByPath = new Map();

function getDatabaseCacheEntry(projectRoot) {
    if (!sqlModule) {
        return null;
    }
    const databasePath = getBridgeDatabasePath(projectRoot);
    if (!databasePath) {
        return null;
    }

    let stat;
    try {
        stat = fs.statSync(databasePath);
    } catch (_error) {
        return null;
    }

    const cached = databaseCacheByPath.get(databasePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached;
    }

    let db;
    try {
        const buffer = fs.readFileSync(databasePath);
        db = new sqlModule.Database(buffer);
    } catch (_error) {
        return null;
    }

    if (cached?.db) {
        try {
            cached.db.close();
        } catch (_error) {
            // ignore -- best-effort cleanup of the stale in-memory handle
        }
    }
    const entry = { mtimeMs: stat.mtimeMs, size: stat.size, db, queryResults: {} };
    databaseCacheByPath.set(databasePath, entry);
    return entry;
}

// Runs `compute(db)` once per (bridge.db content, cacheKey) and reuses the result afterwards --
// cacheKey lets a handful of independent queries (material expressions, substrate builtins,
// settings, diagnostics) share one cache entry per database file without invalidating each other.
function queryWithCache(projectRoot, cacheKey, compute) {
    const entry = getDatabaseCacheEntry(projectRoot);
    if (!entry) {
        return null;
    }
    if (Object.prototype.hasOwnProperty.call(entry.queryResults, cacheKey)) {
        return entry.queryResults[cacheKey];
    }
    let result;
    try {
        result = compute(entry.db);
    } catch (_error) {
        result = null;
    }
    entry.queryResults[cacheKey] = result;
    return result;
}

function invalidateBridgeDatabaseCache(projectRoot) {
    const databasePath = getBridgeDatabasePath(projectRoot);
    const cached = databaseCacheByPath.get(databasePath);
    if (cached?.db) {
        try {
            cached.db.close();
        } catch (_error) {
            // ignore
        }
    }
    databaseCacheByPath.delete(databasePath);
}

function queryAll(db, sql) {
    const statement = db.prepare(sql);
    try {
        const rows = [];
        while (statement.step()) {
            rows.push(statement.getAsObject());
        }
        return rows;
    } finally {
        statement.free();
    }
}

function parseJsonColumn(row) {
    try {
        return JSON.parse(row.json);
    } catch (_error) {
        return null;
    }
}

// Returns the same shape as material-expressions.json ({ expressions: [...] }), or null if
// bridge.db isn't available/ready -- callers should fall back to the JSON manifest in that case.
function queryMaterialExpressionsFromDatabase(projectRoot) {
    return queryWithCache(projectRoot, "materialExpressions", (db) => ({
        expressions: queryAll(db, "SELECT json FROM material_expressions ORDER BY name;")
            .map(parseJsonColumn)
            .filter(Boolean)
    }));
}

// Returns the same shape as substrate-builtins.json ({ builtins: [...] }), or null.
function querySubstrateBuiltinsFromDatabase(projectRoot) {
    return queryWithCache(projectRoot, "substrateBuiltins", (db) => ({
        builtins: queryAll(db, "SELECT json FROM substrate_builtins ORDER BY name;")
            .map(parseJsonColumn)
            .filter(Boolean)
    }));
}

// Returns the same shape as settings.json ({ mappings: { <kind>: [{ alias, value, name,
// displayName, source }, ...] } }), or null.
function querySettingsMappingsFromDatabase(projectRoot) {
    return queryWithCache(projectRoot, "settingsMappings", (db) => {
        const rows = queryAll(db, "SELECT kind, alias, value, name, display_name, source FROM settings_mappings ORDER BY kind, alias;");
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
    });
}

// Returns the same shape as diagnostics.json ({ version, updatedAtUtc, files: [{ path,
// diagnostics: [...] }, ...] }), or null.
function queryDiagnosticsFromDatabase(projectRoot) {
    return queryWithCache(projectRoot, "diagnostics", (db) => {
        const rows = queryAll(db, "SELECT json, updated_at_utc FROM diagnostics;");
        const files = rows.map(parseJsonColumn).filter(Boolean);
        let updatedAtUtc = "";
        for (const row of rows) {
            const rowUpdatedAt = String(row.updated_at_utc || "");
            if (rowUpdatedAt > updatedAtUtc) {
                updatedAtUtc = rowUpdatedAt;
            }
        }
        return { version: 1, updatedAtUtc, files };
    });
}

module.exports = {
    initializeBridgeDatabaseSupport,
    invalidateBridgeDatabaseCache,
    queryMaterialExpressionsFromDatabase,
    querySubstrateBuiltinsFromDatabase,
    querySettingsMappingsFromDatabase,
    queryDiagnosticsFromDatabase
};
