"use strict";

// What a DreamShader header declares, read off its text: the functions a source that includes it can call.
//
// Both languages, because a header may be either -- or both, a 1.x block beside 2.0 declarations, which the
// plugin's mixed-dialect reader accepts. 2.0: `[export | static] T Name(params) { ... }` and `extern ...;`, with
// the `///` block above it (`@name`, `@desc`, free text). 1.x: `Function` / `GraphFunction`, a `Namespace` and its
// members, through the 1.x parser. A 1.x namespace member and a 2.0 function written `/// @name Ns::Name` are both
// called `Ns::Name`, and are the same function under the symbol `Ns_Name`.
//
// Nothing here needs the editor or the compiler: completion of `Ns::` and of an `#include` closure has to work in
// a file that has never been compiled, which is exactly when the compiler's symbol index is missing.

const fs = require("fs");
const { parseDocument } = require("../language/parser");
const { flatten } = require("../language/symbols");

const NOT_A_TYPE = new Set([
    "return", "else", "if", "for", "while", "do", "switch", "case", "struct", "typedef", "using", "namespace",
    // 1.x block words: those blocks are the 1.x parser's.
    "Function", "GraphFunction", "Namespace", "VirtualFunction", "Shader", "ShaderFunction", "ShaderLayer",
    "ShaderLayerBlend", "MaterialLayer", "MaterialLayerBlend", "import"
]);
const QUALIFIERS = new Set(["export", "extern", "static", "inline", "const"]);

/** The text with every comment blanked to spaces; newlines and every offset are kept. Strings are kept. */
function blankComments(text) {
    const source = String(text || "");
    let out = "";
    let index = 0;
    let inString = false;
    while (index < source.length) {
        const char = source[index];
        if (inString) {
            out += char;
            if (char === "\\" && index + 1 < source.length) {
                out += source[index + 1];
                index += 2;
                continue;
            }
            if (char === "\"" || char === "\n") {
                inString = false;
            }
            index += 1;
            continue;
        }
        if (char === "\"") {
            inString = true;
            out += char;
            index += 1;
            continue;
        }
        if (source.startsWith("//", index)) {
            const end = source.indexOf("\n", index);
            const stop = end < 0 ? source.length : end;
            out += " ".repeat(stop - index);
            index = stop;
            continue;
        }
        if (source.startsWith("/*", index)) {
            const end = source.indexOf("*/", index + 2);
            const stop = end < 0 ? source.length : end + 2;
            out += source.slice(index, stop).replace(/[^\r\n]/g, " ");
            index = stop;
            continue;
        }
        out += char;
        index += 1;
    }
    return out;
}

function lineColumnOf(text, offset) {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < offset && index < text.length; index += 1) {
        if (text[index] === "\n") {
            line += 1;
            lineStart = index + 1;
        }
    }
    return { line, column: offset - lineStart + 1 };
}

