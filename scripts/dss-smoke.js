"use strict";

// DreamShader 2.0 in the editor, checked without an editor.
//
// The 2.0 features answer from two files the plugin writes -- the symbol index of a source and the
// builtin node catalog -- so the test is: given those files, in the shape the plugin writes them, are the
// answers right? The fixtures below are that shape to the letter (schema names, 1-based lines and
// columns, absolute paths), built in a temporary project so that the store's directory walk, its
// by-source lookup and its "a header is described by whoever includes it" rule are exercised for real.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createIndexStore, getIndexDirectory, normalizeIndex } = require("../src/dss/indexStore");
const { createCatalogReader, findExpression, describeExpression, getCatalogPath } = require("../src/dss/catalog");
const queries = require("../src/dss/queries");

function write(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
}

const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dreamshader-dss-")));
const norm = (value) => value.replace(/\\/g, "/");
const sourcePath = norm(path.join(project, "DShader", "Materials", "M_Glow.dss"));
const headerPath = norm(path.join(project, "DShader", "Shared", "Common.dsh"));

const sourceText = [
    "#include \"Shared/Common.dsh\"",                            // 1
    "",                                                           // 2
    "/// @group Look @desc The tint",                             // 3
    "uniform float3 Tint = float3(1, 0.5, 0.25);",                // 4
    "",                                                           // 5
    "float Half(float x)",                                        // 6
    "{",                                                          // 7
    "    return x * 0.5;",                                        // 8
    "}",                                                          // 9
    "",                                                           // 10
    "export void M_Glow(inout material m)",                       // 11
    "{",                                                          // 12
    "    float x = Half(Gain);",                                  // 13
    "    m.EmissiveColor = Tint * x;",                            // 14
    "    m.Opacity = UE.Lerp(A = 0.0, B = 1.0, Alpha = x);",      // 15
    "}"                                                           // 16
].join("\n");
const headerText = [
    "/// @desc Overall gain",
    "uniform float Gain = 0.7;"
].join("\n");
write(sourcePath, sourceText);
write(headerPath, headerText);

const span = (file, line, column, length) => ({ file, line, column, offset: 0, length });
const index = {
    schema: "dreamshader-symbol-index",
    version: 1,
    file: sourcePath,
    declarations: [
        { kind: "uniform", name: "Tint", signature: "uniform float3 Tint", type: "float3", doc: "The tint", ...span(sourcePath, 4, 16, 4) },
        { kind: "uniform", name: "Gain", signature: "uniform float Gain", type: "float", doc: "Overall gain", ...span(headerPath, 2, 15, 4) },
        { kind: "function", name: "Half", role: "Helper", signature: "float Half(float x)", type: "float", doc: "", ...span(sourcePath, 6, 7, 4) },
        { kind: "parameter", name: "x", container: "Half", type: "float", doc: "", ...span(sourcePath, 6, 18, 1) },
        { kind: "function", name: "M_Glow", role: "Entry", signature: "export void M_Glow(inout material m)", type: "void", doc: "", ...span(sourcePath, 11, 13, 6) },
        { kind: "parameter", name: "m", container: "M_Glow", type: "material", doc: "", ...span(sourcePath, 11, 35, 1) }
    ],
    references: [
        { name: "Tint", spans: [span(sourcePath, 14, 23, 4)] },
        { name: "Gain", spans: [span(sourcePath, 13, 20, 4)] },
        { name: "Half", spans: [span(sourcePath, 13, 15, 4)] },
        { name: "x", spans: [span(sourcePath, 8, 12, 1), span(sourcePath, 14, 30, 1), span(sourcePath, 15, 50, 1)] },
        { name: "m", spans: [span(sourcePath, 14, 5, 1), span(sourcePath, 15, 5, 1)] }
    ],
    includes: [headerPath],
    parameters: []
};
const indexPath = path.join(getIndexDirectory(project), "Project", "Materials", "M_Glow.dss.index.json");
write(indexPath, JSON.stringify(index, null, 2));
write(path.join(getIndexDirectory(project), "Project", "Broken.dss.index.json"), "{ not json");

const readLines = (file) => fs.readFileSync(file, "utf8").split(/\r\n|\r|\n/);
const lines = sourceText.split("\n");
const at = (line, needle, occurrence = 0) => {
    let character = -1;
    for (let count = 0; count <= occurrence; count += 1) {
        character = lines[line - 1].indexOf(needle, character + 1);
    }
    assert.ok(character >= 0, `'${needle}' on line ${line}`);
    return { line: line - 1, character };
};
const wordAt = (position) => queries.wordAt(lines[position.line], position.character);

// ------------------------------------------------------------------------------------------ the store
const store = createIndexStore(project);
store.refresh();
assert.strictEqual(store.all().length, 1, "one readable index; the half-written one is skipped, not fatal");
assert.strictEqual(store.findForSource(sourcePath).length, 1, "a source is described by its own index");
assert.strictEqual(store.findForSource(sourcePath.toUpperCase()).length, 1, "...whatever the case of the path");
assert.strictEqual(store.findForSource(headerPath).length, 1, "a header is described by an index that includes it");
assert.strictEqual(store.findForSource(norm(path.join(project, "DShader", "Other.dss"))).length, 0, "a source nobody compiled has none");
assert.strictEqual(normalizeIndex({ schema: "something-else", declarations: [] }, "x"), null, "another schema is not read");

