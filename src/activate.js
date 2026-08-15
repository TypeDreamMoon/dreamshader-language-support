"use strict";

// DreamShaderLang: the client half.
//
// What is left here after the language moved into `src/server/` is everything that is not a question
// about the text: the Bridge diagnostics the engine reported, the tree and status bar that show
// them, the preview, the package store, and the commands. None of it has a protocol spelling, and
// inventing one would have meant a second protocol carrying webviews.
//
// The two diagnostic collections stay separate and stay where they always were on the page: this
// process owns `dreamshader`, which is what a recompile said; the server owns `dreamshader-local`,
// which is what the source says. One owner would let either result wipe the other depending on
// which finished last -- a hazard that the split into two processes does not change and does not
// create.

const vscode = require("vscode");
const { BRIDGE_DIAGNOSTIC_COLLECTION_NAME } = require("./languageData");
const { createDebouncedDisposable } = require("./common/debounce");
const { createEmptyBridgeDiagnosticsState, refreshBridgeDiagnostics } = require("./bridge/diagnostics");
const { initializeBridgeDatabaseSupport } = require("./bridge/database");
const { createBridgeDiagnosticsTreeProvider } = require("./vscode/views/bridgeDiagnostics");
const { updateStatusBar } = require("./vscode/statusBar");
const { registerCommands } = require("./vscode/commands");
const { installVscodeHost } = require("./vscode/host");
const { createLanguageClient } = require("./vscode/languageClient");
const { collectKnownProjectRoots, invalidateProjectRootCache } = require("./project/projects");

function activate(context) {
    // First, before anything asks for a project root: the shared language modules resolve one
    // through the host, and this process has to say which one it is.
    installVscodeHost();

    const bridgeDiagnostics = vscode.languages.createDiagnosticCollection(BRIDGE_DIAGNOSTIC_COLLECTION_NAME);
    const bridgeState = createEmptyBridgeDiagnosticsState();
    const bridgeTreeProvider = createBridgeDiagnosticsTreeProvider(bridgeState);
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    const language = createLanguageClient(context);

    const refreshUi = () => {
        bridgeTreeProvider.refresh();
        updateStatusBar(statusBar, bridgeState);
    };
    const refreshBridge = async () => {
        refreshBridgeDiagnostics(bridgeDiagnostics, bridgeState, vscode.window.activeTextEditor?.document?.fileName || "");
        refreshUi();
        // The same files feed the manifests the server reads for completion and for the local
        // diagnostics, and it has no watcher of its own on them -- see the note in lspProtocol.js.
        language.notifyBridgeChanged();
    };
    const debouncedBridgeRefresh = createDebouncedDisposable(() => void refreshBridge(), 200);
    const bridgeWatcherState = { rootsKey: "", watchers: [] };
    const refreshBridgeWatchers = () => updateBridgeWatchers(context, bridgeWatcherState, debouncedBridgeRefresh);

    context.subscriptions.push(
        bridgeDiagnostics,
        bridgeTreeProvider,
        statusBar,
        debouncedBridgeRefresh,
        { dispose: () => void language.stop() },
        vscode.window.createTreeView("dreamshader.bridgeDiagnostics", {
            treeDataProvider: bridgeTreeProvider,
            showCollapseAll: true
        })
    );

    registerCommands(context, { refreshBridge });

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(() => {
            refreshBridgeWatchers();
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeTextDocument(() => {
            refreshUi();
        }),
        vscode.workspace.onDidCloseTextDocument(() => {
            refreshBridgeWatchers();
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            // The server keeps its own copy of this cache and clears it from its own
            // `didChangeWorkspaceFolders`; this one is for the commands that run on this side.
            invalidateProjectRootCache();
            refreshBridgeWatchers();
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("dreamshader")) {
                return;
            }
            invalidateProjectRootCache();
            void refreshBridge();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => {
            refreshBridgeWatchers();
            void refreshBridge();
            refreshUi();
        })
    );

    refreshBridgeWatchers();
    void refreshBridge();
    refreshUi();

    // sql.js's WASM module loads asynchronously; refresh once it's ready so the diagnostics view
    // picks up bridge.db instead of the (now deprecated) JSON Bridge files as soon as possible,
    // rather than waiting for the next unrelated trigger. The server loads its own copy for the
    // manifests behind completion, and does the same thing when it lands.
    void initializeBridgeDatabaseSupport().then((SQL) => {
        if (SQL) {
            void refreshBridge();
        }
    });

    // Not awaited: a server that failed to start should cost completion and the live diagnostics,
    // not the recompile button or the preview. Attaching the handler here is also what keeps a
    // failure from surfacing as an unhandled rejection when nobody holds the promise below.
    const ready = language.start();
    ready.catch((error) => {
        void vscode.window.showErrorMessage(
            `DreamShaderLang: the language server did not start (${String(error)}), so completion, hover and live diagnostics are off.`);
    });

    // Returned so that a caller who does need the language features to exist can wait for them.
    // The integration tests are that caller: they ask the editor to run a completion, and before
    // the client has finished starting there is no provider registered to answer.
    return { ready };
}

function updateBridgeWatchers(context, state, debouncedBridgeRefresh) {
    const roots = collectKnownProjectRoots(vscode.window.activeTextEditor?.document?.fileName || "");
    const rootsKey = roots.join("|");
    if (state.rootsKey === rootsKey && state.watchers.length > 0) {
        return;
    }

    for (const watcher of state.watchers) {
        watcher.dispose();
    }
    state.watchers = [];
    state.rootsKey = rootsKey;

    const registerWatcher = (watcher) => {
        watcher.onDidCreate(() => debouncedBridgeRefresh.run());
        watcher.onDidChange(() => debouncedBridgeRefresh.run());
        watcher.onDidDelete(() => debouncedBridgeRefresh.run());
        state.watchers.push(watcher);
        context.subscriptions.push(watcher);
    };

    registerWatcher(vscode.workspace.createFileSystemWatcher("**/Saved/DreamShader/Bridge/diagnostics.json"));
    registerWatcher(vscode.workspace.createFileSystemWatcher("**/Saved/DreamShader/Bridge/bridge.db"));
    for (const root of roots) {
        registerWatcher(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(root), "Saved/DreamShader/Bridge/diagnostics.json")));
        registerWatcher(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(root), "Saved/DreamShader/Bridge/bridge.db")));
        // Deleting a source file is the one edit that changes which bridge diagnostics still apply
        // without touching a bridge file: the plugin never rewrites the payload for a file it can no
        // longer compile, so the entry stays until something re-reads it. Closing the document
        // already triggers that when the file was open in the editor, which is why the stale
        // diagnostics only survive *sometimes* -- deleted from outside the editor, or never opened,
        // nothing fires. Watching creates as well so restoring the file brings its diagnostics back.
        // `**/DShader/**` rather than `DShader/**` because plugins carry source roots of their own.
        const sources = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(root), "**/DShader/**/*.{dsm,dsf,dsh}"), false, true, false);
        registerWatcher(sources);
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
