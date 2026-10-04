"use strict";

// Custom Pass pipelines (`.dsp`) in the editor, checked without an editor.
//
// The .dsp features answer from two files the plugin writes -- pass-keys.json and the symbol index of the source,
// with its `pipeline` section -- and from the text. The fixtures in test/fixtures/dsp are real ones, copied from a
// project the plugin 2.1.0 ran in (PassDemo's CP_Highlight and CP_LivingWall, their indices, its pass-keys.json); they
// are laid out here in a temporary project the way the plugin lays them out, with the index's absolute paths rewritten
// to it, so the lookup, the span checks and the fallbacks run for real.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { scanPipeline } = require("../src/dsp/scanner");
const passKeys = require("../src/dsp/passKeys");
const { createPipelineIndexReader, expectedIndexPath } = require("../src/dsp/pipelineIndex");
const queries = require("../src/dsp/queries");
const { normalizeIndex } = require("../src/dss/indexStore");

const FIXTURES = path.join(__dirname, "..", "test", "fixtures", "dsp");
// LF, whatever core.autocrlf checked out: the needles below are written with "\n". An index counts lines and columns,
// not offsets, so its spans fit either; CRLF text is checked on its own further down.
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8").replace(/\r\n/g, "\n");

function write(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
}

/** An index fixture with every `file` it names pointed at `sourcePath`. */
function relocatedIndex(name, sourcePath) {
    const raw = JSON.parse(fixture(name));
    const visit = (value) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (value && typeof value === "object") {
            for (const key of Object.keys(value)) {
                if (key === "file" && typeof value[key] === "string") {
                    value[key] = sourcePath;
                } else {
                    visit(value[key]);
                }
            }
        }
    };
    visit(raw);
    return raw;
}

