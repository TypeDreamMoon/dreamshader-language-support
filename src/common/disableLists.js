"use strict";

// The warnings and errors a source turns off for itself (plugin after 2.1.2), read the way the plugin reads them
// (DreamShaderLang/Private/Lang/LangDiagnosticSuppression.cpp), so the diagnostics this extension finds on its own
// are disabled by the same lists as the compiler's:
//
//   #pragma disable_warning(DSH7224, DSH8237)   the whole file
//   #pragma disable_error(DSH8219)
//   x = f(); // disable_warning DSH5251          that line
//   // disable_error DSH4210                     alone on its line: the next line that holds code
//
// An information is never disabled. A `///` line is code, so a comment above a doc block disables it.

const CODE = /^DSH\d{4}$/i;

/** Where a `//` comment starts on the line, outside a string; -1 when there is none. */
function findLineComment(line) {
    let inString = false;
    for (let index = 0; index + 1 < line.length; index += 1) {
        const char = line[index];
        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
        } else if (char === "/" && line[index + 1] === "/") {
            return index;
        }
    }
    return -1;
}

/** `disable_warning` / `disable_error` at the start of text: { error, rest } or null. */
function matchDisableWord(text) {
    const match = /^(disable_warning|disable_error)(?![A-Za-z0-9_])(.*)$/.exec(text);
    return match ? { error: match[1] === "disable_error", rest: match[2] } : null;
}

function readCodes(list) {
    return list.replace(/[(),;:\t]/g, " ").split(/\s+/).filter((word) => CODE.test(word)).map((word) => word.toUpperCase());
}

function addTo(map, line, codes) {
    if (!map.has(line)) {
        map.set(line, new Set());
    }
    for (const code of codes) {
        map.get(line).add(code);
    }
}

/** What a text disables: file-wide sets and per-line (1-based) sets, for warnings and for errors. */
function scanDisableLists(text) {
    const lists = { fileWarnings: new Set(), fileErrors: new Set(), lineWarnings: new Map(), lineErrors: new Map() };
    const lines = String(text || "").split(/\r\n|\r|\n/);
    let pending = [];
    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        const trimmed = line.trim();

        if (trimmed.startsWith("#")) {
            const pragma = /^#\s*pragma\s+(.*)$/.exec(trimmed);
            if (pragma) {
                const payload = pragma[1];
                const commentAt = findLineComment(payload);
                const disable = matchDisableWord(commentAt >= 0 ? payload.slice(0, commentAt) : payload);
                if (disable) {
                    for (const code of readCodes(disable.rest)) {
                        (disable.error ? lists.fileErrors : lists.fileWarnings).add(code);
                    }
                }
            }
        }

        const commentAt = findLineComment(line);
        const docLine = commentAt >= 0 && line[commentAt + 2] === "/";
        const hasCode = docLine || (commentAt >= 0 ? line.slice(0, commentAt) : line).trim().length > 0;
        if (commentAt >= 0 && !docLine) {
            const disable = matchDisableWord(line.slice(commentAt + 2).trim());
            if (disable) {
                const codes = readCodes(disable.rest);
                if (hasCode) {
                    addTo(disable.error ? lists.lineErrors : lists.lineWarnings, lineNumber, codes);
                } else {
                    pending.push({ error: disable.error, codes });
                }
            }
        }
        if (hasCode) {
            for (const entry of pending) {
                addTo(entry.error ? lists.lineErrors : lists.lineWarnings, lineNumber, entry.codes);
            }
            pending = [];
        }
    });
    return lists;
}

/** Whether a diagnostic is disabled: severity "Error" / "Warning" (anything else never is), its code, its 1-based line. */
function isDisabled(lists, severity, code, line) {
    if (!lists || !code || (severity !== "Error" && severity !== "Warning")) {
        return false;
    }
    const upper = String(code).toUpperCase();
    const error = severity === "Error";
    if ((error ? lists.fileErrors : lists.fileWarnings).has(upper)) {
        return true;
    }
    const lineSet = (error ? lists.lineErrors : lists.lineWarnings).get(line);
    return Boolean(lineSet && lineSet.has(upper));
}

module.exports = {
    scanDisableLists,
    isDisabled
};
