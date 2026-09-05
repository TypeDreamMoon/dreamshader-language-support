"use strict";

// DreamShaderLang preprocessor, in JavaScript: the directive scan and the constant-expression
// evaluator that decide which lines of a source a given define table keeps.
//
// This is a MIRROR of the plugin, not an approximation of it. The two files it tracks are
//   Source/DreamShader/Private/Preprocessor/DreamShaderPreprocessor.cpp            (the line scan)
//   Source/DreamShader/Private/Preprocessor/DreamShaderPreprocessorExpression.cpp  (the evaluator)
// and the spec both of them answer to is Docs/language/preprocessor.md. Where the mirror is exact
// the comment says so; where it cannot be, the divergence is named at the bottom of this header
// rather than left for a reader to discover from a wrong answer.
//
// Why a mirror at all: the editor has to grey out the branch that will not be compiled, and it has
// no compiler to ask. A dimmer that guesses is worse than no dimmer -- the failure mode is an author
// editing a branch the editor told them was dead, or trusting a branch it told them was live -- so
// the rule everywhere below is BE EXACT OR BE SILENT. Every structural error (an unclosed `#if`, a
// mis-cased `#IF`, a malformed condition) makes `analyzeSource` return no regions at all, because a
// file the compiler would refuse is a file whose branch structure this module has no opinion about.
//
// The module deliberately knows nothing about `vscode`, `fs` or the bridge: it takes text and a
// define lookup and returns line ranges. That is what lets `scripts/preprocessor-smoke.js` run the
// conformance vectors the plugin exports straight through it, and what would let the language
// server's diagnostics reuse it.
//
// KNOWN DIVERGENCES FROM THE C++ (all deliberate, none reachable from a valid source):
//   1. Identifier and digit characters are ASCII here. The C++ tokenizer uses FChar::IsAlpha /
//      FChar::IsAlnum, which are Unicode-aware, so `#if Café` tokenizes as one identifier there and
//      as an unexpected character here. Define NAMES are ASCII-only in both (DreamShaderDefineTable
//      spells its own ASCII predicates out, with a comment saying the extension's lexer assumes it),
//      so the only sources that can tell the difference are ones the plugin would reject anyway --
//      an identifier it accepts as a token but can never look up.
//   2. Whitespace is JavaScript's `\s` rather than FChar::IsWhitespace (iswspace). The two agree on
//      every ASCII character; they can disagree on exotic Unicode spaces, which again cannot appear
//      in a source that compiles.
//   3. Integers are BigInt. That is not a divergence but the reason there is none: a JS Number
//      carries 53 bits, so `#if DS_BUILD == 9007199254740993` would answer differently from the
//      plugin's int64. Every arithmetic result below is wrapped through BigInt.asIntN(64, ...) so
//      overflow wraps exactly as the C++ (which does its arithmetic through uint64 for the same
//      reason) does.
//
// Grammar, value domain and every edge ruling: Plan/preprocessor-conditionals.md sections 3 and 4.

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

/** The eight directives, and the only spellings that are them: lowercase, matched case-sensitively. */
const DIRECTIVE_KEYWORDS = Object.freeze({
    if: "if",
    ifdef: "ifdef",
    ifndef: "ifndef",
    elif: "elif",
    else: "else",
    endif: "endif",
    define: "define",
    undef: "undef"
});

/**
 * The parser's graph directives, which pass through untouched.
 *
 * Matched case-INSENSITIVELY, because that is what the parser does -- `IsGraphDirective` compares
 * with `ESearchCase::IgnoreCase`, so `#Region`, `#region` and `#REGION` are all region directives.
 * Naming them is what lets an unrecognized `#` line be an error (DSH1035) instead of a shrug.
 */
const GRAPH_DIRECTIVE_KEYWORDS = Object.freeze(["region", "endregion"]);

/** `#if` blocks nest to 64; the 65th is DSH1037. */
const MAX_CONDITIONAL_DEPTH = 64;

/** Recorded for a define that was read while not defined. Matches GDreamShaderUndefinedDefineSentinel. */
const UNDEFINED_DEFINE_SENTINEL = "<undef>";

/** The `DS_` prefix is reserved as a prefix, and the test is case-sensitive: `ds_foo` is ordinary. */
const RESERVED_DEFINE_PREFIX = "DS_";

const DIRECTIVE_KIND = Object.freeze({
    None: "none",
    Unknown: "unknown",
    If: "if",
    IfDef: "ifdef",
    IfNDef: "ifndef",
    Elif: "elif",
    Else: "else",
    Endif: "endif",
    Define: "define",
    Undef: "undef"
});

const REAL_DIRECTIVE_KINDS = new Set([
    DIRECTIVE_KIND.If,
    DIRECTIVE_KIND.IfDef,
    DIRECTIVE_KIND.IfNDef,
    DIRECTIVE_KIND.Elif,
    DIRECTIVE_KIND.Else,
    DIRECTIVE_KIND.Endif,
    DIRECTIVE_KIND.Define,
    DIRECTIVE_KIND.Undef
]);

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// -------------------------------------------------------------------------------------------------
// Character classes
//
// ASCII on purpose; see divergence 1 in the header.
// -------------------------------------------------------------------------------------------------

function isWhitespaceChar(character) {
    return character === " " || character === "\t" || /^\s$/.test(character);
}

function isAsciiAlpha(character) {
    return (character >= "A" && character <= "Z") || (character >= "a" && character <= "z");
}

function isAsciiDigit(character) {
    return character >= "0" && character <= "9";
}

function isNameStartChar(character) {
    return isAsciiAlpha(character) || character === "_";
}

function isNameBodyChar(character) {
    return isNameStartChar(character) || isAsciiDigit(character);
}

// -------------------------------------------------------------------------------------------------
// Define names
// -------------------------------------------------------------------------------------------------

/** `[A-Za-z_][A-Za-z0-9_]*`, matching IsValidDreamShaderDefineName. */
function isValidDefineName(name) {
    if (typeof name !== "string" || name.length === 0) {
        return false;
    }
    if (!isNameStartChar(name[0])) {
        return false;
    }
    for (let index = 1; index < name.length; index += 1) {
        if (!isNameBodyChar(name[index])) {
            return false;
        }
    }
    return true;
}

/**
 * True for a name beginning with `DS_`, case-sensitively.
 *
 * The case sensitivity is load-bearing rather than tidy: were it insensitive, `ds_substrate` would
 * pass the reserved test and then land in `DS_SUBSTRATE`'s slot, overwriting a read-only builtin
 * through the back door.
 */
function isReservedDefineName(name) {
    return typeof name === "string" && name.startsWith(RESERVED_DEFINE_PREFIX);
}

// -------------------------------------------------------------------------------------------------
// Lines
// -------------------------------------------------------------------------------------------------

/**
 * Splits text into lines while KEEPING each terminator, matching SplitSourceLines.
 *
 * CRLF counts as one terminator, a lone CR or a lone LF as one each. The trailing line always
 * exists, even when it is empty, so the line count here is the line count the plugin's own
 * line-conservation invariant is stated in -- which is what makes a line number computed on this
 * side name the same physical line on that one.
 */