const norm = (value) => value.replace(/\\/g, "/");
const project = norm(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dreamshader-dsp-"))));
write(path.join(project, "Smoke.uproject"), JSON.stringify({ FileVersion: 3 }));
const highlightPath = `${project}/DShader/PassDemo/CP_Highlight.dsp`;
const wallPath = `${project}/DShader/PassDemo/CP_LivingWall.dsp`;
const pluginPath = `${project}/Plugins/MoonToon/DShader/Passes/CP_Toon.dsp`;
const highlightText = fixture("CP_Highlight.dsp");
const wallText = fixture("CP_LivingWall.dsp");
write(highlightPath, highlightText);
write(wallPath, wallText);
write(`${project}/Plugins/MoonToon/MoonToon.uplugin`, "{}");
write(pluginPath, highlightText);
const indexDirectory = `${project}/Saved/DreamShader/Index`;
write(`${indexDirectory}/Project/PassDemo/CP_Highlight.dsp.index.json`, JSON.stringify(relocatedIndex("CP_Highlight.dsp.index.json", highlightPath)));
write(`${indexDirectory}/Project/PassDemo/CP_LivingWall.dsp.index.json`, JSON.stringify(relocatedIndex("CP_LivingWall.dsp.index.json", wallPath)));
write(`${indexDirectory}/MoonToon/Passes/CP_Toon.dsp.index.json`, JSON.stringify(relocatedIndex("CP_Highlight.dsp.index.json", pluginPath)));

// --------------------------------------------------------------------------------------------- pass-keys.json
const keys = passKeys.normalizePassKeys(JSON.parse(fixture("pass-keys.json")));
{
    assert.ok(keys && keys.knownVersion && keys.supported, "the plugin's own file reads, at the version this side knows");
    assert.strictEqual(passKeys.normalizePassKeys({ schema: "DreamShader.Settings", version: 1 }), null, "another manifest is not pass-keys.json");
    assert.strictEqual(passKeys.normalizePassKeys({ schema: "DreamShader.PassKeys", version: 2 }).knownVersion, false, "a newer version is read, and flagged");
    assert.deepStrictEqual(keys.layerNames, ["Highlight", "XRay"]);

    // A key's `value` names the list it is completed from; the rule, not a table, finds it.
    assert.deepStrictEqual(passKeys.listFor(keys, "meshMode"), ["Override", "Own", "OwnOrOverride"]);
    assert.deepStrictEqual(passKeys.listFor(keys, "nanitePolicy"), ["Skip", "StencilMask", "AssignStencil"]);
    assert.deepStrictEqual(passKeys.listFor(keys, "bufferResolution"), ["Render", "Output"]);
    assert.ok(passKeys.listFor(keys, "viewFlags").includes("SceneCapture"));
    assert.strictEqual(passKeys.listFor(keys, "injection")[0], "BeginView", "injection points come in frame order");
    assert.deepStrictEqual(passKeys.listFor(keys, "material"), [], "a free value has no list");

    const compute = passKeys.keysFor(keys, { scope: "pass", kind: "compute" }).map((key) => key.name);
    assert.deepStrictEqual(compute, ["Shader", "Entry", "Threads", "Dispatch", "Injection", "Enabled"], "a kind's keys, then the ones every kind takes");
    assert.ok(passKeys.keysFor(keys, { scope: "pass", kind: "fullscren" }).some((key) => key.name === "Filter"), "a misspelt kind takes any kind's keys");
    assert.ok(passKeys.describeKey(keys, passKeys.findKey(keys, { scope: "pass", kind: "mesh" }, "Cull"), "mesh pass").includes("`Auto`"));

    const projectKeys = passKeys.createPassKeysReader(project);
    assert.strictEqual(projectKeys.get().source, "bundled", "no pass-keys.json yet: the bundled copy answers");
    assert.deepStrictEqual(projectKeys.get().keys.layerNames, [], "...without any project's layers");
    write(`${project}/Saved/DreamShader/Bridge/pass-keys.json`, `﻿${fixture("pass-keys.json")}`);
    assert.strictEqual(projectKeys.get().source, "project", "the project's file, once there -- a BOM is no obstacle");
    assert.strictEqual(passKeys.createPassKeysReader("", "").get().source, "none", "nothing to read is nothing, not an error");
}

// ------------------------------------------------------------------------------------------------- the index
{
    assert.strictEqual(norm(expectedIndexPath(project, highlightPath)), `${indexDirectory}/Project/PassDemo/CP_Highlight.dsp.index.json`);
    assert.strictEqual(norm(expectedIndexPath(project, pluginPath)), `${indexDirectory}/MoonToon/Passes/CP_Toon.dsp.index.json`,
        "a plugin root's index is in the project's Saved, under the plugin's name");

    const reader = createPipelineIndexReader(project);
    const found = reader.lookup(highlightPath);
    assert.ok(found.index && found.index.pipeline, "the index of a .dsp carries its pipeline section");
    assert.deepStrictEqual(found.index.pipeline.passes.map((pass) => `${pass.name}:${pass.kind}`), ["DrawMask:mesh", "Blur:compute", "Composite:fullscreen"]);
    assert.strictEqual(found.index.pipeline.passes[1].reads[0].slot, "Source");
    assert.strictEqual(found.index.pipeline.buffers[1].export, true);
    assert.ok(reader.lookup(pluginPath).index, "a plugin root's .dsp finds its index");
    assert.ok(reader.lookup(highlightPath.toUpperCase()).index, "whatever the case of the path");
    assert.strictEqual(reader.lookup(`${project}/DShader/PassDemo/CP_New.dsp`).index, null, "a pipeline nobody compiled has none");

    const newer = relocatedIndex("CP_Highlight.dsp.index.json", wallPath);
    newer.version = 2;
    write(`${indexDirectory}/Project/PassDemo/CP_LivingWall.dsp.index.json`, JSON.stringify(newer));
    const flagged = createPipelineIndexReader(project).lookup(wallPath);
    assert.ok(!flagged.index && flagged.problem === "version 2", "an index of an unknown version is not read, and says why");
    write(`${indexDirectory}/Project/PassDemo/CP_LivingWall.dsp.index.json`, "{ half-written");
    assert.strictEqual(createPipelineIndexReader(project).lookup(wallPath).index, null, "a half-written index is no index, not an exception");
    write(`${indexDirectory}/Project/PassDemo/CP_LivingWall.dsp.index.json`, JSON.stringify(relocatedIndex("CP_LivingWall.dsp.index.json", wallPath)));
}

// ----------------------------------------------------------------------------------------------- the scanner
{
    const wall = scanPipeline(wallText);
    assert.deepStrictEqual(wall.uniforms.map((entry) => entry.name), ["Feed", "Kill", "SporeRadius"]);
    assert.deepStrictEqual(wall.buffers.map((entry) => `${entry.name}:${entry.format}`), ["Field:RG32F", "StepA:RG32F", "StepB:RG32F"]);
    assert.deepStrictEqual(wall.buffers[0].arguments.map((entry) => entry.name), ["Size", "History", "Export", "Clear"]);
    assert.ok(wall.hlsl && wall.hlsl.form === "functions" && wall.hlsl.passIndex === -1, "the file's block, whole functions");
    assert.deepStrictEqual(wall.hlsl.functions.map((fn) => `${fn.name}${fn.numthreads ? "*" : ""}`), ["LwReact", "LwStepAToB", "LwStepBToA", "LwPlant", "GrowCS*"],
        "the functions at its top level, through #define lines, groupshared and initializer braces");
    assert.strictEqual(wallText.slice(wall.hlsl.close, wall.hlsl.close + 1), "}", "the block ends at the brace matching its own");
    const grow1 = wall.passes[0];
    assert.deepStrictEqual(grow1.statements.map((entry) => (entry.type === "key" ? entry.name : `${entry.type} ${entry.name}`)),
        ["Injection", "Entry", "Dispatch", "read InField", "write OutField", "param FeedRate", "param KillRate", "param Spore", "param Plant"]);
    assert.ok(grow1.statements[3].previous && grow1.statements[3].buffer === "Field", "read InField = Field.Previous");

    const highlight = scanPipeline(highlightText);
    assert.strictEqual(highlight.passes[1].hlsl.form, "statements", "Blur's block holds the statements of its entry");
    const implicit = highlight.passes[2].statements[2];
    assert.ok(implicit.type === "read" && implicit.name === "Mask" && implicit.buffer === "Mask" && !implicit.explicitName, "`read Mask;` is `read Mask = Mask;`");

    const tricky = scanPipeline([
        "uniform float buffer = 1.0;",
        "buffer write : R8;",
        "pass Use : copy",
        "{",
        "    read write;",
        "    write param = write;",
        "}",
        "hlsl",
        "{",
        "    #define OPEN {",
        "    static const string S = \"} {\"; // }",
        "    /* { */ void Main() { }",
        "}",
        "pass After : clear { Value = 1; write write; }",
        "hlsl {",
        "    float Halve(float X) { return X * 0.5; }"
    ].join("\r\n"));
    assert.deepStrictEqual(tricky.uniforms.map((entry) => entry.name), ["buffer"], "`buffer` is a name after `uniform float`");
    assert.deepStrictEqual(tricky.passes[0].statements.map((entry) => `${entry.type}:${entry.name}=${entry.buffer}`), ["read:write=write", "write:param=write"]);
    assert.deepStrictEqual(tricky.blocks[0].functions.map((fn) => fn.name), ["Main"], "a brace in a # line, a string or a comment does not count");
    assert.deepStrictEqual(tricky.passes.map((pass) => pass.name), ["Use", "After"], "and the scan goes on after the block, as DreamShader");
    assert.strictEqual(tricky.blocks[1].close, -1, "a block left open runs to the end of the file");
}

// ------------------------------------------------------------------------------------------------- questions
const highlightIndex = normalizeIndex(relocatedIndex("CP_Highlight.dsp.index.json", highlightPath), "x");
const wallIndex = normalizeIndex(relocatedIndex("CP_LivingWall.dsp.index.json", wallPath), "y");
const contextOf = (text, index, keysSource = "project") => queries.createContext(text, scanPipeline(text), keys, index, keysSource);
const offsetIn = (text) => (needle, delta = 0, occurrence = 0) => {
    let found = -1;
    for (let count = 0; count <= occurrence; count += 1) {
        found = text.indexOf(needle, found + 1);
    }
    assert.ok(found >= 0, `'${needle}' is in the fixture`);
    return found + delta;
};
const labels = (items) => items.map((entry) => entry.label);

{
    const context = contextOf(highlightText, highlightIndex);
    const at = offsetIn(highlightText);

    // Completion.
    const blurStart = labels(queries.completionsAt(context, at("    Dispatch  = Blurred;", 4)));
    assert.ok(blurStart.includes("Threads") && blurStart.includes("Dispatch") && blurStart.includes("read") && blurStart.includes("param"),
        "at the start of a compute pass statement: its keys and the binding words");
    assert.ok(!blurStart.includes("Injection"), "...but not a key the pass already set");
    assert.ok(!blurStart.includes("Filter"), "...nor another kind's key");
    assert.ok(!blurStart.includes("hlsl"), "...nor a second hlsl block");
    assert.strictEqual(labels(queries.completionsAt(context, at("AfterOpaque;\n    Dispatch")))[3], "AfterOpaque", "Injection = completes injection points, in frame order");
    assert.deepStrictEqual(labels(queries.completionsAt(context, at("Highlight);"))), ["Highlight", "XRay"], "inside Layer(: the project's layers");
    assert.deepStrictEqual(labels(queries.completionsAt(context, at("None;"))), ["TestScene", "None", "Own"], "Depth = completes from depthModes");
    const reads = labels(queries.completionsAt(context, at("Mask;\n    write Result")));
    assert.ok(reads[0] === "Mask" && reads.includes("Blurred") && reads.includes("SceneColor"), "read X = completes buffers, built-ins after");
    assert.deepStrictEqual(labels(queries.completionsAt(context, at("OutlineWidth;\n"))), ["OutlineColor", "OutlineWidth", "DreamPassWeight"], "param = completes parameters");
    assert.deepStrictEqual(labels(queries.completionsAt(context, at("Order = 100"))), ["Injection", "Views", "Requires", "Enabled"], "#pragma pipeline( completes its keys but Order, which is written");
    assert.ok(labels(queries.completionsAt(context, at("Clear = 0"))).includes("Scale"), "a buffer's argument list completes buffer keys");
    assert.deepStrictEqual(labels(queries.completionsAt(context, at("true);"))), ["true", "false"]);
    assert.deepStrictEqual(labels(queries.completionsAt(context, at("@group Look\n", 1))), ["group", "desc", "slider", "sort", "default"]);
    const inBlur = labels(queries.completionsAt(context, at("const int R")));
    assert.ok(["Source", "SourceSize", "SourceUVRect", "Result", "ResultSize", "Radius", "Id", "LocalIndex", "DP_LinearClamp", "DreamPassSample"].every((name) => inBlur.includes(name)),
        "inside the pass's block: its binding names, the names around the statements, DreamPass.ush");
    assert.ok(!inBlur.includes("Pixel"), "a compute block is not given the pixel pass's names");
    assert.deepStrictEqual(queries.completionsAt(context, at("M_HighlightMask", 2)), [], "nothing inside a string");

    // Hover.
    assert.ok(queries.hoverAt(context, at("Injection = AfterOpaque", 2)).markdown.includes("Where in the frame the pass runs."), "a key: pass-keys.json's detail");
    assert.ok(queries.hoverAt(context, at("AfterOpaque", 3)).markdown.includes("injection point"));
    const mask = queries.hoverAt(context, at("Source = Mask", 10));
    assert.ok(mask.markdown.includes("buffer Mask : R8(Clear = 0)") && mask.markdown.includes("What the objects cover.") && !mask.markdown.includes("not there yet"),
        "a buffer: its declaration, and its description from the index");
    assert.ok(queries.hoverAt(context, at("Source.SampleLevel", 2)).markdown.includes("DP_Input0"), "a binding name inside the block: which fixed parameter it is");
    assert.ok(queries.hoverAt(context, at("ResultSize.zw", 3)).markdown.includes("DP_Output0"));
    assert.ok(queries.hoverAt(context, at("Blur : compute", 9)).markdown.includes("pass kind"));
    assert.ok(queries.hoverAt(context, at("pass Blur", 6)).markdown.includes("at AfterOpaque"));

    // Definition: from the index while it matches the text.
    const toMask = queries.definitionAt(context, at("Source = Mask", 10));
    assert.deepStrictEqual(toMask.map((target) => [target.source, highlightText.slice(target.start, target.end)]), [["index", "Mask"]]);
    assert.strictEqual(toMask[0].start, at("buffer Mask", 7));
    const toSource = queries.definitionAt(context, at("SourceSize.zw", 2));
    assert.deepStrictEqual(toSource.map((target) => [target.source, target.start]), [["index", at("read  Source", 6)]], "XSize goes to the read that makes it");
    assert.deepStrictEqual(queries.definitionAt(context, at("(int)Radius", 6)).map((target) => target.start), [at("param Radius", 6)]);
    assert.deepStrictEqual(queries.definitionAt(context, at("= OutlineWidth;", 4)).map((target) => target.start), [at("float  OutlineWidth", 7)]);

    // Semantic tokens: the names the block borrows, and only inside the block.
    const tokens = queries.semanticTokens(context);
    const tokenAt = (offset) => tokens.find((token) => token.start === offset) || null;
    assert.strictEqual(tokenAt(at("Source.SampleLevel")).type, "parameter", "a binding name in the block");
    assert.strictEqual(tokenAt(at("ResultSize.zw")).type, "parameter", "...and the size it makes");
    assert.strictEqual(tokenAt(at("(Id.xy") + 1).type, "parameter", "a name written around the statements");
    assert.deepStrictEqual(tokenAt(at("DP_LinearClamp")), { start: at("DP_LinearClamp"), end: at("DP_LinearClamp") + 14, type: "variable", modifiers: ["defaultLibrary", "readonly"] });
    assert.strictEqual(tokenAt(at("SampleLevel")), null, "a member is not one of them");
    assert.strictEqual(tokenAt(at("read  Source") + 6), null, "outside the block a binding is DreamShader's, coloured by the grammar");

    // The outline.
    const outline = queries.documentSymbols(context);
    assert.deepStrictEqual(outline.map((entry) => entry.name), ["OutlineColor", "OutlineWidth", "Mask", "Blurred", "DrawMask", "Blur", "Composite"]);
    assert.deepStrictEqual(outline[5].children.map((entry) => entry.name), ["Source", "Result", "Radius", "hlsl"]);
    assert.strictEqual(outline[3].detail, "R8 · exported", "the index adds what the text does not say");
    const contained = (entry) => entry.start <= entry.selectionStart && entry.selectionEnd <= entry.end && entry.children.every(contained);
    assert.ok(outline.every(contained), "every selection range is inside its range");
}

{
    // An entry of the file's block, named by four passes.
    const context = contextOf(wallText, wallIndex);
    const at = offsetIn(wallText);
    const entries = queries.completionsAt(context, at("GrowCS;\n    Dispatch"));
    assert.strictEqual(entries.find((entry) => entry.label === "GrowCS").sortText[0], "0", "a compute pass is offered its [numthreads] entries first");
    const inEntry = labels(queries.completionsAt(context, at("const int2 Origin")));
    assert.ok(inEntry.includes("InField") && inEntry.includes("OutFieldSize") && inEntry.includes("Plant"), "inside an entry: the names of the passes that name it");
    assert.ok(!inEntry.includes("Id"), "a whole-function block is given no names of a body");
    const inShared = labels(queries.completionsAt(context, at("const float Reaction")));
    assert.ok(!inShared.includes("InField") && inShared.includes("LwReact") && !inShared.includes("GrowCS"), "shared code: no pass's names, and no entry to call");
    assert.strictEqual(queries.definitionAt(context, at("InField.Load", 2)).length, 4, "a binding name in an entry goes to each pass's binding");
    assert.ok(queries.hoverAt(context, at("InField.Load", 2)).markdown.includes("`Grow4`: read InField = StepA"));
    assert.deepStrictEqual(queries.definitionAt(context, at("GrowCS;\n    Dispatch", 2)).map((target) => target.start), [at("void GrowCS", 5)], "Entry = goes to the function");
    assert.ok(queries.hoverAt(context, at("GrowCS;\n    Dispatch", 2)).markdown.includes("[numthreads(16, 16, 1)]"));
    const tokens = queries.semanticTokens(context);
    assert.ok(tokens.some((token) => token.start === at("InField.Load") && token.type === "parameter"), "an entry sees the names of the passes naming it");
    assert.ok(!tokens.some((token) => token.start > at("float2 LwReact") && token.start < at("void LwStepAToB") && token.type === "parameter"), "shared code sees none");
}

{
    // The same file with CRLF line ends -- core.autocrlf makes most of them so -- reads the same 1-based spans.
    const crlf = highlightText.replace(/\n/g, "\r\n");
    const crlfAt = offsetIn(crlf);
    assert.deepStrictEqual(queries.definitionAt(contextOf(crlf, highlightIndex), crlfAt("Source.SampleLevel", 2)).map((target) => [target.source, crlf.slice(target.start, target.end)]),
        [["index", "Source"]]);

    // The index is older than the text: two lines were added above everything since the last compile.
    const stale = `// one\r\n// two\r\n${highlightText.replace(/\r?\n/g, "\r\n")}`;
    const context = contextOf(stale, highlightIndex);
    const at = offsetIn(stale);
    const toMask = queries.definitionAt(context, at("Source = Mask", 10));
    assert.deepStrictEqual(toMask.map((target) => [target.source, stale.slice(target.start, target.end)]), [["text", "Mask"]], "a stale span gives way to the text");
    assert.deepStrictEqual(queries.definitionAt(context, at("Source.SampleLevel", 2)).map((target) => [target.source, stale.slice(target.start, target.end)]), [["text", "Source"]]);

    // An index that is plain wrong: spans off every line, before the first column, past the end of a line.
    const broken = JSON.parse(JSON.stringify(relocatedIndex("CP_Highlight.dsp.index.json", highlightPath)));
    broken.declarations.forEach((entry, position) => Object.assign(entry, [{ line: 100000 }, { line: 0, column: 0 }, { column: -3 }, { column: 4000 }][position % 4]));
    broken.pipeline.passes.forEach((pass) => pass.bindings.reads.forEach((read) => Object.assign(read, { line: 99999, column: 1 })));
    const wrong = contextOf(highlightText, normalizeIndex(broken, "z"));
    const at2 = offsetIn(highlightText);
    assert.deepStrictEqual(queries.definitionAt(wrong, at2("Source = Mask", 10)).map((target) => target.source), ["text"]);
    assert.deepStrictEqual(queries.definitionAt(wrong, at2("Source.SampleLevel", 2)).map((target) => target.source), ["text"]);
    assert.ok(queries.hoverAt(wrong, at2("Source = Mask", 10)), "and hover still answers");

    // No index and no pass-keys.json at all.
    const bare = queries.createContext(highlightText, scanPipeline(highlightText), null, null, "none");
    assert.ok(queries.hoverAt(bare, at2("Source = Mask", 10)).markdown.includes("not there yet"), "the text answers, and says the index is missing");
    assert.deepStrictEqual(queries.definitionAt(bare, at2("Source = Mask", 10)).map((target) => target.source), ["text"]);
    assert.deepStrictEqual(queries.completionsAt(bare, at2("AfterOpaque;\n    Dispatch")), [], "no vocabulary, no values -- and no exception");
    assert.ok(queries.documentSymbols(bare).length === 7);

    // The bundled vocabulary says where it came from.
    const bundled = queries.createContext(highlightText, scanPipeline(highlightText), keys, null, "bundled");
    assert.ok(queries.completionsAt(bundled, at2("    Dispatch  = Blurred;", 4)).find((entry) => entry.label === "Threads").documentation.includes("bundled"));
}

fs.rmSync(project, { recursive: true, force: true });
console.log("dsp smoke: ok");
