"use strict";

// Source line -> graph node: *Reveal in Material Editor*.
//
// The other direction lives in the plugin (the material editor's node menu opens the source line). This
// one asks the running editor, through the bridge, to find the node a line of a 2.0 source became, open
// the material editor of the asset that owns it, and select it. The editor answers in
// `Saved/DreamShader/Bridge/Responses/<requestId>.json`; a failure comes back coded (DSH9050-DSH9057),
// and the two that are about what to do next -- nothing from this source is loaded, or the assets were
// built before navigation existed -- say so in words.

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { findProjectRoot } = require("../../project/projects");
const { writeBridgeRequest } = require("../../bridge/requests");
const { getBridgeDirectory } = require("../../bridge/paths");
const { readJsonFile } = require("../../common/json");
const { DSS_EXTENSIONS } = require("../../dss/languageData");

const RESPONSE_TIMEOUT_MS = 8000;
const RESPONSE_POLL_MS = 120;

function registerNavigationCommands(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("dreamshader.revealInMaterialEditor", async () => {
            await revealInMaterialEditor();
        })
    );
}

async function revealInMaterialEditor() {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (!document || !DSS_EXTENSIONS.has(path.extname(document.fileName).toLowerCase())) {
        vscode.window.showWarningMessage("Reveal in Material Editor needs an active .dss document: node navigation is recorded by the 2.0 compiler.");
        return;
    }
    const projectRoot = findProjectRoot(document.fileName);
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const requestId = `reveal-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const line = editor.selection.active.line + 1;
    writeBridgeRequest(projectRoot, { action: "reveal-node", file: document.fileName.replace(/\\/g, "/"), line, requestId });

    const responsePath = path.join(getBridgeDirectory(projectRoot), "Responses", `${requestId}.json`);
    const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `DreamShader: revealing line ${line} in the Material Editor...` },
        () => waitForResponse(responsePath));

    if (!response) {
        vscode.window.showWarningMessage("The Unreal editor did not answer. Reveal in Material Editor needs the project open in an editor with the DreamShader plugin running.");
        return;
    }
    if (response.ok) {
        const count = Array.isArray(response.expressions) ? response.expressions.length : 0;
        vscode.window.setStatusBarMessage(`DreamShader selected ${count === 1 ? "1 node" : `${count} nodes`} of ${response.assetPath || "the asset"}.`, 4000);
        return;
    }

    const diagnostics = Array.isArray(response.diagnostics) ? response.diagnostics : [];
    const first = diagnostics[0] || {};
    const message = String(first.message || response.message || "The editor could not reveal that line.");
    const code = String(first.code || "");
    if (code === "DSH9051") {
        const choice = await vscode.window.showWarningMessage(`${message}`, "Recompile This Source");
        if (choice) {
            await vscode.commands.executeCommand("dreamshader.recompileCurrent");
        }
        return;
    }
    vscode.window.showWarningMessage(code ? `${code}: ${message}` : message);
}

function waitForResponse(responsePath) {
    return new Promise((resolve) => {
        const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
        const poll = () => {
            if (fs.existsSync(responsePath)) {
                const response = readJsonFile(responsePath, null);
                // Present but unreadable is the editor still writing it.
                if (response) {
                    resolve(response);
                    return;
                }
            }
            if (Date.now() > deadline) {
                resolve(null);
                return;
            }
            setTimeout(poll, RESPONSE_POLL_MS);
        };
        poll();
    });
}

module.exports = {
    registerNavigationCommands
};
