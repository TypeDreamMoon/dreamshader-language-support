"use strict";

const { parseDocument } = require("./parser");
const { collectCallables, flatten } = require("./symbols");
const { findMatchingDelimiter, parseCallExpressionText } = require("./calls");
const { findFunctionBuiltin } = require("./functionBuiltins");
const { normalizeSymbolKey, stripCommentsPreserveLayout } = require("./utils");
const { SUBSTRATE_BUILTIN_ITEMS, UE_BUILTINS, getBundledMaterialExpressionBuiltinItems } = require("../languageData");

function getCodeLensTargets(text) {
    const ast = parseDocument(text);
    const blocks = flatten(ast.blocks);
    const recompileBlocks = blocks
        .filter((block) => ["Shader", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend"].includes(block.kind))
        .sort((left, right) => left.startOffset - right.startOffset);

    if (recompileBlocks.length > 0) {
        return recompileBlocks.map((block) => ({
            startOffset: block.startOffset,
            actions: ["recompileCurrent", "recompileAll", "showBridgeDiagnostics"]
        }));
    }

    const firstFunction = blocks
        .filter((block) => block.kind === "Function")
        .sort((left, right) => left.startOffset - right.startOffset)[0];
    return firstFunction
        ? [{ startOffset: firstFunction.startOffset, actions: ["recompileAll"] }]
        : [];
}

function getInlayHintSpecs(text, services = {}) {
    const reachableCallables = typeof services.collectReachableCallableSignatures === "function"
        ? services.collectReachableCallableSignatures()
        : new Map();
    const hints = [];
    for (const callExpression of findCallExpressions(text)) {
        const signature = getInlayHintSignatureForCall(callExpression, reachableCallables, services);
        if (!signature) {
            continue;
        }

        const parameters = getInlayHintParametersForSignature(signature);
        for (let index = 0; index < callExpression.arguments.length && index < parameters.length; index += 1) {
            const argument = callExpression.arguments[index];
            const parameter = parameters[index];
            if (argument.isNamed || !parameter?.name || parameter.name === "...") {
                continue;
            }

            hints.push({
                offset: argument.valueOffset,
                label: `${parameter.name}:`,
                kind: "Parameter",
                paddingRight: true
            });
        }
    }
    return hints;
}

function findCallExpressions(text) {
    const calls = [];
    const clean = stripCommentsPreserveLayout(text);
    const pattern = /(?<![_\p{L}\p{N}])([_\p{L}][_\p{L}\p{N}]*(?:(?:::|\.)[_\p{L}][_\p{L}\p{N}]*)*)\s*\(/gu;
    for (const match of clean.matchAll(pattern)) {
        const callee = match[1];
        const calleeOffset = match.index + match[0].indexOf(callee);
        if (isOffsetInString(text, calleeOffset)) {
            continue;
        }
        const openOffset = match.index + match[0].lastIndexOf("(");
        const closeOffset = findMatchingDelimiter(clean, openOffset, "(", ")");
        if (closeOffset < 0) {
            continue;
        }
        const callExpression = parseCallExpressionText(clean.slice(calleeOffset, closeOffset + 1), calleeOffset);
        if (callExpression && !isDeclarationCall(text, callExpression)) {
            calls.push(callExpression);
        }
    }
    return calls;
}

function isDeclarationCall(text, callExpression) {
    const lineStart = text.lastIndexOf("\n", callExpression.calleeOffset - 1) + 1;
    const prefix = text.slice(lineStart, callExpression.calleeOffset).trim();
    return /^(?:(?:Template\s+)?(?:Shader|ShaderFunction|ShaderLayer|ShaderLayerBlend)|VirtualFunction|Namespace|Function|GraphFunction)\s*$/i.test(prefix);
}

function isOffsetInString(text, offset) {
    let quote = "";
    let inLineComment = false;
    let inBlockComment = false;
    for (let index = 0; index < offset; index += 1) {
        const char = text[index];
        const next = text[index + 1] || "";
        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }
        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (char === "\\") {
                index += 1;
            } else if (char === quote) {
                quote = "";
            }
            continue;
        }
        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
        } else if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
        } else if (char === "\"" || char === "'") {
            quote = char;
        }
    }
    return Boolean(quote);
}

