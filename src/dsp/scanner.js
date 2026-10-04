"use strict";

// The shape of a `.dsp`, read from its text.
//
// What a pipeline MEANS is the compiler's to say, and the providers ask its symbol index first. But the index is as old
// as the last compile, it says nothing about what is inside an `hlsl` block, and it does not record where a pass's
// braces are. So this reads the little a language feature needs to place the caret: the declarations, the statements of
// each pass, and each `hlsl` block with the functions at its top level. It is a scan, not a parser -- it accepts
// anything, never throws, and an error in the text costs it the one declaration the error is in.
//
// A block is captured the way the compiler captures it: it ends at the `}` that matches its `{`, and braces in comments,
// strings and `#` lines do not count. Offsets are into the text as given (a CRLF file keeps its `\r`s); the caller turns
// them into positions. No `vscode` here: the smoke tests run this under plain node.

/** The words that begin a declaration at file scope; a statement that lost its `;` stops before one on a new line. */
const DECLARATION_WORDS = new Set(["uniform", "static", "buffer", "pass", "hlsl"]);

/** HLSL words that can stand where a return type or a function name would, and are neither. */
const NOT_A_FUNCTION = new Set([
    "if", "else", "for", "while", "do", "switch", "case", "default", "return", "break", "continue", "discard",
    "struct", "cbuffer", "groupshared", "typedef", "sizeof", "true", "false", "new"
]);

function isIdentifierStart(char) {
    return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_";
}

