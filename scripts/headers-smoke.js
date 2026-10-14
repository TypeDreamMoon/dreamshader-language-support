"use strict";

// Headers and the plugin's after-2.1.2 syntax, without an editor:
//
//   headerScan   what a header declares, both dialects, and the closure of its includes
//   dialect      which language a `.dsh` is written in
//   disableLists `#pragma disable_warning(...)` / `// disable_error DSH...`, read as the plugin reads them
//   1.x          `BL::` offers that namespace's functions only -- a 1.x header's and a 2.0 header's -- the
//                `Function(Generate = ...)` header parses, the three file pragmas are no DSH1035, and the block
//                headers complete their new keys

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const headerScan = require("../src/project/headerScan");
const { detectHeaderDialect } = require("../src/project/dialect");
const { scanDisableLists, isDisabled } = require("../src/common/disableLists");
const { parseDocument } = require("../src/language/parser");
const { flatten } = require("../src/language/symbols");
const { getCompletionSpecs } = require("../src/language/completions");
const languageCore = require("../src/language");

const MODERN_HEADER = [
    "// A 2.0 header.",
    "#include \"Hash.dsh\"",
    "",
    "/// @custom",
    "float BLNoise_fade(float t)",
    "{",
    "    return t * t * (3.0 - 2.0 * t);",
    "}",
    "",
    "#pragma generate(Functions = \"Noise/MF_{Name}\")",
    "",
    "/// @custom",
    "/// @name BL::TexNoise3D",
    "/// @desc Blender's Noise Texture, 3D.",
    "void BL_TexNoise3D(float3 co, float scale = 5.0, out float fac, out float3 color)",
    "{",
    "    fac = BLNoise_fade(co.x * scale);",
    "    color = float3(fac, fac, fac);",
    "}",
    "",
    "/// @asset /Game/MF_Existing",
    "extern float3 MF_Existing(float3 x);"
].join("\r\n");

const HASH_HEADER = "/// @custom\r\nuint BLHash_uint(uint k)\r\n{\r\n    return k * 2654435761u;\r\n}\r\n";

const LEGACY_HEADER = [
    "Function BLChecker_fac(in float3 p, out float result)",
    "{",
    "    result = 1.0;",
    "}",
    "",
    "Namespace(Name = \"BL\", Generate = \"MF_BL_{Name}\")",
    "{",
    "    Function(Generate = \"Checker/MF_BL_TexChecker\", Description = \"Checker\") TexChecker(in float3 co, out float fac)",
    "    {",
    "        fac = BLChecker_fac(co);",
    "    }",
    "}"
].join("\n");

