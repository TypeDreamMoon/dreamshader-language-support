"use strict";

const path = require("path");
const fs = require("fs");
const vscode = require("vscode");
const languageCore = require("../../language");
const { LANGUAGE_ID, SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } = require("../../languageData");
const { resolveImportPath } = require("../../project/imports");
const { isDreamShaderDocument } = require("../../project/projects");
const { createLanguageServices } = require("../languageServices");

const semanticTokenLegend = new vscode.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS);
const completionTriggerCharacters = [".", "\"", "/", ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_")];

function registerLanguageProviders(context, localDiagnostics, services = {}) {
    const codeLensChangeEmitter = new vscode.EventEmitter();
    context.subscriptions.push(
        codeLensChangeEmitter,
        vscode.languages.registerCompletionItemProvider({ language: LANGUAGE_ID }, createCompletionProvider(services), ...completionTriggerCharacters),
        vscode.languages.registerHoverProvider({ language: LANGUAGE_ID }, createHoverProvider(services)),
        vscode.languages.registerSignatureHelpProvider({ language: LANGUAGE_ID }, createSignatureHelpProvider(services), "(", ","),
        vscode.languages.registerDocumentSymbolProvider({ language: LANGUAGE_ID }, createDocumentSymbolProvider()),
        vscode.languages.registerDocumentSemanticTokensProvider({ language: LANGUAGE_ID }, createSemanticTokensProvider(), semanticTokenLegend),
        vscode.languages.registerInlayHintsProvider({ language: LANGUAGE_ID }, createInlayHintsProvider(services)),
        vscode.languages.registerFoldingRangeProvider({ language: LANGUAGE_ID }, createFoldingRangeProvider()),
        vscode.languages.registerDocumentLinkProvider({ language: LANGUAGE_ID }, createDocumentLinkProvider()),
        vscode.languages.registerDefinitionProvider({ language: LANGUAGE_ID }, createDefinitionProvider(services)),
        vscode.languages.registerReferenceProvider({ language: LANGUAGE_ID }, createReferenceProvider(services)),
        vscode.languages.registerDocumentFormattingEditProvider({ language: LANGUAGE_ID }, createFormattingProvider()),
        vscode.languages.registerCodeLensProvider({ language: LANGUAGE_ID }, createCodeLensProvider(codeLensChangeEmitter)),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("dreamshader.enableCodeLens")) {
                codeLensChangeEmitter.fire();
            }
        })
    );
    refreshAllLocalDiagnostics(localDiagnostics, services);
}

function createCodeLensProvider(changeEmitter) {
    return {
        onDidChangeCodeLenses: changeEmitter.event,
        provideCodeLenses(document) {
            if (!isDreamShaderDocument(document) || !vscode.workspace.getConfiguration("dreamshader").get("enableCodeLens", true)) {
                return [];
            }

            const lenses = [];
            for (const target of languageCore.getCodeLensTargets(document.getText())) {
                const range = new vscode.Range(document.positionAt(target.startOffset), document.positionAt(target.startOffset));
                for (const action of target.actions || []) {
                    lenses.push(new vscode.CodeLens(range, codeLensCommandForAction(action, document)));
                }
            }
            return lenses;
        }
    };
}

function codeLensCommandForAction(action, document) {
    switch (action) {
        case "recompileCurrent":
            return {
                title: "$(play)",
                command: "dreamshader.recompileCurrent",
                arguments: [document.uri]
            };
        case "showBridgeDiagnostics":
            return {
                title: "$(pulse)",
                command: "dreamshader.showBridgeDiagnostics"
            };
        case "recompileAll":
        default:
            return {
                title: "$(sync)",
                command: "dreamshader.recompileAll"
            };
    }
}

function createCompletionProvider(services = {}) {
    return {
        provideCompletionItems(document, position) {
            const offset = document.offsetAt(position);
            const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_:.]*/);
            const defaultRange = wordRange || new vscode.Range(position, position);
            return languageCore
                .getCompletionSpecs(document.getText(), offset, createLanguageServices(document, services))
                .map((spec) => completionSpecToVscodeItem(document, spec, defaultRange));
        }
    };
}

