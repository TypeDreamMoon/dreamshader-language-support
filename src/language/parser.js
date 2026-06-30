"use strict";

const { scan } = require("./scanner");
const {
    normalizeSymbolKey,
    isValidIdentifier,
    splitTopLevel,
    splitTopLevelAssignment,
    stripCommentsPreserveLayout
} = require("./utils");
const { parseCallExpressionText } = require("./calls");

const TOP_LEVEL_BLOCKS = new Set([
    "Shader",
    "ShaderFunction",
    "ShaderLayer",
    "ShaderLayerBlend",
    "VirtualFunction",
    "Function",
    "GraphFunction",
    "Namespace"
]);

const TEMPLATE_BLOCKS = new Set(["Shader", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend"]);

const SECTION_NAMES = new Set(["Properties", "Inputs", "Outputs", "Results", "Settings", "Options", "Graph", "Layout"]);
const SECTION_NAME_ALIASES = new Map([
    ["Results", "Outputs"]
]);

function parseDocument(text) {
    const tokens = scan(text);
    const parser = new Parser(text, tokens);
    return parser.parse();
}

class Parser {
    constructor(text, tokens) {
        this.text = text;
        this.tokens = tokens;
        this.index = 0;
        this.blocks = [];
        this.imports = [];
        this.errors = [];
    }

    parse() {
        while (!this.isAtEnd()) {
            const token = this.peek();
            if (this.isTrivia(token)) {
                this.index += 1;
                continue;
            }

            if (token.type === "identifier" && token.value === "import") {
                this.imports.push(this.parseImport());
                continue;
            }

            if (token.type === "identifier" && token.value === "Template") {
                const block = this.parseTemplateBlock();
                if (block) {
                    this.blocks.push(block);
                    continue;
                }
            }

            if (token.type === "identifier" && TOP_LEVEL_BLOCKS.has(token.value)) {
                const block = token.value === "Function" || token.value === "GraphFunction"
                    ? this.parseFunctionBlock()
                    : this.parseNamedBlock();
                if (block) {
                    this.blocks.push(block);
                    continue;
                }
            }

            this.index += 1;
        }

        return {
            text: this.text,
            tokens: this.tokens,
            blocks: this.blocks,
            imports: this.imports,
            errors: this.errors
        };
    }

    parseImport() {
        const start = this.advance();
        const pathToken = this.findNext((token) => token.type === "string", start.end + 512);
        const lineEndOffset = findLineEnd(this.text, pathToken ? pathToken.end : start.end);
        const semicolon = pathToken ? this.findNext((token) => token.value === ";", lineEndOffset) : null;
        if (pathToken) {
            this.index = semicolon ? this.tokens.indexOf(semicolon) + 1 : this.tokens.indexOf(pathToken) + 1;
        }
        return {
            kind: "import",
            startOffset: start.start,
            endOffset: semicolon ? semicolon.end : pathToken ? pathToken.end : start.end,
            path: pathToken ? trimQuotes(pathToken.value) : "",
            pathOffset: pathToken ? pathToken.start + 1 : start.end
        };
    }

    parseTemplateBlock() {
        const templateToken = this.advance();
        const kindToken = this.skipTriviaAndPeek();
        if (!kindToken || kindToken.type !== "identifier" || !TEMPLATE_BLOCKS.has(kindToken.value)) {
            return {
                kind: "Template",
                name: "Template",
                localName: "Template",
                template: true,
                startOffset: templateToken.start,
                kindOffset: templateToken.start,
                nameOffset: templateToken.start,
                nameRangeLength: templateToken.value.length,
                attributes: [],
                sections: [],
                bodyOpenOffset: -1,
                bodyCloseOffset: -1,
                endOffset: templateToken.end
            };
        }

        const block = this.parseNamedBlock();
        if (!block) {
            return null;
        }

        return {
            ...block,
            template: true,
            templateOffset: templateToken.start,
            templateEndOffset: templateToken.end,
            startOffset: templateToken.start,
            kindOffset: block.startOffset
        };
    }

    parseNamedBlock() {
        const kindToken = this.advance();
        const block = {
            kind: kindToken.value,
            name: kindToken.value,
            localName: kindToken.value,
            startOffset: kindToken.start,
            kindOffset: kindToken.start,
            nameOffset: kindToken.start,
            nameRangeLength: kindToken.value.length,
            attributes: [],
            sections: [],
            bodyOpenOffset: -1,
            bodyCloseOffset: -1,
            endOffset: kindToken.end
        };

        const openParen = this.skipTriviaAndPeek();
        if (openParen && openParen.value === "(") {
            const closeParenIndex = this.findMatchingTokenIndex(this.index, "(", ")");
            block.attributeOpenOffset = openParen.start;
            block.attributeCloseOffset = closeParenIndex >= 0 ? this.tokens[closeParenIndex].start : -1;
            const attributeEnd = closeParenIndex >= 0 ? this.tokens[closeParenIndex].end : openParen.end;
            const attributeText = this.text.slice(openParen.end, closeParenIndex >= 0 ? this.tokens[closeParenIndex].start : attributeEnd);
            block.attributes = parseAssignments(attributeText, openParen.end);
            const nameAttr = block.attributes.find((entry) => normalizeSymbolKey(entry.name) === "name");
            if (nameAttr) {
                block.name = trimQuotes(nameAttr.value);
                block.localName = block.name.split(/[\\/]/).pop() || block.name;
                block.nameOffset = nameAttr.valueOffset + (nameAttr.value.trim().startsWith("\"") ? 1 : 0);
                block.nameRangeLength = block.name.length;
            }
            this.index = closeParenIndex >= 0 ? closeParenIndex + 1 : this.index + 1;
        }

        const openBrace = this.skipTriviaAndPeek();
        if (!openBrace || openBrace.value !== "{") {
            return block;
        }

        const closeBraceIndex = this.findMatchingTokenIndex(this.index, "{", "}");
        block.bodyOpenOffset = openBrace.start;
        block.bodyCloseOffset = closeBraceIndex >= 0 ? this.tokens[closeBraceIndex].start : this.text.length;
        block.endOffset = closeBraceIndex >= 0 ? this.tokens[closeBraceIndex].end : this.text.length;
        if (block.kind === "Namespace") {
            block.children = parseDocument(this.text.slice(openBrace.end, block.bodyCloseOffset)).blocks
                .map((child) => offsetBlock(child, openBrace.end, block.name));
        } else {
            block.sections = parseSections(this.text, openBrace.end, block.bodyCloseOffset);
        }
        this.index = closeBraceIndex >= 0 ? closeBraceIndex + 1 : this.tokens.length - 1;
        return block;
    }

    parseFunctionBlock() {
        const kindToken = this.advance();
        const block = {
            kind: kindToken.value,
            name: "",
            localName: "",
            startOffset: kindToken.start,
            kindOffset: kindToken.start,
            nameOffset: kindToken.start,
            nameRangeLength: 0,
            params: [],
            bodyOpenOffset: -1,
            bodyCloseOffset: -1,
            endOffset: kindToken.end
        };

        if (block.kind === "Function") {
            const maybeModifier = this.skipTriviaAndPeek();
            if (maybeModifier && maybeModifier.type === "identifier" && ["SelfContained", "Inline"].includes(maybeModifier.value)) {
                block.modifier = maybeModifier.value;
                this.index += 1;
            }
        }

        const firstToken = this.skipTriviaAndPeek();
        if (firstToken && firstToken.type === "identifier") {
            this.index += 1;
            const secondToken = this.skipTriviaAndPeek();
            if (secondToken && secondToken.type === "identifier") {
                // `Function <returnType> <name>(...)` — two identifiers before '(' means the
                // first is a single-output return type and the second is the function name.
                block.returnType = firstToken.value;
                block.returnTypeOffset = firstToken.start;
                block.name = secondToken.value;
                block.localName = secondToken.value;
                block.nameOffset = secondToken.start;
                block.nameRangeLength = secondToken.value.length;
                this.index += 1;
            } else {
                block.name = firstToken.value;
                block.localName = firstToken.value;
                block.nameOffset = firstToken.start;
                block.nameRangeLength = firstToken.value.length;
            }
        }

        const openParen = this.skipTriviaAndPeek();
        if (openParen && openParen.value === "(") {
            const closeParenIndex = this.findMatchingTokenIndex(this.index, "(", ")");
            block.paramOpenOffset = openParen.start;
            block.paramCloseOffset = closeParenIndex >= 0 ? this.tokens[closeParenIndex].start : -1;
            block.params = parseFunctionParams(
                this.text.slice(openParen.end, closeParenIndex >= 0 ? this.tokens[closeParenIndex].start : openParen.end),
                openParen.end);
            this.index = closeParenIndex >= 0 ? closeParenIndex + 1 : this.index + 1;
        }

        const openBrace = this.skipTriviaAndPeek();
        if (openBrace && openBrace.value === "{") {
            const closeBraceIndex = this.findMatchingTokenIndex(this.index, "{", "}");
            block.bodyOpenOffset = openBrace.start;
            block.bodyCloseOffset = closeBraceIndex >= 0 ? this.tokens[closeBraceIndex].start : this.text.length;
            block.bodyText = this.text.slice(openBrace.end, block.bodyCloseOffset);
            block.bodyOffset = openBrace.end;
            block.endOffset = closeBraceIndex >= 0 ? this.tokens[closeBraceIndex].end : this.text.length;
            this.index = closeBraceIndex >= 0 ? closeBraceIndex + 1 : this.tokens.length - 1;
        }

        return block;
    }

    findMatchingTokenIndex(openIndex, openValue, closeValue) {
        let depth = 0;
        for (let index = openIndex; index < this.tokens.length; index += 1) {
            const token = this.tokens[index];
            if (token.type === "comment" || token.type === "whitespace" || token.type === "string") {
                continue;
            }
            if (token.value === openValue) {
                depth += 1;
            } else if (token.value === closeValue) {
                depth -= 1;
                if (depth === 0) {
                    return index;
                }
            }
        }
        return -1;
    }

    findNext(predicate, maxEndOffset = Infinity) {
        for (let index = this.index; index < this.tokens.length; index += 1) {
            const token = this.tokens[index];
            if (token.start > maxEndOffset) {
                return null;
            }
            if (predicate(token)) {
                return token;
            }
        }
        return null;
    }

    skipTriviaAndPeek() {
        while (!this.isAtEnd() && this.isTrivia(this.peek())) {
            this.index += 1;
        }
        return this.peek();
    }

    isTrivia(token) {
        return token && (token.type === "whitespace" || token.type === "comment");
    }

    advance() {
        const token = this.peek();
        this.index += 1;
        return token;
    }

    peek() {
        return this.tokens[this.index];
    }

    isAtEnd() {
        return this.peek().type === "eof";
    }
}

function parseSections(text, startOffset, endOffset) {
    const body = text.slice(startOffset, endOffset);
    const tokens = scan(body).map((token) => ({
        ...token,
        start: token.start + startOffset,
        end: token.end + startOffset
    }));
    const sections = [];
    let index = 0;
    while (index < tokens.length && tokens[index].type !== "eof") {
        const token = tokens[index];
        if (token.type !== "identifier" || !SECTION_NAMES.has(token.value)) {
            index += 1;
            continue;
        }
        let cursor = skipTrivia(tokens, index + 1);
        // The '=' between a section name and its body is optional:
        // `Properties { ... }` is equivalent to `Properties = { ... }`.
        if (tokens[cursor] && tokens[cursor].value === "=") {
            cursor = skipTrivia(tokens, cursor + 1);
        }
        if (!tokens[cursor] || tokens[cursor].value !== "{") {
            index += 1;
            continue;
        }
        const closeIndex = findMatchingInTokenList(tokens, cursor, "{", "}");
        const closeOffset = closeIndex >= 0 ? tokens[closeIndex].start : endOffset;
        const canonicalName = SECTION_NAME_ALIASES.get(token.value) || token.value;
        const section = {
            name: canonicalName,
            originalName: token.value,
            nameOffset: token.start,
            bodyOpenOffset: tokens[cursor].start,
            bodyCloseOffset: closeOffset,
            startOffset: token.start,
            endOffset: closeIndex >= 0 ? tokens[closeIndex].end : endOffset,
            bodyOffset: tokens[cursor].end,
            bodyText: text.slice(tokens[cursor].end, closeOffset)
        };
        section.entries = parseSectionEntries(section);
        sections.push(section);
        index = closeIndex >= 0 ? closeIndex + 1 : tokens.length;
    }
    return sections;
}

function parseSectionEntries(section) {
    if (section.name === "Settings" || section.name === "Options") {
        return parseAssignments(section.bodyText, section.bodyOffset);
    }

    if (section.name === "Graph") {
        return parseCodeStatements(section.bodyText, section.bodyOffset);
    }

    if (section.name === "Layout") {
        return parseLayoutEntries(section);
    }

    const entries = [];
    collectPropertyEntries(section.bodyText, section.bodyOffset, section, null, entries);
    // Group("X") { ... } blocks are flattened back into source order.
    entries.sort((a, b) => (a.startOffset || 0) - (b.startOffset || 0));
    return entries;
}

// Walk a Properties/Inputs/Outputs body, descending into any Group("X") { ... } scopes
// and stamping each contained declaration with its group name. Recurses for nested groups
// (the innermost group name wins, matching the flat-group intent of the language).
function collectPropertyEntries(bodyText, bodyOffset, section, group, entries) {
    const { residue, groups } = extractPropertyGroups(bodyText, bodyOffset);
    for (const statement of splitTopLevel(residue, bodyOffset, ";")) {
        pushPropertyStatement(entries, statement, section, group);
    }
    for (const sub of groups) {
        collectPropertyEntries(sub.innerText, sub.innerOffset, section, sub.name, entries);
    }
}

function pushPropertyStatement(entries, statement, section, group) {
    const withoutMetadata = stripTrailingMetadata(statement.text);
    const metadata = group ? { group, ...withoutMetadata.metadata } : withoutMetadata.metadata;
    const assignment = splitTopLevelAssignment(withoutMetadata.text);
    const text = withoutMetadata.text.trim();
    if (assignment) {
        const declaration = parseDeclaration(assignment.left);
        if (declaration) {
            entries.push({
                kind: "declaration",
                ...statement,
                type: declaration.type,
                name: declaration.name,
                optional: declaration.optional,
                constant: declaration.constant,
                valueText: assignment.right,
                valueOffset: statement.startOffset + statement.text.indexOf(assignment.right),
                metadata
            });
        } else if (section.name === "Outputs") {
            entries.push({
                kind: "binding",
                ...statement,
                target: assignment.left,
                valueText: assignment.right,
                valueOffset: statement.startOffset + statement.text.indexOf(assignment.right)
            });
        } else {
            entries.push({ kind: "invalid", ...statement });
        }
        return;
    }
    const declaration = parseDeclaration(text);
    entries.push(declaration
        ? { kind: "declaration", ...statement, ...declaration, valueText: "", metadata }
        : { kind: "invalid", ...statement });
}

// Find top-level Group("Name") { ... } blocks in a property body. Returns the body with each
// group region blanked out (layout preserved so offsets stay valid) plus the extracted groups.
function extractPropertyGroups(bodyText, bodyOffset) {
    const tokens = scan(bodyText);
    const groups = [];
    const blanks = [];
    let i = 0;
    while (i < tokens.length && tokens[i].type !== "eof") {
        const token = tokens[i];
        if (token.type === "identifier" && token.value === "Group") {
            const parenIndex = skipTrivia(tokens, i + 1);
            if (tokens[parenIndex] && tokens[parenIndex].value === "(") {
                const closeParen = findMatchingInTokenList(tokens, parenIndex, "(", ")");
                const braceIndex = closeParen >= 0 ? skipTrivia(tokens, closeParen + 1) : -1;
                if (braceIndex >= 0 && tokens[braceIndex] && tokens[braceIndex].value === "{") {
                    const closeBrace = findMatchingInTokenList(tokens, braceIndex, "{", "}");
                    if (closeBrace >= 0) {
                        const nameText = bodyText.slice(tokens[parenIndex].end, tokens[closeParen].start).trim();
                        groups.push({
                            name: trimQuotes(nameText),
                            innerText: bodyText.slice(tokens[braceIndex].end, tokens[closeBrace].start),
                            innerOffset: bodyOffset + tokens[braceIndex].end
                        });
                        blanks.push([token.start, tokens[closeBrace].end]);
                        i = closeBrace + 1;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    if (blanks.length === 0) {
        return { residue: bodyText, groups };
    }
    const chars = bodyText.split("");
    for (const [start, end] of blanks) {
        for (let k = start; k < end; k += 1) {
            if (chars[k] !== "\n" && chars[k] !== "\r") {
                chars[k] = " ";
            }
        }
    }
    return { residue: chars.join(""), groups };
}

function parseAssignments(text, baseOffset) {
    return splitTopLevel(text, baseOffset, [";", ","]).map((segment) => {
        const assignment = splitTopLevelAssignment(segment.text);
        if (!assignment) {
            return { kind: "invalid", ...segment };
        }
        return {
            kind: "assignment",
            ...segment,
            name: assignment.left,
            value: assignment.right,
            valueOffset: segment.startOffset + segment.text.indexOf(assignment.right)
        };
    });
}

function parseLayoutEntries(section) {
    const entries = [];
    for (const statement of splitTopLevel(section.bodyText, section.bodyOffset, ";")) {
        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (!callExpression) {
            entries.push({ kind: "invalid", ...statement });
            continue;
        }

        entries.push({
            kind: "layout",
            ...statement,
            layoutKind: callExpression.callee,
            callExpression,
            arguments: callExpression.arguments
        });
    }
    return entries;
}

// Match the closing delimiter for the bracket at `openIndex` (one bracket family at a time),
// respecting string literals. Returns the index of the matching close, or -1 if unbalanced.
function matchBracket(str, openIndex) {
    const open = str[openIndex];
    const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
    if (!close) {
        return -1;
    }
    let depth = 0;
    let inString = false;
    for (let k = openIndex; k < str.length; k += 1) {
        const char = str[k];
        if (inString) {
            if (char === "\\") { k += 1; continue; }
            if (char === "\"" || char === "\n" || char === "\r") { inString = false; }
            continue;
        }
        if (char === "\"") { inString = true; }
        else if (char === open) { depth += 1; }
        else if (char === close) { depth -= 1; if (depth === 0) { return k; } }
    }
    return -1;
}

const CONTROL_KEYWORDS = ["if", "for", "while"];

function isWordChar(char) {
    return /[A-Za-z0-9_]/.test(char || "");
}

function matchesControlKeywordAt(str, index) {
    if (isWordChar(str[index - 1])) {
        return null;
    }
    for (const keyword of CONTROL_KEYWORDS) {
        if (str.slice(index, index + keyword.length) === keyword && !isWordChar(str[index + keyword.length])) {
            return keyword;
        }
    }
    return null;
}

// Consume a control-flow statement `kw (cond) { body }` (with optional `else` / `else if` chains
// for `if`), mirroring the plugin's FindIfStatementEnd. Returns the end index (just past the last
// `}`) plus the condition and brace-body ranges. Tolerates a truncated trailing body (cursor mid
// block) by extending the open branch to end-of-text. Returns null if it isn't a complete head.
function findControlStatementEnd(str, start, keyword) {
    const skipWs = (k) => { while (k < str.length && /\s/.test(str[k])) { k += 1; } return k; };
    let k = skipWs(start + keyword.length);
    if (str[k] !== "(") {
        return null;
    }
    const conditionClose = matchBracket(str, k);
    if (conditionClose < 0) {
        return null;
    }
    const condition = { start: k + 1, end: conditionClose };
    k = skipWs(conditionClose + 1);
    if (str[k] !== "{") {
        return null;
    }
    const bodyClose = matchBracket(str, k);
    const branches = [];
    if (bodyClose < 0) {
        branches.push({ start: k + 1, end: str.length });
        return { end: str.length, condition, branches, keyword };
    }
    branches.push({ start: k + 1, end: bodyClose });
    let end = bodyClose + 1;
    if (keyword === "if") {
        let probe = skipWs(end);
        while (str.slice(probe, probe + 4) === "else" && !isWordChar(str[probe + 4])) {
            let m = skipWs(probe + 4);
            if (str.slice(m, m + 2) === "if" && !isWordChar(str[m + 2])) {
                m = skipWs(m + 2);
                if (str[m] !== "(") { break; }
                const condEnd = matchBracket(str, m);
                if (condEnd < 0) { break; }
                m = skipWs(condEnd + 1);
                if (str[m] !== "{") { break; }
                const branchEnd = matchBracket(str, m);
                if (branchEnd < 0) { break; }
                branches.push({ start: m + 1, end: branchEnd });
                end = branchEnd + 1;
                probe = skipWs(end);
            } else if (str[m] === "{") {
                const branchEnd = matchBracket(str, m);
                if (branchEnd < 0) { break; }
                branches.push({ start: m + 1, end: branchEnd });
                end = branchEnd + 1;
                break;
            } else {
                break;
            }
        }
    }
    return { end, condition, branches, keyword };
}

// Split a Graph / function code body into statements. Unlike splitTopLevel, this is control-flow
// aware: an `if (...) {...} else {...}` (or `for`/`while`) block is a single self-terminating
// statement whose brace bodies are recursed into, matching the plugin's SplitStatementsWithLocations.
function splitCodeStatements(text, baseOffset) {
    const normalized = stripCommentsPreserveLayout(text);
    const length = normalized.length;
    const segments = [];
    const pushSegment = (start, end, terminated, extra) => {
        const raw = normalized.slice(start, end);
        const leading = raw.search(/\S|$/);
        const trailing = raw.length - raw.trimEnd().length;
        const value = raw.trim();
        if (!value) {
            return;
        }
        segments.push({
            text: value,
            startOffset: baseOffset + start + leading,
            endOffset: baseOffset + end - trailing,
            terminated,
            ...(extra || {})
        });
    };
    let index = 0;
    while (index < length) {
        while (index < length && /\s/.test(normalized[index])) {
            index += 1;
        }
        if (index >= length) {
            break;
        }
        const start = index;
        const keyword = matchesControlKeywordAt(normalized, index);
        if (keyword) {
            const control = findControlStatementEnd(normalized, index, keyword);
            if (control) {
                pushSegment(start, control.end, true, {
                    control: true,
                    controlKeyword: keyword,
                    conditionText: normalized.slice(control.condition.start, control.condition.end),
                    conditionOffset: baseOffset + control.condition.start,
                    branches: control.branches.map((branch) => ({
                        text: normalized.slice(branch.start, branch.end),
                        offset: baseOffset + branch.start
                    }))
                });
                index = control.end;
                continue;
            }
        }
        let paren = 0;
        let brace = 0;
        let bracket = 0;
        let inString = false;
        let cursor = index;
        for (; cursor < length; cursor += 1) {
            const char = normalized[cursor];
            if (inString) {
                if (char === "\\") { cursor += 1; continue; }
                if (char === "\"" || char === "\n" || char === "\r") { inString = false; }
                continue;
            }
            if (char === "\"") { inString = true; }
            else if (char === "(") { paren += 1; }
            else if (char === ")") { paren = Math.max(0, paren - 1); }
            else if (char === "{") { brace += 1; }
            else if (char === "}") { brace = Math.max(0, brace - 1); }
            else if (char === "[") { bracket += 1; }
            else if (char === "]") { bracket = Math.max(0, bracket - 1); }
            else if (char === ";" && paren === 0 && brace === 0 && bracket === 0) { break; }
        }
        const terminated = cursor < length;
        const end = terminated ? cursor : length;
        pushSegment(start, end, terminated);
        index = terminated ? cursor + 1 : length;
    }
    return segments;
}

function parseCodeStatements(text, baseOffset) {
    return splitCodeStatements(stripGraphRegionDirectivesPreserveLayout(text), baseOffset).map((segment) => {
        if (segment.control) {
            const children = [];
            // The init clause of a `for (init; cond; step)` introduces a loop-scoped local.
            if (segment.controlKeyword === "for" && segment.conditionText) {
                const initText = segment.conditionText.split(";")[0];
                const initDecls = parseCodeDeclarationEntries(initText, segment.conditionOffset);
                if (initDecls.length > 0) {
                    children.push({ kind: "declarations", text: initText.trim(), startOffset: segment.conditionOffset, endOffset: segment.conditionOffset + initText.length, terminated: true, declarations: initDecls });
                }
            }
            for (const branch of segment.branches || []) {
                for (const child of parseCodeStatements(branch.text, branch.offset)) {
                    children.push(child);
                }
            }
            return { kind: "control", ...segment, children };
        }
        const returnMatch = /^return\b\s*/.exec(segment.text);
        if (returnMatch) {
            // `return <expr>;` in a single-output function body — the plugin lowers this to the
            // implicit __return output. Treat it as a value expression, not a declaration.
            const valueText = segment.text.slice(returnMatch[0].length);
            return {
                kind: "return",
                ...segment,
                valueText,
                valueOffset: segment.startOffset + returnMatch[0].length
            };
        }
        const declarations = parseCodeDeclarationEntries(segment.text, segment.startOffset);
        if (declarations.length > 0) {
            return { kind: "declarations", ...segment, declarations };
        }
        const assignment = splitTopLevelAssignment(segment.text);
        if (assignment) {
            return {
                kind: "assignment",
                ...segment,
                target: assignment.left,
                valueText: assignment.right,
                valueOffset: segment.startOffset + segment.text.indexOf(assignment.right)
            };
        }
        return { kind: "expression", ...segment };
    });
}

function parseCodeDeclarationEntries(text, baseOffset) {
    const segments = splitTopLevel(text, baseOffset, ",");
    if (segments.length === 0) {
        return [];
    }
    const firstAssignment = splitTopLevelAssignment(segments[0].text);
    const firstDecl = parseDeclaration(firstAssignment ? firstAssignment.left : segments[0].text);
    if (!firstDecl) {
        return [];
    }
    const result = [{
        ...firstDecl,
        startOffset: segments[0].startOffset,
        endOffset: segments[0].endOffset,
        valueText: firstAssignment ? firstAssignment.right : "",
        valueOffset: firstAssignment ? segments[0].startOffset + segments[0].text.indexOf(firstAssignment.right) : -1
    }];
    for (let index = 1; index < segments.length; index += 1) {
        const assignment = splitTopLevelAssignment(segments[index].text);
        const name = (assignment ? assignment.left : segments[index].text).trim();
        if (!isValidIdentifier(name)) {
            return [];
        }
        result.push({
            type: firstDecl.type,
            name,
            startOffset: segments[index].startOffset,
            endOffset: segments[index].endOffset,
            valueText: assignment ? assignment.right : "",
            valueOffset: assignment ? segments[index].startOffset + segments[index].text.indexOf(assignment.right) : -1
        });
    }
    return result;
}

function stripGraphRegionDirectivesPreserveLayout(text) {
    const source = String(text || "");
    return source.replace(/^[ \t]*#(?:End)?Region(?:[ \t]+(?:"[^"\r\n]*"|[^\r\n]*))?[ \t]*(?=\r?$)/gim, (match) =>
        match.replace(/[^\r\n]/g, " "));
}

function parseDeclaration(text) {
    let trimmed = String(text || "").trim();
    let optional = false;
    let constant = false;
    while (/^(opt|const)\s+/i.test(trimmed)) {
        const match = /^(opt|const)\s+/i.exec(trimmed);
        optional = optional || match[1].toLowerCase() === "opt";
        constant = constant || match[1].toLowerCase() === "const";
        trimmed = trimmed.slice(match[0].length).trim();
    }
    const lastWhitespace = trimmed.search(/\s+\S+$/);
    if (lastWhitespace < 0) {
        return null;
    }
    const type = trimmed.slice(0, lastWhitespace).trim();
    const name = trimmed.slice(lastWhitespace).trim();
    return type && isValidIdentifier(name) ? { type, name, optional, constant } : null;
}

function parseFunctionParams(text, baseOffset) {
    return splitTopLevel(text, baseOffset, ",").map((segment) => {
        const parts = segment.text.trim().split(/\s+/).filter(Boolean);
        if (parts.length < 2) {
            return { kind: "invalid", ...segment };
        }
        let qualifier = "in";
        let type = parts[0];
        let name = parts[1];
        if (parts.length >= 3 && ["in", "out", "inout"].includes(parts[0])) {
            qualifier = parts[0];
            type = parts[1];
            name = parts[2];
        }
        return { kind: "param", ...segment, qualifier, type, name };
    });
}

function stripTrailingMetadata(text) {
    const source = String(text || "").trim();
    if (!source.endsWith("]")) {
        return { text: source, metadata: {} };
    }
    let depth = 0;
    let metadataStart = -1;
    let inString = false;
    for (let index = source.length - 1; index >= 0; index -= 1) {
        const char = source[index];
        if (char === "\"" && source[index - 1] !== "\\") {
            inString = !inString;
        }
        if (inString) {
            continue;
        }
        if (char === "]") {
            depth += 1;
        } else if (char === "[") {
            depth -= 1;
            if (depth === 0) {
                metadataStart = index;
                break;
            }
        }
    }
    if (metadataStart < 0) {
        return { text: source, metadata: {} };
    }
    const metadata = {};
    for (const entry of parseAssignments(source.slice(metadataStart + 1, -1), 0)) {
        if (entry.kind === "assignment") {
            metadata[normalizeSymbolKey(entry.name)] = trimQuotes(entry.value);
        }
    }
    return { text: source.slice(0, metadataStart).trim(), metadata };
}

function skipTrivia(tokens, index) {
    let cursor = index;
    while (tokens[cursor] && (tokens[cursor].type === "whitespace" || tokens[cursor].type === "comment")) {
        cursor += 1;
    }
    return cursor;
}

function findMatchingInTokenList(tokens, openIndex, openValue, closeValue) {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type === "comment" || token.type === "whitespace" || token.type === "string") {
            continue;
        }
        if (token.value === openValue) {
            depth += 1;
        } else if (token.value === closeValue) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function trimQuotes(text) {
    const value = String(text || "").trim();
    return value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
}

function findLineEnd(text, offset) {
    const lineFeed = text.indexOf("\n", offset);
    const carriageReturn = text.indexOf("\r", offset);
    if (lineFeed < 0 && carriageReturn < 0) {
        return text.length;
    }
    if (lineFeed < 0) {
        return carriageReturn;
    }
    if (carriageReturn < 0) {
        return lineFeed;
    }
    return Math.min(lineFeed, carriageReturn);
}

function offsetBlock(block, delta, namespace) {
    const result = {
        ...block,
        namespace,
        startOffset: offsetNumber(block.startOffset, delta),
        endOffset: offsetNumber(block.endOffset, delta),
        nameOffset: offsetNumber(block.nameOffset, delta),
        kindOffset: offsetNumber(block.kindOffset, delta),
        templateOffset: offsetNumber(block.templateOffset, delta),
        templateEndOffset: offsetNumber(block.templateEndOffset, delta),
        bodyOpenOffset: offsetNumber(block.bodyOpenOffset, delta),
        bodyCloseOffset: offsetNumber(block.bodyCloseOffset, delta),
        attributeOpenOffset: offsetNumber(block.attributeOpenOffset, delta),
        attributeCloseOffset: offsetNumber(block.attributeCloseOffset, delta),
        paramOpenOffset: offsetNumber(block.paramOpenOffset, delta),
        paramCloseOffset: offsetNumber(block.paramCloseOffset, delta),
        bodyOffset: offsetNumber(block.bodyOffset, delta),
        bodyText: block.bodyText
    };

    if (Array.isArray(block.params)) {
        result.params = block.params.map((param) => offsetEntry(param, delta));
    }
    if (Array.isArray(block.attributes)) {
        result.attributes = block.attributes.map((entry) => offsetEntry(entry, delta));
    }
    if (Array.isArray(block.sections)) {
        result.sections = block.sections.map((section) => offsetSection(section, delta));
    }
    if (Array.isArray(block.children)) {
        result.children = block.children.map((child) => offsetBlock(child, delta, namespace));
    }
    return result;
}

function offsetSection(section, delta) {
    return {
        ...section,
        nameOffset: offsetNumber(section.nameOffset, delta),
        bodyOpenOffset: offsetNumber(section.bodyOpenOffset, delta),
        bodyCloseOffset: offsetNumber(section.bodyCloseOffset, delta),
        startOffset: offsetNumber(section.startOffset, delta),
        endOffset: offsetNumber(section.endOffset, delta),
        bodyOffset: offsetNumber(section.bodyOffset, delta),
        entries: (section.entries || []).map((entry) => offsetEntry(entry, delta))
    };
}

function offsetEntry(entry, delta) {
    const result = { ...entry };
    for (const key of ["startOffset", "endOffset", "valueOffset", "pathOffset"]) {
        result[key] = offsetNumber(result[key], delta);
    }
    if (Array.isArray(entry.declarations)) {
        result.declarations = entry.declarations.map((declaration) => offsetEntry(declaration, delta));
    }
    return result;
}

function offsetNumber(value, delta) {
    return typeof value === "number" && value >= 0 ? value + delta : value;
}

module.exports = {
    parseDocument,
    parseSections,
    parseSectionEntries,
    parseAssignments,
    parseLayoutEntries,
    parseCodeDeclarationEntries,
    parseCodeStatements,
    stripGraphRegionDirectivesPreserveLayout,
    parseFunctionParams,
    parseDeclaration,
    TOP_LEVEL_BLOCKS,
    TEMPLATE_BLOCKS,
    SECTION_NAMES
};
