"use strict";

const { parseDocument } = require("./parser");
const { isConstructorName } = require("./calls");
const { flatten } = require("./symbols");
const { normalizeSymbolKey, stripCommentsPreserveLayout } = require("./utils");

const HLSL_INTRINSIC_NAMES = new Set([
    "abs", "acos", "all", "any", "asin", "atan", "atan2", "ceil", "clamp", "clip", "cos", "cosh", "cross",
    "ddx", "ddx_coarse", "ddx_fine", "ddy", "ddy_coarse", "ddy_fine", "degrees", "determinant", "distance",
    "dot", "exp", "exp2", "floor", "fmod", "frac", "fract", "frexp", "fwidth", "isfinite", "isinf", "isnan", "ldexp",
    "length", "lerp", "lit", "log", "log10", "log2", "max", "min", "mix", "mod", "modf", "mul", "normalize", "pow", "radians",
    "reflect", "refract", "round", "rsqrt", "saturate", "sign", "sin", "sincos", "sinh", "smoothstep", "sqrt",
    "step", "tan", "tanh", "transpose", "trunc"
]);

const CONTROL_CALL_NAMES = new Set(["if", "for", "while", "switch", "return"]);

function getFoldingRanges(text) {
    const ast = parseDocument(text);
    const ranges = [];
    for (const block of flatten(ast.blocks)) {
        addRange(ranges, block.bodyOpenOffset, block.bodyCloseOffset);
        for (const section of block.sections || []) {
            addRange(ranges, section.bodyOpenOffset, section.bodyCloseOffset);
        }
    }
    return dedupeRanges(ranges);
}

function addRange(ranges, startOffset, endOffset) {
    if (typeof startOffset !== "number" || typeof endOffset !== "number" || startOffset < 0 || endOffset <= startOffset) {
        return;
    }
    ranges.push({ startOffset, endOffset });
}

function getDocumentSymbols(text) {
    const ast = parseDocument(text);
    return ast.blocks.map((block) => makeBlockSymbol(block));
}

function makeBlockSymbol(block) {
    const symbol = {
        name: block.name || block.kind,
        detail: block.kind,
        kind: block.kind,
        startOffset: block.startOffset,
        endOffset: block.endOffset,
        selectionStartOffset: block.nameOffset >= 0 ? block.nameOffset : block.startOffset,
        selectionEndOffset: block.nameOffset >= 0 ? block.nameOffset + (block.nameRangeLength || String(block.name || block.kind).length) : block.startOffset + block.kind.length,
        children: []
    };

    for (const child of block.children || []) {
        symbol.children.push(makeBlockSymbol(child));
    }

    for (const section of block.sections || []) {
        symbol.children.push(makeSectionSymbol(section));
    }

    return symbol;
}

function makeSectionSymbol(section) {
    const symbol = {
        name: section.name,
        detail: "section",
        kind: "Section",
        startOffset: section.startOffset,
        endOffset: section.endOffset,
        selectionStartOffset: section.nameOffset,
        selectionEndOffset: section.nameOffset + section.name.length,
        children: []
    };

    for (const entry of section.entries || []) {
        if (entry.kind === "declaration") {
            const nameOffset = findIdentifierOffset(section.bodyText, section.bodyOffset, entry.name, entry.startOffset, entry.endOffset);
            symbol.children.push({
                name: entry.name,
                detail: entry.type,
                kind: "Variable",
                startOffset: entry.startOffset,
                endOffset: entry.endOffset,
                selectionStartOffset: nameOffset >= 0 ? nameOffset : entry.startOffset,
                selectionEndOffset: nameOffset >= 0 ? nameOffset + entry.name.length : entry.endOffset,
                children: []
            });
        } else if (entry.kind === "binding") {
            const target = String(entry.target || "").trim();
            symbol.children.push({
                name: target,
                detail: "binding",
                kind: "Property",
                startOffset: entry.startOffset,
                endOffset: entry.endOffset,
                selectionStartOffset: entry.startOffset,
                selectionEndOffset: entry.startOffset + target.length,
                children: []
            });
        } else if (entry.kind === "assignment") {
            symbol.children.push({
                name: entry.name,
                detail: "setting",
                kind: "Property",
                startOffset: entry.startOffset,
                endOffset: entry.endOffset,
                selectionStartOffset: entry.startOffset,
                selectionEndOffset: entry.startOffset + String(entry.name || "").length,
                children: []
            });
        }
    }
    return symbol;
}

