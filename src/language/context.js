"use strict";

const {
    parseDocument,
    parseDeclaration,
    parseSections,
    SECTION_NAMES,
    TOP_LEVEL_BLOCKS
} = require("./parser");
const { scan } = require("./scanner");
const {
    getLinePrefix,
    normalizeSymbolKey,
    splitTopLevelAssignment,
    stripCommentsPreserveLayout
} = require("./utils");

function analyzeContext(text, offset) {
    const ast = parseDocument(text);
    let block = findInnermostBlock(ast.blocks, offset);
    let section = block ? findSection(block, offset) : null;
    const looseContext = section ? null : findLooseSectionContext(text, offset);
    if (looseContext) {
        block = block ? mergeLooseBlock(block, looseContext.block) : looseContext.block;
        section = findSection(block, offset) || looseContext.section;
    }
    const functionBlock = findInnermostFunction(ast.blocks, offset);
    const linePrefix = getLinePrefix(text, offset);
    let entry = section ? findEntry(section, offset) : null;
    if (!entry && looseContext && section?.name === "Outputs") {
        entry = findLooseOutputsEntry(text, section, offset);
    }
    let setting = section && (section.name === "Settings" || section.name === "Options")
        ? findAssignmentAtOffset(section, offset)
        : null;
    if (!setting && looseContext && (section?.name === "Settings" || section?.name === "Options")) {
        setting = findLooseAssignmentAtOffset(text, section, offset);
    }
    const metadata = entry
        ? getMetadataContext(text, entry, offset)
        : section
            ? getLooseMetadataContext(text, section, offset)
            : null;

    let kind = "TopLevel";
    if (functionBlock && offset > functionBlock.bodyOpenOffset && offset <= functionBlock.bodyCloseOffset) {
        kind = functionBlock.kind === "Function" ? "FunctionBody" : "GraphFunctionBody";
    } else if (functionBlock && offset > functionBlock.paramOpenOffset && offset <= functionBlock.paramCloseOffset) {
        kind = "FunctionSignature";
    } else if (block && isInsideBlockAttributes(block, offset)) {
        kind = "BlockAttributes";
    } else if (section) {
        if (metadata) {
            kind = "Metadata";
        } else if (section.name === "Graph") {
            kind = "Graph";
        } else if (section.name === "Outputs") {
            kind = getOutputsContextKind(entry, offset);
        } else if (section.name === "Settings" || section.name === "Options") {
            kind = setting && offset >= setting.valueOffset ? "SettingValue" : "SettingKey";
        } else if (section.name === "Properties" || section.name === "Inputs") {
            kind = "Declaration";
        }
    } else if (block) {
        kind = "BlockBody";
    }

    return {
        ast,
        text,
        offset,
        linePrefix,
        block,
        section,
        entry,
        setting,
        metadata,
        kind,
        memberAccess: getMemberAccess(linePrefix, offset),
        afterUEAccessor: /UE\s*\.\s*[A-Za-z0-9_]*$/.test(linePrefix),
        afterBaseAccessor: /\bBase\s*\.\s*[A-Za-z0-9_]*$/.test(linePrefix),
        afterExpressionAccessor: /Expression\s*\([^)]*\)\.\w*$/.test(linePrefix),
        afterMemberAccessor: /\.[A-Za-z0-9_]*$/.test(linePrefix) && !/UE\s*\.\s*[A-Za-z0-9_]*$/.test(linePrefix),
        currentWord: getCurrentWord(text, offset)
    };
}

function findInnermostBlock(blocks, offset) {
    const candidates = [];
    for (const block of flattenBlocks(blocks)) {
        if (offset >= block.startOffset && offset <= block.endOffset) {
            candidates.push(block);
        }
    }
    return candidates.sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))[0] || null;
}

function findInnermostFunction(blocks, offset) {
    const candidates = flattenBlocks(blocks)
        .filter((block) => (block.kind === "Function" || block.kind === "GraphFunction") && offset >= block.startOffset && offset <= block.endOffset);
    return candidates.sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))[0] || null;
}

