"use strict";

// Questions about a 2.0 source, answered from the compiler's symbol index (indexStore.js).
//
// Everything here is a pure function of index data, a text and a position, so the smoke tests can ask
// the same questions the editor does. Two facts about the index shape what is possible:
//
//   * It lists what a file DECLARES at file scope -- structs and their fields, uniforms, constants,
//     functions and their parameters -- not the locals of a body. A local has no definition to go to.
//   * A reference is a NAME and the spans it is mentioned at, not a resolved binding. That is exact for
//     anything whose name is unique at file scope, and an approximation for a parameter, which is why
//     parameters are narrowed to their function's lines and are not renamed.
//
// And one about time: the index is as old as the last compile. A span is therefore never trusted blind.
// `spanMatches` checks that the text under it still is the name; a stale span is dropped from an answer,
// and makes a rename refuse.

const { pathKey } = require("./indexStore");

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
const NAMESPACES = new Set(["UE", "Substrate"]);
const FILE_SCOPE_KINDS = new Set(["struct", "uniform", "constant", "function"]);

function isIdentifierChar(char) {
    return /[A-Za-z0-9_]/.test(char || "");
}

/**
 * The identifier under a position of one line, and what stands in front of it: `member` when a `.`
 * does, and `namespace` when that `.` follows `UE` or `Substrate`.
 */
function wordAt(lineText, character) {
    const text = String(lineText || "");
    let start = Math.min(Math.max(character, 0), text.length);
    // On the character after a word counts as on it: that is where the caret sits after typing one.
    if (!isIdentifierChar(text[start]) && isIdentifierChar(text[start - 1])) {
        start -= 1;
    }
    if (!isIdentifierChar(text[start])) {
        return null;
    }
    while (start > 0 && isIdentifierChar(text[start - 1])) {
        start -= 1;
    }
    IDENTIFIER.lastIndex = start;
    const match = IDENTIFIER.exec(text);
    if (!match) {
        return null;
    }

    let before = start - 1;
    while (before >= 0 && /\s/.test(text[before])) {
        before -= 1;
    }
    let member = false;
    let namespace = "";
    if (text[before] === ".") {
        member = true;
        let end = before - 1;
        while (end >= 0 && /\s/.test(text[end])) {
            end -= 1;
        }
        let begin = end;
        while (begin >= 0 && isIdentifierChar(text[begin])) {
            begin -= 1;
        }
        const owner = text.slice(begin + 1, end + 1);
        if (NAMESPACES.has(owner)) {
            namespace = owner;
        }
    }
    return { word: match[0], start, end: start + match[0].length, member, namespace };
}

/** The text under a span is still `name`. `lines` is the file split into lines; the index counts from one. */
function spanMatches(lines, span, name) {
    const line = lines[span.line - 1];
    if (typeof line !== "string") {
        return false;
    }
    return line.substr(span.column - 1, name.length) === name
        && !isIdentifierChar(line[span.column - 1 + name.length])
        && !isIdentifierChar(line[span.column - 2]);
}

