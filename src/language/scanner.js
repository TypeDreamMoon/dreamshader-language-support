"use strict";

const { isIdentifierStart, isIdentifierPart } = require("./utils");

function scan(text) {
    const tokens = [];
    let index = 0;

    const push = (type, value, start, end) => {
        tokens.push({ type, value, start, end });
    };

    while (index < text.length) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (/\s/.test(char)) {
            const start = index;
            index += 1;
            while (index < text.length && /\s/.test(text[index])) {
                index += 1;
            }
            push("whitespace", text.slice(start, index), start, index);
            continue;
        }

        if (char === "/" && next === "/") {
            const start = index;
            index += 2;
            while (index < text.length && text[index] !== "\n") {
                index += 1;
            }
            push("comment", text.slice(start, index), start, index);
            continue;
        }

        if (char === "/" && next === "*") {
            const start = index;
            index += 2;
            while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
                index += 1;
            }
            index = Math.min(text.length, index + 2);
            push("comment", text.slice(start, index), start, index);
            continue;
        }

        if (char === "\"") {
            const start = index;
            index += 1;
            while (index < text.length) {
                if (text[index] === "\n" || text[index] === "\r") {
                    break;
                }
                if (text[index] === "\\") {
                    index += 2;
                    continue;
                }
                if (text[index] === "\"") {
                    index += 1;
                    break;
                }
                index += 1;
            }
            push("string", text.slice(start, index), start, index);
            continue;
        }

        if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(next))) {
            const start = index;
            index += 1;
            while (index < text.length && /[A-Za-z0-9_.]/.test(text[index])) {
                index += 1;
            }
            push("number", text.slice(start, index), start, index);
            continue;
        }

        if (isIdentifierStart(char)) {
            const start = index;
            index += 1;
            while (index < text.length && isIdentifierPart(text[index])) {
                index += 1;
            }
            push("identifier", text.slice(start, index), start, index);
            continue;
        }

        if (char === ":" && next === ":") {
            push("symbol", "::", index, index + 2);
            index += 2;
            continue;
        }

        push("symbol", char, index, index + 1);
        index += 1;
    }

    tokens.push({ type: "eof", value: "", start: text.length, end: text.length });
    return tokens;
}

module.exports = { scan };
