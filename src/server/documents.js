"use strict";

// The bits of `vscode.TextDocument` the providers used that the protocol's version does not have.
//
// `TextDocument` from `vscode-languageserver-textdocument` is deliberately thin: uri, version,
// getText, positionAt, offsetAt. Everything below is something the providers were getting from the
// editor's richer object and now have to compute -- reimplemented rather than worked around,
// because the behaviour they relied on is specific and changing it changes results.

const { URI } = require("vscode-uri");
const path = require("path");
const { DREAMSHADER_EXTENSIONS, LANGUAGE_ID } = require("../languageData");

/**
 * `file:` URIs to filesystem paths, strictly.
 *
 * Strict because the lenient parse assumes `file:` for a string with no scheme at all, which would
 * turn a non-URI into a plausible-looking absolute path rather than nothing.
 */
function toFsPath(uri) {
    try {
        const parsed = URI.parse(String(uri), true);
        return parsed.scheme === "file" ? parsed.fsPath : "";
    } catch (_error) {
        return "";
    }
}

function toUri(fsPath) {
    return URI.file(fsPath).toString();
}

/** What `document.fileName` was. Empty for anything not on disk, which callers already handle. */
function fileNameOf(document) {
    return toFsPath(document.uri);
}

/**
 * `document.getWordRangeAtPosition(position, pattern)`.
 *
 * Two details of the editor's behaviour that the callers depend on and a looser version would get
 * wrong: the search is confined to the position's own line, and a position sitting at the *end* of
 * a word still matches it -- which is where the cursor is after typing one, and therefore where
 * hover and go-to-definition are asked from most of the time.
 */
function getWordRangeAtPosition(document, position, pattern) {
    const line = document.getText({
        start: { line: position.line, character: 0 },
        end: { line: position.line + 1, character: 0 }
    }).replace(/\r?\n$/, "");

    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const match of line.matchAll(new RegExp(pattern.source, flags))) {
        const start = match.index;
        const end = start + match[0].length;
        if (start <= position.character && position.character <= end) {
            return {
                start: { line: position.line, character: start },
                end: { line: position.line, character: end }
            };
        }
    }
    return undefined;
}

function wordAt(document, position, pattern) {
    const range = getWordRangeAtPosition(document, position, pattern);
    return range ? { range, word: document.getText(range) } : null;
}

function rangeFromOffsets(document, startOffset, endOffset) {
    return { start: document.positionAt(startOffset), end: document.positionAt(endOffset) };
}

/** A position inside arbitrary text the server read itself, which has no `TextDocument` wrapper. */
function offsetToPosition(text, offset) {
    const prefix = text.slice(0, offset);
    const lines = prefix.split(/\n/);
    return { line: lines.length - 1, character: lines[lines.length - 1].replace(/\r$/, "").length };
}

function positionInRange(position, range) {
    if (!range) {
        return true;
    }
    const afterStart = position.line > range.start.line
        || (position.line === range.start.line && position.character >= range.start.character);
    const beforeEnd = position.line < range.end.line
        || (position.line === range.end.line && position.character <= range.end.character);
    return afterStart && beforeEnd;
}

/**
 * The server's `isDreamShaderDocument`.
 *
 * Same two conditions as the editor-side one -- the language id and a known extension -- but reading
 * the extension off the URI, since there is no `fileName` here. An untitled buffer has no extension
 * and so is not one, which matches what the editor-side check did with an empty `fileName`.
 */
function isDreamShaderDocument(document) {
    if (!document || document.languageId !== LANGUAGE_ID) {
        return false;
    }
    return DREAMSHADER_EXTENSIONS.has(path.extname(toFsPath(document.uri)).toLowerCase());
}

module.exports = {
    toFsPath,
    toUri,
    fileNameOf,
    getWordRangeAtPosition,
    wordAt,
    rangeFromOffsets,
    offsetToPosition,
    positionInRange,
    isDreamShaderDocument
};