function splitSourceLines(text) {
    const lines = [];
    const length = text.length;
    let lineStart = 0;

    for (let index = 0; index < length; index += 1) {
        const character = text[index];
        if (character !== "\n" && character !== "\r") {
            continue;
        }
        const terminatorLength = (character === "\r" && index + 1 < length && text[index + 1] === "\n") ? 2 : 1;
        lines.push({ content: text.slice(lineStart, index), terminator: text.substr(index, terminatorLength) });
        index += terminatorLength - 1;
        lineStart = index + 1;
    }

    lines.push({ content: text.slice(lineStart), terminator: "" });
    return lines;
}

// -------------------------------------------------------------------------------------------------
// Opaque regions: `Function` and `GraphFunction` bodies
//
// A Function body is raw HLSL and its `#` lines belong to the HLSL preprocessor, with the shader
// compiler's defines in scope. Reading them as DreamShader directives is silently destructive rather
// than loudly wrong: MoonToon's MF_MoonToonTranslucencyShadow.dsf branches on MATERIALBLENDING_SOLID,
// which DreamShader's table does not and must not hold, so every branch would read false, `#else`
// would win unconditionally, and the function would compile while returning the wrong value for
// every blend mode. Across the whole source tree every HLSL `#` directive sits inside such a body.
//
// So the tracker below exists for one purpose in this file: a line inside a body is NEVER a
// directive and NEVER dimmed on its own account. (It is still dimmed when a `#if` OUTSIDE the block
// cut the whole block -- that is a real cut, and the directives doing the cutting are outside.)
// -------------------------------------------------------------------------------------------------

const OPAQUE_STATE = Object.freeze({
    Outside: "outside",
    SeekingBody: "seeking",
    InsideBody: "inside"
});

function hasClosingQuoteOnLine(line, openIndex) {
    for (let index = openIndex + 1; index < line.length; index += 1) {
        if (line[index] === "\\") {
            index += 1;
            continue;
        }
        if (line[index] === "'") {
            return true;
        }
    }
    return false;
}

/**
 * Tracks whether the current line is inside a `Function` / `GraphFunction` body.
 *
 * Character-level and aware of comments and string literals, because brace counting has to be: a
 * `//` or a `"{"` in an HLSL body would otherwise close the region early and hand the rest of the
 * function back to the directive scanner -- the very failure the region exists to prevent, arrived
 * at from the other side. Block-comment state is the one thing carried across lines.
 *
 * `isOpaque()` is asked BEFORE the line is scanned, so a `Function` declaration line is still
 * ordinary source and the body's closing `}` line is still the last opaque one.
 */
function createOpaqueRegionTracker() {
    let state = OPAQUE_STATE.Outside;
    let braceDepth = 0;
    let inBlockComment = false;

    return {
        isOpaque() {
            return state !== OPAQUE_STATE.Outside;
        },

        scanLine(line) {
            const length = line.length;

            // A `#`-shaped line is never a Function declaration, whatever words follow. Without this
            // a region comment spelled `#Region Function helpers` would open an opaque region that
            // swallows the rest of the graph.
            let lineIsHashShaped = false;
            for (let probe = 0; probe < length; probe += 1) {
                if (!isWhitespaceChar(line[probe])) {
                    lineIsHashShaped = line[probe] === "#";
                    break;
                }
            }

            // Per-line: neither literal may span a line in HLSL or in DreamShaderLang, so resetting
            // each line keeps one stray quote from eating the file.
            let inString = false;
            let inCharacter = false;

            for (let index = 0; index < length; index += 1) {
                const character = line[index];

                if (inBlockComment) {
                    if (character === "*" && index + 1 < length && line[index + 1] === "/") {
                        inBlockComment = false;
                        index += 1;
                    }
                    continue;
                }

                if (inString || inCharacter) {
                    if (character === "\\" && index + 1 < length) {
                        index += 1;
                        continue;
                    }
                    if (inString && character === "\"") {
                        inString = false;
                    } else if (inCharacter && character === "'") {
                        inCharacter = false;
                    }
                    continue;
                }

                if (character === "/" && index + 1 < length) {
                    if (line[index + 1] === "/") {
                        // Nothing after a line comment can affect the state, and returning here is
                        // what keeps a `// }` from closing a body.
                        return;
                    }
                    if (line[index + 1] === "*") {
                        inBlockComment = true;
                        index += 1;
                        continue;
                    }
                }

                if (character === "\"") {
                    inString = true;
                    continue;
                }

                if (character === "'" && hasClosingQuoteOnLine(line, index)) {
                    // Only when the line actually closes it. An apostrophe with no partner is far
                    // likelier than a character literal in either language, and treating one as a
                    // literal would blind the rest of the line -- including a `}` that ends a body.
                    inCharacter = true;
                    continue;
                }

                if (state === OPAQUE_STATE.Outside) {
                    if (isNameStartChar(character)) {
                        // Whole identifier runs, so `MaterialFunction` and `VirtualFunction` are one
                        // token each and cannot match on their `Function` tail.
                        const start = index;
                        while (index < length && isNameBodyChar(line[index])) {
                            index += 1;
                        }
                        const token = line.slice(start, index);
                        index -= 1;

                        // Case-sensitive, matching FScanner::TryConsumeKeyword, which is what
                        // actually decides whether the parser sees a Function block.
                        if (!lineIsHashShaped && (token === "Function" || token === "GraphFunction")) {
                            state = OPAQUE_STATE.SeekingBody;
                            braceDepth = 0;
                        }
                    }

                    // Braces outside a Function body belong to Shader, Namespace and the section
                    // blocks, and are none of this tracker's business.
                    continue;
                }

                if (character === "{") {
                    braceDepth += 1;
                    state = OPAQUE_STATE.InsideBody;
                    continue;
                }

                if (character === "}" && state === OPAQUE_STATE.InsideBody) {
                    braceDepth -= 1;
                    if (braceDepth <= 0) {
                        state = OPAQUE_STATE.Outside;
                        braceDepth = 0;
                    }
                }
            }
        }
    };
}

// -------------------------------------------------------------------------------------------------
// Directive recognition
// -------------------------------------------------------------------------------------------------

/**
 * Classifies one physical line, and hands back the keyword and everything after it.
 *
 * A line is a directive when its first non-whitespace character is `#`, so a line starting with `//`
 * cannot be one -- which is what makes a commented-out `// #if FOO` inert with no special case.
 *
 * The keyword is a maximal run of identifier characters, and that one decision settles three rules:
 * `#if(A)` is legal because `(` is not an identifier character; `#iffy` is an unknown directive
 * rather than a mangled `#if`; and `#  if FOO` is `#if` because whitespace after `#` is skipped.
 *
 * There is deliberately no "unrecognized spellings pass through" fallback. Under one, `#IF FOO` and
 * `#Endif` were emitted as ordinary source, the parser had nothing to say about them either, and the
 * author's conditional simply never took effect. That is the exact shape of failure the feature
 * exists to remove, so anything that is neither one of the eight nor a region directive is Unknown.
 *
 * `hashIndex`, `keywordIndex` and `restIndex` are indices INTO THE LINE (-1 when there is no `#`).
 * Nothing in this file needs them -- regions are counted in whole lines -- but a caller producing
 * diagnostics needs a column, and having the classifier hand back the three offsets it computed
 * anyway is what lets such a caller reuse this function instead of re-deriving the split.
 */
