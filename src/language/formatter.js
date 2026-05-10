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
        depth = Math.max(0, lineDepth + getLineDepthDelta(trimmed));
    }

    let result = formatted.join("\n").replace(/[ \t]+$/gm, "");
    if (/\n$/.test(text) && !/\n$/.test(result)) {
        result += "\n";
    }
    return result;
}

function formatLine(line) {
    if (isCommentOnly(line)) {
        return line;
    }
    let result = line;
    result = result.replace(/\b(import)\s+("[^"]*")\s*;?$/i, "$1 $2;");
    result = result.replace(/\b(Properties|Inputs|Outputs|Results|Settings|Options|Graph)\s*=\s*\{/g, "$1 = {");
    result = result.replace(/\b(Name|Root|Asset|Domain|MaterialDomain|ShadingModel|BlendMode|RenderType|Group|SortPriority|Description|SamplerType|SamplerSource|MipValueMode)\s*=\s*/g, "$1 = ");
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

module.exports = {
    formatDocument
};
