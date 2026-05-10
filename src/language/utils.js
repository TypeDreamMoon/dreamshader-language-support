"use strict";

function normalizeSymbolKey(name) {
    return String(name || "").trim().toLowerCase();
}

function isIdentifierStart(char) {
    return /[A-Za-z_]/.test(char || "");
}

function isIdentifierPart(char) {
    return /[A-Za-z0-9_]/.test(char || "");
}

function isWhitespace(char) {
    return /\s/.test(char || "");
}

function clampOffset(offset, textLength) {
    return Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, textLength));
}

function findLineStart(text, offset) {
    const index = text.lastIndexOf("\n", Math.max(0, offset - 1));
    return index < 0 ? 0 : index + 1;
}

function getLinePrefix(text, offset) {
    return text.slice(findLineStart(text, offset), offset);
}

function stripCommentsPreserveLayout(text) {
    let result = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n" || char === "\r") {
                inLineComment = false;
                result += char;
            } else {
                result += " ";
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                result += "  ";
                inBlockComment = false;
                index += 1;
            } else {
                result += char === "\n" || char === "\r" ? char : " ";
            }
            continue;
        }

        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
                result += char;
                continue;
            }
            result += char;
            if (char === "\\") {
                if (index + 1 < text.length) {
                    result += text[index + 1];
                    index += 1;
                }
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            result += char;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            result += "  ";
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            result += "  ";
            index += 1;
            continue;
        }

        result += char;
    }

    return result;
}

function offsetToPosition(text, offset) {
    const safeOffset = clampOffset(offset, text.length);
    const prefix = text.slice(0, safeOffset);
    const lines = prefix.split("\n");
    return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function normalizeFsPath(value) {
    return String(value || "").replace(/\\/g, "/");
}

function splitTopLevel(text, baseOffset, delimiters) {
    const normalized = stripCommentsPreserveLayout(text);
    const delimiterSet = new Set(Array.isArray(delimiters) ? delimiters : [delimiters]);
    const result = [];
    let start = 0;
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    let inString = false;

    const push = (end, terminated) => {
        const raw = normalized.slice(start, end);
        const leading = raw.search(/\S|$/);
        const trailing = raw.length - raw.trimEnd().length;
        const value = raw.trim();
        if (!value) {
            return;
        }
        result.push({
            text: value,
            startOffset: baseOffset + start + leading,
            endOffset: baseOffset + end - trailing,
            terminated
        });
    };

    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
                continue;
            }
            if (char === "\\") {
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
            paren += 1;
            continue;
        }
        if (char === ")") {
            paren = Math.max(0, paren - 1);
            continue;
        }
        if (char === "{") {
            brace += 1;
            continue;
        }
        if (char === "}") {
            brace = Math.max(0, brace - 1);
            continue;
        }
        if (char === "[") {
            bracket += 1;
            continue;
        }
        if (char === "]") {
            bracket = Math.max(0, bracket - 1);
            continue;
        }
        if (delimiterSet.has(char) && paren === 0 && brace === 0 && bracket === 0) {
            push(index, true);
            start = index + 1;
        }
    }

    if (normalized.slice(start).trim()) {
        push(normalized.length, false);
    }

    return result;
}

function splitTopLevelAssignment(text) {
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
                continue;
            }
            if (char === "\\") {
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
            paren += 1;
            continue;
        }
        if (char === ")") {
            paren = Math.max(0, paren - 1);
            continue;
        }
        if (char === "{") {
            brace += 1;
            continue;
        }
        if (char === "}") {
            brace = Math.max(0, brace - 1);
            continue;
        }
        if (char === "[") {
            bracket += 1;
            continue;
        }
        if (char === "]") {
            bracket = Math.max(0, bracket - 1);
            continue;
        }
        if (char === "=" && paren === 0 && brace === 0 && bracket === 0) {
            return {
                left: text.slice(0, index).trim(),
                right: text.slice(index + 1).trim(),
                index
            };
        }
    }
    return null;
}

module.exports = {
    normalizeSymbolKey,
    isIdentifierStart,
    isIdentifierPart,
    isWhitespace,
    clampOffset,
    findLineStart,
    getLinePrefix,
    stripCommentsPreserveLayout,
    offsetToPosition,
    normalizeFsPath,
    splitTopLevel,
    splitTopLevelAssignment
};
