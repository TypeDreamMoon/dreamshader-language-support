"use strict";

// DreamShader 2.0 (`.dss`, `.dsi`) in the editor.
//
// The 1.x language is served by a language server that reads the text itself (src/server). 2.0 is not,
// and that is a decision, not a shortcut: 2.0 is HLSL-shaped, with overloads, implicit conversions and a
// binder that knows the engine's node classes -- a second implementation of that in JavaScript would be
// wrong in exactly the places that matter. So this side asks the compiler. Navigation, hover, outline
// and rename read the symbol index the plugin writes after every compile (indexStore.js, queries.js);
// completion of `UE.` and `Substrate.` reads the catalog the plugin exports (catalog.js). What is left
// here is turning those answers into VS Code's types.
//
// The cost is that answers are as fresh as the last compile -- and the plugin compiles on save. A span
// that no longer matches the text is dropped rather than shown, and a rename refuses outright.

const fs = require("fs");
const vscode = require("vscode");
const { findProjectRoot } = require("../project/projects");
const { createIndexStore, getIndexDirectory, pathKey } = require("./indexStore");
const { createCatalogReader, findExpression, describeExpression } = require("./catalog");
const queries = require("./queries");
const { DSS_LANGUAGE_ID, KEYWORDS, TYPES, DIRECTIVES, PRAGMAS, SUBSTRATE_MODES, BACKENDS } = require("./languageData");

const REFRESH_INTERVAL_MS = 400;

const SYMBOL_KINDS = {
    struct: vscode.SymbolKind.Struct,
    field: vscode.SymbolKind.Field,
    uniform: vscode.SymbolKind.Property,
    constant: vscode.SymbolKind.Constant,
    function: vscode.SymbolKind.Function,
    parameter: vscode.SymbolKind.Variable
};

const COMPLETION_KINDS = {
    struct: vscode.CompletionItemKind.Struct,
    uniform: vscode.CompletionItemKind.Property,
    constant: vscode.CompletionItemKind.Constant,
    function: vscode.CompletionItemKind.Function,
    parameter: vscode.CompletionItemKind.Variable
};

