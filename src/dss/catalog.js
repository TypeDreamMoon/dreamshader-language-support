"use strict";

// The builtin node catalog of a project, as the plugin exported it:
//
//     <Project>/Saved/DreamShader/Bridge/dreamshader-builtin-catalog.json
//
// (schema `dreamshader-builtin-catalog`, version 1). It is the binder's own table -- every material
// expression class the engine and the loaded plugins have, under the namespace it is called by (`UE` or
// `Substrate`), with its pins, its properties, the other names it answers to and the order its positional
// arguments are read in -- so what completion offers is what the compiler accepts, on this engine, with
// these plugins. The editor writes it once every module is loaded; `dsc export-catalog` writes it without
// an editor.
//
// No `vscode` here: the smoke tests run this under plain node.

const fs = require("fs");
const path = require("path");
const { normalizeFsPath } = require("../common/path");

const CATALOG_SCHEMA = "dreamshader-builtin-catalog";
const CATALOG_FILE_NAME = "dreamshader-builtin-catalog.json";

function getCatalogPath(projectRoot) {
    return projectRoot ? normalizeFsPath(path.join(projectRoot, "Saved", "DreamShader", "Bridge", CATALOG_FILE_NAME)) : "";
}

/**
 * The arguments of Substrate sugar S3: no pins of the node, but the inputs of a conversion node the
 * compiler puts in front of it. A class takes a family when it has every pin the family feeds, and a
 * name that IS a pin of the class is that pin (ShadingModels has a real BaseColor).
 */
const VIRTUAL_FAMILIES = [
    { names: [["BaseColor", "Float3"], ["Metallic", "Float1"], ["Specular", "Float1"]], feeds: ["DiffuseAlbedo", "F0"], via: "MetalnessToDiffuseAlbedoF0" },
    { names: [["Haziness", "Float1"]], feeds: ["SecondRoughness", "SecondRoughnessWeight"], via: "HazinessToSecondaryRoughness (against Roughness)" },
    { names: [["Transmittance", "Float3"], ["Thickness", "Float1"]], feeds: ["SSSMFP"], via: "TransmittanceToMFP" },
    { names: [["IOR", "Float1"]], feeds: ["F0"], via: "F0 = ((n - 1) / (n + 1))^2" }
];

function normalizeExpression(raw) {
    const inputs = (Array.isArray(raw.inputs) ? raw.inputs : []).map((pin) => ({
        name: String(pin.name || ""),
        type: String(pin.type || ""),
        required: Boolean(pin.required),
        constProperty: String(pin.constProperty || ""),
        aliases: Array.isArray(pin.aliases) ? pin.aliases.map(String) : []
    })).filter((pin) => pin.name);
    const properties = (Array.isArray(raw.properties) ? raw.properties : []).map((property) => ({
        name: String(property.name || ""),
        type: String(property.type || ""),
        enumValues: Array.isArray(property.enumValues) ? property.enumValues.map(String) : [],
        default: String(property.default || ""),
        aliases: Array.isArray(property.aliases) ? property.aliases.map(String) : []
    })).filter((property) => property.name);
    const outputs = (Array.isArray(raw.outputs) ? raw.outputs : []).map((pin) => ({
        name: String(pin.name || ""),
        type: String(pin.type || "")
    }));

    const namespace = String(raw.namespace || "UE");
    const pinNames = new Set(inputs.map((pin) => pin.name));
    const virtualArguments = [];
    if (namespace === "Substrate") {
        for (const family of VIRTUAL_FAMILIES) {
            if (!family.feeds.every((pin) => pinNames.has(pin))) {
                continue;
            }
            for (const [name, type] of family.names) {
                if (!pinNames.has(name) && !virtualArguments.some((entry) => entry.name === name)) {
                    virtualArguments.push({ name, type, via: family.via });
                }
            }
        }
    }

    const aliases = Array.isArray(raw.aliases) ? raw.aliases.map(String) : [];
    const shortName = String(raw.shortName || "");
    return {
        namespace,
        shortName,
        // What a source calls it by: a Substrate class goes by its first alias (`Slab`), the reflected
        // name (`SubstrateSlabBSDF`) being the engine's.
        displayName: namespace === "Substrate" && aliases.length > 0 ? aliases[0] : shortName,
        aliases,
        className: String(raw.className || ""),
        inputs,
        outputs,
        properties,
        virtualArguments,
        positional: Array.isArray(raw.positional) ? raw.positional.map(String) : [],
        isParameter: Boolean(raw.isParameter),
        isCustomOutput: Boolean(raw.isCustomOutput),
        isAbstract: Boolean(raw.isAbstract)
    };
}

