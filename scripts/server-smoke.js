"use strict";

// The server, spoken to over a real pipe.
//
// `language-smoke.js` next door imports the language layer and checks what it returns, which is the
// right shape for testing language knowledge and says nothing about whether the server that now
// carries it works. This spawns `src/server/server.js` and holds an LSP conversation with it: it is
// the test that would catch a capability declared but never wired, a handler that throws on a
// document it cannot resolve, or a converter that produces something the protocol will not accept.
//
// `--stdio` rather than the IPC the extension uses: same server, same handlers, and a transport a
// script can hold both ends of.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
    createMessageConnection,
    StreamMessageReader,
    StreamMessageWriter
} = require("vscode-jsonrpc/node");

const ROOT = path.join(__dirname, "..");
const WORKSPACE = path.join(ROOT, "test", "extension", "workspace");
const DOCUMENT = path.join(WORKSPACE, "DShader", "M_Test.dsm");

const { URI } = require("vscode-uri");
const documentUri = URI.file(DOCUMENT).toString();
const workspaceUri = URI.file(WORKSPACE).toString();
const text = fs.readFileSync(DOCUMENT, "utf8");

const child = spawn(process.execPath, [path.join(ROOT, "src", "server", "server.js"), "--stdio"], { stdio: "pipe" });
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin));
connection.listen();

// A minimally honest client: it answers the two requests the server makes of it.
connection.onRequest("workspace/configuration", (params) => params.items.map(() => ({})));
connection.onRequest("client/registerCapability", () => null);

function textDocument(extra = {}) {
    return { textDocument: { uri: documentUri }, ...extra };
}