function getInlayHintSignatureForCall(callExpression, reachableCallables, services) {
    const normalized = normalizeSymbolKey(callExpression.callee);
    const shortName = normalized.split("::").pop().split(".").pop();
    const signatures = reachableCallables.get(normalized) || reachableCallables.get(shortName) || [];
    if (signatures.length > 0) {
        return signatures[0];
    }

    const functionBuiltin = findFunctionBuiltin(callExpression.callee);
    if (functionBuiltin) {
        return {
            kind: "FunctionBuiltin",
            inputs: functionBuiltin.parameters,
            outputs: []
        };
    }

    if (normalized.startsWith("substrate.")) {
        const substrateBuiltin = (callService(services, "getSubstrateBuiltinItems") || []).find((item) =>
            normalizeSymbolKey(item.qualifiedName) === normalized || normalizeSymbolKey(item.name) === shortName);
        if (substrateBuiltin) {
            return { kind: "Substrate", inputs: substrateBuiltin.parameters || [], outputs: [] };
        }
    }

    const ueBuiltin = (callService(services, "getUEBuiltinItems") || []).find((item) =>
        normalizeSymbolKey(item.qualifiedName) === normalized || normalizeSymbolKey(item.name) === normalized || normalizeSymbolKey(item.name) === shortName);
    return ueBuiltin ? { kind: "UE", inputs: ueBuiltin.parameters || [], outputs: [] } : null;
}

function getHoverInfoSpec(text, offset, services = {}) {
    const callExpression = findCallExpressionAtOffset(text, offset);
    if (callExpression) {
        return getHoverSpecForName(callExpression.callee, text, services);
    }
    const identifier = readQualifiedIdentifierAtOffset(text, offset);
    return identifier ? getHoverSpecForName(identifier.name, text, services) : null;
}

function findCallExpressionAtOffset(text, offset) {
    const safeOffset = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length));
    return findCallExpressions(text).find((callExpression) =>
        safeOffset >= callExpression.calleeOffset
        && safeOffset <= callExpression.calleeOffset + String(callExpression.callee || "").length) || null;
}

function readQualifiedIdentifierAtOffset(text, offset) {
    const safeOffset = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length));
    let start = safeOffset;
    let end = safeOffset;
    while (start > 0 && /[_\p{L}\p{N}:.]/u.test(text[start - 1])) {
        start -= 1;
    }
    while (end < text.length && /[_\p{L}\p{N}:.]/u.test(text[end])) {
        end += 1;
    }
    const name = text.slice(start, end).replace(/^:+|[:.]+$/g, "");
    return name && /[_\p{L}]/u.test(name[0]) ? { name, start, end } : null;
}

function getHoverSpecForName(name, text, services) {
    const normalized = normalizeSymbolKey(name);
    const shortName = normalized.split("::").pop().split(".").pop();
    const localCallables = collectCallables(parseDocument(text));
    const reachableCallables = callService(services, "collectReachableCallableSignatures") || new Map();
    const signatures = findCallableEntries(mergeCallables(localCallables, reachableCallables), normalized, shortName);
    if (signatures.length > 0) {
        return callableToHoverSpec(signatures[0], name);
    }

    const functionBuiltin = findFunctionBuiltin(name);
    if (functionBuiltin) {
        return builtinToHoverSpec(functionBuiltin, name, "FunctionBuiltin");
    }

    const substrateBuiltin = findBuiltinItem(getSubstrateBuiltins(services), normalized, shortName, "substrate");
    if (substrateBuiltin) {
        return builtinToHoverSpec(substrateBuiltin, name, "Substrate");
    }

    const ueBuiltin = findBuiltinItem(getUEBuiltins(services), normalized, shortName, "ue");
    return ueBuiltin ? builtinToHoverSpec(ueBuiltin, name, "UE") : null;
}

function findCallableEntries(callables, normalized, shortName) {
    const entries = callables.get(normalized)
        || callables.get(shortName)
        || callables.get(normalized.split(".").pop())
        || [];
    return Array.isArray(entries) ? entries : [entries];
}

function callableToHoverSpec(callable, fallbackName) {
    const outputs = normalizeOutputs(callable.outputs);
    return {
        name: callable.name || callable.localName || fallbackName,
        kind: callable.kind || "DreamShader callable",
        detail: getCallableDetail(callable),
        parameters: normalizeParameters(callable.inputs),
        returnType: getSingleReturnType(outputs),
        outputs,
        documentation: callable.documentation || ""
    };
}

function builtinToHoverSpec(builtin, fallbackName, kind) {
    const outputs = normalizeOutputs(builtin.outputs);
    const effectiveOutputs = outputs.length > 0 ? outputs : getBuiltinFallbackOutputs(builtin);
    const outputType = getOutputType(builtin, effectiveOutputs);
    return {
        name: builtin.qualifiedName || builtin.name || fallbackName,
        kind,
        detail: builtin.detail || "",
        parameters: normalizeParameters(builtin.parameters || builtin.inputs),
        returnType: outputType,
        outputs: effectiveOutputs,
        example: stripSnippetPlaceholders(builtin.example || builtin.snippet || ""),
        documentation: builtin.documentation || ""
    };
}

function getOutputType(builtin, outputs) {
    if (outputs.length > 1) {
        return "";
    }
    if (builtin?.returnType) {
        return builtin.returnType;
    }
    if (builtin?.outputType) {
        return builtin.outputType;
    }
    const single = getSingleReturnType(outputs);
    if (single) {
        return single;
    }
    return builtin?.isSubstrateOutput === true ? "Substrate" : "";
}

