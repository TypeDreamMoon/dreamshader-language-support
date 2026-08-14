"use strict";

const fs = require("fs");
const path = require("path");
const { readJsonFile } = require("../common/json");
const { host } = require("../host");
const {
    MATERIAL_EXPRESSION_MANIFEST_NAME,
    SETTINGS_MANIFEST_NAME,
    SUBSTRATE_BUILTIN_ITEMS,
    UE_BUILTINS,
    createUEBuiltinItemFromManifestExpression
} = require("../languageData");
const { normalizeSymbolKey } = require("../language/utils");
const { collectKnownProjectRoots, findProjectRoot } = require("../project/projects");
const {
    getMaterialExpressionManifestPath,
    getSettingsManifestPath,
    getSubstrateBuiltinsManifestPath,
    getBridgeDatabasePath
} = require("./paths");
const {
    queryMaterialExpressionsFromDatabase,
    querySubstrateBuiltinsFromDatabase,
    querySettingsMappingsFromDatabase
} = require("./database");

const bundledMaterialExpressionManifestPath = path.join(__dirname, "..", "..", "resources", MATERIAL_EXPRESSION_MANIFEST_NAME);

// Every completion keystroke re-triggers these lookups (every letter is a registered completion
// trigger character), so re-reading/re-merging Bridge manifests from scratch on every call is
// disk- and CPU-bound work repeated dozens of times a second while typing -- exactly the kind of
// latency that can make a completion request lag behind the keystrokes that immediately follow it
// (e.g. a stale "UE." completion list still being shown/accepted after "UE.A" was typed). These
// functions are memoized against a cheap "file version" fingerprint (mtime+size, no content read)
// of everything that can affect their result, so unless a Bridge file actually changed, repeat
// calls just return the previously computed value instead of redoing the work.
function getFileVersionTag(filePath) {
    if (!filePath) {
        return "0";
    }
    try {
        const stat = fs.statSync(filePath);
        return `${stat.mtimeMs}:${stat.size}`;
    } catch (_error) {
        return "0";
    }
}

function memoizeByFileVersion(computeCacheKey, compute) {
    let cache = { key: null, value: null };
    return (...args) => {
        const key = computeCacheKey(...args);
        if (cache.key === key) {
            return cache.value;
        }
        const value = compute(...args);
        cache = { key, value };
        return value;
    };
}

// The plugin dual-writes these manifests to bridge.db alongside the legacy JSON files (the JSON
// files are deprecated, scheduled for removal in DreamShader plugin 1.7.0). Prefer the database;
// fall back to JSON for older plugin versions or before the database has been generated once.
function readBridgeManifest(projectRoot, queryDatabase, jsonPath, fallback) {
    const fromDatabase = queryDatabase(projectRoot);
    if (fromDatabase) {
        return fromDatabase;
    }
    return readJsonFile(jsonPath, fallback);
}

function getConfiguredMaterialExpressionManifestPath() {
    return host().getSetting("materialExpressionManifestPath", "") || "";
}

// Everything below takes `activePath` -- the absolute path of the file being served -- rather than
// a document. It only ever wanted the path, and taking the document meant taking a `vscode` one:
// the protocol's `TextDocument.uri` is a string, so `document.uri.fsPath` would have read as
// undefined here and quietly narrowed every lookup to the no-project case.
function computeMaterialExpressionSymbolsCacheKey(activePath) {
    const roots = collectKnownProjectRoots(activePath);
    const configured = getConfiguredMaterialExpressionManifestPath();
    const parts = [];
    for (const root of roots) {
        parts.push(getFileVersionTag(getBridgeDatabasePath(root)), getFileVersionTag(getMaterialExpressionManifestPath(root)));
    }
    parts.push(getFileVersionTag(configured), getFileVersionTag(bundledMaterialExpressionManifestPath));
    return parts.join("|");
}

const collectMaterialExpressionSymbols = memoizeByFileVersion(computeMaterialExpressionSymbolsCacheKey, (activePath) => {
    const expressions = new Map();
    const addExpressions = (list) => {
        for (const expression of list || []) {
            const name = String(expression.name || "").trim();
            const key = normalizeSymbolKey(name);
            if (name && !expressions.has(key)) {
                expressions.set(key, expression);
            }
        }
    };

    for (const root of collectKnownProjectRoots(activePath)) {
        const manifest = readBridgeManifest(root, queryMaterialExpressionsFromDatabase, getMaterialExpressionManifestPath(root), { expressions: [] });
        addExpressions(manifest.expressions);
    }

    // A user-configured override path and the extension's own bundled fallback are plain files,
    // not part of a project's live Bridge output, so they're always read as JSON.
    const configured = getConfiguredMaterialExpressionManifestPath();
    if (configured) {
        addExpressions(readJsonFile(configured, { expressions: [] }).expressions);
    }
    addExpressions(readJsonFile(bundledMaterialExpressionManifestPath, { expressions: [] }).expressions);

    return Array.from(expressions.values()).sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")));
});

const getUEBuiltinItems = memoizeByFileVersion(computeMaterialExpressionSymbolsCacheKey, (activePath) => {
    const items = [...UE_BUILTINS];
    const seen = new Set(items.flatMap((item) => [
        normalizeSymbolKey(item.name),
        normalizeSymbolKey(item.qualifiedName)
    ]));

    for (const expression of collectMaterialExpressionSymbols(activePath)) {
        const item = createUEBuiltinItemFromManifestExpression(expression);
        if (!item) {
            continue;
        }
        const key = normalizeSymbolKey(item.name);
        const qualifiedKey = normalizeSymbolKey(item.qualifiedName);
        if (seen.has(key) || seen.has(qualifiedKey)) {
            continue;
        }
        items.push(item);
        seen.add(key);
        seen.add(qualifiedKey);
    }
    return items;
});