async function main() {
    const initialize = await connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri: workspaceUri,
        workspaceFolders: [{ uri: workspaceUri, name: "workspace" }],
        capabilities: {
            workspace: {
                configuration: true,
                workspaceFolders: true,
                didChangeWatchedFiles: { dynamicRegistration: true }
            }
        }
    });
    await connection.sendNotification("initialized", {});

    const capabilities = initialize.capabilities;
    // Incremental, specifically. Shipping the whole buffer on every keystroke would make an
    // out-of-process server slower than the in-process providers it replaced -- and completion here
    // is triggered by every letter of the alphabet.
    assert.strictEqual(capabilities.textDocumentSync, 2, "The server should ask for incremental sync");
    for (const capability of [
        "completionProvider", "hoverProvider", "signatureHelpProvider", "documentSymbolProvider",
        "documentFormattingProvider", "foldingRangeProvider", "documentLinkProvider",
        "definitionProvider", "referencesProvider", "colorProvider", "inlayHintProvider",
        "codeLensProvider", "semanticTokensProvider"
    ]) {
        assert(capabilities[capability], `The server should declare ${capability} -- all fourteen providers moved across`);
    }

    const firstDiagnostics = new Promise((resolve) => {
        connection.onNotification("textDocument/publishDiagnostics", (params) => {
            if (params.uri === documentUri) {
                resolve(params.diagnostics);
            }
        });
    });

    await connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri: documentUri, languageId: "dreamshaderlang", version: 1, text }
    });

    const diagnostics = await firstDiagnostics;
    assert(diagnostics.length > 0, "The fixture's unterminated `Color =` should be diagnosed");
    assert(
        diagnostics.some((entry) => /trailing ';'/.test(entry.message)),
        "The missing-semicolon diagnostic should survive the trip across the wire");
    assert.strictEqual(typeof diagnostics[0].range.start.line, "number", "Offsets should have become positions");

    const symbols = await connection.sendRequest("textDocument/documentSymbol", textDocument());
    assert.strictEqual(symbols.length, 1, "The fixture has one top-level Shader block");
    assert(symbols[0].children?.length > 0, "The Shader block should carry its sections");

    // The import on line 1 is the one construct that resolves to another file, so it is what proves
    // the path handling survived the move from `document.fileName` to a uri conversion.
    const links = await connection.sendRequest("textDocument/documentLink", textDocument());
    assert.strictEqual(links.length, 1, "The single import should produce one link");
    assert(/Common\.dsh$/.test(decodeURIComponent(links[0].target)), "The link should resolve to the imported header");

    const importDefinition = await connection.sendRequest("textDocument/definition",
        textDocument({ position: { line: 0, character: 12 } }));
    assert(importDefinition?.length === 1, "Go-to-definition on the import path should resolve");
    assert(/Common\.dsh$/.test(decodeURIComponent(importDefinition[0].uri)), "...to the header it names");

    // `UE.TexCoord` on line 13 is a Bridge-manifest builtin, which exercises the whole services
    // chain: project root, known roots, manifests, and the memoisation over all three.
    const hover = await connection.sendRequest("textDocument/hover",
        textDocument({ position: { line: 12, character: 24 } }));
    assert(hover, "Hovering a UE builtin should say something");
    assert.strictEqual(hover.contents.kind, "markdown", "Hover contents should cross as MarkupContent");
    assert(hover.range, "Hover should report the range it applies to");

    const signature = await connection.sendRequest("textDocument/signatureHelp",
        textDocument({ position: { line: 13, character: 60 } }));
    assert(signature?.signatures?.length > 0, "Inside Substrate.ThinFilm(...) there should be a signature");
    assert.strictEqual(typeof signature.activeParameter, "number", "...with an active parameter index");

    const completions = await connection.sendRequest("textDocument/completion",
        textDocument({ position: { line: 12, character: 24 } }));
    const items = Array.isArray(completions) ? completions : completions.items;
    assert(items.length > 0, "There should be completions after `UE.`");
    assert(items.every((item) => item.textEdit), "Every item should carry its own range as a textEdit");

    // A placeholder is a placeholder in both spellings. The converter used to detect only the braced
    // `${1:…}` form, which left every insert text whose only placeholder was a bare `$0` declared as
    // PlainText -- so the editor typed the characters `$0` into the document instead of putting the
    // cursor there. `Settings` entries are the visible case (`TwoSided = "$0";`), and there are 116
    // of them, so this asserts the invariant over a Settings-section completion rather than over the
    // `UE.` list above, whose items happen to use the braced form.
    const settingsUri = URI.file(path.join(WORKSPACE, "DShader", "M_SettingsProbe.dsm")).toString();
    const settingsText = [
        'Shader(Name="Materials/M_SettingsProbe", Root="Game")',
        "{",
        "    Settings = {",
        "        ",
        "    }",
        "}",
        ""
    ].join("\n");
    await connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri: settingsUri, languageId: "dreamshaderlang", version: 1, text: settingsText }
    });
    const settingsCompletions = await connection.sendRequest("textDocument/completion", {
        textDocument: { uri: settingsUri },
        position: { line: 3, character: 8 }
    });
    const settingsItems = Array.isArray(settingsCompletions) ? settingsCompletions : settingsCompletions.items;
    assert(settingsItems.length > 0, "A Settings section should offer setting completions");
    const placeholderItems = settingsItems.filter((item) => /\$\{?\d/.test(item.textEdit?.newText || ""));
    assert(placeholderItems.length > 0, "Setting completions insert a `$0` placeholder to land the cursor in");
    const literalDollarItems = placeholderItems.filter((item) => item.insertTextFormat !== 2);
    assert.strictEqual(
        literalDollarItems.length, 0,
        "Every insert text carrying a placeholder must be declared InsertTextFormat.Snippet, or the "
        + `editor inserts it literally: ${literalDollarItems.slice(0, 3).map((item) => item.textEdit.newText).join(", ")}`);

    const colors = await connection.sendRequest("textDocument/documentColor", textDocument());
    assert.strictEqual(colors.length, 1, "float4(1, 1, 1, 1) is the fixture's one color literal");
    const presentations = await connection.sendRequest("textDocument/colorPresentation", {
        textDocument: { uri: documentUri },
        color: { red: 0.5, green: 0.25, blue: 0, alpha: 1 },
        range: colors[0].range
    });
    assert.strictEqual(presentations[0].label, "float4(0.5, 0.25, 0.0, 1.0)",
        "The presentation should keep the original constructor spelling, read back from the range");

    const tokens = await connection.sendRequest("textDocument/semanticTokens/full", textDocument());
    assert(tokens.data.length > 0 && tokens.data.length % 5 === 0,
        "Semantic tokens should arrive as the protocol's flat five-per-token encoding");

    const folding = await connection.sendRequest("textDocument/foldingRange", textDocument());
    assert(folding.length > 0, "The fixture's blocks should fold");
    assert(folding.every((range) => range.startLine < range.endLine), "A folding range should span lines");

    const hints = await connection.sendRequest("textDocument/inlayHint",
        textDocument({ range: { start: { line: 0, character: 0 }, end: { line: 200, character: 0 } } }));
    assert(Array.isArray(hints), "Inlay hints should answer for a whole-document range");

    const lenses = await connection.sendRequest("textDocument/codeLens", textDocument());
    assert(lenses.length > 0, "The Shader block should carry recompile lenses");
    assert(
        lenses.every((lens) => lens.command.arguments === undefined
            || lens.command.arguments.every((argument) => typeof argument === "string")),
        "Lens command arguments cross as JSON, so a uri has to be a string rather than a vscode.Uri");

    const edits = await connection.sendRequest("textDocument/formatting",
        textDocument({ options: { tabSize: 4, insertSpaces: true } }));
    assert.strictEqual(edits.length, 1, "Formatting replaces the whole document in one edit");
    assert(edits[0].newText.length > 0, "...with something in it");

    // A request naming a document the server never opened must answer, not throw: the client is
    // allowed to race a close against an in-flight request.
    const forgotten = await connection.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: URI.file(path.join(WORKSPACE, "nope.dsm")).toString() }
    });
    assert.deepStrictEqual(forgotten, [], "An unknown document should answer empty rather than error");

    await connection.sendRequest("shutdown");
    await connection.sendNotification("exit");
    child.kill();

    assert.strictEqual(stderr.join(""), "", "The server should not have written to stderr");
    console.log("server smoke tests passed");
}

main().catch((error) => {
    console.error(stderr.join(""));
    console.error(error);
    child.kill();
    process.exit(1);
});
