"use strict";

// Which language a `.dsh` header is written in.
//
// `.dsh` is the header of both languages, and VS Code opens every one as `dreamshaderlang` (1.x) by its
// extension. A header written in 2.0 -- `#include`, `/// @custom`, `T Name(params) { ... }` -- then gets the 1.x
// grammar and the 1.x language server, which read it as nothing they know. The plugin itself reads a header in
// the mixed dialect: a 1.x block beside 2.0 declarations is legal. So a header with any 1.x block stays 1.x, and
// one with 2.0 declarations and none of those is 2.0.

const { blankComments } = require("./headerScan");

const LEGACY_PATTERNS = [
    /^[ \t]*(?:Function|GraphFunction|Namespace|VirtualFunction)\b/m,
    /^[ \t]*import[ \t]+"/m
];

const MODERN_PATTERNS = [
    /^[ \t]*#[ \t]*(?:include|pragma)\b/m,
    /^[ \t]*(?:export|extern|uniform|struct)\b/m,
    /^[ \t]*(?:static[ \t]+)?(?:const[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\([^;{]*\)\s*\{/m
];

/** "2.0" for a header written only in 2.0, else "1.x" -- an empty or a mixed header included. */
function detectHeaderDialect(text) {
    const source = String(text || "");
    const code = blankComments(source);
    if (LEGACY_PATTERNS.some((pattern) => pattern.test(code))) {
        return "1.x";
    }
    // `/// @custom` and the other directives are comments to blankComments, so they are read off the source.
    if (/^[ \t]*\/\/\/[ \t]*@[A-Za-z]/m.test(source) || MODERN_PATTERNS.some((pattern) => pattern.test(code))) {
        return "2.0";
    }
    return "1.x";
}

module.exports = {
    detectHeaderDialect
};
