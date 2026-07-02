"use strict";

const vscode = require("vscode");
const {
    BRIDGE_DIAGNOSTIC_COLLECTION_NAME,
    LOCAL_DIAGNOSTIC_COLLECTION_NAME
} = require("./languageData");
const { createDebouncedDisposable } = require("./common/debounce");
const { createEmptyBridgeDiagnosticsState, refreshBridgeDiagnostics } = require("./bridge/diagnostics");
const { initializeBridgeDatabaseSupport } = require("./bridge/database");
const { createBridgeDiagnosticsTreeProvider } = require("./vscode/views/bridgeDiagnostics");
const { registerLanguageProviders, refreshAllLocalDiagnostics, refreshLocalDiagnosticsForDocument } = require("./vscode/providers/languageProviders");
const { createLanguageIndexCache } = require("./vscode/languageIndexCache");
const { updateStatusBar } = require("./vscode/statusBar");
const { registerCommands } = require("./vscode/commands");
const { collectKnownProjectRoots, invalidateProjectRootCache } = require("./project/projects");

function activate(context) {
    const bridgeDiagnostics = vscode.languages.createDiagnosticCollection(BRIDGE_DIAGNOSTIC_COLLECTION_NAME);
    const localDiagnostics = vscode.languages.createDiagnosticCollection(LOCAL_DIAGNOSTIC_COLLECTION_NAME);
    const languageIndexCache = createLanguageIndexCache();
    const languageServices = { languageIndexCache };
    const bridgeState = createEmptyBridgeDiagnosticsState();
    const bridgeTreeProvider = createBridgeDiagnosticsTreeProvider(bridgeState);
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

    const refreshUi = () => {
        bridgeTreeProvider.refresh();
        updateStatusBar(statusBar, bridgeState);
    };
    const refreshBridge = async () => {
        refreshBridgeDiagnostics(bridgeDiagnostics, bridgeState, vscode.window.activeTextEditor?.document?.fileName || "");
        refreshUi();
    };
    const debouncedBridgeRefresh = createDebouncedDisposable(() => void refreshBridge(), 200);
    const debouncedLocalRefresh = createDebouncedDisposable((document) => {
        refreshLocalDiagnosticsForDocument(document, localDiagnostics, languageServices);
    }, 150);
    const debouncedAllLocalRefresh = createDebouncedDisposable(() => {
        refreshAllLocalDiagnostics(localDiagnostics, languageServices);
    }, 150);
    const bridgeWatcherState = { rootsKey: "", watchers: [] };
    const refreshBridgeWatchers = () => updateBridgeWatchers(context, bridgeWatcherState, debouncedBridgeRefresh);
    const importWatcher = vscode.workspace.createFileSystemWatcher("**/*.{dsh,dsf}");
    const handleImportFileChange = (uri) => {
        languageIndexCache.invalidatePath(uri.fsPath);
        debouncedAllLocalRefresh.run();
    };
    importWatcher.onDidCreate(() => {
        languageIndexCache.invalidateAll();
        debouncedAllLocalRefresh.run();
    });
    importWatcher.onDidChange(handleImportFileChange);
    importWatcher.onDidDelete(handleImportFileChange);

    context.subscriptions.push(
        bridgeDiagnostics,
        localDiagnostics,
        bridgeTreeProvider,
        statusBar,
        debouncedBridgeRefresh,
        debouncedLocalRefresh,
        debouncedAllLocalRefresh,
        importWatcher,
        vscode.window.createTreeView("dreamshader.bridgeDiagnostics", {
            treeDataProvider: bridgeTreeProvider,
            showCollapseAll: true
        })
    );

    registerLanguageProviders(context, localDiagnostics, languageServices);
    registerCommands(context, { refreshBridge });

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            refreshLocalDiagnosticsForDocument(document, localDiagnostics, languageServices);
            refreshBridgeWatchers();
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            languageIndexCache.invalidateDocument(event.document.uri);
            debouncedLocalRefresh.run(event.document);
            refreshUi();
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            languageIndexCache.invalidateDocument(document.uri);
            localDiagnostics.delete(document.uri);
            refreshBridgeWatchers();
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            invalidateProjectRootCache();
            languageIndexCache.invalidateAll();
            refreshAllLocalDiagnostics(localDiagnostics, languageServices);
            refreshBridgeWatchers();
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("dreamshader")) {
                return;
            }
            invalidateProjectRootCache();
            languageIndexCache.invalidateAll();
            refreshAllLocalDiagnostics(localDiagnostics, languageServices);
            void refreshBridge();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => {
            refreshBridgeWatchers();
            void refreshBridge();
            refreshUi();
        })
    );

    refreshBridgeWatchers();
    refreshAllLocalDiagnostics(localDiagnostics, languageServices);
    void refreshBridge();
    refreshUi();

    // sql.js's WASM module loads asynchronously; refresh once it's ready so completions/hover and
    // the diagnostics view pick up bridge.db instead of the (now deprecated) JSON Bridge files as
    // soon as possible, rather than waiting for the next unrelated trigger.
    void initializeBridgeDatabaseSupport().then((SQL) => {
        if (SQL) {
            languageIndexCache.invalidateAll();
            refreshAllLocalDiagnostics(localDiagnostics, languageServices);
            void refreshBridge();
        }
    });
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
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
