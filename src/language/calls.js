"use strict";

const {
    QUALIFIED_IDENTIFIER_PATTERN,
    splitTopLevel,
    stripCommentsPreserveLayout,
    normalizeSymbolKey,
    isValidIdentifier
} = require("./utils");

const CONSTRUCTOR_NAMES = new Set([
    "float", "float1", "float2", "float3", "float4",
    "half", "half1", "half2", "half3", "half4",
    "int", "int2", "int3", "int4",
    "uint", "uint2", "uint3", "uint4",
    "bool", "bool2", "bool3", "bool4",
    "vec2", "vec3", "vec4",
    "ivec2", "ivec3", "ivec4",
    "uvec2", "uvec3", "uvec4",
    "bvec2", "bvec3", "bvec4",
    "mat2", "mat3", "mat4"
]);

function parseCallExpressionText(text, baseOffset = 0) {
    const clean = stripCommentsPreserveLayout(String(text || ""));
    const match = new RegExp(`^\\s*(${QUALIFIED_IDENTIFIER_PATTERN})\\s*\\(`, "u").exec(clean);
    if (!match) {
        return null;
    }
    const callee = match[1];
    const calleeStart = clean.indexOf(callee);
    const openIndex = clean.indexOf("(", calleeStart + callee.length);
    const closeIndex = findMatchingDelimiter(clean, openIndex, "(", ")");
    if (openIndex < 0 || closeIndex < 0) {
        return null;
    }
    const trailing = clean.slice(closeIndex + 1).trim();
    if (trailing && trailing !== ";") {
        return null;
    }
    return {
        callee,
        calleeOffset: baseOffset + calleeStart,
        openOffset: baseOffset + openIndex,
        closeOffset: baseOffset + closeIndex,
        endOffset: baseOffset + closeIndex + 1,
        arguments: parseCallArguments(clean.slice(openIndex + 1, closeIndex), baseOffset + openIndex + 1)
    };
}

function parseCallArguments(text, baseOffset = 0) {
    return splitTopLevel(text, baseOffset, ",").map((segment) => {
        const assignment = findNamedArgument(segment.text);
        if (!assignment) {
            return {
                isNamed: false,
                name: "",
                valueText: segment.text.trim(),
                valueOffset: segment.startOffset + leadingWhitespaceLength(segment.text),
                startOffset: segment.startOffset,
                endOffset: segment.endOffset
            };
        }
        return {
            isNamed: true,
            name: assignment.name,
            valueText: assignment.value,
            nameOffset: segment.startOffset + assignment.nameOffset,
            valueOffset: segment.startOffset + assignment.valueOffset,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset
        };
    });
}

function findNamedArgument(text) {
    const clean = stripCommentsPreserveLayout(String(text || ""));
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let inString = false;
    for (let index = 0; index < clean.length; index += 1) {
        const char = clean[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
            } else if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "(") {
            depthParen += 1;
            continue;
        }
        if (char === ")") {
            depthParen = Math.max(0, depthParen - 1);
            continue;
        }
        if (char === "{") {
            depthBrace += 1;
            continue;
        }
        if (char === "}") {
            depthBrace = Math.max(0, depthBrace - 1);
            continue;
        }
        if (char === "[") {
            depthBracket += 1;
            continue;
        }
        if (char === "]") {
            depthBracket = Math.max(0, depthBracket - 1);
            continue;
        }
        if (char === "=" && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
            const left = clean.slice(0, index).trim();
            if (!isValidIdentifier(left)) {
                return null;
            }
            const value = clean.slice(index + 1).trim();
            return {
                name: left,
                value,
                nameOffset: clean.indexOf(left),
                valueOffset: index + 1 + leadingWhitespaceLength(clean.slice(index + 1))
            };
        }
    }
    return null;
}

function collectCallNames(text) {
    const clean = stripCommentsPreserveLayout(String(text || ""));
    const result = [];
    const seen = new Set();
    const callPattern = new RegExp(`(?<![_\\p{L}\\p{N}])(${QUALIFIED_IDENTIFIER_PATTERN})\\s*\\(`, "gu");
    for (const match of clean.matchAll(callPattern)) {
        const name = match[1];
        const key = normalizeSymbolKey(name);
        if (!key || key.startsWith("ue.") || CONSTRUCTOR_NAMES.has(key) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(name);
    }
    return result;
}

function findMatchingDelimiter(text, openIndex, openChar, closeChar) {
    if (openIndex < 0 || text[openIndex] !== openChar) {
        return -1;
    }
    let depth = 0;
    let inString = false;
    for (let index = openIndex; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
            } else if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === openChar) {
            depth += 1;
        } else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function leadingWhitespaceLength(text) {
    const match = /^\s*/.exec(String(text || ""));
    return match ? match[0].length : 0;
}

function isConstructorName(name) {
    return CONSTRUCTOR_NAMES.has(normalizeSymbolKey(name));
}

module.exports = {
    parseCallExpressionText,
    parseCallArguments,
    collectCallNames,
    findMatchingDelimiter,
    isConstructorName
};