function dedupeSpans(spans) {
    const seen = new Set();
    const result = [];
    for (const span of spans) {
        const key = `${span.fileKey}:${span.line}:${span.column}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(span);
        }
    }
    return result;
}

/** The functions a file declares, in order, each with the line the next one starts on. */
function functionRanges(index, fileKey) {
    const functions = index.declarations
        .filter((entry) => entry.kind === "function" && entry.fileKey === fileKey)
        .sort((left, right) => left.line - right.line);
    return functions.map((entry, position) => ({
        name: entry.name,
        startLine: entry.line,
        endLine: position + 1 < functions.length ? functions[position + 1].line - 1 : Number.MAX_SAFE_INTEGER
    }));
}

function enclosingFunction(index, fileKey, line) {
    let found = null;
    for (const range of functionRanges(index, fileKey)) {
        if (range.startLine <= line && line <= range.endLine) {
            found = range;
        }
    }
    return found;
}

/**
 * The declarations a name at a position can mean, best first. `indices` comes from
 * `store.findForSource`, so the file's own index leads and a header falls back on whoever includes it.
 */
function findDeclarations(indices, sourceFile, position, word) {
    if (!word || word.namespace) {
        return [];
    }
    const fileKey = pathKey(sourceFile);
    const candidates = [];
    for (const index of indices) {
        const scope = enclosingFunction(index, fileKey, position.line + 1);
        for (const declaration of index.declarations) {
            if (declaration.name !== word.word) {
                continue;
            }
            let rank;
            if (word.member) {
                // `a.Field`: a struct field, never a global that happens to share the name.
                if (declaration.kind !== "field") {
                    continue;
                }
                rank = 0;
            } else if (declaration.kind === "parameter") {
                // A parameter means something only inside its own function.
                if (!scope || declaration.container !== scope.name || declaration.fileKey !== fileKey) {
                    continue;
                }
                rank = 0;
            } else if (declaration.kind === "field") {
                continue;
            } else {
                rank = 1;
            }
            candidates.push({ rank, declaration });
        }
        if (candidates.length > 0) {
            break;
        }
    }
    candidates.sort((left, right) => left.rank - right.rank);
    const best = candidates.length > 0 ? candidates[0].rank : 0;
    return dedupeSpans(candidates.filter((entry) => entry.rank === best).map((entry) => entry.declaration));
}

/**
 * Every mention of what the name at a position means. `readLines(file)` hands back a file's lines --
 * an open document's, or the disk's -- so that a span from before the last edit is dropped.
 */
function findReferences(indices, sourceFile, position, word, readLines, includeDeclaration = true) {
    const declarations = findDeclarations(indices, sourceFile, position, word);
    if (declarations.length === 0) {
        return [];
    }
    const declaration = declarations[0];
    const fileKey = pathKey(sourceFile);

    let spans = [];
    for (const index of indices) {
        spans = spans.concat(index.references.get(word.word) || []);
    }
    if (includeDeclaration) {
        spans = spans.concat(declarations);
    }
    spans = dedupeSpans(spans);

    if (declaration.kind === "parameter") {
        const scope = indices.map((index) => enclosingFunction(index, fileKey, position.line + 1)).find(Boolean);
        spans = spans.filter((span) => span.fileKey === fileKey && scope && span.line >= scope.startLine && span.line <= scope.endLine);
    }

    const linesByFile = new Map();
    return spans.filter((span) => {
        if (!linesByFile.has(span.fileKey)) {
            linesByFile.set(span.fileKey, readLines(span.file) || []);
        }
        return spanMatches(linesByFile.get(span.fileKey), span, word.word);
    }).sort((left, right) => left.fileKey.localeCompare(right.fileKey) || left.line - right.line || left.column - right.column);
}

/**
 * The edits a rename makes, or `{ error }`. Only a name that is unique at file scope is renamed: the
 * index cannot tell one function's `x` from another's, and a rename that guesses is worse than none.
 * Every span has to match the text as it is now -- one stale span means the index is older than the
 * file, and the answer is to compile first.
 */
function planRename(indices, sourceFile, position, word, newName, readLines) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName || "")) {
        return { error: `'${newName}' is not an identifier.` };
    }
    const declarations = findDeclarations(indices, sourceFile, position, word);
    if (declarations.length === 0) {
        return { error: `'${word ? word.word : ""}' is not declared at file scope in the compiler's index; a local cannot be renamed from here.` };
    }
    const declaration = declarations[0];
    if (!FILE_SCOPE_KINDS.has(declaration.kind)) {
        return { error: `'${word.word}' is a ${declaration.kind}; the index names mentions, not bindings, so only file-scope names are renamed.` };
    }
    for (const index of indices) {
        if (index.declarations.some((entry) => entry.name === word.word && !FILE_SCOPE_KINDS.has(entry.kind))) {
            return { error: `'${word.word}' is also the name of a parameter or a field, and the index cannot tell their mentions apart.` };
        }
        if (index.declarations.some((entry) => entry.name === newName)) {
            return { error: `'${newName}' is already declared.` };
        }
    }

    let spans = declarations.slice();
    for (const index of indices) {
        spans = spans.concat(index.references.get(word.word) || []);
    }
    spans = dedupeSpans(spans);

    const linesByFile = new Map();
    for (const span of spans) {
        if (!linesByFile.has(span.fileKey)) {
            linesByFile.set(span.fileKey, readLines(span.file) || []);
        }
        if (!spanMatches(linesByFile.get(span.fileKey), span, word.word)) {
            return { error: `The compiler's index is older than '${span.file}' (line ${span.line} no longer says '${word.word}'). Compile the source, then rename.` };
        }
    }
    return { edits: spans.map((span) => ({ file: span.file, line: span.line, column: span.column, length: word.word.length, newText: newName })) };
}

/** The outline of one file: structs over their fields, functions over their parameters. */
function documentSymbols(index, sourceFile) {
    const fileKey = pathKey(sourceFile);
    const own = index.declarations.filter((entry) => entry.fileKey === fileKey);
    const roots = [];
    const byContainer = new Map();
    for (const entry of own) {
        if (entry.kind === "field" || entry.kind === "parameter") {
            continue;
        }
        const node = { ...entry, children: [] };
        roots.push(node);
        if (entry.kind === "struct" || entry.kind === "function") {
            byContainer.set(`${entry.kind}:${entry.name}`, node);
        }
    }
    for (const entry of own) {
        const parentKind = entry.kind === "field" ? "struct" : entry.kind === "parameter" ? "function" : "";
        const parent = parentKind ? byContainer.get(`${parentKind}:${entry.container}`) : null;
        if (parent) {
            parent.children.push({ ...entry, children: [] });
        }
    }
    return roots.sort((left, right) => left.line - right.line);
}

