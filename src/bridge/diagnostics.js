"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { readJsonFile } = require("../common/json");
const { normalizeFsPath } = require("../common/path");
const { collectKnownProjectRoots } = require("../project/projects");
const { getDiagnosticsFilePath } = require("./paths");

function createEmptyBridgeDiagnosticsState() {
    return {
        updatedAtUtc: "",
        hasAnyBridgeFile: false,
        totals: createBridgeDiagnosticCounts(),
        projectEntries: []
    };
}

function createBridgeDiagnosticCounts() {
    return { error: 0, warning: 0, information: 0, hint: 0, total: 0 };
}

function refreshBridgeDiagnostics(collection, state, activePath = "") {
    resetState(state);
    const roots = collectKnownProjectRoots(activePath);
    for (const root of roots) {
        const diagnosticsFilePath = getDiagnosticsFilePath(root);
        if (!fs.existsSync(diagnosticsFilePath)) {
            continue;
        }
        state.hasAnyBridgeFile = true;
        const parsed = readJsonFile(diagnosticsFilePath, null);
        if (!parsed || !Array.isArray(parsed.files)) {
            continue;
        }
        const projectEntry = {
            type: "project",
            label: path.basename(root),
            projectRoot: normalizeFsPath(root),
            diagnosticsFilePath,
            updatedAtUtc: parsed.updatedAtUtc || "",
            counts: createBridgeDiagnosticCounts(),
            fileEntries: []
        };
        for (const file of parsed.files) {
            const filePath = normalizeFsPath(path.isAbsolute(file.path) ? file.path : path.join(root, file.path || ""));
            const fileEntry = {
                type: "file",
                label: path.basename(filePath),
                filePath,
                counts: createBridgeDiagnosticCounts(),
                diagnosticEntries: []
            };
            for (const diagnostic of file.diagnostics || []) {
                const entry = normalizeDiagnosticEntry(diagnostic, filePath);
                addCount(fileEntry.counts, entry.severity);
                addCount(projectEntry.counts, entry.severity);
                addCount(state.totals, entry.severity);
                fileEntry.diagnosticEntries.push(entry);
            }
            projectEntry.fileEntries.push(fileEntry);
            collection.set(vscode.Uri.file(filePath), fileEntry.diagnosticEntries.map(toVsCodeDiagnostic));
        }
        state.projectEntries.push(projectEntry);
        state.updatedAtUtc = parsed.updatedAtUtc || state.updatedAtUtc;
    }
}

function resetState(state) {
    state.updatedAtUtc = "";
    state.hasAnyBridgeFile = false;
    state.totals = createBridgeDiagnosticCounts();
    state.projectEntries = [];
}

function normalizeDiagnosticEntry(diagnostic, filePath) {
    return {
        type: "diagnostic",
        label: String(diagnostic.message || "DreamShader diagnostic"),
        message: String(diagnostic.message || "DreamShader diagnostic"),
        detail: String(diagnostic.detail || ""),
        filePath,
        line: Math.max(1, Number(diagnostic.line) || 1),
        column: Math.max(1, Number(diagnostic.column) || 1),
        severity: normalizeSeverity(diagnostic.severity),
        source: String(diagnostic.source || "DreamShader"),
        code: diagnostic.code || "",
        stage: diagnostic.stage || ""
    };
}

function toVsCodeDiagnostic(entry) {
    const line = Math.max(0, entry.line - 1);
    const column = Math.max(0, entry.column - 1);
    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, column, line, column + 1),
        entry.message,
        toVsCodeSeverity(entry.severity));
    diagnostic.source = entry.source;
    diagnostic.code = entry.code || undefined;
    return diagnostic;
}

function normalizeSeverity(value) {
    switch (String(value || "").toLowerCase()) {
        case "warning": return "warning";
        case "information":
        case "info": return "information";
        case "hint": return "hint";
        default: return "error";
    }
}

function toVsCodeSeverity(value) {
    switch (normalizeSeverity(value)) {
        case "warning": return vscode.DiagnosticSeverity.Warning;
        case "information": return vscode.DiagnosticSeverity.Information;
        case "hint": return vscode.DiagnosticSeverity.Hint;
        default: return vscode.DiagnosticSeverity.Error;
    }
}

function addCount(counts, severity) {
    const key = normalizeSeverity(severity);
    counts[key] += 1;
    counts.total += 1;
}

module.exports = {
    createEmptyBridgeDiagnosticsState,
    createBridgeDiagnosticCounts,
    refreshBridgeDiagnostics,
    normalizeSeverity
};
