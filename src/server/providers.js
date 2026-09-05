"use strict";

// The fourteen providers, as protocol handlers.
//
// `language/` already answered every one of these as a plain "spec" object carrying offsets -- that
// was the seam that made the editor-side layer a converter and nothing more, and it is the same
// seam here. What changed is only the target vocabulary: offsets still become positions, but into
// protocol ranges rather than `vscode.Range`, and the enums are the protocol's, whose numbering
// happens to be the editor's plus one. Using the names rather than the numbers keeps that difference
// where it belongs, which is nowhere.

const fs = require("fs");
const path = require("path");
const {
    CompletionItemKind,
    DiagnosticSeverity,
    InlayHintKind,
    InsertTextFormat,
    MarkupKind,
    SemanticTokensBuilder,
    SymbolKind
} = require("vscode-languageserver");

const languageCore = require("../language");
const { SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } = require("../languageData");
const { resolveImportPath } = require("../project/imports");
const { createLanguageServices } = require("./services");
const {
    fileNameOf,
    isDreamShaderDocument,
    offsetToPosition,
    positionInRange,
    rangeFromOffsets,
    toUri,
    wordAt
} = require("./documents");

const WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_:.]*/;
/** Definition and references use the narrower one: a trailing `.member` is not part of the name. */
const SYMBOL_PATTERN = /[A-Za-z_][A-Za-z0-9_:]*/;

// ------------------------------------------------------------------ completion

function completion(document, position, services) {
    const offset = document.offsetAt(position);
    const word = wordAt(document, position, WORD_PATTERN);
    const defaultRange = word ? word.range : { start: position, end: position };

    return languageCore
        .getCompletionSpecs(document.getText(), offset, createLanguageServices(document, services))
        .map((spec) => completionSpecToItem(document, spec, defaultRange));
}