// --------------------------------------------------------------------------------------- headerScan
{
    const modern = headerScan.scanHeaderFunctions(MODERN_HEADER);
    const names = modern.map((entry) => entry.name);
    assert.deepStrictEqual(names, ["BLNoise_fade", "BL_TexNoise3D", "MF_Existing"], "a 2.0 header's functions, an extern included");
    const noise = modern.find((entry) => entry.name === "BL_TexNoise3D");
    assert.strictEqual(noise.qualifiedName, "BL::TexNoise3D", "`/// @name BL::X` is how it is called");
    assert.strictEqual(noise.doc, "Blender's Noise Texture, 3D.");
    assert.strictEqual(noise.line, 15, "its line, counted in a CRLF text");
    assert.strictEqual(headerScan.formatSignature(noise),
        "void BL::TexNoise3D(float3 co, float scale = 5.0, out float fac, out float3 color)");
    assert.strictEqual(modern.find((entry) => entry.name === "MF_Existing").linkage, "extern");

    const legacy = headerScan.scanHeaderFunctions(LEGACY_HEADER);
    assert.deepStrictEqual(legacy.map((entry) => entry.qualifiedName || entry.name), ["BLChecker_fac", "BL::TexChecker"],
        "a 1.x header's functions, a namespace member under its namespace -- and its Generate header does not hide it");
    assert.strictEqual(legacy[1].name, "BL_TexChecker", "...declared as BL_TexChecker");

    assert.deepStrictEqual(headerScan.scanIncludes(MODERN_HEADER + "\n// #include \"Commented.dsh\"\nimport \"Old.dsh\";"), ["Hash.dsh", "Old.dsh"],
        "includes and imports, not the commented ones");

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ds-headers-"));
    try {
        fs.writeFileSync(path.join(directory, "Noise.dsh"), MODERN_HEADER);
        fs.writeFileSync(path.join(directory, "Hash.dsh"), HASH_HEADER);
        const resolve = (specifier, from) => {
            const candidate = path.resolve(path.dirname(from), specifier);
            return fs.existsSync(candidate) ? candidate : "";
        };
        const main = "#include \"Noise.dsh\"\n#include \"Missing.dsh\"\nexport void M(inout material m) { }\n";
        const closure = headerScan.collectIncludeClosure(path.join(directory, "M.dss"), main, resolve);
        assert.strictEqual(closure.files.length, 3, "the file, its header and that header's header; a missing one is skipped");
        assert.ok(closure.functions.some((entry) => entry.name === "BLHash_uint"), "a header's header is read too");
        assert.deepStrictEqual(headerScan.collectNamespaces(closure.functions), ["BL"]);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

// ------------------------------------------------------------------------------------------ dialect
{
    assert.strictEqual(detectHeaderDialect(MODERN_HEADER), "2.0");
    assert.strictEqual(detectHeaderDialect(HASH_HEADER), "2.0", "`/// @custom` and a C function are 2.0");
    assert.strictEqual(detectHeaderDialect(LEGACY_HEADER), "1.x");
    assert.strictEqual(detectHeaderDialect(MODERN_HEADER + "\nimport \"Old.dsh\";"), "1.x", "a mixed header stays 1.x");
    assert.strictEqual(detectHeaderDialect(""), "1.x", "so does an empty one");
    assert.strictEqual(detectHeaderDialect("// Function F() is mentioned in a comment\nfloat F(float x) { return x; }"), "2.0",
        "a 1.x word in a comment does not count");
}

// ------------------------------------------------------------------------------------- disableLists
{
    const lists = scanDisableLists([
        "#pragma disable_warning(DSH7224, dsh8237) // and a note",   // 1
        "#pragma disable_error(DSH4210)",                            // 2
        "float a = 1; // disable_warning DSH5251",                   // 3
        "// disable_error DSH4211, DSH4212",                         // 4
        "",                                                          // 5
        "// an ordinary comment",                                    // 6
        "float b = 2;",                                              // 7
        "// disable_warning DSH7224",                                // 8
        "/// @library X",                                            // 9
        "string s = \"// disable_warning DSH1111\";"                 // 10
    ].join("\r\n"));
    assert.ok(isDisabled(lists, "Warning", "DSH8237", 40), "a file-wide warning, any line, any case");
    assert.ok(isDisabled(lists, "Error", "DSH4210", 1));
    assert.ok(!isDisabled(lists, "Warning", "DSH4210", 1), "a disabled error is not a disabled warning");
    assert.ok(isDisabled(lists, "Warning", "DSH5251", 3), "a trailing comment covers its own line");
    assert.ok(!isDisabled(lists, "Warning", "DSH5251", 4), "...and no other");
    assert.ok(isDisabled(lists, "Error", "DSH4212", 7), "a comment alone covers the next line that holds code");
    assert.ok(isDisabled(lists, "Warning", "DSH7224", 9), "a doc line holds code");
    assert.ok(!isDisabled(lists, "Warning", "DSH1111", 10), "a `//` inside a string is no comment");
    assert.ok(!isDisabled(lists, "Information", "DSH7224", 1), "an information is never disabled");
}

// -------------------------------------------------------------------------------------------- 1.x
{
    const blocks = flatten(parseDocument(LEGACY_HEADER).blocks);
    const checker = blocks.find((block) => block.name === "TexChecker");
    assert.ok(checker, "`Function(Generate = ...) Name(...)` parses to its name");
    assert.deepStrictEqual(checker.params.map((param) => param.name), ["co", "fac"], "...and its parameters, not its attributes");
    assert.deepStrictEqual(checker.attributes.map((attribute) => attribute.name), ["Generate", "Description"]);

    const pragmas = "#pragma nogeneration\n#pragma disable_warning(DSH2253)\n#pragma disable_error(DSH2240)\n#pragma once\nShader(Name = \"M\") { Graph = { } }\n";
    const pragmaCodes = languageCore.getDiagnostics(pragmas, "C:/Smoke/M.dsm", {}).filter((entry) => entry.code === "DSH1035");
    assert.strictEqual(pragmaCodes.length, 1, "the three file pragmas are no DSH1035; any other `#pragma` still is");

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ds-legacy-"));
    try {
        fs.writeFileSync(path.join(directory, "Legacy.dsh"), LEGACY_HEADER);
        fs.writeFileSync(path.join(directory, "Noise.dsh"), MODERN_HEADER);
        fs.writeFileSync(path.join(directory, "Hash.dsh"), HASH_HEADER);
        const resolve = (specifier, from) => {
            const candidate = path.resolve(path.dirname(from || directory), specifier);
            return fs.existsSync(candidate) ? candidate : "";
        };
        const main = "import \"Legacy.dsh\";\nimport \"Noise.dsh\";\nShader(Name = \"M\")\n{\n    Graph = {\n        BL::\n    }\n}\n";
        const index = languageCore.buildDocumentIndex({ fileName: path.join(directory, "M.dsm"), text: main, resolveImportPath: resolve });
        const services = { collectReachableCallableSignatures: () => index.callables };

        const members = getCompletionSpecs(main, main.indexOf("BL::") + 4, services);
        assert.deepStrictEqual(members.map((spec) => spec.label).sort(), ["TexChecker", "TexNoise3D"],
            "after `BL::`: that namespace's functions, from a 1.x header and a 2.0 one, and nothing else");

        const plainText = main.replace("BL::", "Te");
        const plain = getCompletionSpecs(plainText, plainText.indexOf("Te") + 2, services);
        assert.ok(plain.some((spec) => spec.label === "BL" && spec.kind === "Module"), "a namespace is offered by its name");
        assert.ok(!plain.some((spec) => spec.label === "TexChecker"), "...and its members only under it");
        assert.ok(plain.some((spec) => spec.label === "BLNoise_fade"), "a 2.0 header's plain function is offered");
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }

    const headerText = "Shader(Name = \"M\", )\n{\n}\n";
    const headerItems = getCompletionSpecs(headerText, headerText.indexOf(", )") + 2, {}).map((spec) => spec.label);
    assert.ok(headerItems.includes("NoGeneration"), `a Shader header completes NoGeneration (got ${headerItems.join(", ")})`);
    const namespaceText = "Namespace(Name = \"BL\", )\n{\n}\n";
    const namespaceItems = getCompletionSpecs(namespaceText, namespaceText.indexOf(", )") + 2, {}).map((spec) => spec.label);
    assert.ok(["Generate", "Library", "Description"].every((key) => namespaceItems.includes(key)), `a Namespace header completes its Generate keys (got ${namespaceItems.join(", ")})`);
}

console.log("headers smoke: ok");