function completionSpecToVscodeItem(document, spec, defaultRange) {
    const item = new vscode.CompletionItem(spec.label, getCompletionItemKind(spec.kind));
    item.detail = spec.detail || "";
    item.documentation = spec.documentation ? new vscode.MarkdownString(spec.documentation) : undefined;
    item.insertText = /\$\{\d/.test(spec.insertText || "")
        ? new vscode.SnippetString(spec.insertText)
        : spec.insertText || spec.label;
    item.range = Array.isArray(spec.range)
        ? new vscode.Range(document.positionAt(spec.range[0]), document.positionAt(spec.range[1]))
        : defaultRange;
    return item;
}

function getCompletionItemKind(kind) {
    switch (kind) {
        case "Class": return vscode.CompletionItemKind.Class;
        case "Field": return vscode.CompletionItemKind.Field;
        case "File": return vscode.CompletionItemKind.File;
        case "Function": return vscode.CompletionItemKind.Function;
        case "Keyword": return vscode.CompletionItemKind.Keyword;
        case "Method": return vscode.CompletionItemKind.Method;
        case "Module": return vscode.CompletionItemKind.Module;
        case "Property": return vscode.CompletionItemKind.Property;
        case "Snippet": return vscode.CompletionItemKind.Snippet;
        case "TypeParameter": return vscode.CompletionItemKind.TypeParameter;
        case "Variable": return vscode.CompletionItemKind.Variable;
        case "EnumMember": return vscode.CompletionItemKind.EnumMember;
        default: return vscode.CompletionItemKind.Text;
    }
}

function createHoverProvider(services = {}) {
    return {
        provideHover(document, position) {
            const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_:.]*/);
            if (!wordRange) {
                return undefined;
            }
            const word = document.getText(wordRange);
            const languageServices = createLanguageServices(document, services);
            const hoverSpec = languageCore.getHoverInfoSpec(document.getText(), document.offsetAt(position), languageServices);
            if (hoverSpec) {
                return new vscode.Hover(hoverSpecToMarkdown(hoverSpec), wordRange);
            }
            const index = languageServices.getLanguageIndex();
            const definitions = index.functionDefinitions.get(word.toLowerCase());
            if (definitions?.length) {
                const first = definitions[0];
                return new vscode.Hover(new vscode.MarkdownString(`DreamShader ${first.kind} \`${first.name}\`\n\nDefined in \`${path.basename(first.fsPath)}\``), wordRange);
            }
            const completions = languageCore.getCompletionSpecs(document.getText(), document.offsetAt(position), languageServices);
            const completion = completions.find((entry) => entry.label === word || entry.label.endsWith(`.${word}`));
            if (completion?.detail || completion?.documentation) {
                return new vscode.Hover(new vscode.MarkdownString([completion.detail, completion.documentation].filter(Boolean).join("\n\n")), wordRange);
            }
            return undefined;
        }
    };
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
    return new vscode.MarkdownString(lines.filter(Boolean).join("\n\n"));
}

function formatHoverParameter(parameter) {
    const optional = parameter.optional ? "?" : "";
    return `\`${parameter.qualifier || "in"} ${parameter.type || "value"} ${parameter.name || ""}${optional}\``;
}

function escapeMarkdownTableCell(text) {
    return String(text || "").replace(/\|/g, "\\|");
}