const indices = store.findForSource(sourcePath);

// ------------------------------------------------------------------------------------- definitions
{
    const position = at(14, "Tint");
    const found = queries.findDeclarations(indices, sourcePath, position, wordAt(position));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 4, "a uniform of the file");
}
{
    const position = at(13, "Gain");
    const found = queries.findDeclarations(indices, sourcePath, position, wordAt(position));
    assert.strictEqual(found[0].file, headerPath, "a uniform of an included header leads into the header");
}
{
    const position = at(8, "x");
    const found = queries.findDeclarations(indices, sourcePath, position, wordAt(position));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].kind, "parameter", "inside Half, x is Half's parameter");
    assert.strictEqual(found[0].line, 6);
}
{
    // `x` inside M_Glow is a local, and the index has no locals: no answer beats a wrong one.
    const position = at(14, "x");
    assert.strictEqual(queries.findDeclarations(indices, sourcePath, position, wordAt(position)).length, 0, "a local has no declaration in the index");
}
{
    const position = at(15, "Lerp");
    const word = wordAt(position);
    assert.strictEqual(word.namespace, "UE");
    assert.strictEqual(queries.findDeclarations(indices, sourcePath, position, word).length, 0, "a node of a namespace is the catalog's, not the index's");
}
{
    const position = at(14, "EmissiveColor");
    const word = wordAt(position);
    assert.ok(word.member && !word.namespace, "m.EmissiveColor is a member, of no namespace");
}

// -------------------------------------------------------------------------------------- references
{
    const position = at(6, "Half");
    const found = queries.findReferences(indices, sourcePath, position, wordAt(position), readLines, true);
    assert.deepStrictEqual(found.map((entry) => entry.line), [6, 13], "the declaration and the call");
}
{
    const position = at(6, "x", 0);
    const found = queries.findReferences(indices, sourcePath, position, wordAt(position), readLines, false);
    assert.deepStrictEqual(found.map((entry) => entry.line), [8], "a parameter's mentions stop at its function");
}
{
    // The file moved on since the compile: line 14 no longer says Tint there.
    const stale = (file) => (file === sourcePath ? sourceText.replace("Tint * x", "Colour * x").split("\n") : readLines(file));
    const position = at(4, "Tint");
    const found = queries.findReferences(indices, sourcePath, position, wordAt(position), stale, false);
    assert.strictEqual(found.length, 0, "a span the text no longer matches is dropped");
}

// ------------------------------------------------------------------------------------------ rename
{
    const position = at(4, "Tint");
    const plan = queries.planRename(indices, sourcePath, position, wordAt(position), "Colour", readLines);
    assert.ok(!plan.error, plan.error);
    assert.deepStrictEqual(plan.edits.map((entry) => `${entry.line}:${entry.column}`).sort(), ["14:23", "4:16"]);
}
{
    const position = at(13, "Gain");
    const plan = queries.planRename(indices, sourcePath, position, wordAt(position), "Strength", readLines);
    assert.ok(!plan.error, plan.error);
    assert.ok(plan.edits.some((entry) => entry.file === headerPath), "a rename reaches into the header that declares the name");
}
{
    const position = at(6, "x", 0);
    assert.ok(queries.planRename(indices, sourcePath, position, wordAt(position), "value", readLines).error, "a parameter is not renamed: the index cannot tell one x from another");
    const tint = at(4, "Tint");
    assert.ok(queries.planRename(indices, sourcePath, tint, wordAt(tint), "Gain", readLines).error, "a name that is taken is refused");
    assert.ok(queries.planRename(indices, sourcePath, tint, wordAt(tint), "2fast", readLines).error, "so is one that is no identifier");
    const stale = (file) => (file === sourcePath ? sourceText.replace("Tint * x", "Colour * x").split("\n") : readLines(file));
    const plan = queries.planRename(indices, sourcePath, tint, wordAt(tint), "Colour", stale);
    assert.ok(plan.error && /older than/.test(plan.error), "a stale index refuses the whole rename");
}