function flattenBlocks(blocks) {
    const result = [];
    for (const block of blocks || []) {
        result.push(block);
        if (Array.isArray(block.children)) {
            result.push(...flattenBlocks(block.children));
        }
    }
    return result;
}

function findSection(block, offset) {
    const sections = block.sections || [];
    return sections
        .filter((section) => offset >= section.bodyOpenOffset && offset <= section.bodyCloseOffset + 1)
        .sort((a, b) => (a.bodyCloseOffset - a.bodyOpenOffset) - (b.bodyCloseOffset - b.bodyOpenOffset))[0] || null;
}

function findEntry(section, offset) {
    return (section.entries || [])
        .slice()
        .sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))
        .find((entry) => offset >= entry.startOffset && offset <= entry.endOffset + 1) || null;
}

function findAssignmentAtOffset(section, offset) {
    return (section.entries || []).find((entry) => entry.kind === "assignment" && offset >= entry.startOffset && offset <= entry.endOffset + 1) || null;
}

function findLooseSectionContext(text, offset) {
    const tokens = scan(text.slice(0, offset));
    const stack = [];

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token || token.type === "eof" || token.type === "comment" || token.type === "whitespace" || token.type === "string") {
            continue;
        }

        if (token.value === "{") {
            const section = getSectionBeforeOpenBrace(tokens, index);
            if (section) {
                stack.push({
                    type: "section",
                    name: section.name,
                    nameOffset: section.nameOffset,
                    startOffset: section.nameOffset,
                    openOffset: token.start
                });
                continue;
            }

            const blockKind = getBlockKindBeforeOpenBrace(tokens, index);
            stack.push({
                type: blockKind ? "block" : "brace",
                name: blockKind || "",
                startOffset: blockKind ? getBlockKeywordOffsetBeforeOpenBrace(tokens, index, blockKind) : token.start,
                openOffset: token.start
            });
        } else if (token.value === "}") {
            stack.pop();
        }
    }

    const sectionIndex = findLastIndex(stack, (frame) => frame.type === "section");
    if (sectionIndex < 0) {
        return null;
    }

    const sectionFrame = stack[sectionIndex];
    const blockFrame = findLastBefore(stack, sectionIndex, (frame) => frame.type === "block");
    const blockKind = blockFrame?.name || "Shader";
    const blockOpenOffset = blockFrame?.openOffset ?? 0;
    const parsedSections = parseSections(text, blockOpenOffset + 1, text.length);
    const syntheticSection = parsedSections.find((section) =>
        section.name === sectionFrame.name
        && offset >= section.bodyOpenOffset
        && offset <= section.bodyCloseOffset + 1)
        || {
            name: sectionFrame.name,
            nameOffset: sectionFrame.nameOffset,
            bodyOpenOffset: sectionFrame.openOffset,
            bodyCloseOffset: text.length,
            startOffset: sectionFrame.startOffset,
            endOffset: text.length,
            bodyOffset: sectionFrame.openOffset + 1,
            bodyText: text.slice(sectionFrame.openOffset + 1),
            entries: []
        };

    return {
        block: {
            kind: blockKind,
            name: blockKind,
            localName: blockKind,
            startOffset: blockFrame?.startOffset ?? 0,
            endOffset: text.length,
            bodyOpenOffset: blockOpenOffset,
            bodyCloseOffset: text.length,
            sections: mergeSections(parsedSections, [syntheticSection])
        },
        section: syntheticSection
    };
}

function mergeLooseBlock(block, looseBlock) {
    if (!looseBlock) {
        return block;
    }
    return {
        ...block,
        sections: mergeSections(block.sections || [], looseBlock.sections || [])
    };
}

function mergeSections(primarySections, fallbackSections) {
    const result = [...(primarySections || [])];
    const hasSection = (section) => result.some((existing) =>
        existing.name === section.name
        && Math.abs((existing.startOffset || 0) - (section.startOffset || 0)) < 2);

    for (const section of fallbackSections || []) {
        if (!hasSection(section)) {
            result.push(section);
        }
    }

    return result.sort((a, b) => (a.startOffset || 0) - (b.startOffset || 0));
}