function isIdentifierChar(char) {
    return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

function isDigit(char) {
    return char >= "0" && char <= "9";
}

/**
 * Tokens and comments of a whole file. A token is `{ t, v, s, e, first }`: `t` is `id`, `num`, `str`, `p`
 * (one punctuation character) or `dir` (a `#` line, whole); `first` marks the first token of its line. A comment is
 * `{ s, e, block, doc }`.
 */
function tokenize(text) {
    const tokens = [];
    const comments = [];
    const length = text.length;
    let position = 0;
    let lineHasToken = false;

    while (position < length) {
        const char = text[position];
        if (char === "\n" || char === "\r") {
            lineHasToken = false;
            position += 1;
            continue;
        }
        if (char === " " || char === "\t" || char === "\f" || char === "\v") {
            position += 1;
            continue;
        }
        if (char === "/" && text[position + 1] === "/") {
            let end = position;
            while (end < length && text[end] !== "\n" && text[end] !== "\r") {
                end += 1;
            }
            const doc = text.startsWith("///", position) && text[position + 3] !== "/";
            comments.push({ s: position, e: end, block: false, doc });
            position = end;
            continue;
        }
        if (char === "/" && text[position + 1] === "*") {
            const close = text.indexOf("*/", position + 2);
            const end = close < 0 ? length : close + 2;
            comments.push({ s: position, e: end, block: true, doc: false });
            position = end;
            continue;
        }

        const first = !lineHasToken;
        lineHasToken = true;
        if (char === "#" && first) {
            let end = position;
            while (end < length && text[end] !== "\n" && text[end] !== "\r") {
                // A comment after a directive is a comment, not part of it.
                if (text[end] === "/" && (text[end + 1] === "/" || text[end + 1] === "*")) {
                    break;
                }
                end += 1;
            }
            tokens.push({ t: "dir", v: text.slice(position, end).trimEnd(), s: position, e: end, first });
            position = end;
            continue;
        }
        if (char === "\"") {
            // As the grammar has it: a string ends at its quote or at the end of its line.
            let end = position + 1;
            while (end < length && text[end] !== "\"" && text[end] !== "\n" && text[end] !== "\r") {
                end += text[end] === "\\" ? 2 : 1;
            }
            end = Math.min(text[end] === "\"" ? end + 1 : end, length);
            tokens.push({ t: "str", v: text.slice(position, end), s: position, e: end, first });
            position = end;
            continue;
        }
        if (isIdentifierStart(char)) {
            let end = position + 1;
            while (end < length && isIdentifierChar(text[end])) {
                end += 1;
            }
            tokens.push({ t: "id", v: text.slice(position, end), s: position, e: end, first });
            position = end;
            continue;
        }
        if (isDigit(char) || (char === "." && isDigit(text[position + 1]))) {
            let end = position + 1;
            while (end < length && (isIdentifierChar(text[end]) || text[end] === "." ||
                ((text[end] === "+" || text[end] === "-") && (text[end - 1] === "e" || text[end - 1] === "E")))) {
                end += 1;
            }
            tokens.push({ t: "num", v: text.slice(position, end), s: position, e: end, first });
            position = end;
            continue;
        }
        tokens.push({ t: "p", v: char, s: position, e: position + 1, first });
        position += 1;
    }
    return { tokens, comments };
}

function isPunct(token, value) {
    return Boolean(token) && token.t === "p" && token.v === value;
}

function isIdent(token, value) {
    return Boolean(token) && token.t === "id" && (value === undefined || token.v === value);
}

/** The index of the token closing the bracket opened at `index`, or -1 when the file ends first. */
function matchingIndex(tokens, index, open, close, limit = tokens.length) {
    let depth = 0;
    for (let cursor = index; cursor < limit; cursor += 1) {
        const token = tokens[cursor];
        if (token.t !== "p") {
            continue;
        }
        if (token.v === open) {
            depth += 1;
        } else if (token.v === close) {
            depth -= 1;
            if (depth === 0) {
                return cursor;
            }
        }
    }
    return -1;
}

/**
 * The top level of one `hlsl` block: its functions, and which of the two forms it is -- whole functions (a function
 * definition, a `groupshared`, `struct` or `cbuffer`, or a `[numthreads(...)]` at its top level) or the statements of
 * an entry (anything else). That is the rule the compiler reads the form off by (Docs/runtime/hlsl.md).
 */
function analyzeBlock(tokens, from, to) {
    const functions = [];
    let whole = false;
    let window = [];
    let numthreads = false;
    let attributeStart = -1;

    for (let index = from; index < to; index += 1) {
        const token = tokens[index];
        if (token.t === "dir") {
            continue;
        }
        if (isPunct(token, ";") || isPunct(token, "}")) {
            window = [];
            numthreads = false;
            attributeStart = -1;
            continue;
        }
        if (isPunct(token, "{")) {
            // A brace at the top level that no function signature opened: a statement block, an initializer.
            const close = matchingIndex(tokens, index, "{", "}", to);
            index = close < 0 ? to : close;
            window = [];
            continue;
        }
        if (isPunct(token, "[")) {
            const close = matchingIndex(tokens, index, "[", "]", to);
            if (isIdent(tokens[index + 1], "numthreads")) {
                whole = true;
                numthreads = true;
                if (attributeStart < 0) {
                    attributeStart = token.s;
                }
            }
            index = close < 0 ? to : close;
            continue;
        }
        if (isIdent(token) && (token.v === "groupshared" || token.v === "struct" || token.v === "cbuffer")) {
            whole = true;
        }
        if (isPunct(token, "(")) {
            const close = matchingIndex(tokens, index, "(", ")", to);
            const name = window[window.length - 1];
            const type = window[window.length - 2];
            let after = close < 0 ? to : close + 1;
            if (isPunct(tokens[after], ":") && isIdent(tokens[after + 1])) {
                after += 2;
            }
            if (close >= 0 && isIdent(name) && isIdent(type) && !NOT_A_FUNCTION.has(name.v) && !NOT_A_FUNCTION.has(type.v)
                && after < to && isPunct(tokens[after], "{")) {
                const bodyClose = matchingIndex(tokens, after, "{", "}", to);
                const start = attributeStart >= 0 ? attributeStart : (window[0] || type).s;
                functions.push({
                    name: name.v,
                    nameStart: name.s,
                    nameEnd: name.e,
                    start,
                    signatureEnd: tokens[close].e,
                    bodyOpen: tokens[after].s,
                    bodyClose: bodyClose < 0 ? -1 : tokens[bodyClose].s,
                    end: bodyClose < 0 ? (to > 0 ? tokens[to - 1].e : tokens[after].e) : tokens[bodyClose].e,
                    numthreads
                });
                whole = true;
                window = [];
                numthreads = false;
                attributeStart = -1;
                index = bodyClose < 0 ? to : bodyClose;
                continue;
            }
            window.push({ t: "p", v: ")", s: token.s, e: close < 0 ? token.e : tokens[close].e });
            index = close < 0 ? to : close;
            continue;
        }
        window.push(token);
    }
    return { form: whole ? "functions" : "statements", functions };
}

/**
 * Scan a `.dsp`. Every range is a pair of offsets, end exclusive. A block's `close` is the offset of its `}`, or -1
 * when the file ends first (the compiler's DSH2150) -- its content then runs to the end of the text.
 */
function scanPipeline(input) {
    const text = String(input || "");
    const { tokens, comments } = tokenize(text);
    const result = {
        text,
        tokens,
        comments,
        pragma: null,
        uniforms: [],
        constants: [],
        buffers: [],
        passes: [],
        hlsl: null,
        blocks: []
    };

    let index = 0;

    /**
     * The `///` block right above the token at `tokenIndex`, as a reader wants it: the free text and the `@desc`
     * values. A key is `@` and a name at the start of the line or after a space, and its value runs to the next one --
     * the compiler's doc-block rule -- so `name@example.com` stays text.
     */
    function docBefore(tokenIndex) {
        const start = tokens[tokenIndex].s;
        const floor = tokenIndex > 0 ? tokens[tokenIndex - 1].e : 0;
        return comments
            .filter((comment) => comment.doc && comment.s >= floor && comment.e <= start)
            .map((comment) => {
                const parts = text.slice(comment.s + 3, comment.e).split(/(?:^|\s)@(?=[A-Za-z_])/);
                const free = parts[0].trim();
                const descriptions = parts.slice(1)
                    .filter((part) => /^desc\b/i.test(part))
                    .map((part) => part.replace(/^desc\b/i, "").trim());
                return [free, ...descriptions].filter(Boolean).join(" ");
            })
            .filter(Boolean)
            .join("\n");
    }

    /** Past the next `;` at bracket depth 0; never past a declaration word that begins a line, nor a `}` that closes `stopDepth`. */
    function skipStatement(stopAtBrace) {
        const begin = index;
        let depth = 0;
        while (index < tokens.length) {
            const token = tokens[index];
            if (index > begin && token.first && token.t === "id" && DECLARATION_WORDS.has(token.v) && depth === 0 && !stopAtBrace) {
                return;
            }
            if (token.t === "dir" && index > begin && depth === 0) {
                return;
            }
            if (token.t === "p") {
                if (token.v === "(" || token.v === "[" || token.v === "{") {
                    depth += 1;
                } else if (token.v === ")" || token.v === "]") {
                    depth = Math.max(depth - 1, 0);
                } else if (token.v === "}") {
                    if (depth === 0) {
                        if (stopAtBrace) {
                            return;
                        }
                    } else {
                        depth -= 1;
                    }
                } else if (token.v === ";" && depth === 0) {
                    index += 1;
                    return;
                }
            }
            index += 1;
        }
    }

    /** The end offset of what `skipStatement` just stepped over. */
    function endOfLastToken(fallback) {
        return index > 0 && tokens[index - 1] ? Math.max(tokens[index - 1].e, fallback) : fallback;
    }

    function captureBlock(keywordIndex, passIndex) {
        const openIndex = keywordIndex + 1;
        const closeIndex = matchingIndex(tokens, openIndex, "{", "}");
        const limit = closeIndex < 0 ? tokens.length : closeIndex;
        const open = tokens[openIndex].s;
        const block = {
            passIndex,
            keywordStart: tokens[keywordIndex].s,
            open,
            close: closeIndex < 0 ? -1 : tokens[closeIndex].s,
            contentStart: open + 1,
            contentEnd: closeIndex < 0 ? text.length : tokens[closeIndex].s,
            end: closeIndex < 0 ? text.length : tokens[closeIndex].e,
            ...analyzeBlock(tokens, openIndex + 1, limit)
        };
        result.blocks.push(block);
        index = closeIndex < 0 ? tokens.length : closeIndex + 1;
        return block;
    }

    function parseVariable(kind, words) {
        const first = tokens[index];
        const type = tokens[index + words];
        const name = tokens[index + words + 1];
        const doc = docBefore(index);
        index += words + 2;
        skipStatement(false);
        const entry = {
            kind,
            name: name.v,
            type: type.v,
            nameStart: name.s,
            nameEnd: name.e,
            start: first.s,
            end: endOfLastToken(name.e),
            doc
        };
        (kind === "uniform" ? result.uniforms : result.constants).push(entry);
    }

    function parseArguments(openIndex, closeIndex) {
        const argumentsFound = [];
        let cursor = openIndex + 1;
        const limit = closeIndex < 0 ? tokens.length : closeIndex;
        while (cursor < limit) {
            const key = tokens[cursor];
            if (isIdent(key) && isPunct(tokens[cursor + 1], "=")) {
                let end = cursor + 2;
                let depth = 0;
                while (end < limit && !(depth === 0 && isPunct(tokens[end], ","))) {
                    if (isPunct(tokens[end], "(")) {
                        depth += 1;
                    } else if (isPunct(tokens[end], ")")) {
                        depth -= 1;
                    }
                    end += 1;
                }
                const valueTokens = tokens.slice(cursor + 2, end);
                argumentsFound.push({
                    name: key.v,
                    nameStart: key.s,
                    nameEnd: key.e,
                    valueStart: valueTokens.length > 0 ? valueTokens[0].s : tokens[cursor + 1].e,
                    valueEnd: valueTokens.length > 0 ? valueTokens[valueTokens.length - 1].e : tokens[cursor + 1].e
                });
                cursor = end + 1;
            } else {
                cursor += 1;
            }
        }
        return argumentsFound;
    }

    function parseBuffer() {
        const first = tokens[index];
        const name = tokens[index + 1];
        const format = isIdent(tokens[index + 3]) ? tokens[index + 3] : null;
        const doc = docBefore(index);
        index += format ? 4 : 3;
        let argumentsOpen = -1;
        let argumentsClose = -1;
        let argumentList = [];
        if (isPunct(tokens[index], "(")) {
            const close = matchingIndex(tokens, index, "(", ")");
            argumentsOpen = tokens[index].s;
            argumentsClose = close < 0 ? -1 : tokens[close].s;
            argumentList = parseArguments(index, close);
        }
        skipStatement(false);
        result.buffers.push({
            name: name.v,
            format: format ? format.v : "",
            nameStart: name.s,
            nameEnd: name.e,
            formatStart: format ? format.s : -1,
            formatEnd: format ? format.e : -1,
            argumentsOpen,
            argumentsClose,
            arguments: argumentList,
            start: first.s,
            end: endOfLastToken(name.e),
            doc
        });
    }

    function valueRange(from, fallback) {
        // The tokens of a value run to the `;`, or to a `}` that ends the pass, at bracket depth 0.
        let cursor = from;
        let depth = 0;
        while (cursor < tokens.length) {
            const token = tokens[cursor];
            if (token.t === "p") {
                if (token.v === "(" || token.v === "[") {
                    depth += 1;
                } else if (token.v === ")" || token.v === "]") {
                    depth = Math.max(depth - 1, 0);
                } else if ((token.v === ";" || token.v === "}" || token.v === "{") && depth === 0) {
                    break;
                }
            }
            if (token.t === "id" && token.first && cursor > from && depth === 0
                && (token.v === "read" || token.v === "write" || token.v === "param" || token.v === "hlsl" || isPunct(tokens[cursor + 1], "="))) {
                // A statement that lost its `;`: the value is what stood on the lines before this one.
                break;
            }
            cursor += 1;
        }
        return cursor > from
            ? { valueStart: tokens[from].s, valueEnd: tokens[cursor - 1].e, next: cursor }
            : { valueStart: fallback, valueEnd: fallback, next: cursor };
    }

    function finishStatement(next) {
        index = next;
        if (isPunct(tokens[index], ";")) {
            index += 1;
        }
        return endOfLastToken(0);
    }

    function parsePassBody(pass) {
        while (index < tokens.length) {
            const token = tokens[index];
            if (isPunct(token, "}")) {
                pass.bodyClose = token.s;
                pass.end = token.e;
                index += 1;
                return;
            }
            if (token.t === "id" && (token.v === "read" || token.v === "write") && isIdent(tokens[index + 1])) {
                const verb = token;
                const first = tokens[index + 1];
                let slot = first;
                let buffer = first;
                let cursor = index + 2;
                if (isPunct(tokens[cursor], "=") && isIdent(tokens[cursor + 1])) {
                    buffer = tokens[cursor + 1];
                    cursor += 2;
                }
                let member = null;
                if (isPunct(tokens[cursor], ".") && isIdent(tokens[cursor + 1])) {
                    member = tokens[cursor + 1];
                    cursor += 2;
                }
                const rest = valueRange(cursor, buffer.e);
                pass.statements.push({
                    type: verb.v,
                    name: slot.v,
                    nameStart: slot.s,
                    nameEnd: slot.e,
                    explicitName: slot !== buffer,
                    buffer: buffer.v,
                    bufferStart: buffer.s,
                    bufferEnd: buffer.e,
                    member: member ? member.v : "",
                    previous: Boolean(member && member.v === "Previous"),
                    start: verb.s,
                    end: finishStatement(rest.next)
                });
                continue;
            }
            if (isIdent(token, "param") && isIdent(tokens[index + 1])) {
                const name = tokens[index + 1];
                const hasValue = isPunct(tokens[index + 2], "=");
                const value = valueRange(index + (hasValue ? 3 : 2), (hasValue ? tokens[index + 2] : name).e);
                pass.statements.push({
                    type: "param",
                    name: name.v,
                    nameStart: name.s,
                    nameEnd: name.e,
                    valueStart: value.valueStart,
                    valueEnd: value.valueEnd,
                    start: token.s,
                    end: finishStatement(value.next)
                });
                continue;
            }
            if (isIdent(token, "hlsl") && isPunct(tokens[index + 1], "{")) {
                const block = captureBlock(index, result.passes.indexOf(pass));
                if (!pass.hlsl) {
                    pass.hlsl = block;
                }
                continue;
            }
            if (token.t === "id" && /^[A-Z]/.test(token.v) && isPunct(tokens[index + 1], "=")) {
                const value = valueRange(index + 2, tokens[index + 1].e);
                pass.statements.push({
                    type: "key",
                    name: token.v,
                    nameStart: token.s,
                    nameEnd: token.e,
                    valueStart: value.valueStart,
                    valueEnd: value.valueEnd,
                    start: token.s,
                    end: finishStatement(value.next)
                });
                continue;
            }
            skipStatement(true);
            if (index < tokens.length && tokens[index] === token) {
                // Nothing was consumed (a stray `)`): step over it, or the scan would stand still.
                index += 1;
            }
        }
        // The file ended inside the pass.
        pass.bodyClose = -1;
        pass.end = text.length;
    }

    function parsePass() {
        const first = tokens[index];
        const name = tokens[index + 1];
        const kind = isIdent(tokens[index + 3]) ? tokens[index + 3] : null;
        const pass = {
            name: name.v,
            kind: kind ? kind.v : "",
            nameStart: name.s,
            nameEnd: name.e,
            kindStart: kind ? kind.s : -1,
            kindEnd: kind ? kind.e : -1,
            start: first.s,
            bodyOpen: -1,
            bodyClose: -1,
            end: (kind || tokens[index + 2]).e,
            doc: docBefore(index),
            statements: [],
            hlsl: null
        };
        result.passes.push(pass);
        index += kind ? 4 : 3;
        if (!isPunct(tokens[index], "{")) {
            // No body (the compiler's DSH2xxx): what follows is read as file scope again.
            return;
        }
        pass.bodyOpen = tokens[index].s;
        index += 1;
        parsePassBody(pass);
    }

    while (index < tokens.length) {
        const token = tokens[index];
        if (token.t === "dir") {
            if (!result.pragma && /^#\s*pragma\s+pipeline\b/.test(token.v)) {
                const open = token.v.indexOf("(");
                const close = token.v.lastIndexOf(")");
                result.pragma = {
                    start: token.s,
                    end: token.e,
                    argumentsOpen: open < 0 ? -1 : token.s + open,
                    argumentsClose: close < open ? -1 : token.s + close
                };
            }
            index += 1;
            continue;
        }
        if (token.t === "id") {
            const next = tokens[index + 1];
            if (token.v === "uniform" && isIdent(next) && isIdent(tokens[index + 2])) {
                parseVariable("uniform", 1);
                continue;
            }
            if (token.v === "static" && isIdent(next, "const") && isIdent(tokens[index + 2]) && isIdent(tokens[index + 3])) {
                parseVariable("constant", 2);
                continue;
            }
            if (token.v === "buffer" && isIdent(next) && isPunct(tokens[index + 2], ":")) {
                parseBuffer();
                continue;
            }
            if (token.v === "pass" && isIdent(next) && isPunct(tokens[index + 2], ":")) {
                parsePass();
                continue;
            }
            if (token.v === "hlsl" && isPunct(next, "{")) {
                const block = captureBlock(index, -1);
                if (!result.hlsl) {
                    result.hlsl = block;
                }
                continue;
            }
        }
        const before = index;
        skipStatement(false);
        if (index === before) {
            index += 1;
        }
    }

    return result;
}

module.exports = {
    tokenize,
    scanPipeline
};