// ----------------------------------------------------------------------------- outline, hover, calls
{
    const outline = queries.documentSymbols(indices[0], sourcePath);
    assert.deepStrictEqual(outline.map((entry) => entry.name), ["Tint", "Half", "M_Glow"], "the file's own declarations, in order, without the header's");
    assert.deepStrictEqual(outline[1].children.map((entry) => entry.name), ["x"], "a function holds its parameters");

    const hover = queries.describeDeclaration(indices[0].declarations.find((entry) => entry.name === "M_Glow"));
    assert.ok(hover.includes("export void M_Glow(inout material m)") && hover.includes("material entry"));

    assert.deepStrictEqual(queries.callAt("m.Opacity = UE.Lerp(A = 0.0, B = "), { name: "Lerp", argument: 1, member: true, owner: "UE", qualifier: "" });
    assert.deepStrictEqual(queries.callAt("float y = Half(max(a, b), "), { name: "Half", argument: 1, member: false, owner: "", qualifier: "" });
    assert.deepStrictEqual(queries.callAt("BL::TexNoise3D(p, 5.0, "), { name: "TexNoise3D", argument: 2, member: false, owner: "", qualifier: "BL" },
        "a header namespace's call keeps its namespace apart from a `.` owner");
    const qualifiedWord = queries.wordAt("    BL::TexNoise3D(p);", 10);
    assert.strictEqual(qualifiedWord.word, "TexNoise3D");
    assert.strictEqual(qualifiedWord.qualifier, "BL", "the word under the caret knows its `Ns::`");
    assert.strictEqual(queries.wordAt("    Half(p);", 6).qualifier, "", "and a plain name has none");
    assert.strictEqual(queries.callAt("float y = 1; "), null, "no call is open after a statement ended");
    assert.deepStrictEqual(queries.parametersOf(indices[0], indices[0].declarations.find((entry) => entry.name === "Half")).map((entry) => entry.name), ["x"]);
    assert.deepStrictEqual(queries.completionDeclarations(indices).map((entry) => entry.name).sort(), ["Gain", "Half", "M_Glow", "Tint"]);
}

// ----------------------------------------------------------------------------------------- catalog
{
    write(getCatalogPath(project), JSON.stringify({
        schema: "dreamshader-builtin-catalog",
        version: 1,
        engine: "5.8",
        expressions: [
            { namespace: "UE", shortName: "LinearInterpolate", className: "MaterialExpressionLinearInterpolate", aliases: ["Lerp"],
              inputs: [{ name: "A", type: "Numeric", constProperty: "ConstA" }, { name: "B", type: "Numeric" }, { name: "Alpha", type: "Numeric" }],
              outputs: [{ name: "", type: "Numeric" }], properties: [{ name: "ConstA", type: "Float1" }] },
            { namespace: "Substrate", shortName: "SubstrateSlabBSDF", className: "MaterialExpressionSubstrateSlabBSDF", aliases: ["Slab"],
              inputs: ["DiffuseAlbedo", "F0", "Roughness", "SSSMFP", "SecondRoughness", "SecondRoughnessWeight"].map((name) => ({ name, type: "Float3" })),
              outputs: [{ name: "", type: "Substrate" }] },
            { namespace: "Substrate", shortName: "SubstrateShadingModels", className: "MaterialExpressionSubstrateShadingModels", aliases: ["ShadingModels"],
              inputs: [{ name: "BaseColor", type: "Float3" }, { name: "Roughness", type: "Float1" }], outputs: [{ name: "", type: "Substrate" }] },
            { namespace: "Substrate", shortName: "SubstrateHorizontalMixing", className: "MaterialExpressionSubstrateHorizontalMixing",
              aliases: ["HorizontalMix", "HorizontalMixing", "Mix"], positional: ["Background", "Foreground", "Mix"],
              inputs: [{ name: "Background", type: "Substrate" }, { name: "Foreground", type: "Substrate" }, { name: "Mix", type: "Float1" }],
              outputs: [{ name: "", type: "Substrate" }] },
            { namespace: "UE", shortName: "Abstract", className: "MaterialExpressionAbstract", isAbstract: true }
        ],
        materialAttributes: [{ name: "BaseColor", property: "MP_BaseColor", type: "float3" }]
    }));
    const catalog = createCatalogReader(project).get();
    assert.ok(catalog, "the catalog reads");
    assert.strictEqual(catalog.expressions.length, 4, "an abstract class is nothing a source can call");
    assert.strictEqual(findExpression(catalog, "UE", "Lerp").shortName, "LinearInterpolate", "an alias finds its class");
    assert.strictEqual(findExpression(catalog, "UE", "Slab"), null, "a name belongs to its namespace");

    const slab = findExpression(catalog, "Substrate", "Slab");
    assert.strictEqual(slab.displayName, "Slab", "a Substrate class goes by the name sources use");
    assert.deepStrictEqual(slab.virtualArguments.map((entry) => entry.name), ["BaseColor", "Metallic", "Specular", "Haziness", "Transmittance", "Thickness", "IOR"],
        "a slab takes every family of sugar S3");
    assert.deepStrictEqual(findExpression(catalog, "Substrate", "ShadingModels").virtualArguments, [],
        "a class without the pins a family feeds takes none -- its BaseColor is a pin");
    assert.ok(describeExpression(findExpression(catalog, "Substrate", "Mix")).includes("Positional"), "a positional order is said");
    assert.strictEqual(createCatalogReader(path.join(project, "Nowhere")).get(), null, "no catalog yet is no catalog, not an error");
}

fs.rmSync(project, { recursive: true, force: true });
console.log("dss smoke: ok");
