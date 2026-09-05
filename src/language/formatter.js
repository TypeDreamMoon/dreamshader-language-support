"use strict";

const { stripCommentsPreserveLayout } = require("./utils");

function formatDocument(text, options = {}) {
    const indentText = options.indent || "    ";
    const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");
    const formatted = [];
    let depth = 0;
    let previousBlank = false;

    for (const originalLine of lines) {
        const trimmed = originalLine.trim();
        if (!trimmed) {
            if (!previousBlank) {
                formatted.push("");
            }
            previousBlank = true;
            continue;
        }
        previousBlank = false;

        const leadingClosers = countLeadingClosers(trimmed);
        const lineDepth = Math.max(0, depth - leadingClosers);
        formatted.push(indentText.repeat(lineDepth) + formatLine(trimmed));
        // Depth for the *next* line must accumulate off the pre-line depth, not the display-only
        // lineDepth -- lineDepth already subtracted the leading closers once for indentation, so
        // adding the line's full brace delta (which counts those same closers again) on top of it
        // would double-subtract and collapse a level every time 3+ blocks close in a row.
        depth = Math.max(0, depth + getLineDepthDelta(trimmed));
    }

    let result = formatted.join("\n").replace(/[ \t]+$/gm, "");
    if (/\n$/.test(text) && !/\n$/.test(result)) {
        result += "\n";
    }
    // Give the document back the line ending it arrived with. The pass above works in LF because
    // every rule here is single-line, but the caller replaces the WHOLE document with this string
    // (providers.js formatting()), so returning LF unconditionally rewrites every line ending in a
    // CRLF file -- a whole-file change disguised as a format, on a repository whose working tree is
    // CRLF throughout.
    return usesCrlf(text) ? result.replace(/\n/g, "\r\n") : result;
}

// True when the text is predominantly CRLF. Counting rather than sampling the first terminator:
// a file that is already mixed should end up consistent afterwards, and consistent with its
// majority rather than with whichever line happened to be first.
function usesCrlf(text) {
    const source = String(text || "");
    const crlf = (source.match(/\r\n/g) || []).length;
    const total = (source.match(/\n/g) || []).length;
    return crlf * 2 > total;
}

function formatLine(line) {
    if (isCommentOnly(line)) {
        return line;
    }
    if (isDirectiveLine(line)) {
        return line;
    }
    let result = line;
    result = result.replace(/\b(import)\s+("[^"]*")\s*;?$/i, "$1 $2;");
    result = result.replace(/\bTemplate\s+(Shader|ShaderFunction|ShaderLayer|ShaderLayerBlend)\b/g, "Template $1");
    result = result.replace(/\b(Properties|Inputs|Outputs|Results|Settings|Options|Graph|Layout)\s*=\s*\{/g, "$1 = {");
    result = result.replace(/\b(Name|Root|Asset|Domain|MaterialDomain|ShadingModel|BlendMode|RenderType|Group|Category|SortPriority|Sort|Description|Desc|Tooltip|DisplayName|ParameterName|DefaultValue|Curve|Atlas|CurveTime|UseCustomPrimitiveData|PrimitiveDataIndex|SamplerType|SamplerSource|MipValueMode|GatherMode|AutomaticViewMipBias|AutomaticViewMipBiasValue|Coordinates|MipValue|CoordinatesDX|CoordinatesDY|ConstCoordinate|ConstMipValue|OutputType|ResultType|Output|OutputName|OutputIndex|Class|True|False|Default|DynamicBranch|Var|X|Y|W|H|Color)\s*=\s*/g, "$1 = ");
    result = result.replace(/\s+;/g, ";");
    result = result.replace(/,\s*/g, ", ");
    result = result.replace(/\(\s+/g, "(");
    result = result.replace(/\s+\)/g, ")");
    return result;
}

function getLineDepthDelta(line) {
    const clean = stripCommentsPreserveLayout(line);
    let delta = 0;
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
        if (char === "{" || char === "[") {
            delta += 1;
        } else if (char === "}" || char === "]") {
            delta -= 1;
        }
    }
    return delta;
}

function countLeadingClosers(line) {
    let count = 0;
    for (const char of line) {
        if (char === "}" || char === "]") {
            count += 1;
            continue;
        }
        if (/\s/.test(char)) {
            continue;
        }
        break;
    }
    return count;
}

function isCommentOnly(line) {
    return /^\/\//.test(line) || /^\/\*/.test(line) || /^\*/.test(line);
}

// Any line whose first non-blank character is '#', passed through byte for byte.
//
// Deliberately every '#' line and not just the eight preprocessor keywords: a graph #Region, an
// HLSL #include inside a Function body and a #define all have the same thing in common here --
// their text is data, not DreamShaderLang, and none of the rewrites below have any business
// touching it. Widening the test also means this cannot go stale when the keyword set moves.
//
// It is not cosmetic. formatLine normalizes ", " and strips space before ';', and a #define's
// value is literal text that is folded into the generated asset's build key: formatting
// `#define A B,C` once would silently change both the value and the hash. `#if X == "a,b"`
// rewrites the string a condition compares against, and `#Region "A,B"` renames a region -- that
// last one has been true since long before conditionals existed.
function isDirectiveLine(line) {
    return /^[ \t]*#/.test(line);
}

module.exports = {
    formatDocument
};
