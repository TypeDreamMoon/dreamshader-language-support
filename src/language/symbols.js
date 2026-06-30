"use strict";

const { normalizeSymbolKey } = require("./utils");
const { resolveTypeInfo } = require("./types");

function collectSymbols(ast, context, reachableCallables = new Map()) {
    const symbols = new Map();
    const block = context.block;

    if (context.kind === "FunctionBody" || context.kind === "GraphFunctionBody") {
        for (const param of block.params || []) {
            addSymbol(symbols, param.name, param.type, `${block.kind} ${param.qualifier} parameter`);
        }
        addCodeSymbols(symbols, block.bodyText || "", block.bodyOffset || block.bodyOpenOffset + 1, context.offset);
        return symbols;
    }

    if (!block || !Array.isArray(block.sections)) {
        return symbols;
    }

    const sectionByName = new Map(block.sections.map((section) => [section.name, section]));
    const includeProperties = block.kind !== "VirtualFunction";
    const includeInputs = block.kind !== "Shader";

    if (includeProperties) {
        addSectionSymbols(symbols, sectionByName.get("Properties"), Infinity, `${block.kind} property`);
    }
    if (includeInputs) {
        addSectionSymbols(symbols, sectionByName.get("Inputs"), Infinity, `${block.kind} input`);
    }

    if (context.section?.name === "Outputs") {
        addSectionSymbols(symbols, context.section, context.offset, `${block.kind} output`);
        return symbols;
    }

    addSectionSymbols(symbols, sectionByName.get("Outputs"), Infinity, `${block.kind} output`);

    if (context.section?.name === "Graph") {
        addCodeSymbols(symbols, context.section.bodyText, context.section.bodyOffset, context.offset, reachableCallables);
    }

    return symbols;
}

function collectCallables(ast) {
    const result = new Map();
    for (const block of flatten(ast.blocks)) {
        if (block.kind === "Function" || block.kind === "GraphFunction") {
            const outputs = (block.params || []).filter((param) => param.qualifier === "out");
            if (block.returnType) {
                // `Function float Luma(...)` exposes a single implicit output so it can be
                // called as a value (`x = Luma(c)`). Mirrors the plugin's __return lowering.
                outputs.unshift({ qualifier: "out", type: block.returnType, name: "__return" });
            }
            addCallable(result, {
                kind: block.kind,
                name: block.name,
                localName: block.localName || block.name,
                inputs: (block.params || []).filter((param) => param.qualifier !== "out"),
                outputs
            });
        } else if (["ShaderFunction", "ShaderLayer", "ShaderLayerBlend", "VirtualFunction"].includes(block.kind)) {
            const sections = new Map((block.sections || []).map((section) => [section.name, section]));
            addCallable(result, {
                kind: block.kind,
                name: block.name,
                localName: block.localName || block.name.split(/[\\/]/).pop(),
                inputs: declarationsToParams(sections.get("Inputs")),
                outputs: declarationsToParams(sections.get("Outputs"))
            });
        }
    }
    return result;
}

function addCallable(result, callable) {
    for (const name of [callable.name, callable.localName].filter(Boolean)) {
        const key = normalizeSymbolKey(name);
        if (!result.has(key)) {
            result.set(key, []);
        }
        result.get(key).push(callable);
    }
}

function declarationsToParams(section) {
    return (section?.entries || [])
        .filter((entry) => entry.kind === "declaration")
        .map((entry) => ({ qualifier: "in", type: entry.type, name: entry.name, optional: Boolean(entry.optional) }));
}

function addSectionSymbols(symbols, section, cutoffOffset, detail) {
    for (const entry of section?.entries || []) {
        if (entry.kind !== "declaration" || entry.startOffset >= cutoffOffset) {
            continue;
        }
        addSymbol(symbols, entry.name, entry.type, detail);
    }
}

function addCodeSymbols(symbols, bodyText, bodyOffset, cutoffOffset) {
    const visibleText = bodyText.slice(0, Math.max(0, cutoffOffset - bodyOffset));
    const { parseCodeStatements } = require("./parser");
    for (const statement of parseCodeStatements(visibleText, bodyOffset)) {
        if (statement.kind !== "declarations") {
            continue;
        }
        for (const declaration of statement.declarations) {
            addSymbol(symbols, declaration.name, declaration.type, "local variable");
        }
    }
}

function addSymbol(symbols, name, type, detail) {
    const key = normalizeSymbolKey(name);
    if (!key || symbols.has(key)) {
        return;
    }
    symbols.set(key, {
        name,
        type,
        detail: `${type || "value"} ${detail}`,
        typeInfo: resolveTypeInfo(type)
    });
}

function flatten(blocks) {
    const result = [];
    for (const block of blocks || []) {
        result.push(block);
        if (Array.isArray(block.children)) {
            result.push(...flatten(block.children));
        }
    }
    return result;
}

module.exports = {
    collectSymbols,
    collectCallables,
    flatten
};