function classifyDirectiveLine(line) {
    const empty = { kind: DIRECTIVE_KIND.None, keyword: "", rest: "", hashIndex: -1, keywordIndex: -1, restIndex: -1 };
    const length = line.length;
    let index = 0;

    while (index < length && isWhitespaceChar(line[index])) {
        index += 1;
    }
    if (index >= length || line[index] !== "#") {
        return empty;
    }
    const hashIndex = index;

    index += 1;
    while (index < length && isWhitespaceChar(line[index])) {
        index += 1;
    }

    const keywordStart = index;
    while (index < length && isNameBodyChar(line[index])) {
        index += 1;
    }

    const keyword = line.slice(keywordStart, index);
    const split = { keyword, rest: line.slice(index), hashIndex, keywordIndex: keywordStart, restIndex: index };

    if (GRAPH_DIRECTIVE_KEYWORDS.includes(keyword.toLowerCase())) {
        return { kind: DIRECTIVE_KIND.None, ...split };
    }

    if (Object.prototype.hasOwnProperty.call(DIRECTIVE_KEYWORDS, keyword) && DIRECTIVE_KEYWORDS[keyword] === keyword) {
        return { kind: keyword, ...split };
    }

    return { kind: DIRECTIVE_KIND.Unknown, ...split };
}

function isRealDirective(kind) {
    return REAL_DIRECTIVE_KINDS.has(kind);
}

/**
 * Cuts a trailing `//` comment off a directive's tail.
 *
 * String-aware, because `#if DS_HOST == "http://build"` is a condition and not a comment. Block
 * comments are deliberately not handled: one may span lines, and a line-oriented scanner that tried
 * would need the very lexer state this pass runs before.
 */
function stripTrailingLineComment(text) {
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (inString) {
            if (character === "\\" && index + 1 < text.length) {
                index += 1;
                continue;
            }
            if (character === "\"") {
                inString = false;
            }
            continue;
        }

        if (character === "\"") {
            inString = true;
            continue;
        }

        if (character === "/" && index + 1 < text.length && text[index + 1] === "/") {
            return text.slice(0, index);
        }
    }
    return text;
}

/**
 * Splits a `#define` / `#undef` / `#ifdef` / `#ifndef` tail into the name and the remainder.
 *
 * The name is the first whitespace-delimited token, taken WHOLE and validated afterwards, so
 * `#define FOO(x) ...` fails as an invalid name instead of quietly defining `FOO` with the value
 * `(x)`. A `#define` value is everything after the name, trimmed, running to end of line.
 *
 * `nameOffset`, `nameEndOffset` and `valueOffset` are indices INTO `rest`. Nothing in this file
 * needs them -- it reports whole lines -- but a caller producing diagnostics has to underline the
 * name it just refused, and deriving that span a second time (`rest.indexOf(name)`) would put the
 * offset arithmetic in two places to drift apart. One split, one set of offsets.
 */
function splitNameAndValue(rest) {
    const length = rest.length;
    let index = 0;

    while (index < length && isWhitespaceChar(rest[index])) {
        index += 1;
    }
    const nameStart = index;
    while (index < length && !isWhitespaceChar(rest[index])) {
        index += 1;
    }

    const tail = rest.slice(index);
    const value = tail.trim();
    return {
        name: rest.slice(nameStart, index),
        nameOffset: nameStart,
        nameEndOffset: index,
        value,
        // `indexOf` on a trimmed needle counts the leading whitespace exactly, and gives the same
        // answer as measuring it: `trim` only ever removes from the ends.
        valueOffset: index + (value ? tail.indexOf(value) : 0)
    };
}

// -------------------------------------------------------------------------------------------------
// Integer literals
// -------------------------------------------------------------------------------------------------

/**
 * Parses a WHOLE string as an integer literal: decimal or `0x` / `0X` hexadecimal, optional sign.
 * Returns null for anything else, a trailing remainder included.
 *
 * Whole-string and not prefix, because this also decides whether a define's VALUE is a number or a
 * string: `1abc` has to come out a string rather than the number 1 with the rest quietly dropped.
 *
 * The base is spelled out instead of letting a general parser also accept C's octal -- a switch
 * written `#define MASK 0755` meaning 493 is a trap nobody asked for in a language with no octal.
 *
 * A literal that does not fit in 64 bits is REFUSED rather than wrapped, matching the C++: folding
 * it modulo 2^64 would make which branch compiles depend on arithmetic nobody wrote.
 */
function parsePreprocessorInteger(text) {
    if (typeof text !== "string") {
        return null;
    }

    let index = 0;
    const length = text.length;

    let negative = false;
    if (index < length && (text[index] === "+" || text[index] === "-")) {
        negative = text[index] === "-";
        index += 1;
    }

    let base = 10n;
    let hexadecimal = false;
    if (index + 1 < length && text[index] === "0" && (text[index + 1] === "x" || text[index + 1] === "X")) {
        base = 16n;
        hexadecimal = true;
        index += 2;
    }

    // `0x` on its own, an empty string, or a lone sign: no digits means no literal.
    if (index >= length) {
        return null;
    }

    // The magnitude is accumulated unsigned so the range check is exact for both signs: the most
    // negative int64 has a magnitude one larger than the most positive.
    const limit = negative ? -INT64_MIN : INT64_MAX;

    let magnitude = 0n;
    for (; index < length; index += 1) {
        const character = text[index];

        let digit;
        if (isAsciiDigit(character)) {
            digit = BigInt(character.charCodeAt(0) - 48);
        } else if (hexadecimal && character >= "a" && character <= "f") {
            digit = 10n + BigInt(character.charCodeAt(0) - 97);
        } else if (hexadecimal && character >= "A" && character <= "F") {
            digit = 10n + BigInt(character.charCodeAt(0) - 65);
        } else {
            // Also where a hex digit in a decimal literal lands, and where the run the tokenizer
            // handed over stops being a literal at all: `12abc` fails here.
            return null;
        }
        if (digit >= base) {
            return null;
        }

        if (magnitude > (limit - digit) / base) {
            return null;
        }
        magnitude = magnitude * base + digit;
    }

    return negative ? -magnitude : magnitude;
}

// -------------------------------------------------------------------------------------------------
// Values
//
// The two-type domain the grammar admits: a 64-bit signed integer (booleans are 0 and 1) and a
// string. Strings exist for one reason -- `DS_PLATFORM == "Windows"` -- so they take part in
// equality and nothing else. Every other operator refuses them rather than coercing, because the
// coercions C would apply turn a typo into a branch that silently always fires.
// -------------------------------------------------------------------------------------------------

function makeInteger(value) {
    return { isString: false, integer: BigInt.asIntN(64, value), string: "" };
}

function makeBoolean(value) {
    return makeInteger(value ? 1n : 0n);
}