function matchParen(text, open) {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === "(") {
            depth += 1;
        } else if (text[index] === ")") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const char of text) {
        if (char === "(" || char === "[" || char === "{" || char === "<") {
            depth += 1;
        } else if (char === ")" || char === "]" || char === "}" || char === ">") {
            depth -= 1;
        }
        if (char === "," && depth === 0) {
            parts.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    if (current.trim()) {
        parts.push(current);
    }
    return parts.map((part) => part.trim()).filter(Boolean);
}

/** `out float3 color`, `float scale = 5.0`, `Texture2D lut` -> { qualifier, type, name, defaultValue }. */
function parseParameter(text) {
    const [declaration, ...defaultParts] = text.split("=");
    const words = declaration.trim().split(/\s+/).filter(Boolean);
    let qualifier = "in";
    while (words.length > 2 && ["in", "out", "inout", "uniform", "const"].includes(words[0])) {
        if (words[0] !== "uniform" && words[0] !== "const") {
            qualifier = words[0];
        }
        words.shift();
    }
    if (words.length < 2) {
        return null;
    }
    const name = words[words.length - 1].replace(/\[.*$/, "");
    return {
        qualifier,
        type: words.slice(0, -1).join(" "),
        name,
        defaultValue: defaultParts.length > 0 ? defaultParts.join("=").trim() : ""
    };
}

/** The `///` block directly above a line: its directives and its free text. */
function readDocBlock(lines, declarationLine) {
    const docLines = [];
    for (let index = declarationLine - 2; index >= 0; index -= 1) {
        const trimmed = lines[index].trim();
        if (!trimmed.startsWith("///")) {
            break;
        }
        docLines.unshift(trimmed.slice(3).trim());
    }
    const directives = {};
    const text = [];
    for (const docLine of docLines) {
        const match = /^@([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(docLine);
        if (match) {
            directives[match[1].toLowerCase()] = match[2].trim();
        } else if (docLine) {
            text.push(docLine);
        }
    }
    return { directives, text: directives.desc || text.join("\n") };
}

/** 2.0 function declarations at file scope. */
function scanDssFunctions(text) {
    // Offsets into the text as given, CRLF and all: the 1.x language server measures positions on it.
    const source = String(text || "");
    const code = blankComments(source);
    const lines = source.split(/\r\n|\r|\n/);
    const result = [];
    const pattern = /^[ \t]*((?:[A-Za-z_][A-Za-z0-9_]*[ \t]+)+?)([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(/gm;
    let depth = 0;
    let scanned = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
        // File scope only: count the braces between the last match and this one.
        for (; scanned < match.index; scanned += 1) {
            if (code[scanned] === "{") {
                depth += 1;
            } else if (code[scanned] === "}") {
                depth = Math.max(0, depth - 1);
            }
        }
        if (depth > 0) {
            continue;
        }
        const words = match[1].trim().split(/[ \t]+/);
        const qualifiers = words.filter((word) => QUALIFIERS.has(word));
        const typeWords = words.filter((word) => !QUALIFIERS.has(word));
        if (typeWords.length !== 1 || NOT_A_TYPE.has(typeWords[0]) || NOT_A_TYPE.has(match[2])) {
            continue;
        }
        const open = match.index + match[0].length - 1;
        const close = matchParen(code, open);
        if (close < 0) {
            continue;
        }
        const after = code.slice(close + 1).trimStart();
        if (!after.startsWith("{") && !after.startsWith(";")) {
            continue;
        }
        const nameOffset = match.index + match[0].indexOf(match[2], match[1].length);
        const position = lineColumnOf(source, nameOffset);
        const doc = readDocBlock(lines, position.line);
        const nameDirective = doc.directives.name || "";
        const qualified = nameDirective.includes("::") ? nameDirective : "";
        const parameters = splitTopLevel(code.slice(open + 1, close)).map(parseParameter).filter(Boolean);
        result.push({
            dialect: "2.0",
            name: match[2],
            qualifiedName: qualified,
            returnType: typeWords[0],
            linkage: qualifiers.includes("export") ? "export" : qualifiers.includes("extern") ? "extern" : "",
            parameters,
            doc: doc.text,
            line: position.line,
            column: position.column,
            nameOffset
        });
    }
    return result;
}

/** 1.x `Function` / `GraphFunction` blocks, a namespace's included. */
function scanLegacyFunctions(text) {
    const source = String(text || "");
    let ast;
    try {
        ast = parseDocument(source);
    } catch (_error) {
        return [];
    }
    const result = [];
    for (const block of flatten(ast.blocks)) {
        if ((block.kind !== "Function" && block.kind !== "GraphFunction") || !block.name) {
            continue;
        }
        const position = lineColumnOf(source, block.nameOffset || 0);
        const parameters = (block.params || [])
            .filter((param) => param.kind === "param")
            .map((param) => ({ qualifier: param.qualifier || "in", type: param.type, name: param.name, defaultValue: "" }));
        result.push({
            dialect: "1.x",
            name: block.namespace ? `${block.namespace}_${block.name}` : block.name,
            qualifiedName: block.namespace ? `${block.namespace}::${block.name}` : "",
            returnType: block.returnType || "void",
            linkage: "",
            parameters,
            doc: "",
            line: position.line,
            column: position.column,
            nameOffset: block.nameOffset || 0,
            legacyKind: block.kind
        });
    }
    return result;
}

/** Every `#include "x"` and `import "x";` of a text, in order. */
function scanIncludes(text) {
    const code = blankComments(String(text || ""));
    const result = [];
    const pattern = /^[ \t]*(?:#[ \t]*include[ \t]+"([^"\n]*)"|import[ \t]+"([^"\n]*)")/gm;
    let match;
    while ((match = pattern.exec(code)) !== null) {
        result.push(match[1] !== undefined ? match[1] : match[2]);
    }
    return result;
}

/** Every function a header declares, both dialects. */
function scanHeaderFunctions(text) {
    const legacy = scanLegacyFunctions(text);
    const modern = scanDssFunctions(text);
    const seen = new Set(legacy.map((entry) => entry.name));
    return legacy.concat(modern.filter((entry) => !seen.has(entry.name)));
}

/**
 * The functions a file can call through its includes, and its own: { functions, files }. `resolve(specifier,
 * fromFile)` answers an absolute path or ""; `read(file)` its text. Each function carries the file it is in.
 */
function collectIncludeClosure(fileName, text, resolve, read = (file) => fs.readFileSync(file, "utf8")) {
    const functions = [];
    const files = [];
    const visited = new Set();
    const visit = (file, fileText) => {
        const key = String(file || "").replace(/\\/g, "/").toLowerCase();
        if (visited.has(key)) {
            return;
        }
        visited.add(key);
        files.push(file);
        for (const entry of scanHeaderFunctions(fileText)) {
            functions.push({ ...entry, file });
        }
        for (const specifier of scanIncludes(fileText)) {
            const resolved = typeof resolve === "function" ? resolve(specifier, file) : "";
            if (!resolved) {
                continue;
            }
            let included;
            try {
                included = read(resolved);
            } catch (_error) {
                continue;
            }
            visit(resolved, included);
        }
    };
    visit(fileName, text);
    return { functions, files };
}

/** The namespaces the functions are called by (`BL` for `BL::TexNoise3D`), once each. */
function collectNamespaces(functions) {
    const names = new Set();
    for (const entry of functions || []) {
        if (entry.qualifiedName) {
            names.add(entry.qualifiedName.split("::")[0]);
        }
    }
    return Array.from(names).sort();
}

/** `float3 BL_X(float3 co, out float fac)` as written, the way a hover shows it; `qualified` uses `Ns::Name`. */
function formatSignature(entry, qualified = true) {
    const name = qualified && entry.qualifiedName ? entry.qualifiedName : entry.name;
    const parameters = (entry.parameters || []).map((parameter) =>
        `${parameter.qualifier && parameter.qualifier !== "in" ? `${parameter.qualifier} ` : ""}${parameter.type} ${parameter.name}${parameter.defaultValue ? ` = ${parameter.defaultValue}` : ""}`);
    return `${entry.returnType || "void"} ${name}(${parameters.join(", ")})`;
}

/**
 * A 1.x callable entry -- what language/symbols.js collectCallables makes -- for a scanned function, so the 1.x
 * language server can offer and describe a 2.0 header's functions too.
 */
function toLegacyCallable(entry) {
    const inputs = (entry.parameters || []).filter((parameter) => parameter.qualifier !== "out")
        .map((parameter) => ({ qualifier: parameter.qualifier, type: parameter.type, name: parameter.name }));
    const outputs = (entry.parameters || []).filter((parameter) => parameter.qualifier === "out")
        .map((parameter) => ({ qualifier: "out", type: parameter.type, name: parameter.name }));
    if (entry.returnType && entry.returnType !== "void") {
        outputs.unshift({ qualifier: "out", type: entry.returnType, name: "", isReturn: true });
    }
    return {
        kind: entry.legacyKind || "Function",
        name: entry.qualifiedName || entry.name,
        localName: entry.qualifiedName ? entry.qualifiedName.split("::").pop() : entry.name,
        inputs,
        outputs,
        doc: entry.doc || "",
        dialect: entry.dialect
    };
}

module.exports = {
    blankComments,
    scanDssFunctions,
    scanLegacyFunctions,
    scanHeaderFunctions,
    scanIncludes,
    collectIncludeClosure,
    collectNamespaces,
    formatSignature,
    toLegacyCallable,
    parseParameter
};