function normalizeCatalog(raw) {
    if (!raw || raw.schema !== CATALOG_SCHEMA || !Array.isArray(raw.expressions)) {
        return null;
    }
    const expressions = raw.expressions.map(normalizeExpression).filter((entry) => entry.shortName && !entry.isAbstract);
    const byName = new Map();
    for (const expression of expressions) {
        for (const name of [expression.shortName, ...expression.aliases]) {
            const key = `${expression.namespace}.${name}`;
            // A short name wins over an alias everywhere, as it does in the binder.
            if (!byName.has(key) || name === expression.shortName) {
                byName.set(key, expression);
            }
        }
    }
    return {
        engine: String(raw.engine || ""),
        expressions,
        byName,
        materialAttributes: (Array.isArray(raw.materialAttributes) ? raw.materialAttributes : []).map((attribute) => ({
            name: String(attribute.name || ""),
            type: String(attribute.type || ""),
            aliases: Array.isArray(attribute.aliases) ? attribute.aliases.map(String) : []
        })).filter((attribute) => attribute.name)
    };
}

/** One project's catalog, re-read when the file changes. Null until the plugin has written one. */
function createCatalogReader(projectRoot) {
    const catalogPath = getCatalogPath(projectRoot);
    let mtimeMs = -1;
    let catalog = null;
    return {
        catalogPath,
        get() {
            let current = 0;
            try {
                current = fs.statSync(catalogPath).mtimeMs;
            } catch (_error) {
                mtimeMs = -1;
                catalog = null;
                return null;
            }
            if (current !== mtimeMs) {
                mtimeMs = current;
                try {
                    catalog = normalizeCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
                } catch (_error) {
                    catalog = null;
                }
            }
            return catalog;
        }
    };
}

function findExpression(catalog, namespace, name) {
    return catalog ? catalog.byName.get(`${namespace}.${name}`) || null : null;
}

/** `Namespace.Name(Pin: type, ...)` and what else a hover should say. */
function describeExpression(expression) {
    const pins = expression.inputs.map((pin) => `${pin.name}: ${pin.type}${pin.required ? "" : "?"}`);
    const lines = ["```hlsl", `${expression.namespace}.${expression.displayName}(${pins.join(", ")})`, "```"];
    const outputs = expression.outputs.filter((pin) => pin.name);
    if (outputs.length > 1) {
        lines.push("", `**Outputs** ${outputs.map((pin) => `\`${pin.name}\`: ${pin.type}`).join(", ")}`);
    } else if (expression.outputs.length === 1) {
        lines.push("", `**Returns** ${expression.outputs[0].type}`);
    }
    if (expression.properties.length > 0) {
        lines.push("", `**Properties** ${expression.properties.slice(0, 12).map((property) => `\`${property.name}\``).join(", ")}${expression.properties.length > 12 ? ", ..." : ""}`);
    }
    if (expression.virtualArguments.length > 0) {
        lines.push("", `**Also takes** ${expression.virtualArguments.map((entry) => `\`${entry.name}\``).join(", ")} -- converted by the compiler into the pins they stand for.`);
    }
    if (expression.positional.length > 0) {
        lines.push("", `**Positional** ${expression.positional.join(", ")}`);
    }
    const others = [expression.shortName, ...expression.aliases].filter((name) => name !== expression.displayName);
    if (others.length > 0) {
        lines.push("", `*also* ${others.map((name) => `\`${expression.namespace}.${name}\``).join(", ")} *· engine class* \`${expression.className}\``);
    } else {
        lines.push("", `*engine class* \`${expression.className}\``);
    }
    return lines.join("\n");
}

module.exports = {
    CATALOG_SCHEMA,
    CATALOG_FILE_NAME,
    getCatalogPath,
    normalizeCatalog,
    createCatalogReader,
    findExpression,
    describeExpression
};