function completionSpecToItem(document, spec, defaultRange) {
    const insertText = spec.insertText || spec.label;
    // Snippet placeholders come in both spellings: braced (`${1:Surface}`, `${1|a,b|}`) and bare
    // (`$0`). Matching only the braced form left every insert text whose sole placeholder was a bare
    // `$0` — which is all 116 `createSettingItem` entries (`TwoSided = "$0";`), the `Base.<Output>`
    // bindings, and the section bodies — declared PlainText, so the editor inserted the characters
    // `$0` literally instead of placing the cursor. The `{` is what must be optional, not required.
    const isSnippet = /\$\{?\d/.test(spec.insertText || "");
    const range = Array.isArray(spec.range)
        ? rangeFromOffsets(document, spec.range[0], spec.range[1])
        : defaultRange;

    const item = {
        label: spec.label,
        kind: completionItemKind(spec.kind),
        detail: spec.detail || "",
        insertTextFormat: isSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
        // A `textEdit` rather than `insertText`, because the editor-side version set an explicit
        // range and the protocol has no other way to say one. Without it the client picks its own
        // word range, which is not the same range for a label carrying a `.` or a `::`.
        textEdit: { range, newText: insertText }
    };

    if (spec.documentation) {
        item.documentation = { kind: MarkupKind.Markdown, value: spec.documentation };
    }
    if (spec.sortText) {
        item.sortText = spec.sortText;
    }
    return item;
}

function completionItemKind(kind) {
    switch (kind) {
        case "Class": return CompletionItemKind.Class;
        case "Constant": return CompletionItemKind.Constant;
        case "Field": return CompletionItemKind.Field;
        case "File": return CompletionItemKind.File;
        case "Function": return CompletionItemKind.Function;
        case "Keyword": return CompletionItemKind.Keyword;
        case "Method": return CompletionItemKind.Method;
        case "Module": return CompletionItemKind.Module;
        case "Property": return CompletionItemKind.Property;
        case "Snippet": return CompletionItemKind.Snippet;
        case "TypeParameter": return CompletionItemKind.TypeParameter;
        case "Variable": return CompletionItemKind.Variable;
        case "EnumMember": return CompletionItemKind.EnumMember;
        default: return CompletionItemKind.Text;
    }
}

// ----------------------------------------------------------------------- hover

function hover(document, position, services) {
    const found = wordAt(document, position, WORD_PATTERN);
    if (!found) {
        return null;
    }

    const { word, range } = found;
    const text = document.getText();
    const offset = document.offsetAt(position);
    const languageServices = createLanguageServices(document, services);

    const hoverSpec = languageCore.getHoverInfoSpec(text, offset, languageServices);
    if (hoverSpec) {
        return { contents: markdown(hoverSpecToMarkdown(hoverSpec)), range };
    }

    const definitions = languageServices.getLanguageIndex().functionDefinitions.get(word.toLowerCase());
    if (definitions?.length) {
        const first = definitions[0];
        return {
            contents: markdown(`DreamShader ${first.kind} \`${first.name}\`\n\nDefined in \`${path.basename(first.fsPath)}\``),
            range
        };
    }

    const completions = languageCore.getCompletionSpecs(text, offset, languageServices);
    const match = completions.find((entry) => entry.label === word || entry.label.endsWith(`.${word}`));
    if (match?.detail || match?.documentation) {
        return { contents: markdown([match.detail, match.documentation].filter(Boolean).join("\n\n")), range };
    }

    return null;
}

function markdown(value) {
    return { kind: MarkupKind.Markdown, value };
}

function hoverSpecToMarkdown(spec) {
    const lines = [];
    const title = [spec.kind, spec.name ? `\`${spec.name}\`` : ""].filter(Boolean).join(" ");
    if (title) {
        lines.push(title);
    }
    if (spec.detail) {
        lines.push(spec.detail);
    }
    if (spec.parameters?.length) {
        lines.push(`Parameters: ${spec.parameters.map(formatHoverParameter).join(", ")}`);
    }
    if (spec.outputs?.length > 1) {
        lines.push("Outputs:");
        lines.push("| Index | Name | Type |");
        lines.push("| --- | --- | --- |");
        for (const output of spec.outputs) {
            lines.push(`| ${output.index ?? ""} | ${escapeMarkdownTableCell(output.name || "Result")} | \`${output.type || "value"}\` |`);
        }
    } else if (spec.returnType) {
        lines.push(`Returns: \`${spec.returnType}\``);
    } else if (spec.outputs?.length === 1) {
        const output = spec.outputs[0];
        lines.push(`Returns: \`${output.type || "value"}\`${output.name ? ` (${output.name})` : ""}`);
    }
    if (spec.example) {
        lines.push("Example:");
        lines.push("```dreamshaderlang");
        lines.push(spec.example);
        lines.push("```");
    }
    if (spec.documentation) {
        lines.push(spec.documentation);
    }
    return lines.filter(Boolean).join("\n\n");
}

function formatHoverParameter(parameter) {
    const optional = parameter.optional ? "?" : "";
    return `\`${parameter.qualifier || "in"} ${parameter.type || "value"} ${parameter.name || ""}${optional}\``;
}

function escapeMarkdownTableCell(text) {
    return String(text || "").replace(/\|/g, "\\|");
}

// --------------------------------------------------------------- signature help

function signatureHelp(document, position, services) {
    const offset = document.offsetAt(position);
    const callContext = getActiveCallContext(document.getText(), offset);
    if (!callContext) {
        return null;
    }

    const signatures = getCallableSignatures(document, callContext.callee, services);
    if (!signatures.length) {
        return null;
    }

    return {
        signatures: signatures.map(buildSignatureInformation),
        activeSignature: 0,
        activeParameter: callContext.argumentIndex
    };
}

function getActiveCallContext(text, offset) {
    const prefix = text.slice(0, offset);
    const openIndex = prefix.lastIndexOf("(");
    if (openIndex < 0) {
        return null;
    }
    const calleeMatch = /([A-Za-z_][A-Za-z0-9_:.]*)\s*$/.exec(prefix.slice(0, openIndex));
    if (!calleeMatch) {
        return null;
    }
    const argumentText = prefix.slice(openIndex + 1);
    return {
        callee: calleeMatch[1],
        argumentIndex: (argumentText.match(/,/g) || []).length
    };
}

function getCallableSignatures(document, callee, services) {
    const languageServices = createLanguageServices(document, services);
    const callables = languageServices.collectReachableCallableSignatures();
    const normalized = String(callee || "").toLowerCase();
    const shortName = normalized.split("::").pop().split(".").pop();
    const local = callables.get(normalized) || callables.get(shortName) || [];
    if (local.length) {
        return local;
    }
    if (normalized.startsWith("substrate.")) {
        return (languageServices.getSubstrateBuiltinItems() || []).filter((item) =>
            item.name?.toLowerCase() === shortName || item.qualifiedName?.toLowerCase() === normalized);
    }
    return (languageServices.getUEBuiltinItems() || []).filter((item) =>
        item.name?.toLowerCase() === shortName || item.qualifiedName?.toLowerCase() === normalized);
}

function buildSignatureInformation(signature) {
    const allOutputs = signature.outputs || [];
    // A return-type function's implicit output is shown as a `: <type>` return suffix, not as a
    // bogus `out <type>` parameter leaking the internal lowering name.
    const returnOutput = allOutputs.find((output) => output && output.isReturn);
    const visibleOutputs = allOutputs.filter((output) => output && !output.isReturn);
    const params = [...(signature.inputs || []), ...visibleOutputs, ...(signature.parameters || [])];
    const returnSuffix = returnOutput ? ` : ${returnOutput.type || "value"}` : "";
    const label = `${signature.name || signature.qualifiedName || "call"}(${params.map((param) => `${param.qualifier || "in"} ${param.type || "value"} ${param.name || ""}`.trim()).join(", ")})${returnSuffix}`;

    return {
        label,
        documentation: signature.detail || "",
        parameters: params.map((param) => ({ label: param.name || String(param) }))
    };
}

// -------------------------------------------------------------- document symbols

function documentSymbols(document) {
    return languageCore.getDocumentSymbols(document.getText()).map((spec) => symbolSpecToSymbol(document, spec));
}

function symbolSpecToSymbol(document, spec) {
    return {
        // Never falsy. The client throws "name must not be falsy" while converting, and because it
        // converts the whole tree at once, one nameless node three levels down fails the entire
        // documentSymbol request -- outline, breadcrumbs and go-to-symbol all go with it. In-process
        // the same throw was swallowed per-provider and merely left the outline blank, which is how
        // a nameless Graph assignment survived unnoticed. A placeholder degrades one label instead.
        name: spec.name || "(unnamed)",
        detail: spec.detail || "",
        kind: documentSymbolKind(spec.kind),
        range: rangeFromOffsets(document, spec.startOffset, spec.endOffset),
        selectionRange: rangeFromOffsets(document, spec.selectionStartOffset, spec.selectionEndOffset),
        children: (spec.children || []).map((child) => symbolSpecToSymbol(document, child))
    };
}

function documentSymbolKind(kind) {
    switch (kind) {
        case "Function":
        case "GraphFunction": return SymbolKind.Function;
        case "Namespace": return SymbolKind.Namespace;
        case "Section": return SymbolKind.Module;
        case "Variable": return SymbolKind.Variable;
        case "Property": return SymbolKind.Property;
        default: return SymbolKind.Class;
    }
}

// -------------------------------------------------------------- semantic tokens

function semanticTokens(document) {
    const builder = new SemanticTokensBuilder();
    for (const token of languageCore.getSemanticTokens(document.getText())) {
        const position = document.positionAt(token.offset);
        builder.push(
            position.line,
            position.character,
            token.length,
            SEMANTIC_TOKEN_TYPES.indexOf(token.type),
            encodeTokenModifiers(token.modifiers || []));
    }
    return builder.build();
}

function encodeTokenModifiers(modifiers) {
    let encoded = 0;
    for (const modifier of modifiers) {
        const index = SEMANTIC_TOKEN_MODIFIERS.indexOf(modifier);
        if (index >= 0) {
            encoded |= 1 << index;
        }
    }
    return encoded;
}

// ----------------------------------------------------------------- inlay hints

function inlayHints(document, range, services) {
    if (!isDreamShaderDocument(document)) {
        return [];
    }

    const hints = [];
    for (const spec of languageCore.getInlayHintSpecs(document.getText(), createLanguageServices(document, services))) {
        const position = document.positionAt(spec.offset);
        if (!positionInRange(position, range)) {
            continue;
        }
        hints.push({
            position,
            label: spec.label,
            kind: spec.kind === "Type" ? InlayHintKind.Type : InlayHintKind.Parameter,
            paddingRight: Boolean(spec.paddingRight)
        });
    }
    return hints;
}

// --------------------------------------------------------------- folding ranges

function foldingRanges(document) {
    return languageCore.getFoldingRanges(document.getText()).map((range) => ({
        startLine: document.positionAt(range.startOffset).line,
        endLine: document.positionAt(range.endOffset).line
    }));
}

// ----------------------------------------------------------------------- colors

function documentColors(document) {
    return languageCore.getDocumentColorRanges(document.getText()).map((entry) => ({
        range: rangeFromOffsets(document, entry.startOffset, entry.endOffset),
        color: {
            red: entry.color.red,
            green: entry.color.green,
            blue: entry.color.blue,
            alpha: entry.color.alpha
        }
    }));
}

function colorPresentations(document, color, range) {
    // Re-derive the original constructor spelling (float3/float4 vs the vec3/vec4 alias) from the
    // range's pre-edit text rather than threading extra state through the colour requests -- the
    // range still points at what `documentColors` reported, before this presentation is applied.
    const originalText = document.getText(range).trim();
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(originalText);
    const constructorName = nameMatch ? nameMatch[1] : "float4";
    const componentCount = constructorName.endsWith("3") ? 3 : 4;

    return [{ label: languageCore.formatColorPresentation(constructorName, componentCount, color) }];
}

// ---------------------------------------------------------------- document links

function documentLinks(document) {
    const fileName = fileNameOf(document);
    return (languageCore.parseDocument(document.getText()).imports || [])
        .map((importStatement) => {
            const resolved = resolveImportPath(fileName, importStatement.path);
            if (!resolved) {
                return null;
            }
            return {
                range: rangeFromOffsets(
                    document,
                    importStatement.pathOffset,
                    importStatement.pathOffset + importStatement.path.length),
                target: toUri(resolved)
            };
        })
        .filter(Boolean);
}

// ------------------------------------------------------------ definition, refs

function definition(document, position, services) {
    const importLocation = getImportDefinitionLocation(document, position);
    if (importLocation) {
        return importLocation;
    }

    const found = wordAt(document, position, SYMBOL_PATTERN);
    if (!found) {
        return null;
    }

    const word = found.word.toLowerCase();
    return (createLanguageServices(document, services).collectReachableFunctionDefinitions().get(word) || [])
        .map((entry) => ({
            uri: toUri(entry.fsPath),
            range: {
                start: offsetToPositionInFile(entry.fsPath, entry.nameOffset),
                end: offsetToPositionInFile(entry.fsPath, entry.nameOffset + entry.nameRangeLength)
            }
        }));
}

function getImportDefinitionLocation(document, position) {
    const offset = document.offsetAt(position);
    const fileName = fileNameOf(document);

    for (const importStatement of languageCore.parseDocument(document.getText()).imports || []) {
        if (offset < importStatement.pathOffset || offset > importStatement.pathOffset + importStatement.path.length) {
            continue;
        }
        const resolved = resolveImportPath(fileName, importStatement.path);
        return resolved
            ? [{ uri: toUri(resolved), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }]
            : null;
    }
    return null;
}

function offsetToPositionInFile(filePath, offset) {
    try {
        return offsetToPosition(fs.readFileSync(filePath, "utf8"), offset);
    } catch (_error) {
        return { line: 0, character: 0 };
    }
}

function references(document, position, services) {
    const found = wordAt(document, position, SYMBOL_PATTERN);
    if (!found) {
        return [];
    }

    const { word } = found;
    const index = createLanguageServices(document, services).getLanguageIndex();
    const locations = [];

    for (const file of index.files || []) {
        const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "g");
        for (const match of file.text.matchAll(pattern)) {
            locations.push({
                uri: toUri(file.fsPath),
                range: {
                    start: offsetToPosition(file.text, match.index),
                    end: offsetToPosition(file.text, match.index + word.length)
                }
            });
        }
    }
    return locations;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -------------------------------------------------------------------- formatting

function formatting(document, options) {
    const indent = options.insertSpaces ? " ".repeat(options.tabSize || 4) : "\t";
    const text = document.getText();
    return [{
        range: rangeFromOffsets(document, 0, text.length),
        newText: languageCore.formatDocument(text, { indent })
    }];
}

// ------------------------------------------------------------------- diagnostics

const DIAGNOSTIC_SOURCE = "dreamshaderlang";
const DIAGNOSTIC_DOCS_BASE = "https://github.com/TypeDreamMoon/DreamShader/blob/main/Docs/diagnostics";

function diagnostics(document, services) {
    return languageCore
        .getDiagnostics(document.getText(), fileNameOf(document), createLanguageServices(document, services))
        .map((entry) => {
            const diagnostic = {
                range: rangeFromOffsets(document, entry.startOffset, entry.endOffset),
                message: entry.message,
                severity: entry.severity === "Error"
                    ? DiagnosticSeverity.Error
                    : entry.severity === "Information"
                        ? DiagnosticSeverity.Information
                        : DiagnosticSeverity.Warning,
                source: DIAGNOSTIC_SOURCE
            };

            // A DSHnnnn is the compiler's stable identity for a rule, and each range owns the doc
            // page of the same name -- so the code is worth carrying, and worth making clickable.
            if (entry.code) {
                diagnostic.code = entry.code;
                diagnostic.codeDescription = {
                    href: `${DIAGNOSTIC_DOCS_BASE}/${entry.code.slice(0, 4)}xxx.md#${entry.code.toLowerCase()}`
                };
            }
            return diagnostic;
        });
}

// --------------------------------------------------------------------- code lens

function codeLenses(document, enabled) {
    if (!isDreamShaderDocument(document) || !enabled) {
        return [];
    }

    const lenses = [];
    for (const target of languageCore.getCodeLensTargets(document.getText())) {
        const position = document.positionAt(target.startOffset);
        const range = { start: position, end: position };
        for (const action of target.actions || []) {
            lenses.push({ range, command: codeLensCommand(action, document) });
        }
    }
    return lenses;
}

function codeLensCommand(action, document) {
    switch (action) {
        case "recompileCurrent":
            return {
                title: "$(play)",
                command: "dreamshader.recompileCurrent",
                // The uri crosses as a string. The editor-side version passed a `vscode.Uri`, which
                // it could because the lens and the command handler were the same process; here the
                // arguments are JSON, and the client's handler parses it back.
                arguments: [document.uri]
            };
        case "showBridgeDiagnostics":
            return { title: "$(pulse)", command: "dreamshader.showBridgeDiagnostics" };
        case "recompileAll":
        default:
            return { title: "$(sync)", command: "dreamshader.recompileAll" };
    }
}

module.exports = {
    codeLenses,
    colorPresentations,
    completion,
    definition,
    diagnostics,
    documentColors,
    documentLinks,
    documentSymbols,
    foldingRanges,
    formatting,
    hover,
    inlayHints,
    references,
    semanticTokens,
    signatureHelp
};
