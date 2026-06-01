"use strict";

const vscode = require("vscode");
const { normalizeSeverity } = require("../../bridge/diagnostics");

function createBridgeDiagnosticsTreeProvider(state) {
    const changeEmitter = new vscode.EventEmitter();
    return {
        onDidChangeTreeData: changeEmitter.event,
        refresh() {
            changeEmitter.fire();
        },
        getChildren(element) {
            if (!element) {
                return state.projectEntries.length ? state.projectEntries : [createPlaceholder(state)];
            }
            if (element.type === "project") {
                return element.fileEntries || [];
            }
            if (element.type === "file") {
                return element.diagnosticEntries || [];
            }
            return [];
        },
        getTreeItem(element) {
            return buildTreeItem(element);
        },
        dispose() {
            changeEmitter.dispose();
        }
    };
}

function createPlaceholder(state) {
    return {
        type: "placeholder",
        label: state.hasAnyBridgeFile ? "Bridge is clean" : "Waiting for Unreal bridge diagnostics",
        description: state.hasAnyBridgeFile ? "No active issues" : "No diagnostics file detected"
    };
}

function buildTreeItem(element) {
    if (element.type === "project") {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = formatCounts(element.counts);
        item.iconPath = getSummaryIcon(element.counts);
        item.tooltip = element.diagnosticsFilePath;
        return item;
    }
    if (element.type === "file") {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.resourceUri = vscode.Uri.file(element.filePath);
        item.description = formatCounts(element.counts);
        item.iconPath = getSummaryIcon(element.counts);
        item.command = {
            command: "dreamshader.openBridgeDiagnosticLocation",
            title: "Open DreamShader Source",
            arguments: [element]
        };
        return item;
    }
    if (element.type === "diagnostic") {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = `L${element.line}:${element.column}${element.stage ? ` ${element.stage}` : ""}`;
        item.iconPath = getSeverityIcon(element.severity);
        item.command = {
            command: "dreamshader.openBridgeDiagnosticLocation",
            title: "Open Bridge Diagnostic",
            arguments: [element]
        };
        item.tooltip = element.detail || element.message;
        return item;
    }
    const item = new vscode.TreeItem(element.label || "DreamShader Bridge", vscode.TreeItemCollapsibleState.None);
    item.description = element.description || "";
    item.iconPath = new vscode.ThemeIcon(element.label === "Bridge is clean" ? "check" : "info");
    return item;
}

function formatCounts(counts) {
    if (!counts?.total) {
        return "0 issues";
    }
    return [
        counts.error ? `${counts.error} error` : "",
        counts.warning ? `${counts.warning} warning` : "",
        counts.information ? `${counts.information} info` : "",
        counts.hint ? `${counts.hint} hint` : ""
    ].filter(Boolean).join(", ");
}

function getSummaryIcon(counts) {
    if (!counts?.total) {
        return new vscode.ThemeIcon("check");
    }
    if (counts.error) {
        return new vscode.ThemeIcon("error");
    }
    if (counts.warning) {
        return new vscode.ThemeIcon("warning");
    }
    return new vscode.ThemeIcon("info");
}

function getSeverityIcon(severity) {
    switch (normalizeSeverity(severity)) {
        case "warning": return new vscode.ThemeIcon("warning");
        case "information": return new vscode.ThemeIcon("info");
        case "hint": return new vscode.ThemeIcon("lightbulb");
        default: return new vscode.ThemeIcon("error");
    }
}

module.exports = {
    createBridgeDiagnosticsTreeProvider,
    formatCounts
};