function makeStringValue(value) {
    return { isString: true, integer: 0n, string: value };
}

// -------------------------------------------------------------------------------------------------
// Tokenizer
// -------------------------------------------------------------------------------------------------

const TOKEN_KIND = Object.freeze({
    End: "end",
    Identifier: "identifier",
    Integer: "integer",
    String: "string",
    Operator: "operator"
});

const MULTI_CHARACTER_OPERATORS = ["==", "!=", "<=", ">=", "&&", "||"];
const SINGLE_CHARACTER_OPERATORS = ["!", "<", ">", "+", "-", "*", "/", "%", "(", ")"];

/**
 * `startOffset` / `endOffset` are indices INTO THE CONDITION TEXT, and -1 when the error names no
 * span at all (a missing condition has nothing to point at). Added for the same reason
 * `classifyDirectiveLine` reports its three indices: this file answers in whole lines, but the
 * diagnostics provider that shares this evaluator has to underline the offending token, and the
 * tokenizer is the only pass that still knows where it was.
 */
function makeError(code, message, startOffset = -1, endOffset = -1) {
    return { code, message, startOffset, endOffset };
}

function describeToken(token) {
    return token.kind === TOKEN_KIND.End ? "the end of the condition" : `'${token.spelling}'`;
}

function tokenizeCondition(expression) {
    const tokens = [];
    let index = 0;
    const length = expression.length;

    while (index < length) {
        const character = expression[index];

        if (isWhitespaceChar(character)) {
            index += 1;
            continue;
        }

        if (isNameStartChar(character)) {
            const start = index;
            while (index < length && isNameBodyChar(expression[index])) {
                index += 1;
            }
            tokens.push({ kind: TOKEN_KIND.Identifier, spelling: expression.slice(start, index), startOffset: start, endOffset: index });
            continue;
        }

        if (isAsciiDigit(character)) {
            // The run swallows every character a literal could contain, hex digits included, so
            // `0xZZ` and `12abc` arrive whole and fail as one bad literal. Stopping at the first
            // non-digit would tokenize them as a number followed by a name and report "unexpected
            // token 'abc'", which points at the wrong half of the mistake.
            const start = index;
            while (index < length && isNameBodyChar(expression[index])) {
                index += 1;
            }
            const literal = expression.slice(start, index);
            const parsed = parsePreprocessorInteger(literal);
            if (parsed === null) {
                return {
                    ok: false,
                    error: makeError("DSH1034", `'${literal}' is not a valid integer literal (decimal, or 0x hexadecimal).`, start, index)
                };
            }
            tokens.push({ kind: TOKEN_KIND.Integer, spelling: literal, integer: parsed, startOffset: start, endOffset: index });
            continue;
        }

        if (character === "\"") {
            const start = index;
            index += 1;

            let unescaped = "";
            let terminated = false;
            while (index < length) {
                const current = expression[index];

                if (current === "\\" && index + 1 < length) {
                    // `\"` and `\\` are what the syntax promises; the rest follow the plugin's
                    // UnescapeDreamShaderStringLiteral so the two dialects of string literal a
                    // reader meets in one file do not disagree about what a backslash means.
                    const escaped = expression[index + 1];
                    if (escaped === "n") {
                        unescaped += "\n";
                    } else if (escaped === "r") {
                        unescaped += "\r";
                    } else if (escaped === "t") {
                        unescaped += "\t";
                    } else {
                        unescaped += escaped;
                    }
                    index += 2;
                    continue;
                }

                if (current === "\"") {
                    terminated = true;
                    index += 1;
                    break;
                }

                unescaped += current;
                index += 1;
            }

            if (!terminated) {
                return { ok: false, error: makeError("DSH1034", "unterminated string literal.", start, index) };
            }

            tokens.push({
                kind: TOKEN_KIND.String,
                spelling: expression.slice(start, index),
                stringValue: unescaped,
                startOffset: start,
                endOffset: index
            });
            continue;
        }

        const twoCharacters = expression.substr(index, 2);
        if (MULTI_CHARACTER_OPERATORS.includes(twoCharacters)) {
            // Two-character operators are tried first so `<=` never tokenizes as `<` followed by a
            // stray `=`, which would report the wrong thing about an ordinary comparison.
            tokens.push({ kind: TOKEN_KIND.Operator, spelling: twoCharacters, startOffset: index, endOffset: index + 2 });
            index += 2;
            continue;
        }

        if (SINGLE_CHARACTER_OPERATORS.includes(character)) {
            tokens.push({ kind: TOKEN_KIND.Operator, spelling: character, startOffset: index, endOffset: index + 1 });
            index += 1;
            continue;
        }

        // A lone `&` or `|` lands here, which is the point: bitwise operators are not in the
        // grammar, and accepting `A & B` as something else would be worse than refusing it.
        return { ok: false, error: makeError("DSH1034", `unexpected character '${character}'.`, index, index + 1) };
    }

    // The End sentinel's span is empty and sits past the last character, which is what lets a caller
    // recognize "the error is at the end of the condition" and underline the directive instead.
    tokens.push({ kind: TOKEN_KIND.End, spelling: "", startOffset: length, endOffset: length });
    return { ok: true, tokens };
}

// -------------------------------------------------------------------------------------------------
// Recursive-descent parser, evaluating as it goes
//
// Every level carries an `evaluate` flag rather than building a tree first, and that flag is how
// short-circuiting is expressed: the right operand of a `&&` whose left side is false is still
// PARSED -- so `#if 0 && (` is still a syntax error, as it is in C -- but nothing in it is read,
// divided or type-checked. Skipping the parse would let a dead operand rot; evaluating it anyway
// would read defines that provably cannot change the answer.
// -------------------------------------------------------------------------------------------------

class ConditionParser {
    constructor(tokens, readDefine) {
        this.tokens = tokens;
        this.index = 0;
        this.readDefine = readDefine;
        this.error = null;
    }

    peek() {
        return this.tokens[this.index];
    }

    isAtEnd() {
        return this.peek().kind === TOKEN_KIND.End;
    }

    advance() {
        // The End token is a wall, not a step: every level stops on it, so clamping here means no
        // path can walk off the array even when a production bails out mid-way.
        if (this.index + 1 < this.tokens.length) {
            this.index += 1;
        }
    }

    fail(code, message) {
        // Spanning the token the parse stopped ON, which is the token every message here names.
        const token = this.peek();
        this.error = makeError(code, message, token.startOffset, token.endOffset);
        return null;
    }

    matchOperator(spelling) {
        const token = this.peek();
        if (token.kind === TOKEN_KIND.Operator && token.spelling === spelling) {
            this.advance();
            return true;
        }
        return false;
    }

    /** Truthiness for the logical operators. A string has none, and saying so beats guessing. */
    requireTruth(value, operator) {
        if (value.isString) {
            this.fail("DSH1040", `'${operator}' needs a number, but one operand is the string "${value.string}".`);
            return null;
        }
        return value.integer !== 0n;
    }

    requireInteger(value, operator) {
        if (value.isString) {
            this.fail("DSH1040",
                `'${operator}' is only defined for numbers, but one operand is the string "${value.string}". `
                + "Strings compare only with '==' and '!='.");
            return null;
        }
        return value.integer;
    }