function registerDssLanguageFeatures(context) {
    /** projectRoot -> { store, catalog, refreshedAt } */
    const projects = new Map();

    function servicesFor(document) {
        const projectRoot = findProjectRoot(document.fileName);
        if (!projectRoot) {
            return null;
        }
        let services = projects.get(projectRoot);
        if (!services) {
            services = { store: createIndexStore(projectRoot), catalog: createCatalogReader(projectRoot), refreshedAt: 0 };
            projects.set(projectRoot, services);
        }
        const now = Date.now();
        if (now - services.refreshedAt > REFRESH_INTERVAL_MS) {
            services.store.refresh();
            services.refreshedAt = now;
        }
        return services;
    }

    function indicesFor(document) {
        const services = servicesFor(document);
        return services ? services.store.findForSource(document.fileName) : [];
    }

    /** A file's lines as the editor has them, which is what a span has to be checked against. */
    function readLines(file) {
        const key = pathKey(file);
        const open = vscode.workspace.textDocuments.find((entry) => pathKey(entry.fileName) === key);
        if (open) {
            return open.getText().split(/\r\n|\r|\n/);
        }
        try {
            return fs.readFileSync(file, "utf8").split(/\r\n|\r|\n/);
        } catch (_error) {
            return [];
        }
    }

    function wordAtPosition(document, position) {
        return queries.wordAt(document.lineAt(position.line).text, position.character);
    }

    function toRange(span, length) {
        const start = new vscode.Position(Math.max(span.line - 1, 0), Math.max(span.column - 1, 0));
        return new vscode.Range(start, start.translate(0, Math.max(length, 1)));
    }

    function toLocation(span, length) {
        return new vscode.Location(vscode.Uri.file(span.file), toRange(span, length));
    }

    // A watcher per workspace rather than per project: the index folder of every project the workspace
    // holds matches the one pattern, and a change only has to make the next question re-read.
    const watcher = vscode.workspace.createFileSystemWatcher("**/Saved/DreamShader/Index/**/*.index.json");
    const invalidate = () => {
        for (const services of projects.values()) {
            services.refreshedAt = 0;
        }
    };
    watcher.onDidCreate(invalidate);
    watcher.onDidChange(invalidate);
    watcher.onDidDelete(invalidate);

    const selector = { language: DSS_LANGUAGE_ID };

    context.subscriptions.push(
        watcher,

        vscode.languages.registerDefinitionProvider(selector, {
            provideDefinition(document, position) {
                const word = wordAtPosition(document, position);
                if (!word) {
                    return null;
                }
                return queries.findDeclarations(indicesFor(document), document.fileName, position, word)
                    .map((declaration) => toLocation(declaration, word.word.length));
            }
        }),

        vscode.languages.registerReferenceProvider(selector, {
            provideReferences(document, position, referenceContext) {
                const word = wordAtPosition(document, position);
                if (!word) {
                    return [];
                }
                return queries.findReferences(indicesFor(document), document.fileName, position, word, readLines, referenceContext.includeDeclaration)
                    .map((span) => toLocation(span, word.word.length));
            }
        }),

        vscode.languages.registerHoverProvider(selector, {
            provideHover(document, position) {
                const line = document.lineAt(position.line).text;
                const word = queries.wordAt(line, position.character);
                if (!word) {
                    return null;
                }
                const range = new vscode.Range(position.line, word.start, position.line, word.end);

                const directive = /^\s*\/\/\//.test(line) && line[word.start - 1] === "@"
                    ? DIRECTIVES.find((entry) => entry.name === word.word)
                    : null;
                if (directive) {
                    return new vscode.Hover(new vscode.MarkdownString(`\`/// ${directive.detail}\`\n\n${directive.doc}`), range);
                }

                if (word.namespace) {
                    const services = servicesFor(document);
                    const expression = services ? findExpression(services.catalog.get(), word.namespace, word.word) : null;
                    return expression ? new vscode.Hover(new vscode.MarkdownString(describeExpression(expression)), range) : null;
                }

                const declarations = queries.findDeclarations(indicesFor(document), document.fileName, position, word);
                if (declarations.length === 0) {
                    return null;
                }
                return new vscode.Hover(declarations.map((declaration) => new vscode.MarkdownString(queries.describeDeclaration(declaration))), range);
            }
        }),

        vscode.languages.registerDocumentSymbolProvider(selector, {
            provideDocumentSymbols(document) {
                const indices = indicesFor(document);
                if (indices.length === 0) {
                    return [];
                }
                const lastLine = Math.max(document.lineCount - 1, 0);
                const toSymbol = (entry) => {
                    const selection = toRange(entry, entry.name.length);
                    const clamped = selection.start.line > lastLine
                        ? new vscode.Range(lastLine, 0, lastLine, 0)
                        : selection;
                    const symbol = new vscode.DocumentSymbol(
                        entry.name,
                        entry.kind === "function" ? (entry.role || "") : entry.type,
                        SYMBOL_KINDS[entry.kind] || vscode.SymbolKind.Variable,
                        clamped,
                        clamped);
                    symbol.children = entry.children.map(toSymbol);
                    return symbol;
                };
                return queries.documentSymbols(indices[0], document.fileName).map(toSymbol);
            }
        }),

        vscode.languages.registerRenameProvider(selector, {
            prepareRename(document, position) {
                const word = wordAtPosition(document, position);
                if (!word || word.namespace) {
                    throw new Error("There is nothing here the compiler's index can rename.");
                }
                const plan = queries.planRename(indicesFor(document), document.fileName, position, word, `${word.word}_`, readLines);
                if (plan.error && !/already declared/.test(plan.error)) {
                    throw new Error(plan.error);
                }
                return new vscode.Range(position.line, word.start, position.line, word.end);
            },
            provideRenameEdits(document, position, newName) {
                const word = wordAtPosition(document, position);
                const plan = queries.planRename(indicesFor(document), document.fileName, position, word, newName, readLines);
                if (plan.error) {
                    throw new Error(plan.error);
                }
                const edit = new vscode.WorkspaceEdit();
                for (const entry of plan.edits) {
                    edit.replace(vscode.Uri.file(entry.file), toRange(entry, entry.length), entry.newText);
                }
                return edit;
            }
        }),

        vscode.languages.registerSignatureHelpProvider(selector, {
            provideSignatureHelp(document, position) {
                const before = document.getText(new vscode.Range(new vscode.Position(Math.max(position.line - 20, 0), 0), position));
                const call = queries.callAt(before);
                if (!call) {
                    return null;
                }

                const help = new vscode.SignatureHelp();
                if (call.member) {
                    const services = servicesFor(document);
                    const expression = services && (call.owner === "UE" || call.owner === "Substrate")
                        ? findExpression(services.catalog.get(), call.owner, call.name)
                        : null;
                    if (!expression) {
                        return null;
                    }
                    const parameters = expression.inputs.map((pin) => `${pin.name}: ${pin.type}`);
                    const signature = new vscode.SignatureInformation(`${expression.namespace}.${expression.displayName}(${parameters.join(", ")})`);
                    signature.parameters = parameters.map((label) => new vscode.ParameterInformation(label));
                    signature.documentation = new vscode.MarkdownString(expression.positional.length > 0
                        ? `Positional order: ${expression.positional.join(", ")}. Every argument can be given by name.`
                        : "Arguments are given by name: `Pin = value`.");
                    help.signatures = [signature];
                    help.activeSignature = 0;
                    help.activeParameter = expression.positional.length > 0 ? Math.min(call.argument, parameters.length - 1) : 0;
                    return help;
                }

                for (const index of indicesFor(document)) {
                    const declaration = index.declarations.find((entry) => entry.kind === "function" && entry.name === call.name);
                    if (!declaration) {
                        continue;
                    }
                    const parameters = queries.parametersOf(index, declaration);
                    const signature = new vscode.SignatureInformation(declaration.signature || declaration.name);
                    signature.documentation = new vscode.MarkdownString(declaration.doc || "");
                    signature.parameters = parameters.map((parameter) =>
                        new vscode.ParameterInformation(parameter.name, new vscode.MarkdownString(parameter.doc || "")));
                    help.signatures = [signature];
                    help.activeSignature = 0;
                    help.activeParameter = Math.min(call.argument, Math.max(parameters.length - 1, 0));
                    return help;
                }
                return null;
            }
        }, "(", ","),

        vscode.languages.registerCompletionItemProvider(selector, {
            provideCompletionItems(document, position) {
                const line = document.lineAt(position.line).text;
                const before = line.slice(0, position.character);
                const services = servicesFor(document);
                const catalog = services ? services.catalog.get() : null;
                const items = [];
                const add = (label, kind, detail, documentation, insertText) => {
                    const item = new vscode.CompletionItem(label, kind);
                    item.detail = detail || "";
                    if (documentation) {
                        item.documentation = new vscode.MarkdownString(documentation);
                    }
                    if (insertText) {
                        item.insertText = insertText;
                    }
                    items.push(item);
                    return item;
                };

                // ----- `/// @`
                if (/^\s*\/\/\/.*@[A-Za-z]*$/.test(before)) {
                    for (const directive of DIRECTIVES) {
                        add(directive.name, vscode.CompletionItemKind.Keyword, directive.detail, directive.doc);
                    }
                    return items;
                }

                // ----- `#`
                if (/^\s*#\s*[A-Za-z]*$/.test(before)) {
                    for (const pragma of PRAGMAS) {
                        add(`pragma ${pragma.name}`, vscode.CompletionItemKind.Keyword, "#pragma", pragma.doc, new vscode.SnippetString(pragma.snippet));
                    }
                    add("include", vscode.CompletionItemKind.Keyword, "#include", "Another DreamShader source: a `.dsh` header.", new vscode.SnippetString("include \"${1:Shared/Common.dsh}\""));
                    return items;
                }

                // ----- inside `#pragma material(`
                if (/^\s*#\s*pragma\s+material\s*\(/.test(before)) {
                    const value = /\b(Backend|Substrate)\s*=\s*[A-Za-z]*$/.exec(before);
                    if (value) {
                        for (const name of value[1] === "Backend" ? BACKENDS : SUBSTRATE_MODES) {
                            add(name, vscode.CompletionItemKind.EnumMember, value[1]);
                        }
                        return items;
                    }
                    for (const key of ["ShadingModel", "BlendMode", "Domain", "TwoSided", "Backend", "Substrate"]) {
                        add(key, vscode.CompletionItemKind.Property, "#pragma material", "", new vscode.SnippetString(`${key} = $0`));
                    }
                    return items;
                }

                // ----- `UE.` / `Substrate.`
                const namespace = /\b(UE|Substrate)\s*\.\s*[A-Za-z_0-9]*$/.exec(before);
                if (namespace) {
                    if (!catalog) {
                        return items;
                    }
                    for (const expression of catalog.expressions) {
                        if (expression.namespace !== namespace[1]) {
                            continue;
                        }
                        const item = add(
                            expression.displayName,
                            vscode.CompletionItemKind.Function,
                            expression.className,
                            describeExpression(expression),
                            new vscode.SnippetString(`${expression.displayName}($0)`));
                        item.filterText = [expression.displayName, expression.shortName, ...expression.aliases].join(" ");
                        item.command = { command: "editor.action.triggerParameterHints", title: "" };
                    }
                    return items;
                }

                // ----- an argument name inside `UE.X(` / `Substrate.X(`
                const callText = document.getText(new vscode.Range(new vscode.Position(Math.max(position.line - 20, 0), 0), position));
                const call = queries.callAt(callText);
                if (call && call.member && catalog && /(^|[(,]\s*)[A-Za-z_]*$/.test(before)) {
                    const expression = (call.owner === "UE" || call.owner === "Substrate")
                        ? findExpression(catalog, call.owner, call.name)
                        : null;
                    if (expression) {
                        for (const pin of expression.inputs) {
                            add(pin.name, vscode.CompletionItemKind.Field, `pin: ${pin.type}${pin.required ? " (required)" : ""}`, "", new vscode.SnippetString(`${pin.name} = $0`));
                        }
                        for (const property of expression.properties) {
                            const documentation = property.enumValues.length > 0 ? `One of: ${property.enumValues.join(", ")}` : "";
                            add(property.name, vscode.CompletionItemKind.Property, `property: ${property.type}${property.default ? ` = ${property.default}` : ""}`, documentation, new vscode.SnippetString(`${property.name} = $0`));
                        }
                        for (const entry of expression.virtualArguments) {
                            add(entry.name, vscode.CompletionItemKind.Field, `sugar: ${entry.type}`, `Converted by the compiler through ${entry.via}.`, new vscode.SnippetString(`${entry.name} = $0`));
                        }
                    }
                }

                // ----- `m.` on a `material` parameter
                const member = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z_0-9]*$/.exec(before);
                if (member) {
                    const indices = indicesFor(document);
                    const owner = queries.findDeclarations(indices, document.fileName, position, { word: member[1], member: false, namespace: "" })[0];
                    if (owner && owner.type === "material" && catalog) {
                        for (const attribute of catalog.materialAttributes) {
                            add(attribute.name, vscode.CompletionItemKind.Field, attribute.type);
                        }
                    } else if (owner && indices.length > 0) {
                        for (const field of indices[0].declarations.filter((entry) => entry.kind === "field" && entry.container === owner.type)) {
                            add(field.name, vscode.CompletionItemKind.Field, field.type, field.doc);
                        }
                    }
                    return items;
                }

                // ----- everywhere else: the words, the namespaces, what the file can see
                for (const keyword of KEYWORDS) {
                    add(keyword, vscode.CompletionItemKind.Keyword);
                }
                for (const type of TYPES) {
                    add(type, vscode.CompletionItemKind.TypeParameter);
                }
                add("UE", vscode.CompletionItemKind.Module, "engine material expressions");
                add("Substrate", vscode.CompletionItemKind.Module, "Substrate nodes");

                const indices = indicesFor(document);
                for (const declaration of queries.completionDeclarations(indices)) {
                    add(declaration.name, COMPLETION_KINDS[declaration.kind] || vscode.CompletionItemKind.Variable, declaration.signature || declaration.type, declaration.doc);
                }
                if (indices.length > 0) {
                    const scope = queries.enclosingFunction(indices[0], pathKey(document.fileName), position.line + 1);
                    if (scope) {
                        for (const parameter of indices[0].declarations.filter((entry) => entry.kind === "parameter" && entry.container === scope.name)) {
                            add(parameter.name, vscode.CompletionItemKind.Variable, parameter.type, parameter.doc);
                        }
                    }
                }
                return items;
            }
        }, ".", "@", "#", "(", ",")
    );

    return {
        /** For the status line and the tests: where this document's answers would come from. */
        describe(document) {
            const services = servicesFor(document);
            return services
                ? { indexDirectory: getIndexDirectory(services.store.projectRoot), indices: services.store.findForSource(document.fileName).length, hasCatalog: Boolean(services.catalog.get()) }
                : { indexDirectory: "", indices: 0, hasCatalog: false };
        }
    };
}

module.exports = {
    registerDssLanguageFeatures
};
