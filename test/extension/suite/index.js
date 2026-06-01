"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vscode = require("vscode");

const EXTENSION_ID = "typedreammoon.dreamshaderlang-language-support";

async function run() {
    const workspaceRoot = prepareWorkspace();
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert(extension, `Expected extension ${EXTENSION_ID} to be installed`);
    await extension.activate();
    assert.strictEqual(extension.isActive, true, "Extension should activate");

    await assertContributedCommandsRegistered();

    const document = await vscode.workspace.openTextDocument(path.join(workspaceRoot, "DShader", "M_Test.dsm"));
    await vscode.window.showTextDocument(document);

    await assertCompletionProvider(document);
    await assertHoverProvider(document);
    await assertCodeLensProvider(document);
    await assertInlayHintProvider(document);
    await assertBridgeDiagnosticsRefresh(workspaceRoot, document);

    console.log("extension smoke tests passed");
}

function prepareWorkspace() {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert(folder, "Expected an extension test workspace folder");

    fs.mkdirSync(path.join(folder, "DShader", "Shared"), { recursive: true });
    fs.mkdirSync(path.join(folder, "Saved", "DreamShader", "Bridge"), { recursive: true });
    fs.writeFileSync(path.join(folder, "DreamShaderSmoke.uproject"), JSON.stringify({ FileVersion: 3 }), "utf8");
    fs.writeFileSync(path.join(folder, "DShader", "Shared", "Common.dsh"), "Function Tint(in float3 Color, out float3 Result) { Result = Color; }\n", "utf8");
    fs.writeFileSync(path.join(folder, "DShader", "M_Test.dsm"), `import "Shared/Common.dsh";

Shader(Name="Materials/M_Test", Root="Game")
{
    Properties = {
        VectorParameter BaseColor = float4(1, 1, 1, 1);
    }
    Outputs = {
        float3 Color;
        Base.BaseColor = Color;
    }
    Graph = {
        float2 UV = UE.TexCoord(0);
        float ThinFilmSpecular = Substrate.ThinFilm(FilmThickness=500.0, FilmIor=1.4);
        Color =
    }
}
`, "utf8");
    fs.writeFileSync(path.join(folder, "Saved", "DreamShader", "Bridge", "diagnostics.json"), JSON.stringify({
        updatedAtUtc: new Date(0).toISOString(),
        files: [{
            path: "DShader/M_Test.dsm",
            diagnostics: [{
                severity: "warning",
                message: "Bridge smoke diagnostic",
                line: 3,
                column: 1,
                source: "DreamShader"
            }]
        }]
    }), "utf8");
    return folder;
}

async function assertContributedCommandsRegistered() {
    const packageJson = require("../../../package.json");
    const expectedCommands = packageJson.contributes.commands
        .map((entry) => entry.command)
        .filter((command) => command.startsWith("dreamshader."));
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of expectedCommands) {
        assert(registered.has(command), `Expected command to be registered: ${command}`);
    }
}

async function assertCompletionProvider(document) {
    const marker = "        Color =";
    const position = document.positionAt(document.getText().indexOf(marker) + marker.length);
    const completions = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, position);
    const labels = new Set((completions?.items || []).map((item) => item.label));
    assert(labels.has("BaseColor"), "Completion provider should offer graph symbols");
}

async function assertHoverProvider(document) {
    const offset = document.getText().indexOf("Substrate.ThinFilm") + "Substrate.Thin".length;
    const position = document.positionAt(offset);
    const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, position);
    const text = (hovers || [])
        .flatMap((hover) => hover.contents || [])
        .map((content) => typeof content === "string" ? content : content.value || "")
        .join("\n");
    assert(/Specular Color/.test(text), "Hover provider should show Substrate.ThinFilm Specular Color output");
    assert(/Edge Specular Color/.test(text), "Hover provider should show Substrate.ThinFilm Edge Specular Color output");
    assert(/float1/.test(text), "Hover provider should show Substrate.ThinFilm output type");
}

async function assertCodeLensProvider(document) {
    const lenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", document.uri);
    assert((lenses || []).some((lens) => lens.command?.command === "dreamshader.recompileCurrent"), "CodeLens provider should expose recompile-current action");
}

async function assertInlayHintProvider(document) {
    const hints = await vscode.commands.executeCommand("vscode.executeInlayHintProvider", document.uri, new vscode.Range(0, 0, document.lineCount, 0));
    assert((hints || []).some((hint) => String(hint.label) === "Index:"), "Inlay hint provider should expose parameter labels");
}

async function assertBridgeDiagnosticsRefresh(workspaceRoot, document) {
    await vscode.commands.executeCommand("dreamshader.refreshBridgeDiagnostics");
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    assert(diagnostics.some((diagnostic) => diagnostic.message === "Bridge smoke diagnostic"), "Bridge diagnostics refresh should publish diagnostics");

    const requestDirectory = path.join(workspaceRoot, "Saved", "DreamShader", "Bridge", "Requests");
    assert(!fs.existsSync(requestDirectory) || fs.statSync(requestDirectory).isDirectory(), "Bridge request directory state should remain valid");
}

module.exports = {
    run
};