    parseExpression(evaluate) {
        return this.parseOr(evaluate);
    }

    parseOr(evaluate) {
        let left = this.parseAnd(evaluate);
        if (left === null) {
            return null;
        }

        while (this.matchOperator("||")) {
            let leftTruth = false;
            if (evaluate) {
                const truth = this.requireTruth(left, "||");
                if (truth === null) {
                    return null;
                }
                leftTruth = truth;
            }

            const right = this.parseAnd(evaluate && !leftTruth);
            if (right === null) {
                return null;
            }

            if (!evaluate) {
                left = makeBoolean(false);
                continue;
            }
            if (leftTruth) {
                left = makeBoolean(true);
                continue;
            }

            const rightTruth = this.requireTruth(right, "||");
            if (rightTruth === null) {
                return null;
            }
            left = makeBoolean(rightTruth);
        }

        return left;
    }

    parseAnd(evaluate) {
        let left = this.parseEquality(evaluate);
        if (left === null) {
            return null;
        }

        while (this.matchOperator("&&")) {
            let leftTruth = false;
            if (evaluate) {
                const truth = this.requireTruth(left, "&&");
                if (truth === null) {
                    return null;
                }
                leftTruth = truth;
            }

            const right = this.parseEquality(evaluate && leftTruth);
            if (right === null) {
                return null;
            }

            if (!evaluate) {
                left = makeBoolean(false);
                continue;
            }
            if (!leftTruth) {
                left = makeBoolean(false);
                continue;
            }

            const rightTruth = this.requireTruth(right, "&&");
            if (rightTruth === null) {
                return null;
            }
            left = makeBoolean(rightTruth);
        }

        return left;
    }

    parseEquality(evaluate) {
        let left = this.parseRelational(evaluate);
        if (left === null) {
            return null;
        }

        for (;;) {
            let isEquals = false;
            if (this.matchOperator("==")) {
                isEquals = true;
            } else if (!this.matchOperator("!=")) {
                break;
            }
            const spelling = isEquals ? "==" : "!=";

            const right = this.parseRelational(evaluate);
            if (right === null) {
                return null;
            }

            if (!evaluate) {
                left = makeBoolean(false);
                continue;
            }

            if (left.isString !== right.isString) {
                // Not silently false. Comparing a string against a number is a mistake in the source
                // -- almost always a missing pair of quotes -- and answering "not equal" would let
                // the whole conditional read as deliberate.
                return this.fail("DSH1040", `'${spelling}' cannot compare a string with a number.`);
            }

            // Case-SENSITIVE, explicitly: `DS_PLATFORM == "windows"` is false on Windows.
            const equal = left.isString ? left.string === right.string : left.integer === right.integer;
            left = makeBoolean(isEquals ? equal : !equal);
        }

        return left;
    }

    parseRelational(evaluate) {
        let left = this.parseAdditive(evaluate);
        if (left === null) {
            return null;
        }

        for (;;) {
            let spelling = null;
            if (this.matchOperator("<=")) {
                spelling = "<=";
            } else if (this.matchOperator(">=")) {
                spelling = ">=";
            } else if (this.matchOperator("<")) {
                spelling = "<";
            } else if (this.matchOperator(">")) {
                spelling = ">";
            } else {
                break;
            }

            const right = this.parseAdditive(evaluate);
            if (right === null) {
                return null;
            }

            if (!evaluate) {
                left = makeBoolean(false);
                continue;
            }

            const leftInteger = this.requireInteger(left, spelling);
            if (leftInteger === null) {
                return null;
            }
            const rightInteger = this.requireInteger(right, spelling);
            if (rightInteger === null) {
                return null;
            }

            let result;
            if (spelling === "<=") {
                result = leftInteger <= rightInteger;
            } else if (spelling === ">=") {
                result = leftInteger >= rightInteger;
            } else if (spelling === "<") {
                result = leftInteger < rightInteger;
            } else {
                result = leftInteger > rightInteger;
            }
            left = makeBoolean(result);
        }

        return left;
    }

    parseAdditive(evaluate) {
        let left = this.parseMultiplicative(evaluate);
        if (left === null) {
            return null;
        }

        for (;;) {
            let isAdd = false;
            if (this.matchOperator("+")) {
                isAdd = true;
            } else if (!this.matchOperator("-")) {
                break;
            }
            const spelling = isAdd ? "+" : "-";

            const right = this.parseMultiplicative(evaluate);
            if (right === null) {
                return null;
            }

            if (!evaluate) {
                left = makeInteger(0n);
                continue;
            }

            const leftInteger = this.requireInteger(left, spelling);
            if (leftInteger === null) {
                return null;
            }
            const rightInteger = this.requireInteger(right, spelling);
            if (rightInteger === null) {
                return null;
            }

            // makeInteger wraps through BigInt.asIntN(64), matching the C++, which does its
            // arithmetic through uint64 so signed overflow is never undefined behaviour.
            left = makeInteger(isAdd ? leftInteger + rightInteger : leftInteger - rightInteger);
        }

        return left;
    }

    parseMultiplicative(evaluate) {
        let left = this.parseUnary(evaluate);
        if (left === null) {
            return null;
        }

        for (;;) {
            let spelling = null;
            if (this.matchOperator("*")) {
                spelling = "*";
            } else if (this.matchOperator("/")) {
                spelling = "/";
            } else if (this.matchOperator("%")) {
                spelling = "%";
            } else {
                break;
            }

            const right = this.parseUnary(evaluate);
            if (right === null) {
                return null;
            }

            if (!evaluate) {
                left = makeInteger(0n);
                continue;
            }

            const leftInteger = this.requireInteger(left, spelling);
            if (leftInteger === null) {
                return null;
            }
            const rightInteger = this.requireInteger(right, spelling);
            if (rightInteger === null) {
                return null;
            }

            if (spelling === "*") {
                left = makeInteger(leftInteger * rightInteger);
                continue;
            }

            if (rightInteger === 0n) {
                return this.fail("DSH1041", `the right operand of '${spelling}' in this condition is zero.`);
            }

            // BigInt `/` truncates toward zero and BigInt `%` takes the dividend's sign, which is
            // exactly C's and HLSL's rule and what the plugin does: -7 / 2 is -3, -7 % 2 is -1. (A
            // JS Number `/` would have produced -3.5 here, so this must stay BigInt.)
            //
            // MIN_int64 / -1 has no representable answer; asIntN folds it back to MIN_int64, which
            // is the same value the C++ special-cases to rather than faulting on x86.
            left = makeInteger(spelling === "/" ? leftInteger / rightInteger : leftInteger % rightInteger);
        }

        return left;
    }