function findIdentifierOffset(_bodyText, _bodyOffset, name, startOffset, endOffset) {
    if (!name) {
        return -1;
    }
    return startOffset + Math.max(0, String(_bodyText || "").slice(Math.max(0, startOffset - _bodyOffset), Math.max(0, endOffset - _bodyOffset)).lastIndexOf(name));
}

function getSemanticTokens(text) {
    const ast = parseDocument(text);
    const tokens = [];
    for (const importStatement of ast.imports || []) {
        tokens.push({ offset: importStatement.startOffset, length: "import".length, type: "keyword", modifiers: [] });
    }
    for (const block of flatten(ast.blocks)) {
        tokens.push({ offset: block.startOffset, length: block.kind.length, type: "keyword", modifiers: ["declaration"] });
        if (block.nameOffset >= 0 && block.nameRangeLength > 0) {
            tokens.push({ offset: block.nameOffset, length: block.nameRangeLength, type: tokenTypeForBlock(block.kind), modifiers: ["definition"] });
        }
        for (const param of block.params || []) {
            addParameterTokens(tokens, text, param);
        }
        if ((block.kind === "Function" || block.kind === "GraphFunction") && block.bodyOffset >= 0) {
            addCodeSemanticTokens(tokens, text, block.bodyOffset, block.bodyCloseOffset);
        }
        for (const section of block.sections || []) {
            tokens.push({ offset: section.nameOffset, length: section.name.length, type: "property", modifiers: ["declaration"] });
            for (const entry of section.entries || []) {
                addEntryTokens(tokens, text, section, entry);
            }
            if (section.name === "Graph") {
                addCodeSemanticTokens(tokens, text, section.bodyOffset, section.bodyCloseOffset);
            }
        }
    }
    return dedupeTokens(tokens).sort((a, b) => a.offset - b.offset || a.length - b.length);
}

function addParameterTokens(tokens, text, param) {
    if (!param || param.startOffset < 0 || param.endOffset <= param.startOffset) {
        return;
    }

    const rangeText = text.slice(param.startOffset, param.endOffset);
    let typeSearchStart = param.startOffset;
    const qualifierMatch = /^\s*(inout|in|out)\b/.exec(rangeText);
    if (qualifierMatch) {
        const qualifierOffset = param.startOffset + rangeText.indexOf(qualifierMatch[1]);
        tokens.push({ offset: qualifierOffset, length: qualifierMatch[1].length, type: "modifier", modifiers: ["declaration"] });
        typeSearchStart = qualifierOffset + qualifierMatch[1].length;
    }

    const typeOffset = findTokenOffsetInRange(text, param.type, typeSearchStart, param.endOffset);
    if (typeOffset >= 0) {
        tokens.push({ offset: typeOffset, length: String(param.type || "").length, type: "type", modifiers: [] });
    }

    const nameOffset = findNameInRange(text, param.name, param.startOffset, param.endOffset);
    if (nameOffset >= 0) {
        tokens.push({ offset: nameOffset, length: param.name.length, type: "parameter", modifiers: ["declaration"] });
    }
}

function addEntryTokens(tokens, text, section, entry) {
    if (entry.kind === "declaration") {
        addDeclarationTypeTokens(tokens, text, entry.startOffset, entry.endOffset, entry.type);
        const nameOffset = findNameInRange(text, entry.name, entry.startOffset, entry.endOffset);
        if (nameOffset >= 0) {
            tokens.push({ offset: nameOffset, length: entry.name.length, type: "variable", modifiers: ["declaration"] });
        }
        return;
    }
    if (entry.kind === "binding" || entry.kind === "assignment") {
        const length = String(entry.kind === "binding" ? entry.target : entry.name || "").length;
        tokens.push({ offset: entry.startOffset, length, type: "property", modifiers: [] });
    }
}