function getSectionBeforeOpenBrace(tokens, openBraceIndex) {
    const equalsIndex = previousSignificantTokenIndex(tokens, openBraceIndex - 1);
    const nameIndex = previousSignificantTokenIndex(tokens, equalsIndex - 1);
    const equals = tokens[equalsIndex];
    const name = tokens[nameIndex];
    if (!equals || !name || equals.value !== "=" || name.type !== "identifier" || !SECTION_NAMES.has(name.value)) {
        return null;
    }
    return { name: name.value, nameOffset: name.start };
}

function getBlockKindBeforeOpenBrace(tokens, openBraceIndex) {
    for (let index = openBraceIndex - 1, checked = 0; index >= 0 && checked < 160; index -= 1) {
        const token = tokens[index];
        if (!token || token.type === "comment" || token.type === "whitespace" || token.type === "string") {
            continue;
        }
        checked += 1;
        if (token.value === "}" || token.value === ";") {
            break;
        }
        if (token.type === "identifier" && TOP_LEVEL_BLOCKS.has(token.value)) {
            return token.value;
        }
    }
    return "";
}

function getBlockKeywordOffsetBeforeOpenBrace(tokens, openBraceIndex, blockKind) {
    for (let index = openBraceIndex - 1; index >= 0; index -= 1) {
        const token = tokens[index];
        if (token?.type === "identifier" && token.value === blockKind) {
            return token.start;
        }
    }
    return tokens[openBraceIndex]?.start ?? 0;
}

function previousSignificantTokenIndex(tokens, startIndex) {
    for (let index = startIndex; index >= 0; index -= 1) {
        const token = tokens[index];
        if (token && token.type !== "comment" && token.type !== "whitespace") {
            return index;
        }
    }
    return -1;
}

function findLooseOutputsEntry(text, section, offset) {
    const statement = getCurrentStatement(text, section.bodyOffset, offset);
    const trimmed = statement.text.trim();
    if (!trimmed) {
        return null;
    }

    const assignment = splitTopLevelAssignment(statement.text);
    if (assignment) {
        return {
            kind: "binding",
            text: trimmed,
            startOffset: statement.startOffset + statement.text.search(/\S/),
            endOffset: offset,
            target: assignment.left,
            valueText: assignment.right,
            valueOffset: getRightHandSideOffset(text, statement, assignment, offset)
        };
    }

    const declaration = parseDeclaration(trimmed);
    if (declaration) {
        return {
            kind: "declaration",
            text: trimmed,
            startOffset: statement.startOffset + statement.text.search(/\S/),
            endOffset: offset,
            ...declaration
        };
    }

    return {
        kind: "invalid",
        text: trimmed,
        startOffset: statement.startOffset + statement.text.search(/\S/),
        endOffset: offset
    };
}

function findLooseAssignmentAtOffset(text, section, offset) {
    const statement = getCurrentStatement(text, section.bodyOffset, offset);
    const trimmed = statement.text.trim();
    if (!trimmed) {
        return null;
    }

    const assignment = splitTopLevelAssignment(statement.text);
    if (!assignment) {
        return null;
    }

    return {
        kind: "assignment",
        text: trimmed,
        startOffset: statement.startOffset + statement.text.search(/\S/),
        endOffset: offset,
        name: assignment.left,
        value: assignment.right,
        valueOffset: getRightHandSideOffset(text, statement, assignment, offset)
    };
}

function getCurrentStatement(text, startOffset, offset) {
    const normalized = stripCommentsPreserveLayout(text.slice(startOffset, offset));
    let statementStart = 0;
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    let inString = false;

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
        if (char === ";" && paren === 0 && brace === 0 && bracket === 0) {
            statementStart = index + 1;
        }
    }

    return {
        text: text.slice(startOffset + statementStart, offset),
        startOffset: startOffset + statementStart
    };
}