    parseUnary(evaluate) {
        // Recursing rather than taking at most one prefix: the grammar writes a single optional
        // sign, but `!!FOO` and `- -1` cost nothing to accept and refusing them would be a rule a
        // reader has to discover by hitting it.
        if (this.matchOperator("!")) {
            const operand = this.parseUnary(evaluate);
            if (operand === null) {
                return null;
            }
            if (!evaluate) {
                return makeBoolean(false);
            }
            const truth = this.requireTruth(operand, "!");
            if (truth === null) {
                return null;
            }
            return makeBoolean(!truth);
        }

        let negate = false;
        if (this.matchOperator("-")) {
            negate = true;
        } else if (!this.matchOperator("+")) {
            return this.parsePrimary(evaluate);
        }
        const spelling = negate ? "-" : "+";

        const operand = this.parseUnary(evaluate);
        if (operand === null) {
            return null;
        }
        if (!evaluate) {
            return makeInteger(0n);
        }

        const integer = this.requireInteger(operand, spelling);
        if (integer === null) {
            return null;
        }
        return makeInteger(negate ? -integer : integer);
    }

    parsePrimary(evaluate) {
        if (this.matchOperator("(")) {
            const inner = this.parseOr(evaluate);
            if (inner === null) {
                return null;
            }
            if (!this.matchOperator(")")) {
                return this.fail("DSH1034", `expected ')' but found ${describeToken(this.peek())}.`);
            }
            return inner;
        }

        const token = this.peek();

        if (token.kind === TOKEN_KIND.Integer) {
            this.advance();
            return makeInteger(token.integer);
        }

        if (token.kind === TOKEN_KIND.String) {
            this.advance();
            return makeStringValue(token.stringValue);
        }

        if (token.kind === TOKEN_KIND.Identifier) {
            // `defined` is a keyword only here, in operand position, which is also the only place C
            // treats it as one.
            if (token.spelling === "defined") {
                this.advance();
                return this.parseDefined(evaluate);
            }
            const name = token.spelling;
            this.advance();
            return this.resolveIdentifier(name, evaluate);
        }

        return this.fail("DSH1034", `unexpected ${describeToken(token)}.`);
    }

    parseDefined(evaluate) {
        const parenthesized = this.matchOperator("(");

        const nameToken = this.peek();
        if (nameToken.kind !== TOKEN_KIND.Identifier) {
            return this.fail("DSH1034", `'defined' needs a define name, but found ${describeToken(nameToken)}.`);
        }
        const name = nameToken.spelling;
        this.advance();

        if (parenthesized && !this.matchOperator(")")) {
            return this.fail("DSH1034",
                `expected ')' to close 'defined(${name})' but found ${describeToken(this.peek())}.`);
        }

        if (!evaluate) {
            return makeInteger(0n);
        }

        // The value is deliberately discarded: `defined` asks whether a name exists, and a define
        // spelled `0` is still defined. The read is what matters -- it is what records the name.
        return makeBoolean(Boolean(this.readDefine(name)));
    }

    /**
     * The four value rules, tried IN THIS ORDER. The empty-value row has to come before the integer
     * parse: an empty string does not parse as an integer, so testing that first would make every
     * bare `#define FOO` marker a string -- and a string in a `#if` is DSH1040, which would close
     * off the most common spelling of all.
     */
    resolveIdentifier(name, evaluate) {
        if (!evaluate) {
            return makeInteger(0n);
        }

        const entry = this.readDefine(name);
        if (!entry) {
            // C's rule: a name with no definition is the number 0, so `#if FOO` is false rather than
            // an error. The read is still recorded, undefined and all -- that sentinel is what makes
            // ADDING the define later change the build key.
            return makeInteger(0n);
        }

        const raw = entry.value;
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
            // A bare `#define FOO` is a marker, not the empty string, so `#if FOO` means what
            // everyone expects. `defined(FOO)` was always available for the other question.
            return makeInteger(1n);
        }

        const parsed = parsePreprocessorInteger(trimmed);
        if (parsed !== null) {
            // Trimmed and not raw: a settings row typed as `1 ` is a number with a stray space, and
            // reading it as the string "1 " would take the other branch without a word.
            return makeInteger(parsed);
        }

        // Not trimmed here, though: once it is a string it is data, and its edges are the author's.
        return makeStringValue(raw);
    }
}

/**
 * Evaluates one `#if` / `#elif` condition to a verdict.
 *
 * @param {string} expression Condition text, with any trailing `//` comment already removed.
 * @param {(name: string) => ({ value: string } | null)} readDefine Name lookup; null when undefined.
 * @param {object} [options]
 * @param {boolean} [options.evaluate=true] False parses for SHAPE only -- see checkConditionSyntax.
 * @returns {{ ok: true, value: boolean } | { ok: false, error: { code: string, message: string,
 *          startOffset: number, endOffset: number } }}
 */
function evaluateCondition(expression, readDefine, options = {}) {
    const lookup = typeof readDefine === "function" ? readDefine : () => null;
    const evaluate = options.evaluate !== false;

    const tokenized = tokenizeCondition(expression);
    if (!tokenized.ok) {
        return { ok: false, error: tokenized.error };
    }

    // One token is the End sentinel on its own: `#if` with nothing after it, or with nothing but the
    // trailing comment the caller has already stripped.
    if (tokenized.tokens.length <= 1) {
        return { ok: false, error: makeError("DSH1036", "this directive requires a condition expression.") };
    }

    const parser = new ConditionParser(tokenized.tokens, lookup);
    const value = parser.parseExpression(evaluate);
    if (value === null) {
        return { ok: false, error: parser.error };
    }

    // Parsing and leftover-checking are two steps raising two codes. Everything the parse refused is
    // DSH1034 -- the expression is incomplete or malformed: `(1`, `1 &&`, `1 &&)`. Reaching here is
    // the opposite: a whole expression was consumed and something still follows it -- `1 2`, `1)`.
    // That is a finished directive with extra text, the same mistake with the same fix as
    // `#ifdef A B`, so it carries that code rather than one naming the component that noticed.
    if (!parser.isAtEnd()) {
        const surplus = parser.peek();
        return {
            ok: false,
            error: makeError("DSH1042",
                `this directive is already complete before '${surplus.spelling}'. `
                + "Nothing may follow a directive but a '//' comment.",
                surplus.startOffset, surplus.endOffset)
        };
    }

    if (value.isString) {
        return {
            ok: false,
            error: makeError("DSH1040",
                `a condition must be a number, but this one is the string "${value.string}". `
                + "Compare it with '==' instead.")
        };
    }

    return { ok: true, value: value.integer !== 0n };
}

/**
 * The same tokenizer and the same grammar, PARSED BUT NOT EVALUATED.
 *
 * For the one caller that has no define table: the diagnostics provider, which runs in the editor
 * where the five tiers of defines (CVar, C++ registrations, the provider delegate, the project
 * settings and the file's own `#define`s) are simply not reachable. Shape is knowable without them
 * and value is not, so this answers the shape question and refuses to guess at the other.
 *
 * Concretely, `evaluate: false` makes every type and value rule inside the parser unreachable --
 * `requireTruth`, `requireInteger`, the string/number equality check and the divide-by-zero check
 * are all behind `if (evaluate)` -- so DSH1041 cannot arise at all, and DSH1040 only from the final
 * whole-condition string test, for a condition that is nothing but a string literal. Everything
 * else it can return (DSH1034, DSH1036, DSH1042) is decided by the token stream alone and is the
 * same verdict the plugin reaches with any table whatsoever.
 *
 * @param {string} expression Condition text, with any trailing `//` comment already removed.
 * @returns {{ ok: true } | { ok: false, error: { code: string, message: string,
 *          startOffset: number, endOffset: number } }}
 */