function addDeclarationTypeTokens(tokens, text, startOffset, endOffset, typeText) {
    const rangeText = text.slice(startOffset, endOffset);
    const leadingModifiers = [];
    const modifierPattern = /\b(?:opt|const|static|in|out|inout)\b/g;
    let scanOffset = 0;

    for (const match of rangeText.matchAll(modifierPattern)) {
        const before = rangeText.slice(scanOffset, match.index);
        if (before.trim()) {
            break;
        }
        leadingModifiers.push({
            offset: startOffset + match.index,
            length: match[0].length
        });
        scanOffset = match.index + match[0].length;
    }

    for (const modifier of leadingModifiers) {
        tokens.push({ offset: modifier.offset, length: modifier.length, type: "modifier", modifiers: [] });
    }

    const typeOffset = findTokenOffsetInRange(text, typeText, startOffset + scanOffset, endOffset);
    if (typeOffset >= 0) {
        tokens.push({ offset: typeOffset, length: String(typeText || "").length, type: "type", modifiers: [] });
    }
}

function findTokenOffsetInRange(text, tokenText, startOffset, endOffset) {
    if (!tokenText) {
        return -1;
    }
    const match = new RegExp(`\\b${escapeRegExp(tokenText)}\\b`).exec(text.slice(startOffset, endOffset));
    return match ? startOffset + match.index : -1;
}

function addCodeSemanticTokens(tokens, text, startOffset, endOffset) {
    if (typeof startOffset !== "number" || typeof endOffset !== "number" || startOffset < 0 || endOffset <= startOffset) {
        return;
    }

    const source = text.slice(startOffset, endOffset);
    const clean = stripCommentsPreserveLayout(source);
    const callPattern = /\b([A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g;
    for (const match of clean.matchAll(callPattern)) {
        const callee = match[1];
        const calleeOffset = startOffset + match.index + match[0].indexOf(callee);
        addCalleeTokens(tokens, callee, calleeOffset);
    }
}

function addCalleeTokens(tokens, callee, calleeOffset) {
    const normalized = normalizeSymbolKey(callee);
    if (!normalized || CONTROL_CALL_NAMES.has(normalized)) {
        return;
    }

    if (isConstructorName(callee)) {
        tokens.push({ offset: calleeOffset, length: callee.length, type: "type", modifiers: ["defaultLibrary"] });
        return;
    }

    if (HLSL_INTRINSIC_NAMES.has(normalized)) {
        tokens.push({ offset: calleeOffset, length: callee.length, type: "function", modifiers: ["defaultLibrary"] });
        return;
    }

    const namespaceSeparatorIndex = callee.lastIndexOf("::");
    if (namespaceSeparatorIndex > 0) {
        tokens.push({ offset: calleeOffset, length: namespaceSeparatorIndex, type: "namespace", modifiers: [] });
        tokens.push({
            offset: calleeOffset + namespaceSeparatorIndex + 2,
            length: callee.length - namespaceSeparatorIndex - 2,
            type: "function",
            modifiers: []
        });
        return;
    }

    const dotIndex = callee.lastIndexOf(".");
    if (dotIndex > 0) {
        const defaultLibrary = normalized.startsWith("ue.") ? ["defaultLibrary"] : [];
        tokens.push({ offset: calleeOffset, length: dotIndex, type: "namespace", modifiers: defaultLibrary });
        tokens.push({
            offset: calleeOffset + dotIndex + 1,
            length: callee.length - dotIndex - 1,
            type: "method",
            modifiers: defaultLibrary
        });
        return;
    }

    tokens.push({ offset: calleeOffset, length: callee.length, type: "function", modifiers: [] });
}

function tokenTypeForBlock(kind) {
    if (kind === "Namespace") {
        return "namespace";
    }
    if (kind === "Function" || kind === "GraphFunction") {
        return "function";
    }
    return "class";
}

function findNameInRange(text, name, startOffset, endOffset) {
    if (!name) {
        return -1;
    }
    const match = new RegExp(`\\b${escapeRegExp(name)}\\b`).exec(text.slice(startOffset, endOffset));
    return match ? startOffset + match.index : -1;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeRanges(ranges) {
    const seen = new Set();
    return ranges.filter((range) => {
        const key = `${range.startOffset}:${range.endOffset}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function dedupeTokens(tokens) {
    const seen = new Set();
    return tokens.filter((token) => {
        if (!token || token.offset < 0 || token.length <= 0) {
            return false;
        }
        const key = `${token.offset}:${token.length}:${token.type}:${normalizeSymbolKey((token.modifiers || []).join(","))}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

module.exports = {
    getFoldingRanges,
    getDocumentSymbols,
    getSemanticTokens
};
