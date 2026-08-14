"use strict";

const path = require("path");
const vscode = require("vscode");
const { findProjectRoot, isDreamShaderDocument } = require("../../project/projects");
const { writeRecompileRequest, writeCleanGeneratedShadersRequest } = require("../../bridge/requests");

function registerBridgeCommands(context, refreshBridge) {
    context.subscriptions.push(
        vscode.commands.registerCommand("dreamshader.showBridgeDiagnostics", async () => {
            await refreshBridge();
            await vscode.commands.executeCommand("dreamshader.bridgeDiagnostics.focus");
        }),
        vscode.commands.registerCommand("dreamshader.refreshBridgeDiagnostics", async () => {
            await refreshBridge();
        }),
        vscode.commands.registerCommand("dreamshader.recompileCurrent", async (targetUri) => {
            await recompileCurrent(targetUri);
        }),
        vscode.commands.registerCommand("dreamshader.recompileAll", async () => {
            await recompileAll();
        }),
        vscode.commands.registerCommand("dreamshader.cleanGeneratedShaders", async () => {
            await cleanGeneratedShaders();
        }),
        vscode.commands.registerCommand("dreamshader.openBridgeDiagnosticLocation", async (entry) => {
            await openBridgeDiagnosticLocation(entry);
        })
    );
}

async function recompileCurrent(targetUri) {
    const document = await getTargetDocument(targetUri);
    if (!document || !isDreamShaderDocument(document)) {
        vscode.window.showWarningMessage("DreamShader recompile needs an active .dsm, .dsf, or .dsh document.");
        return;
    }
    if (document.isDirty) {
        await document.save();
    }
    const projectRoot = findProjectRoot(document.fileName);
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }
    const scope = path.extname(document.fileName).toLowerCase() === ".dsh" ? "all" : "file";
    writeRecompileRequest(projectRoot, scope, document.fileName);
    vscode.window.setStatusBarMessage(scope === "all"
        ? "DreamShader requested a full Unreal recompile."
        : `DreamShader requested Unreal to recompile ${path.basename(document.fileName)}.`,
    2500);
}

async function recompileAll() {
    const projectRoot = findProjectRoot(vscode.window.activeTextEditor?.document?.fileName || "");
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }
    writeRecompileRequest(projectRoot, "all");
    vscode.window.setStatusBarMessage("DreamShader requested a full Unreal recompile.", 2500);
}

async function cleanGeneratedShaders() {
    const projectRoot = findProjectRoot(vscode.window.activeTextEditor?.document?.fileName || "");
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }
    writeCleanGeneratedShadersRequest(projectRoot);
    vscode.window.setStatusBarMessage("DreamShader requested generated shader cleanup and a full Unreal recompile.", 3000);
}

async function getTargetDocument(targetUri) {
    const uri = asUri(targetUri);
    if (uri) {
        return vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString())
            || vscode.workspace.openTextDocument(uri);
    }
    return vscode.window.activeTextEditor?.document;
}

/**
 * The recompile lens is now built by the language server, so its argument arrives as JSON -- a uri
 * string, not a `vscode.Uri`. Both are accepted because the command is also invoked from the command
 * palette with no argument at all, and because an unrecognised one used to fall through silently to
 * the *active* editor: clicking the lens on a background file would have recompiled the foreground
 * one, which is a wrong answer rather than a missing one.
 */
function asUri(value) {
    if (value instanceof vscode.Uri) {
        return value;
    }
    if (typeof value !== "string" || !value) {
        return null;
    }
    try {
        return vscode.Uri.parse(value, true);
    } catch (_error) {
        return null;
    }
}

async function openBridgeDiagnosticLocation(entry) {
    const filePath = entry?.filePath;
    if (!filePath) {
        return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const line = Math.max(0, Number(entry.line || 1) - 1);
    const column = Math.max(0, Number(entry.column || 1) - 1);
    await vscode.window.showTextDocument(document, {
        selection: new vscode.Range(line, column, line, column)
    });
}

module.exports = {
    registerBridgeCommands
};