function checkConditionSyntax(expression) {
    const result = evaluateCondition(expression, () => null, { evaluate: false });
    return result.ok ? { ok: true } : result;
}

// -------------------------------------------------------------------------------------------------
// Whole-file analysis
// -------------------------------------------------------------------------------------------------

function normalizeDefineTable(defines) {
    const table = new Map();
    if (!defines) {
        return table;
    }
    if (defines instanceof Map) {
        for (const [name, value] of defines) {
            table.set(String(name), value === undefined || value === null ? "" : String(value));
        }
        return table;
    }
    if (Array.isArray(defines)) {
        for (const entry of defines) {
            const name = String(entry?.name || "");
            if (name) {
                table.set(name, entry?.value === undefined || entry?.value === null ? "" : String(entry.value));
            }
        }
        return table;
    }
    for (const name of Object.keys(defines)) {
        const value = defines[name];
        table.set(name, value === undefined || value === null ? "" : String(value));
    }
    return table;
}

function failure(code, line, message) {
    return {
        ok: false,
        error: { code, line, message },
        regions: [],
        directiveLines: [],
        hadDirectives: false,
        touchedDefines: new Map()
    };
}

/**
 * Runs the directive scan over one file's text and reports which lines this define table cuts.
 *
 * The contract is deliberately all-or-nothing: on ANY diagnostic the plugin would raise, this
 * returns `ok: false` with no regions. A file the compiler refuses has no settled branch structure,
 * and a dimmer that showed one would be inventing it -- which is the one failure a dimmer must not
 * have. "Rather no grey than the wrong grey."
 *
 * @param {string} text                     The file's whole text.
 * @param {object} [options]
 * @param {Map|object|Array} [options.defines] The injected define table: Map, plain object, or the
 *                                          manifest's `[{ name, value }]` array.
 * @returns {{
 *   ok: boolean,
 *   error: { code: string, line: number, message: string } | null,
 *   regions: Array<{ startLine: number, endLine: number }>,  // 1-based, inclusive, cut CONTENT only
 *   directiveLines: number[],                                // 1-based lines holding a directive
 *   hadDirectives: boolean,
 *   touchedDefines: Map<string, string>
 * }}
 */