function getRightHandSideOffset(text, statement, assignment, offset) {
    const rawStart = statement.startOffset + assignment.index + 1;
    const prefix = text.slice(rawStart, offset);
    const firstValueChar = prefix.search(/\S/);
    return firstValueChar < 0 ? offset : rawStart + firstValueChar;
}

function getLooseMetadataContext(text, section, offset) {
    if (!section || !["Properties", "Inputs", "Outputs"].includes(section.name)) {
        return null;
    }

    const openOffset = findUnclosedMetadataOpenOffset(text, section.bodyOffset, offset);
    if (openOffset < 0) {
        return null;
    }

    const assignmentMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^;\]]*$/.exec(text.slice(openOffset + 1, offset));
    return {
        openOffset,
        key: assignmentMatch ? assignmentMatch[1] : "",
        inValue: Boolean(assignmentMatch)
    };
}

function findUnclosedMetadataOpenOffset(text, startOffset, offset) {
    const tokens = scan(text.slice(startOffset, offset));
    let depth = 0;
    let openOffset = -1;

    for (const token of tokens) {
        if (!token || token.type === "eof" || token.type === "comment" || token.type === "whitespace" || token.type === "string") {
            continue;
        }
        if (token.value === ";" && depth === 0) {
            openOffset = -1;
        } else if (token.value === "[") {
            depth += 1;
            if (depth === 1) {
                openOffset = startOffset + token.start;
            }
        } else if (token.value === "]") {
            depth = Math.max(0, depth - 1);
            if (depth === 0) {
                openOffset = -1;
            }
        }
    }

    return depth > 0 ? openOffset : -1;
}

function findLastIndex(items, predicate) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (predicate(items[index], index)) {
            return index;
        }
    }
    return -1;
}

function findLastBefore(items, beforeIndex, predicate) {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
        if (predicate(items[index], index)) {
            return items[index];
        }
    }
    return null;
}

function getOutputsContextKind(entry, offset) {
    if (!entry) {
        return "Outputs";
    }
    if (entry.kind === "binding") {
        return offset >= entry.valueOffset ? "OutputsValue" : "OutputsTarget";
    }
    return "OutputsDeclaration";
}

function getMetadataContext(text, entry, offset) {
    const slice = text.slice(entry.startOffset, Math.min(offset, entry.endOffset));
    const open = slice.lastIndexOf("[");
    const close = slice.lastIndexOf("]");
    if (open >= 0 && open > close) {
        const absoluteOpen = entry.startOffset + open;
        const assignmentMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^;\]]*$/.exec(text.slice(absoluteOpen + 1, offset));
        return {
            openOffset: absoluteOpen,
            key: assignmentMatch ? assignmentMatch[1] : "",
            inValue: Boolean(assignmentMatch)
        };
    }
    return null;
}

function isInsideBlockAttributes(block, offset) {
    return typeof block.attributeOpenOffset === "number"
        && typeof block.attributeCloseOffset === "number"
        && block.attributeOpenOffset >= 0
        && block.attributeCloseOffset >= 0
        && offset > block.attributeOpenOffset
        && offset <= block.attributeCloseOffset;
}

function getMemberAccess(linePrefix, offset) {
    const match = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z0-9_]*)$/.exec(linePrefix || "");
    if (!match) {
        return null;
    }
    const member = match[2] || "";
    return {
        baseName: match[1],
        memberPrefix: member,
        replaceStartOffset: offset - member.length,
        replaceEndOffset: offset
    };
}

function getCurrentWord(text, offset) {
    let start = offset;
    while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) {
        start -= 1;
    }
    return {
        text: text.slice(start, offset),
        startOffset: start,
        key: normalizeSymbolKey(text.slice(start, offset))
    };
}

module.exports = {
    analyzeContext,
    findInnermostBlock,
    findInnermostFunction,
    flattenBlocks,
    findSection,
    isInsideBlockAttributes,
    getMemberAccess
};