function getSingleReturnType(outputs) {
    return outputs.length === 1 ? outputs[0].type : "";
}

function normalizeParameters(parameters) {
    return Array.isArray(parameters)
        ? parameters
            .map((parameter) => ({
                qualifier: parameter?.qualifier || "in",
                type: parameter?.type || "value",
                name: parameter?.name || "",
                optional: Boolean(parameter?.optional)
            }))
            .filter((parameter) => parameter.name || parameter.type)
        : [];
}

function normalizeOutputs(outputs) {
    if (!Array.isArray(outputs)) {
        return [];
    }
    return outputs
        .map((output, index) => {
            if (!output) {
                return null;
            }
            const type = output.type || output.outputType || inferFloatTypeFromComponentCount(output.componentCount);
            return {
                index: Number.isFinite(Number(output.index)) ? Number(output.index) : index,
                name: output.name || "",
                type: type || "value",
                componentCount: Number.isFinite(Number(output.componentCount)) ? Number(output.componentCount) : undefined
            };
        })
        .filter(Boolean);
}

function inferFloatTypeFromComponentCount(componentCount) {
    const count = Number(componentCount);
    return Number.isFinite(count) && count > 0 ? `float${Math.max(1, Math.min(4, count))}` : "";
}

function getBuiltinFallbackOutputs(builtin) {
    const key = normalizeSymbolKey(builtin?.name);
    const qualifiedKey = normalizeSymbolKey(builtin?.qualifiedName);
    const classKey = normalizeSymbolKey(builtin?.className);
    if (key === "thinfilm" || qualifiedKey === "substrate.thinfilm" || classKey === "materialexpressionsubstratethinfilm") {
        return [
            { index: 0, name: "Specular Color", type: "float1", componentCount: 1 },
            { index: 1, name: "Edge Specular Color", type: "float1", componentCount: 1 }
        ];
    }
    return [];
}

function findBuiltinItem(items, normalized, shortName, namespaceName) {
    const namespacePrefix = `${namespaceName}.`;
    return (items || []).find((item) => {
        const itemName = normalizeSymbolKey(item?.name);
        const itemQualifiedName = normalizeSymbolKey(item?.qualifiedName);
        return itemQualifiedName === normalized
            || itemName === normalized
            || itemName === shortName
            || (normalized.startsWith(namespacePrefix) && itemName === normalized.slice(namespacePrefix.length));
    }) || null;
}

function getSubstrateBuiltins(services) {
    const items = callService(services, "getSubstrateBuiltinItems");
    return Array.isArray(items) && items.length > 0 ? items : SUBSTRATE_BUILTIN_ITEMS;
}

function getUEBuiltins(services) {
    const items = callService(services, "getUEBuiltinItems");
    const baseItems = Array.isArray(items) && items.length > 0 ? items : UE_BUILTINS;
    const merged = [...baseItems];
    const seen = new Set(merged.flatMap((item) => [
        normalizeSymbolKey(item.name),
        normalizeSymbolKey(item.qualifiedName)
    ]));
    for (const item of getBundledMaterialExpressionBuiltinItems()) {
        const key = normalizeSymbolKey(item.name);
        const qualifiedKey = normalizeSymbolKey(item.qualifiedName);
        if (!key || seen.has(key) || seen.has(qualifiedKey)) {
            continue;
        }
        merged.push(item);
        seen.add(key);
        seen.add(qualifiedKey);
    }
    return merged;
}

function mergeCallables(local, reachable) {
    const result = new Map();
    for (const [key, entries] of mapEntries(reachable)) {
        result.set(key, Array.isArray(entries) ? [...entries] : [entries]);
    }
    for (const [key, entries] of mapEntries(local)) {
        if (!result.has(key)) {
            result.set(key, []);
        }
        result.get(key).push(...(Array.isArray(entries) ? entries : [entries]));
    }
    return result;
}

function mapEntries(value) {
    if (!value) {
        return [];
    }
    if (value instanceof Map) {
        return value.entries();
    }
    if (typeof value === "object") {
        return Object.entries(value);
    }
    return [];
}

function getCallableDetail(callable) {
    if (callable?.sourceKind === "imported") {
        return `Imported DreamShader ${callable.kind || "callable"}`;
    }
    return `DreamShader ${callable?.kind || "callable"}`;
}

function stripSnippetPlaceholders(text) {
    return String(text || "").replace(/\$\{\d+:([^}]+)\}/g, "$1").replace(/\$\d+/g, "");
}

function callService(services, name) {
    return typeof services?.[name] === "function" ? services[name]() : [];
}

function getInlayHintParametersForSignature(signature) {
    return signature.kind === "Function"
        ? [...(signature.inputs || []), ...(signature.outputs || [])]
        : signature.inputs || [];
}

module.exports = {
    findCallExpressions,
    getCodeLensTargets,
    getHoverInfoSpec,
    getInlayHintSpecs
};