function analyzeSource(text, options = {}) {
    const source = typeof text === "string" ? text : "";
    const lines = splitSourceLines(source);

    // `#define` is FILE-LOCAL, and this copy is the whole of that implementation: definitions land
    // on it and it dies with this call, so a header cannot leak a value into the file importing it.
    const defines = normalizeDefineTable(options.defines);
    const locallyOverridden = new Set();
    const touchedDefines = new Map();

    const readDefine = (name) => {
        const has = defines.has(name);
        // A read is recorded only when the INJECTED table is what answered it: a name this file has
        // defined or undefined itself is answered by the file's own text, which the build key
        // already hashes. An UNDEFINED name still has to be recorded, sentinel and all, or adding
        // the define later would change no hash and the asset would keep the other branch forever.
        if (!locallyOverridden.has(name)) {
            touchedDefines.set(name, has ? defines.get(name) : UNDEFINED_DEFINE_SENTINEL);
        }
        return has ? { value: defines.get(name) } : null;
    };

    const stack = [];
    const opaqueRegion = createOpaqueRegionTracker();
    const isEmitting = () => stack.length === 0 || stack[stack.length - 1].currentActive;

    const inactiveLines = [];
    const directiveLines = [];
    let hadDirectives = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex].content;
        const lineNumber = lineIndex + 1;

        // Asked before the line is scanned, so a `Function` declaration line is still ordinary source
        // and the body's closing `}` line is still the last opaque one.
        const opaque = opaqueRegion.isOpaque();
        const { kind, keyword, rest } = opaque
            ? { kind: DIRECTIVE_KIND.None, keyword: "", rest: "" }
            : classifyDirectiveLine(line);

        const emitting = isEmitting();

        // A line is dimmed when it is cut AND is not itself one of the eight directives. A directive
        // line is control flow -- it is what tells the reader why the lines under it are grey -- so
        // greying it too would hide the explanation, and that holds for a nested chain inside a cut
        // branch as much as for the outer one. Everything else that is cut is dimmed, `#Region` and
        // an unknown `#` spelling included: the plugin blanks those lines too, and inside a cut
        // branch it never even complains about the unknown one.
        if (!emitting && !isRealDirective(kind)) {
            inactiveLines.push(lineNumber);
        }

        // Advanced for every line, opaque or not, emitted or cut. A Function body inside a branch
        // this build cuts still has to be recognized as a body, or its HLSL `#if` lines would be
        // paired against the file's own conditional stack and corrupt it.
        opaqueRegion.scanLine(line);

        if (isRealDirective(kind)) {
            // Taken or not: a conditional in a branch this compile cut is still one in the file.
            hadDirectives = true;
            directiveLines.push(lineNumber);
        }

        switch (kind) {
            case DIRECTIVE_KIND.None:
                break;

            case DIRECTIVE_KIND.Unknown:
                // Not reported inside a cut branch, exactly as in C: a branch that was cut is not
                // compiled, and checking it would raise errors about code this build does not
                // contain and make the message depend on which switches happened to be set.
                if (emitting) {
                    return failure("DSH1035", lineNumber, `unknown preprocessor directive '#${keyword}'.`);
                }
                break;

            case DIRECTIVE_KIND.If:
            case DIRECTIVE_KIND.IfDef:
            case DIRECTIVE_KIND.IfNDef: {
                if (stack.length >= MAX_CONDITIONAL_DEPTH) {
                    return failure("DSH1037", lineNumber,
                        `'#${keyword}' nesting is deeper than the limit of ${MAX_CONDITIONAL_DEPTH}.`);
                }

                const frame = { parentActive: emitting, branchTaken: false, currentActive: false, seenElse: false, elseLine: 0, directiveLine: lineNumber };

                if (emitting) {
                    let condition = false;

                    if (kind === DIRECTIVE_KIND.If) {
                        const result = evaluateCondition(stripTrailingLineComment(rest), readDefine);
                        if (!result.ok) {
                            return failure(result.error.code, lineNumber, result.error.message);
                        }
                        condition = result.value;
                    } else {
                        // `#ifdef NAME` is `#if defined(NAME)` and `#ifndef NAME` is its negation.
                        const split = splitNameAndValue(stripTrailingLineComment(rest));

                        // Nothing at all is a MISSING operand, the same failure as a bare `#if`;
                        // something unusable is an invalid NAME. Different mistakes, different codes.
                        if (!split.name) {
                            return failure("DSH1036", lineNumber, `'#${keyword}' requires a define name.`);
                        }
                        if (!isValidDefineName(split.name)) {
                            return failure("DSH1038", lineNumber,
                                `'#${keyword}' needs a name made of letters, digits and underscores and not starting with a digit; got '${split.name}'.`);
                        }
                        // `#ifdef A B` desugars to `#if defined(A) B`, so it must report what that
                        // spelling reports -- down to the code.
                        if (split.value) {
                            return failure("DSH1042", lineNumber,
                                `'#${keyword}' is already complete before '${splitNameAndValue(split.value).name}'.`);
                        }

                        const defined = Boolean(readDefine(split.name));
                        condition = kind === DIRECTIVE_KIND.IfDef ? defined : !defined;
                    }

                    frame.branchTaken = condition;
                    frame.currentActive = condition;
                } else {
                    // Inside a branch already cut, the condition is not evaluated at all: no define
                    // is read, and a syntax error in it is not reported. Only the nesting is tracked,
                    // which is all that is needed to pair the `#endif`. Marking the chain as already
                    // taken is how every `#elif` and `#else` under it stays dead.
                    frame.branchTaken = true;
                    frame.currentActive = false;
                }

                stack.push(frame);
                break;
            }

            case DIRECTIVE_KIND.Elif:
            case DIRECTIVE_KIND.Else: {
                if (stack.length === 0) {
                    return failure("DSH1032", lineNumber, `'#${keyword}' without a matching '#if'.`);
                }
                const frame = stack[stack.length - 1];

                // Reported even inside a cut branch, unlike everything else here. The SHAPE of the
                // chain is not part of a branch's contents: get it wrong and the `#endif` pairing
                // goes wrong with it, so every line after it is misjudged in a file that still
                // compiles. A malformed chain is never survivable, whichever switches are set.
                if (frame.seenElse) {
                    return failure("DSH1033", lineNumber,
                        `'#${keyword}' after the '#else' on line ${frame.elseLine}, which already closed this chain.`);
                }

                if (kind === DIRECTIVE_KIND.Else) {
                    // `#else` takes no operand at all, so anything left is trailing -- checked
                    // whether or not this branch emits, because `#else` belongs to the CHAIN.
                    const remainder = stripTrailingLineComment(rest).trim();
                    if (remainder) {
                        return failure("DSH1042", lineNumber,
                            `'#else' is already complete before '${splitNameAndValue(remainder).name}'.`);
                    }
                    frame.seenElse = true;
                    frame.elseLine = lineNumber;
                    frame.currentActive = frame.parentActive && !frame.branchTaken;
                    frame.branchTaken = true;
                    break;
                }

                if (frame.parentActive && !frame.branchTaken) {
                    const result = evaluateCondition(stripTrailingLineComment(rest), readDefine);
                    if (!result.ok) {
                        return failure(result.error.code, lineNumber, result.error.message);
                    }
                    frame.branchTaken = result.value;
                    frame.currentActive = result.value;
                } else {
                    // An earlier branch already won, or the whole chain is inside a cut region.
                    // Either way this condition cannot change the output, so it is not evaluated.
                    frame.currentActive = false;
                }
                break;
            }

            case DIRECTIVE_KIND.Endif: {
                if (stack.length === 0) {
                    return failure("DSH1031", lineNumber, "'#endif' without a matching '#if'.");
                }
                // `#endif MOONTOON_LEGACY` is the C habit of labelling a long chain, and it is not
                // spelled that way here -- `// MOONTOON_LEGACY` is. Checked unconditionally.
                const remainder = stripTrailingLineComment(rest).trim();
                if (remainder) {
                    return failure("DSH1042", lineNumber,
                        `'#endif' is already complete before '${splitNameAndValue(remainder).name}'.`);
                }
                stack.pop();
                break;
            }

            case DIRECTIVE_KIND.Define:
            case DIRECTIVE_KIND.Undef: {
                // Only in an active region: a `#define` in a branch this build cut must not change
                // what the lines after it see, or a cut branch would still be steering the file.
                if (!emitting) {
                    break;
                }

                const split = splitNameAndValue(stripTrailingLineComment(rest));
                if (!isValidDefineName(split.name)) {
                    return failure("DSH1038", lineNumber,
                        `'#${keyword}' needs a name made of letters, digits and underscores and not starting with a digit; got '${split.name}'.`);
                }
                if (isReservedDefineName(split.name)) {
                    return failure("DSH1039", lineNumber,
                        `'${split.name}' is a read-only built-in constant, so '#${keyword}' cannot change it. The 'DS_' prefix is reserved by DreamShader.`);
                }
                // `#undef` takes a name and nothing else. `#define` is the exception in this pair --
                // its value runs to the end of the line, so there is no such thing as a trailing
                // token after one.
                if (kind === DIRECTIVE_KIND.Undef && split.value) {
                    return failure("DSH1042", lineNumber,
                        `'#undef' is already complete before '${splitNameAndValue(split.value).name}'.`);
                }

                // Marked before the write, and marked for `#undef` too: from here on, what this name
                // reads is decided by this file's text, so the touched set stops recording it.
                locallyOverridden.add(split.name);

                if (kind === DIRECTIVE_KIND.Define) {
                    defines.set(split.name, split.value);
                } else {
                    // Remove, not "restore what the table had": there is one flat table, so an
                    // `#undef` of an injected name leaves it undefined for the rest of the file.
                    defines.delete(split.name);
                }
                break;
            }

            default:
                break;
        }
    }

    if (stack.length > 0) {
        return failure("DSH1030", stack[stack.length - 1].directiveLine,
            `this '#if' is never closed; the file ends with ${stack.length} conditional block(s) still open.`);
    }

    return {
        ok: true,
        error: null,
        regions: coalesceLines(inactiveLines),
        directiveLines,
        hadDirectives,
        touchedDefines
    };
}

/** Runs of consecutive line numbers become one inclusive range, so a cut block is one decoration. */
function coalesceLines(sortedLineNumbers) {
    const regions = [];
    for (const lineNumber of sortedLineNumbers) {
        const last = regions[regions.length - 1];
        if (last && lineNumber === last.endLine + 1) {
            last.endLine = lineNumber;
            continue;
        }
        regions.push({ startLine: lineNumber, endLine: lineNumber });
    }
    return regions;
}

/**
 * The dimmer's entry point: the inactive line ranges of one file, or none.
 *
 * Returns an empty array for a file the plugin would refuse, and for one with no directives at all,
 * so a caller can hand the result straight to `setDecorations` without a special case.
 */
function computeInactiveRegions(text, options = {}) {
    const analysis = analyzeSource(text, options);
    return analysis.ok ? analysis.regions : [];
}

module.exports = {
    DIRECTIVE_KEYWORDS,
    DIRECTIVE_KIND,
    GRAPH_DIRECTIVE_KEYWORDS,
    MAX_CONDITIONAL_DEPTH,
    RESERVED_DEFINE_PREFIX,
    UNDEFINED_DEFINE_SENTINEL,
    analyzeSource,
    checkConditionSyntax,
    classifyDirectiveLine,
    computeInactiveRegions,
    createOpaqueRegionTracker,
    evaluateCondition,
    isRealDirective,
    isReservedDefineName,
    isValidDefineName,
    parsePreprocessorInteger,
    splitNameAndValue,
    splitSourceLines,
    stripTrailingLineComment
};
