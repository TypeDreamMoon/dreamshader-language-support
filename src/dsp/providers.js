"use strict";

// Custom Pass pipelines (`.dsp`, DreamShader 2.1.0) in the editor.
//
// As with `.dss` (src/dss/providers.js), the meaning of a pipeline is the compiler's: the symbol index it writes after
// every compile -- for a `.dsp`, with a `pipeline` section -- and pass-keys.json, the vocabulary it exports. The text is
// read only for what neither says: where the caret is, what is inside an `hlsl` block, and -- when the index is
// missing, stale or of a version this code does not know -- where a name is declared. The questions are answered in
// queries.js; this file turns offsets into VS Code's types, keeps one scan per document version, and says once, not
// on every keystroke, when a file of the plugin is of a version it does not read.

const path = require("path");
const vscode = require("vscode");
const { findProjectRoot } = require("../project/projects");
const { scanPipeline } = require("./scanner");
const { createPassKeysReader } = require("./passKeys");
const { createPipelineIndexReader } = require("./pipelineIndex");
const queries = require("./queries");
const { DSP_LANGUAGE_ID } = require("./languageData");

/** How long the answer to "which pass-keys.json, which index" is reused before their files are looked at again. */
const REFRESH_INTERVAL_MS = 400;

const COMPLETION_KINDS = {
    keyword: vscode.CompletionItemKind.Keyword,
    property: vscode.CompletionItemKind.Property,
    enum: vscode.CompletionItemKind.EnumMember,
    variable: vscode.CompletionItemKind.Variable,
    constant: vscode.CompletionItemKind.Constant,
    function: vscode.CompletionItemKind.Function,
    snippet: vscode.CompletionItemKind.Snippet,
    type: vscode.CompletionItemKind.TypeParameter,
    class: vscode.CompletionItemKind.Class
};

const SYMBOL_KINDS = {
    property: vscode.SymbolKind.Property,
    constant: vscode.SymbolKind.Constant,
    variable: vscode.SymbolKind.Variable,
    function: vscode.SymbolKind.Function,
    namespace: vscode.SymbolKind.Namespace
};

/** The token types and modifiers queries.semanticTokens hands out: all standard, so every theme knows them. */
const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(["parameter", "variable", "function", "macro"], ["readonly", "defaultLibrary"]);

/** A provider must not throw at the editor: an answer it cannot give is no answer. */
function safely(fallback, run) {
    try {
        return run();
    } catch (error) {
        console.error("DreamShader .dsp:", error);
        return fallback;
    }
}