function createSignatureHelpProvider(services = {}) {
    return {
        provideSignatureHelp(document, position) {
            const offset = document.offsetAt(position);
            const text = document.getText();
            const callContext = getActiveCallContext(text, offset);
            if (!callContext) {
                return undefined;
            }
            const signatures = getCallableSignatures(document, callContext.callee, services);
            if (!signatures.length) {
                return undefined;
            }
            const help = new vscode.SignatureHelp();
            help.signatures = signatures.map(buildSignatureInformation);
            help.activeSignature = 0;
            help.activeParameter = callContext.argumentIndex;
            return help;
        }
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

function getCallableSignatures(document, callee, services = {}) {
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
    const params = [...(signature.inputs || []), ...(signature.outputs || []), ...(signature.parameters || [])];
    const label = `${signature.name || signature.qualifiedName || "call"}(${params.map((param) => `${param.qualifier || "in"} ${param.type || "value"} ${param.name || ""}`.trim()).join(", ")})`;
    const info = new vscode.SignatureInformation(label, signature.detail || "");
    info.parameters = params.map((param) => new vscode.ParameterInformation(param.name || String(param)));
    return info;
}

function createDocumentSymbolProvider() {
    return {
        provideDocumentSymbols(document) {
            return languageCore.getDocumentSymbols(document.getText()).map((symbol) => documentSymbolSpecToVscode(document, symbol));
        }
    };
}

function documentSymbolSpecToVscode(document, spec) {
    const range = new vscode.Range(document.positionAt(spec.startOffset), document.positionAt(spec.endOffset));
    const selectionRange = new vscode.Range(document.positionAt(spec.selectionStartOffset), document.positionAt(spec.selectionEndOffset));
    const symbol = new vscode.DocumentSymbol(spec.name, spec.detail || "", getDocumentSymbolKind(spec.kind), range, selectionRange);
    symbol.children = (spec.children || []).map((child) => documentSymbolSpecToVscode(document, child));
    return symbol;
}

function getDocumentSymbolKind(kind) {
    switch (kind) {
        case "Function":
        case "GraphFunction": return vscode.SymbolKind.Function;
        case "Namespace": return vscode.SymbolKind.Namespace;
        case "Section": return vscode.SymbolKind.Module;
        case "Variable": return vscode.SymbolKind.Variable;
        case "Property": return vscode.SymbolKind.Property;
        default: return vscode.SymbolKind.Class;
    }
}

function createSemanticTokensProvider() {
    return {
        provideDocumentSemanticTokens(document) {
            const builder = new vscode.SemanticTokensBuilder(semanticTokenLegend);
            for (const token of languageCore.getSemanticTokens(document.getText())) {
                builder.push(
                    document.positionAt(token.offset),
                    token.length,
                    semanticTokenLegend.tokenTypes.indexOf(token.type),
                    encodeTokenModifiers(token.modifiers || []));
            }
            return builder.build();
        }
    };
}

function createInlayHintsProvider(services = {}) {
    return {
        provideInlayHints(document, range) {
            if (!isDreamShaderDocument(document)) {
                return [];
            }

            const hints = [];
            for (const spec of languageCore.getInlayHintSpecs(document.getText(), createLanguageServices(document, services))) {
                const position = document.positionAt(spec.offset);
                if (range && !range.contains(position)) {
                    continue;
                }

                const hint = new vscode.InlayHint(position, spec.label, getInlayHintKind(spec.kind));
                hint.paddingRight = Boolean(spec.paddingRight);
                hints.push(hint);
            }
            return hints;
        }
    };
}

function getInlayHintKind(kind) {
    switch (kind) {
        case "Parameter": return vscode.InlayHintKind.Parameter;
        case "Type": return vscode.InlayHintKind.Type;
        default: return vscode.InlayHintKind.Parameter;
    }
}

function encodeTokenModifiers(modifiers) {
    let encoded = 0;
    for (const modifier of modifiers) {
        const index = semanticTokenLegend.tokenModifiers.indexOf(modifier);
        if (index >= 0) {
            encoded |= 1 << index;
        }
    }
    return encoded;
}

function createFoldingRangeProvider() {
    return {
        provideFoldingRanges(document) {
            return languageCore.getFoldingRanges(document.getText()).map((range) =>
                new vscode.FoldingRange(document.positionAt(range.startOffset).line, document.positionAt(range.endOffset).line));
        }
    };
}

function createDocumentLinkProvider() {
    return {
        provideDocumentLinks(document) {
            return (languageCore.parseDocument(document.getText()).imports || [])
                .map((importStatement) => {
                    const resolved = resolveImportPath(document.fileName, importStatement.path);
                    if (!resolved) {
                        return null;
                    }
                    return new vscode.DocumentLink(
                        new vscode.Range(document.positionAt(importStatement.pathOffset), document.positionAt(importStatement.pathOffset + importStatement.path.length)),
                        vscode.Uri.file(resolved));
                })
                .filter(Boolean);
        }
    };
}

function createDefinitionProvider(services = {}) {
    return {
        provideDefinition(document, position) {
            const importLocation = getImportDefinitionLocation(document, position);
            if (importLocation) {
                return importLocation;
            }
            const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_:]*/);
            if (!wordRange) {
                return undefined;
            }
            const word = document.getText(wordRange).toLowerCase();
            return (createLanguageServices(document, services).collectReachableFunctionDefinitions().get(word) || [])
                .map((definition) => new vscode.Location(vscode.Uri.file(definition.fsPath), new vscode.Range(
                    offsetToPositionFromFile(definition.fsPath, definition.nameOffset),
                    offsetToPositionFromFile(definition.fsPath, definition.nameOffset + definition.nameRangeLength))));
        }
    };
}

