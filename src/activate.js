"use strict";

const vscode = require("vscode");
const {
    BRIDGE_DIAGNOSTIC_COLLECTION_NAME,
    LOCAL_DIAGNOSTIC_COLLECTION_NAME
} = require("./languageData");
const { createEmptyBridgeDiagnosticsState, refreshBridgeDiagnostics } = require("./bridge/diagnostics");
const { createBridgeDiagnosticsTreeProvider } = require("./vscode/views/bridgeDiagnostics");
const { registerLanguageProviders, refreshAllLocalDiagnostics, refreshLocalDiagnosticsForDocument } = require("./vscode/providers/languageProviders");
const { updateStatusBar } = require("./vscode/statusBar");
const { registerCommands } = require("./vscode/commands");

function activate(context) {
    const bridgeDiagnostics = vscode.languages.createDiagnosticCollection(BRIDGE_DIAGNOSTIC_COLLECTION_NAME);
    const localDiagnostics = vscode.languages.createDiagnosticCollection(LOCAL_DIAGNOSTIC_COLLECTION_NAME);
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

    context.subscriptions.push(
        bridgeDiagnostics,
        localDiagnostics,
        bridgeTreeProvider,
        statusBar,
        vscode.window.createTreeView("dreamshader.bridgeDiagnostics", {
            treeDataProvider: bridgeTreeProvider,
            showCollapseAll: true
        })
    );

    registerLanguageProviders(context, localDiagnostics);
    registerCommands(context, { refreshBridge });

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            refreshLocalDiagnosticsForDocument(document, localDiagnostics);
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            refreshLocalDiagnosticsForDocument(event.document, localDiagnostics);
            refreshUi();
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            localDiagnostics.delete(document.uri);
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            refreshAllLocalDiagnostics(localDiagnostics);
            void refreshBridge();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("dreamshader")) {
                return;
            }
            refreshAllLocalDiagnostics(localDiagnostics);
            void refreshBridge();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => {
            void refreshBridge();
            refreshUi();
        })
    );

    refreshAllLocalDiagnostics(localDiagnostics);
    void refreshBridge();
    refreshUi();
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
