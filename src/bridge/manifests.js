"use strict";

const path = require("path");
const { readJsonFile } = require("../common/json");
const {
    MATERIAL_EXPRESSION_MANIFEST_NAME,
    SETTINGS_MANIFEST_NAME,
    SUBSTRATE_BUILTIN_ITEMS,
    UE_BUILTINS,
    createUEBuiltinItemFromManifestExpression
} = require("../languageData");
const { normalizeSymbolKey } = require("../language/utils");
const { collectKnownProjectRoots, findProjectRoot } = require("../project/projects");
const { getMaterialExpressionManifestPath, getSettingsManifestPath, getSubstrateBuiltinsManifestPath } = require("./paths");

const bundledMaterialExpressionManifestPath = path.join(__dirname, "..", "..", "resources", MATERIAL_EXPRESSION_MANIFEST_NAME);

function getVscode() {
    try {
        return require("vscode");
    } catch (_error) {
        return null;
    }
}

function collectMaterialExpressionSymbols(document) {
    const expressions = new Map();
    const addManifest = (manifestPath) => {
        const manifest = readJsonFile(manifestPath, { expressions: [] });
        for (const expression of manifest.expressions || []) {
            const name = String(expression.name || "").trim();
            const key = normalizeSymbolKey(name);
            if (name && !expressions.has(key)) {
                expressions.set(key, expression);
            }
        }
    };

    const activePath = document?.uri?.fsPath || document?.fileName || "";
    for (const root of collectKnownProjectRoots(activePath)) {
        addManifest(getMaterialExpressionManifestPath(root));
    }

    const configured = getVscode()?.workspace.getConfiguration("dreamshader").get("materialExpressionManifestPath", "") || "";
    if (configured) {
        addManifest(configured);
    }
    addManifest(bundledMaterialExpressionManifestPath);

    return Array.from(expressions.values()).sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")));
}

function getUEBuiltinItemsForDocument(document) {
    const items = [...UE_BUILTINS];
    const seen = new Set(items.flatMap((item) => [
        normalizeSymbolKey(item.name),
        normalizeSymbolKey(item.qualifiedName)
    ]));

    for (const expression of collectMaterialExpressionSymbols(document)) {
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
}

function collectDreamShaderSettingMappings(document, mappingName) {
    const projectRoot = findProjectRoot(document?.uri?.fsPath || document?.fileName || "");
    const manifest = readJsonFile(getSettingsManifestPath(projectRoot), { mappings: {} });
    const values = manifest.mappings?.[mappingName] || [];
    return values
        .map((entry) => typeof entry === "string" ? { alias: entry, name: entry, displayName: entry } : entry)
        .filter((entry) => entry && entry.alias);
}

function getSubstrateBuiltinItemsForDocument(document) {
    const activePath = document?.uri?.fsPath || document?.fileName || "";
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
        const manifest = readJsonFile(getSubstrateBuiltinsManifestPath(root), { builtins: [] });
        for (const item of manifest.builtins || []) {
            addItem(item);
        }
    }

    for (const item of SUBSTRATE_BUILTIN_ITEMS) {
        addItem(item);
    }

    return items.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

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
    getUEBuiltinItemsForDocument,
    getSubstrateBuiltinItemsForDocument,
    collectDreamShaderSettingMappings,
    MATERIAL_EXPRESSION_MANIFEST_NAME,
    SETTINGS_MANIFEST_NAME
};