const collectDreamShaderSettingMappings = memoizeByFileVersion(
    (activePath, mappingName) => {
        const projectRoot = findProjectRoot(activePath);
        return `${mappingName}|${getFileVersionTag(getBridgeDatabasePath(projectRoot))}|${getFileVersionTag(getSettingsManifestPath(projectRoot))}`;
    },
    (activePath, mappingName) => {
        const projectRoot = findProjectRoot(activePath);
        const manifest = readBridgeManifest(projectRoot, querySettingsMappingsFromDatabase, getSettingsManifestPath(projectRoot), { mappings: {} });
        const values = manifest.mappings?.[mappingName] || [];
        return values
            .map((entry) => typeof entry === "string" ? { alias: entry, name: entry, displayName: entry } : entry)
            .filter((entry) => entry && entry.alias);
    }
);

const getSubstrateBuiltinItems = memoizeByFileVersion(
    (activePath) => {
        const roots = collectKnownProjectRoots(activePath);
        return roots.map((root) => `${getFileVersionTag(getBridgeDatabasePath(root))}|${getFileVersionTag(getSubstrateBuiltinsManifestPath(root))}`).join(",");
    },
    (activePath) => {
        const items = [];
        const seen = new Set();

        const addItem = (item) => {
            const normalized = normalizeSubstrateBuiltinManifestEntry(item);
            const key = normalizeSymbolKey(normalized?.name);
            if (!normalized || !key || seen.has(key)) {
                return;
            }
            seen.add(key);
            items.push(normalized);
        };

        for (const root of collectKnownProjectRoots(activePath)) {
            const manifest = readBridgeManifest(root, querySubstrateBuiltinsFromDatabase, getSubstrateBuiltinsManifestPath(root), { builtins: [] });
            for (const item of manifest.builtins || []) {
                addItem(item);
            }
        }

        for (const item of SUBSTRATE_BUILTIN_ITEMS) {
            addItem(item);
        }

        return items.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    }
);

function normalizeSubstrateBuiltinManifestEntry(entry) {
    const name = String(entry?.name || "").trim();
    if (!name) {
        return null;
    }
    const parameters = Array.isArray(entry.parameters)
        ? entry.parameters
            .filter((param) => param && typeof param.name === "string" && param.name.trim())
            .map((param) => ({
                qualifier: typeof param.qualifier === "string" && param.qualifier.trim() ? param.qualifier.trim() : "in",
                type: typeof param.type === "string" && param.type.trim() ? param.type.trim() : "value",
                name: param.name.trim(),
                optional: Boolean(param.optional)
            }))
        : [];
    const snippet = typeof entry.snippet === "string" && entry.snippet.trim()
        ? entry.snippet.trim()
        : buildSubstrateSnippet(name, parameters);
    const outputs = normalizeBuiltinOutputs(entry.outputs);
    const outputFallbacks = outputs.length > 0 ? outputs : getSubstrateBuiltinFallbackOutputs(entry);
    return {
        name,
        qualifiedName: typeof entry.qualifiedName === "string" && entry.qualifiedName.trim()
            ? entry.qualifiedName.trim()
            : `Substrate.${name}`,
        className: typeof entry.className === "string" ? entry.className.trim() : "",
        outputType: typeof entry.outputType === "string" && entry.outputType.trim()
            ? entry.outputType.trim()
            : (entry.isSubstrateOutput === false ? "auto" : "Substrate"),
        isSubstrateOutput: entry.isSubstrateOutput !== false,
        snippet,
        memberSnippet: snippet.replace(/^Substrate\./, ""),
        detail: typeof entry.detail === "string" && entry.detail.trim()
            ? entry.detail.trim()
            : `DreamShader Substrate builtin ${name}`,
        documentation: typeof entry.documentation === "string" ? entry.documentation : "",
        parameters,
        outputs: outputFallbacks,
        example: typeof entry.example === "string" && entry.example.trim() ? entry.example.trim() : snippet
    };
}

function buildSubstrateSnippet(name, parameters) {
    const args = parameters.map((param, index) => `${param.name}=\${${index + 1}:${param.name}}`);
    return `Substrate.${name}(${args.join(", ")})`;
}

function normalizeBuiltinOutputs(outputs) {
    if (!Array.isArray(outputs)) {
        return [];
    }
    return outputs
        .map((output, index) => {
            if (!output) {
                return null;
            }
            const name = typeof output.name === "string" ? output.name.trim() : "";
            const type = typeof output.type === "string" && output.type.trim()
                ? output.type.trim()
                : typeof output.outputType === "string" && output.outputType.trim()
                    ? output.outputType.trim()
                    : "";
            return {
                index: Number.isFinite(Number(output.index)) ? Number(output.index) : index,
                name,
                type,
                outputType: type,
                componentCount: Number.isFinite(Number(output.componentCount)) ? Number(output.componentCount) : undefined
            };
        })
        .filter(Boolean);
}

function getSubstrateBuiltinFallbackOutputs(entry) {
    const key = normalizeSymbolKey(entry?.name);
    const classKey = normalizeSymbolKey(entry?.className);
    if (key === "thinfilm" || classKey === "materialexpressionsubstratethinfilm") {
        return [
            { index: 0, name: "Specular Color", type: "float1", outputType: "float1", componentCount: 1 },
            { index: 1, name: "Edge Specular Color", type: "float1", outputType: "float1", componentCount: 1 }
        ];
    }
    return [];
}

module.exports = {
    collectMaterialExpressionSymbols,
    getUEBuiltinItems,
    getSubstrateBuiltinItems,
    collectDreamShaderSettingMappings,
    MATERIAL_EXPRESSION_MANIFEST_NAME,
    SETTINGS_MANIFEST_NAME
};
