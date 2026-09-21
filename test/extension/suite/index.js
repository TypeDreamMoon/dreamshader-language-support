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
    const api = await extension.activate();
    assert.strictEqual(extension.isActive, true, "Extension should activate");

    // Activation deliberately does not wait for the language server -- a server that fails to start
    // should not take the commands down with it. Everything below asks the editor to run a provider,
    // though, and until the client has finished starting there is nothing registered to answer.
    assert(api?.ready, "Extension should expose its language-server readiness");
    await api.ready;

    await assertContributedCommandsRegistered();

    const document = await vscode.workspace.openTextDocument(path.join(workspaceRoot, "DShader", "M_Test.dsm"));
    await vscode.window.showTextDocument(document);

    await assertCompletionProvider(document);
    await assertHoverProvider(document);
    await assertCodeLensProvider(document);
    await assertInlayHintProvider(document);
    await assertBridgeDiagnosticsRefresh(workspaceRoot, document);

    await assertDssLanguageFeatures(workspaceRoot);

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
        }, {
            // Deliberately never written to disk: the payload is a record of the last compile, so an
            // entry for a since-deleted file outlives it in every later write the plugin makes.
            path: "DShader/M_Deleted.dsm",
            diagnostics: [{
                severity: "error",
                message: "Bridge diagnostic for a deleted file",
                line: 1,
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

    // The deleted file's entry is still in the payload and must not reach the editor: it would be a
    // diagnostic nobody can navigate to, on a count no edit can clear.
    const deletedUri = vscode.Uri.file(path.join(workspaceRoot, "DShader", "M_Deleted.dsm"));
    assert(!fs.existsSync(deletedUri.fsPath), "Test setup expects the deleted file to be absent");
    assert.deepStrictEqual(
        vscode.languages.getDiagnostics(deletedUri).map((diagnostic) => diagnostic.message),
        [],
        "Bridge diagnostics for a file that no longer exists should not be published");

    const requestDirectory = path.join(workspaceRoot, "Saved", "DreamShader", "Bridge", "Requests");
    assert(!fs.existsSync(requestDirectory) || fs.statSync(requestDirectory).isDirectory(), "Bridge request directory state should remain valid");
}

// DreamShader 2.0: a `.dss` answers from the symbol index the plugin wrote for it, not from the text. The index below is
// that file to the letter (scripts/dss-smoke.js checks the queries; this checks that the providers are registered for
// the language and reach the index through a real workspace).
async function assertDssLanguageFeatures(workspaceRoot) {
    const norm = (value) => value.replace(/\\/g, "/");
    const sourcePath = norm(path.join(workspaceRoot, "DShader", "M_Glow.dss"));
    const sourceText = [
        "/// @desc The tint",                                   // 1
        "uniform float3 Tint = float3(1, 0.5, 0.25);",          // 2
        "",                                                     // 3
        "export void M_Glow(inout material m)",                 // 4
        "{",                                                    // 5
        "    m.EmissiveColor = Tint;",                          // 6
        "}"                                                     // 7
    ].join("\n");
    fs.writeFileSync(sourcePath, sourceText, "utf8");

    const span = (line, column, length) => ({ file: sourcePath, line, column, offset: 0, length });
    const indexPath = path.join(workspaceRoot, "Saved", "DreamShader", "Index", "Project", "M_Glow.dss.index.json");
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({
        schema: "dreamshader-symbol-index",
        version: 1,
        file: sourcePath,
        declarations: [
            { kind: "uniform", name: "Tint", signature: "uniform float3 Tint", type: "float3", doc: "The tint", ...span(2, 16, 4) },
            { kind: "function", name: "M_Glow", role: "Entry", signature: "export void M_Glow(inout material m)", type: "void", doc: "", ...span(4, 13, 6) },
            { kind: "parameter", name: "m", container: "M_Glow", type: "material", doc: "", ...span(4, 35, 1) }
        ],
        references: [
            { name: "Tint", spans: [span(6, 23, 4)] },
            { name: "m", spans: [span(6, 5, 1)] }
        ],
        includes: [],
        parameters: []
    }), "utf8");

    const document = await vscode.workspace.openTextDocument(sourcePath);
    await vscode.window.showTextDocument(document);
    assert.strictEqual(document.languageId, "dreamshader-dss", "A .dss file should open as DreamShader 2.0");

    const usage = new vscode.Position(5, sourceText.split("\n")[5].indexOf("Tint") + 1);
    const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, usage);
    const target = (definitions || []).map((entry) => entry.targetRange || entry.range)[0];
    assert(target, "Definition provider should answer for a uniform of a .dss from its index");
    assert.strictEqual(target.start.line, 1, "...with the line the index names");

    const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri);
    const names = (symbols || []).map((entry) => entry.name);
    assert(names.includes("Tint") && names.includes("M_Glow"), `Outline should list the declarations of the index (got ${names.join(", ")})`);

    const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, usage);
    const hoverText = (hovers || [])
        .flatMap((hover) => hover.contents || [])
        .map((content) => typeof content === "string" ? content : content.value || "")
        .join("\n");
    assert(/uniform float3 Tint/.test(hoverText), "Hover should show the declaration's signature");
    assert(/The tint/.test(hoverText), "...and its doc comment");

    // Unlike the 1.x fixtures above, these are not kept: an index names its sources by absolute path, which is this
    // machine's, and a checked-in one would be wrong everywhere else.
    fs.rmSync(path.join(workspaceRoot, "Saved", "DreamShader", "Index"), { recursive: true, force: true });
    fs.rmSync(sourcePath, { force: true });
}

module.exports = {
    run
};