function getImportDefinitionLocation(document, position) {
    const offset = document.offsetAt(position);
    for (const importStatement of languageCore.parseDocument(document.getText()).imports || []) {
        if (offset < importStatement.pathOffset || offset > importStatement.pathOffset + importStatement.path.length) {
            continue;
        }
        const resolved = resolveImportPath(document.fileName, importStatement.path);
        return resolved ? new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0)) : undefined;
    }
    return undefined;
}

function offsetToPositionFromFile(filePath, offset) {
    let text = "";
    try {
        text = fs.readFileSync(filePath, "utf8");
    } catch (_error) {
        return new vscode.Position(0, 0);
    }
    const prefix = text.slice(0, offset);
    const lines = prefix.split(/\n/);
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].replace(/\r$/, "").length);
}

function createReferenceProvider(services = {}) {
    return {
        provideReferences(document, position) {
            const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_:]*/);
            if (!wordRange) {
                return [];
            }
            const word = document.getText(wordRange);
            const index = createLanguageServices(document, services).getLanguageIndex();
            const locations = [];
            for (const file of index.files || []) {
                const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "g");
                for (const match of file.text.matchAll(pattern)) {
                    const start = offsetToPosition(file.text, match.index);
                    const end = offsetToPosition(file.text, match.index + word.length);
                    locations.push(new vscode.Location(vscode.Uri.file(file.fsPath), new vscode.Range(start, end)));
                }
            }
            return locations;
        }
    };
}

function createFormattingProvider() {
    return {
        provideDocumentFormattingEdits(document, options) {
            const indent = options.insertSpaces ? " ".repeat(options.tabSize || 4) : "\t";
            const formatted = languageCore.formatDocument(document.getText(), { indent });
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
    };
}

function refreshAllLocalDiagnostics(collection, services = {}) {
    for (const document of vscode.workspace.textDocuments) {
        refreshLocalDiagnosticsForDocument(document, collection, services);
    }
}

function refreshLocalDiagnosticsForDocument(document, collection, services = {}) {
    if (document.languageId !== LANGUAGE_ID) {
        return;
    }
    const diagnostics = languageCore
        .getDiagnostics(document.getText(), document.fileName, createLanguageServices(document, services))
        .map((diagnostic) => new vscode.Diagnostic(
            new vscode.Range(document.positionAt(diagnostic.startOffset), document.positionAt(diagnostic.endOffset)),
            diagnostic.message,
            diagnostic.severity === "Error"
                ? vscode.DiagnosticSeverity.Error
                : diagnostic.severity === "Information"
                    ? vscode.DiagnosticSeverity.Information
                    : vscode.DiagnosticSeverity.Warning));
    collection.set(document.uri, diagnostics);
}

function offsetToPosition(text, offset) {
    const prefix = text.slice(0, offset);
    const lines = prefix.split(/\n/);
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].replace(/\r$/, "").length);
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
    registerLanguageProviders,
    refreshAllLocalDiagnostics,
    refreshLocalDiagnosticsForDocument,
    completionSpecToVscodeItem
};