const ROLE_LABELS = {
    Entry: "material entry",
    Layer: "material layer",
    LayerBlend: "material layer blend",
    ExportFunction: "material function",
    Helper: "helper (inlined)",
    Custom: "custom node",
    Extern: "extern (an existing asset)"
};

/** What a hover says about a declaration, as markdown. */
function describeDeclaration(declaration) {
    const lines = ["```hlsl", declaration.signature || `${declaration.type} ${declaration.name}`.trim(), "```"];
    const facts = [];
    if (declaration.kind === "function" && declaration.role) {
        facts.push(ROLE_LABELS[declaration.role] || declaration.role);
    } else if (declaration.kind === "parameter") {
        facts.push(`parameter of \`${declaration.container}\`${declaration.pin ? `, pin \`${declaration.pin}\`` : ""}`);
    } else if (declaration.kind === "field") {
        facts.push(`field of \`${declaration.container}\``);
    } else if (declaration.kind === "uniform") {
        facts.push("material parameter");
    } else if (declaration.kind) {
        facts.push(declaration.kind);
    }
    if (declaration.asset) {
        facts.push(`asset \`${declaration.asset}\``);
    }
    if (declaration.library) {
        facts.push(`library \`${declaration.library}\``);
    }
    if (facts.length > 0) {
        lines.push("", `*${facts.join(" · ")}*`);
    }
    if (declaration.doc) {
        lines.push("", declaration.doc);
    }
    return lines.join("\n");
}

/** A function's parameters, in declaration order. */
function parametersOf(index, functionDeclaration) {
    return index.declarations
        .filter((entry) => entry.kind === "parameter" && entry.container === functionDeclaration.name && entry.fileKey === functionDeclaration.fileKey)
        .sort((left, right) => left.line - right.line || left.column - right.column);
}

/**
 * The call the caret is inside of, read backwards from it on the text before the caret: the callee's
 * name and how many top-level commas have gone by. Strings and nested brackets are skipped; this is a
 * scan, not a parse, and it answers nothing when the brackets do not balance.
 */
function callAt(textBeforeCaret) {
    let depth = 0;
    let argument = 0;
    let inString = false;
    for (let position = textBeforeCaret.length - 1; position >= 0; position -= 1) {
        const char = textBeforeCaret[position];
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === ")" || char === "]" || char === "}") {
            depth += 1;
        } else if (char === "(" || char === "[" || char === "{") {
            if (depth > 0) {
                depth -= 1;
                continue;
            }
            if (char !== "(") {
                return null;
            }
            let end = position;
            while (end > 0 && /\s/.test(textBeforeCaret[end - 1])) {
                end -= 1;
            }
            let begin = end;
            while (begin > 0 && isIdentifierChar(textBeforeCaret[begin - 1])) {
                begin -= 1;
            }
            const name = textBeforeCaret.slice(begin, end);
            if (!name) {
                return null;
            }
            let before = begin - 1;
            while (before >= 0 && /\s/.test(textBeforeCaret[before])) {
                before -= 1;
            }
            // `owner` is the namespace a member call hangs off -- `UE` in `UE.Lerp(` -- read here because
            // only here is it known where the callee starts.
            let owner = "";
            if (textBeforeCaret[before] === ".") {
                let ownerEnd = before - 1;
                while (ownerEnd >= 0 && /\s/.test(textBeforeCaret[ownerEnd])) {
                    ownerEnd -= 1;
                }
                let ownerBegin = ownerEnd;
                while (ownerBegin >= 0 && isIdentifierChar(textBeforeCaret[ownerBegin])) {
                    ownerBegin -= 1;
                }
                owner = textBeforeCaret.slice(ownerBegin + 1, ownerEnd + 1);
            }
            return { name, argument, member: textBeforeCaret[before] === ".", owner };
        } else if (char === "," && depth === 0) {
            argument += 1;
        } else if (char === ";" && depth === 0) {
            return null;
        }
    }
    return null;
}

/** File-scope names worth offering: the file's own and every header's, once each. */
function completionDeclarations(indices) {
    const seen = new Set();
    const result = [];
    for (const index of indices) {
        for (const declaration of index.declarations) {
            if (!FILE_SCOPE_KINDS.has(declaration.kind) || seen.has(declaration.name)) {
                continue;
            }
            seen.add(declaration.name);
            result.push(declaration);
        }
    }
    return result;
}

module.exports = {
    wordAt,
    spanMatches,
    functionRanges,
    enclosingFunction,
    findDeclarations,
    findReferences,
    planRename,
    documentSymbols,
    describeDeclaration,
    parametersOf,
    callAt,
    completionDeclarations
};
