"use strict";

// The DreamShaderLang language server.
//
// Everything the language itself can answer lives here: the fourteen providers and the local
// diagnostics, plus the cross-file index and the Bridge manifests they read. What stayed on the
// client is everything that is not a question about the text -- the preview, the package store, the
// Bridge diagnostics tree, the status bar, the commands. The protocol has nothing to say about any
// of those, and pretending otherwise would have meant inventing a second protocol to carry them.
//
// The two diagnostic owners stay separate for the reason they always were: this publishes what it
// derives from the source, and the client publishes what the engine reported. One owner would let a
// recompile result wipe the live diagnostics, or the reverse, depending on which finished last.

const {
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
    ProposedFeatures,
    TextDocumentSyncKind,
    TextDocuments,
    createConnection
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");

const { setHost } = require("../host");
const { LANGUAGE_ID, SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } = require("../languageData");
const { invalidateProjectRootCache } = require("../project/projects");
const { createLanguageIndexCache } = require("./indexCache");
const { toFsPath } = require("./documents");
const providers = require("./providers");
const { initializeBridgeDatabaseSupport } = require("../bridge/database");
const { BRIDGE_CHANGED_NOTIFICATION, SETTINGS_SECTION } = require("../lspProtocol");

const DIAGNOSTIC_DEBOUNCE_MS = 150;

/**
 * The alphabet is in here because a member completion has to keep offering as the author types the
 * member name, and DreamShaderLang has no character that reliably starts one. It is the reason the
 * parse cache in `language/parser.js` exists: this fires on every keystroke.
 */
const COMPLETION_TRIGGERS = [".", "\"", "/", ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_")];

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const languageIndexCache = createLanguageIndexCache();
const services = { languageIndexCache };

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDidChangeWatchedFilesCapability = false;

/**
 * A synchronous snapshot of the `dreamshader` settings.
 *
 * `findProjectRoot` sits under completion and cannot await a `workspace/configuration` round trip,
 * so the values are pulled when the client says they changed and read from here in between.
 */
let settings = {};
let workspaceFolderPaths = [];

setHost({
    getSetting: (name, fallback) => (settings?.[name] === undefined ? fallback : settings[name]),
    getWorkspaceFolderPaths: () => workspaceFolderPaths
    // `getActiveDocumentPath` and `getOpenDocumentPaths` stay empty: their only callers are the
    // commands, which run on the client.
});

const debounceTimers = new Map();
const published = new Set();

connection.onInitialize((params) => {
    const capabilities = params.capabilities;
    hasConfigurationCapability = Boolean(capabilities.workspace?.configuration);
    hasWorkspaceFolderCapability = Boolean(capabilities.workspace?.workspaceFolders);
    hasDidChangeWatchedFilesCapability = Boolean(capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration);
    setWorkspaceFolders(params.workspaceFolders);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: { triggerCharacters: COMPLETION_TRIGGERS },
            hoverProvider: true,
            signatureHelpProvider: { triggerCharacters: ["(", ","] },
            documentSymbolProvider: true,
            documentFormattingProvider: true,
            foldingRangeProvider: true,
            documentLinkProvider: { resolveProvider: false },
            definitionProvider: true,
            referencesProvider: true,
            colorProvider: true,
            inlayHintProvider: true,
            codeLensProvider: { resolveProvider: false },
            semanticTokensProvider: {
                legend: {
                    tokenTypes: SEMANTIC_TOKEN_TYPES,
                    tokenModifiers: SEMANTIC_TOKEN_MODIFIERS
                },
                full: true
            },
            workspace: hasWorkspaceFolderCapability
                ? { workspaceFolders: { supported: true, changeNotifications: true } }
                : undefined
        }
    };
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        connection.client
            .register(DidChangeConfigurationNotification.type, undefined)
            .catch((error) => connection.console.warn(`could not watch settings: ${String(error)}`));
        void refreshSettings();
    }

    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(async () => {
            setWorkspaceFolders(await connection.workspace.getWorkspaceFolders());
            languageIndexCache.invalidateAll();
            refreshAllDiagnostics();
        });
    }

    // An import edited outside the editor still changes what a document means, and the index caches
    // dependency mtimes precisely so that it can notice -- but it only re-checks when asked.
    //
    // Guarded and caught, both for the same reason: a client that cannot register this is a client
    // that gives us slightly staler imports, not a reason to stop serving. Uncaught, the rejected
    // registration would take the whole server process down with it.
    if (hasDidChangeWatchedFilesCapability) {
        connection.client
            .register(DidChangeWatchedFilesNotification.type, {
                watchers: [{ globPattern: "**/*.{dsh,dsf,dsm}" }]
            })
            .catch((error) => connection.console.warn(`could not watch source files: ${String(error)}`));
    }
});

connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) {
        const fsPath = toFsPath(change.uri);
        if (fsPath) {
            languageIndexCache.invalidatePath(fsPath);
        }
    }
    refreshAllDiagnostics();
});

connection.onDidChangeConfiguration(() => {
    void refreshSettings().then(() => {
        // The configured project root feeds every path lookup below it, so both caches that were
        // built on the old answer have to go.
        invalidateProjectRootCache();
        languageIndexCache.invalidateAll();
        refreshAllDiagnostics();
    });
});

// ------------------------------------------------------------- language features

/** Every handler resolves the document first; a request can outlive the buffer it names. */
function withDocument(handler, fallback) {
    return (params, ...rest) => {
        const document = documents.get(params.textDocument.uri);
        return document ? handler(document, params, ...rest) : fallback;
    };
}

connection.onCompletion(withDocument(
    (document, params) => providers.completion(document, params.position, services), []));

connection.onHover(withDocument(
    (document, params) => providers.hover(document, params.position, services), null));

connection.onSignatureHelp(withDocument(
    (document, params) => providers.signatureHelp(document, params.position, services), null));

connection.onDocumentSymbol(withDocument(
    (document) => providers.documentSymbols(document), []));

connection.onDocumentFormatting(withDocument(
    (document, params) => providers.formatting(document, params.options), []));

connection.onFoldingRanges(withDocument(
    (document) => providers.foldingRanges(document), []));

connection.onDocumentLinks(withDocument(
    (document) => providers.documentLinks(document), []));

connection.onDefinition(withDocument(
    (document, params) => providers.definition(document, params.position, services), null));

connection.onReferences(withDocument(
    (document, params) => providers.references(document, params.position, services), []));

connection.onDocumentColor(withDocument(
    (document) => providers.documentColors(document), []));

connection.onColorPresentation(withDocument(
    (document, params) => providers.colorPresentations(document, params.color, params.range), []));

connection.languages.inlayHint.on(withDocument(
    (document, params) => providers.inlayHints(document, params.range, services), []));

connection.onCodeLens(withDocument(
    (document) => providers.codeLenses(document, settings.enableCodeLens !== false), []));

connection.languages.semanticTokens.on(withDocument(
    (document) => providers.semanticTokens(document), { data: [] }));

// ------------------------------------------------------------------- diagnostics

documents.onDidChangeContent((event) => {
    languageIndexCache.invalidateDocument(event.document.uri);
    schedule(event.document, published.has(event.document.uri) ? DIAGNOSTIC_DEBOUNCE_MS : 0);
});

documents.onDidClose((event) => {
    const timer = debounceTimers.get(event.document.uri);
    if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(event.document.uri);
    }
    published.delete(event.document.uri);
    languageIndexCache.invalidateDocument(event.document.uri);
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function schedule(document, delay) {
    const existing = debounceTimers.get(document.uri);
    if (existing) {
        clearTimeout(existing);
    }

    if (delay === 0) {
        debounceTimers.delete(document.uri);
        validate(document);
        return;
    }

    debounceTimers.set(document.uri, setTimeout(() => {
        debounceTimers.delete(document.uri);
        validate(document);
    }, delay));
}

function validate(document) {
    if (document.languageId !== LANGUAGE_ID) {
        return;
    }
    published.add(document.uri);
    void connection.sendDiagnostics({
        uri: document.uri,
        diagnostics: providers.diagnostics(document, services)
    });
}

function refreshAllDiagnostics() {
    for (const document of documents.all()) {
        schedule(document, 0);
    }
}

// --------------------------------------------------------------- custom messages

connection.onNotification(BRIDGE_CHANGED_NOTIFICATION, () => {
    // The manifests are memoised on a file-version tag, so they re-read themselves; the index is
    // memoised on document version and dependency mtimes, which a Bridge write does not move.
    languageIndexCache.invalidateAll();
    refreshAllDiagnostics();
});

// ------------------------------------------------------------------------- boot

function setWorkspaceFolders(folders) {
    workspaceFolderPaths = (folders || [])
        .map((folder) => toFsPath(folder.uri))
        .filter(Boolean);
    invalidateProjectRootCache();
}

async function refreshSettings() {
    if (!hasConfigurationCapability) {
        return;
    }
    settings = (await connection.workspace.getConfiguration(SETTINGS_SECTION)) || {};
}

documents.listen(connection);
connection.listen();

// sql.js's WASM module loads asynchronously, and the manifests behind completion and the local
// diagnostics prefer bridge.db over the deprecated JSON files. Re-run once it is ready rather than
// waiting for the next unrelated trigger to notice the better source.
void initializeBridgeDatabaseSupport().then((SQL) => {
    if (SQL) {
        languageIndexCache.invalidateAll();
        refreshAllDiagnostics();
    }
});
