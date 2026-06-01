"use strict";

const path = require("path");
const vscode = require("vscode");
const { findProjectRoot, isDreamShaderDocument } = require("../project/projects");
const { formatCounts } = require("./views/bridgeDiagnostics");

function updateStatusBar(statusBar, bridgeState) {
    const enabled = vscode.workspace.getConfiguration("dreamshader").get("showStatusBar", true);
    const document = vscode.window.activeTextEditor?.document;
    if (!enabled || !document || !isDreamShaderDocument(document)) {
        statusBar.hide();
        return;
    }
    const projectRoot = findProjectRoot(document.fileName);
    const projectLabel = projectRoot ? path.basename(projectRoot) : "Project";
    const counts = getCountsForProject(bridgeState, projectRoot);
    statusBar.text = counts.total
        ? `$(warning) DreamShader ${projectLabel}: ${formatCounts(counts)}`
        : `$(check) DreamShader ${projectLabel}`;
    statusBar.command = "dreamshader.showBridgeDiagnostics";
    statusBar.tooltip = `Project: ${projectRoot || "Not detected"}`;
    statusBar.show();
}

function getCountsForProject(state, projectRoot) {
    const entry = (state.projectEntries || []).find((project) => project.projectRoot === projectRoot);
    return entry?.counts || state.totals;
}

module.exports = {
    updateStatusBar
};