function registerDspLanguageFeatures(context) {
    /** projectRoot -> { keys, index } */
    const projects = new Map();
    /** A `.dsp` outside any Unreal project still gets the bundled vocabulary and the text. */
    const loose = { projectRoot: "", keys: createPassKeysReader(""), index: null };
    /** document uri -> { version, text, scan } */
    const scans = new Map();
    /** document uri -> { at, keys, lookup } */
    const sources = new Map();
    const warned = new Set();

    function servicesFor(document) {
        const projectRoot = findProjectRoot(document.fileName);
        if (!projectRoot) {
            return loose;
        }
        let services = projects.get(projectRoot);
        if (!services) {
            services = { projectRoot, keys: createPassKeysReader(projectRoot), index: createPipelineIndexReader(projectRoot) };
            projects.set(projectRoot, services);
        }
        return services;
    }

    function warnOnce(key, message) {
        if (warned.has(key)) {
            return;
        }
        warned.add(key);
        void vscode.window.showWarningMessage(message);
    }

    /** What the plugin's files say that the author should hear about once: a version this side cannot read, an engine that cannot run a pipeline. */
    function report(services, document, keys, lookup) {
        if (lookup.problem) {
            warnOnce(`index:${services.projectRoot}:${lookup.version}`,
                `DreamShader: the symbol index of ${path.basename(document.fileName)} has version ${lookup.version}, which this extension does not read; `
                + "navigation in .dsp files falls back to the text. The plugin and the DreamShaderLang extension do not match -- update the extension.");
        }
        if (keys.keys && keys.source === "project" && !keys.keys.knownVersion) {
            warnOnce(`keys:${services.projectRoot}:${keys.keys.version}`,
                `DreamShader: ${keys.path} has version ${keys.keys.version}, which this extension does not know; completion reads what it can of it. `
                + "The plugin and the DreamShaderLang extension do not match -- update the extension.");
        }
        if (keys.keys && keys.source === "project" && !keys.keys.supported) {
            warnOnce(`unsupported:${services.projectRoot}`,
                `DreamShader: ${keys.keys.unsupportedReason || "this engine cannot run Custom Pass pipelines."} A .dsp still parses and binds here; nothing runs it.`);
        }
    }

    function contextFor(document) {
        const key = document.uri.toString();
        let scanned = scans.get(key);
        if (!scanned || scanned.version !== document.version) {
            const text = document.getText();
            scanned = { version: document.version, text, scan: scanPipeline(text) };
            scans.set(key, scanned);
        }

        const now = Date.now();
        let found = sources.get(key);
        if (!found || now - found.at > REFRESH_INTERVAL_MS) {
            const services = servicesFor(document);
            const keys = services.keys.get();
            const lookup = services.index ? services.index.lookup(document.fileName) : { index: null, path: "", problem: "" };
            found = { at: now, keys, lookup };
            sources.set(key, found);
            report(services, document, keys, lookup);
        }
        return queries.createContext(scanned.text, scanned.scan, found.keys.keys, found.lookup.index, found.keys.source);
    }

    const toRange = (document, start, end) => new vscode.Range(document.positionAt(start), document.positionAt(Math.max(start, end)));

    /** The range a dotted value (`PostProcess.AfterTonemap`) replaces: the dots are not part of a word to VS Code. */
    function dottedRange(document, position) {
        const line = document.lineAt(position.line).text;
        let start = position.character;
        while (start > 0 && /[A-Za-z0-9_.]/.test(line[start - 1])) {
            start -= 1;
        }
        let end = position.character;
        while (end < line.length && /[A-Za-z0-9_.]/.test(line[end])) {
            end += 1;
        }
        return new vscode.Range(position.line, start, position.line, end);
    }

    const selector = { language: DSP_LANGUAGE_ID };

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            scans.delete(document.uri.toString());
            sources.delete(document.uri.toString());
        }),

        vscode.languages.registerCompletionItemProvider(selector, {
            provideCompletionItems(document, position) {
                return safely([], () => {
                    const entries = queries.completionsAt(contextFor(document), document.offsetAt(position));
                    return entries.map((entry) => {
                        const item = new vscode.CompletionItem(entry.label, COMPLETION_KINDS[entry.kind] || vscode.CompletionItemKind.Text);
                        item.detail = entry.detail;
                        if (entry.documentation) {
                            item.documentation = new vscode.MarkdownString(entry.documentation);
                        }
                        if (entry.insertText) {
                            item.insertText = entry.snippet ? new vscode.SnippetString(entry.insertText) : entry.insertText;
                        }
                        if (entry.sortText) {
                            item.sortText = entry.sortText;
                        }
                        if (entry.label.includes(".")) {
                            item.range = dottedRange(document, position);
                        }
                        return item;
                    });
                });
            }
        }, ".", "=", "@", "#", "(", "|", ":"),

        vscode.languages.registerHoverProvider(selector, {
            provideHover(document, position) {
                return safely(null, () => {
                    const hover = queries.hoverAt(contextFor(document), document.offsetAt(position));
                    return hover ? new vscode.Hover(new vscode.MarkdownString(hover.markdown), toRange(document, hover.start, hover.end)) : null;
                });
            }
        }),

        vscode.languages.registerDefinitionProvider(selector, {
            provideDefinition(document, position) {
                return safely([], () => queries.definitionAt(contextFor(document), document.offsetAt(position))
                    .map((target) => new vscode.Location(document.uri, toRange(document, target.start, target.end))));
            }
        }),

        vscode.languages.registerDocumentSymbolProvider(selector, {
            provideDocumentSymbols(document) {
                return safely([], () => {
                    const toSymbol = (entry) => {
                        const selection = toRange(document, entry.selectionStart, entry.selectionEnd);
                        // DocumentSymbol refuses a selection outside its range; the scan should never produce one, and
                        // this is the guarantee that it cannot reach the editor if it did.
                        const range = toRange(document, Math.min(entry.start, entry.selectionStart), Math.max(entry.end, entry.selectionEnd));
                        const symbol = new vscode.DocumentSymbol(entry.name, entry.detail || "", SYMBOL_KINDS[entry.kind] || vscode.SymbolKind.Variable, range, selection);
                        symbol.children = entry.children.map(toSymbol);
                        return symbol;
                    };
                    return queries.documentSymbols(contextFor(document)).map(toSymbol);
                });
            }
        }, { label: "DreamShader Pipeline" }),

        vscode.languages.registerDocumentSemanticTokensProvider(selector, {
            provideDocumentSemanticTokens(document) {
                return safely(undefined, () => {
                    const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
                    for (const token of queries.semanticTokens(contextFor(document))) {
                        builder.push(toRange(document, token.start, token.end), token.type, token.modifiers);
                    }
                    return builder.build();
                });
            }
        }, SEMANTIC_LEGEND)
    );
}

module.exports = {
    registerDspLanguageFeatures
};
