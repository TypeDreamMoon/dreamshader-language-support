"use strict";

// The editor-backed half of `src/host.js`.
//
// The client runs the same `project/projects.js` the server does -- the status bar, the Bridge
// commands and the preview all ask for a project root -- so it has to say where it is too. Unlike
// the server it can answer all four: the commands genuinely do mean "the root of whatever the author
// is looking at", and on this side there is something to look at.

const vscode = require("vscode");
const { setHost } = require("../host");
const { SETTINGS_SECTION } = require("../lspProtocol");

function installVscodeHost() {
    setHost({
        getSetting: (name, fallback) => vscode.workspace.getConfiguration(SETTINGS_SECTION).get(name, fallback),
        getWorkspaceFolderPaths: () => (vscode.workspace.workspaceFolders || [])
            .map((folder) => folder.uri.fsPath)
            .filter(Boolean),
        getActiveDocumentPath: () => vscode.window.activeTextEditor?.document?.uri?.fsPath || "",
        getOpenDocumentPaths: () => vscode.workspace.textDocuments
            .map((document) => document.uri?.fsPath)
            .filter(Boolean)
    });
}

module.exports = {
    installVscodeHost
};
