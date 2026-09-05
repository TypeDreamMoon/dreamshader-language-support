"use strict";

// The preprocessor mirror, checked against the plugin and against itself.
//
// `src/language/preprocessor.js` is a JavaScript copy of a C++ evaluator, which means it has the one
// failure mode a copy always has: it can be right today and wrong after someone edits the original.
// The editor's inactive-branch dimming is exactly the feature that fails silently when that happens
// -- a wrong answer is a grey block over live code, with no error anywhere to notice it -- so this
// file is arranged around catching drift rather than around covering lines.
//
// Three tiers, in decreasing order of authority:
//
//   1. CONFORMANCE VECTORS. The plugin exports its own evaluator's test vectors in the
//      DreamShader.PreprocessorDefines manifest: an expression, and either the value it produced or
//      the DSHnnnn it raised. Replaying them here is the only check that compares against the
//      original rather than against someone's reading of it. The manifest is written by the running
//      editor and is not part of this repository, so when it is absent this SAYS SO and moves on --
//      a skipped conformance run that printed nothing would read exactly like a passing one, which
//      is the failure mode the whole file exists to avoid.
//   2. SEMANTIC CHECKS. The rulings in `Docs/language/preprocessor.md` section "Values", written out
//      as assertions. These run everywhere, and they are what keeps a refactor of the mirror honest
//      on a machine with no Unreal project on it.
//   3. THE REGRESSION GATE. A `#` directive inside a `Function` body belongs to the HLSL
//      preprocessor, and dimming one would be a first-class bug: MoonToon's blend-mode switch would
//      be greyed down to its `#else` branch, telling an author the six live branches are dead. That
//      gate runs against an inline fixture always, and against the real .dsf when a project is
//      reachable.
//
// Optional, for tier 1 and for the real-file half of tier 3:
//   $env:DREAMSHADER_PROJECT_ROOT = 'I:\...\DevTest'                     # the project itself
//   $env:DREAMSHADER_CORPUS_DIR   = 'I:\...\DevTest\Plugins\DreamShader' # or the plugin, as
//                                                                       # corpus-smoke.js takes it

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { setHost } = require("../src/host");
const { invalidateProjectRootCache } = require("../src/project/projects");
const { readPreprocessorDefinesManifest } = require("../src/bridge/manifests");
const {
    analyzeSource,
    classifyDirectiveLine,
    computeInactiveRegions,
    evaluateCondition,
    parsePreprocessorInteger,
    splitSourceLines,
    stripTrailingLineComment
} = require("../src/language/preprocessor");

let checks = 0;
const notes = [];

function check(condition, message) {
    checks += 1;
    assert(condition, message);
}

function equal(actual, expected, message) {
    checks += 1;
    assert.deepStrictEqual(actual, expected, message);
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function makeReader(entries) {
    const map = entries instanceof Map ? entries : new Map(Object.entries(entries || {}));
    return (name) => (map.has(name) ? { value: String(map.get(name)) } : null);
}

/** `regions` as a flat list of line numbers, which is what an assertion about greying reads like. */
function inactiveLineNumbers(text, defines) {
    const lines = [];
    for (const region of computeInactiveRegions(text, { defines })) {
        for (let line = region.startLine; line <= region.endLine; line += 1) {
            lines.push(line);
        }
    }
    return lines;
}

function expectDiagnostic(text, code, message) {
    const analysis = analyzeSource(text, {});
    check(!analysis.ok, `${message}: expected the scan to fail`);
    equal(analysis.error.code, code, `${message}: expected ${code}, got ${analysis.error?.code}`);
    // The contract the dimmer relies on: a file the plugin would refuse greys nothing at all.
    equal(analysis.regions, [], `${message}: a refused file must produce no regions`);
}

function expectConditionCode(expression, code, defines, note = "") {
    const result = evaluateCondition(expression, makeReader(defines));
    check(!result.ok, `'${expression}' should have failed${note ? ` -- ${note}` : ""}`);
    equal(result.error.code, code, `'${expression}' should raise ${code}, got ${result.error?.code}`);
}

function expectConditionValue(expression, expected, defines, note = "") {
    const result = evaluateCondition(expression, makeReader(defines));
    check(result.ok, `'${expression}' should have evaluated, got ${result.error?.code} ${result.error?.message}`);
    equal(result.value, expected, `'${expression}' should be ${expected}${note ? ` -- ${note}` : ""}`);
}

function resolveProjectRoot() {
    const direct = process.env.DREAMSHADER_PROJECT_ROOT;
    if (direct && fs.existsSync(direct)) {
        return path.resolve(direct);
    }
    // corpus-smoke.js already asks for the plugin directory; a plugin lives at
    // <project>/Plugins/<Name>, so the project is two levels up. Checked rather than assumed.
    const corpus = process.env.DREAMSHADER_CORPUS_DIR;
    if (corpus && fs.existsSync(corpus)) {
        const candidate = path.resolve(corpus, "..", "..");
        if (fs.existsSync(candidate) && fs.readdirSync(candidate).some((entry) => entry.toLowerCase().endsWith(".uproject"))) {
            return candidate;
        }
    }
    return "";
}

function useProjectRoot(root) {
    setHost({
        getSetting: (name, fallback) => (name === "projectRoot" ? root : fallback),
        getWorkspaceFolderPaths: () => (root ? [root] : []),
        getActiveDocumentPath: () => "",
        getOpenDocumentPaths: () => []
    });
    invalidateProjectRootCache();
}

// -------------------------------------------------------------------------------------------------
// 1. Line splitting -- the invariant every line number in this file is stated in
// -------------------------------------------------------------------------------------------------

function testLineSplitting() {
    // Four lines, not five: the text ends without a terminator, so "d" IS the trailing line rather
    // than being followed by an empty one. The next assertion is the other half of the same rule --
    // "a\n" does end in a terminator, so its trailing line exists and is empty.
    equal(splitSourceLines("a\r\nb\nc\rd").map((line) => line.content), ["a", "b", "c", "d"],
        "CRLF is one terminator; a lone CR and a lone LF are one each");
    equal(splitSourceLines("a\n").length, 2, "A file ending in a newline still has its trailing empty line");
    equal(splitSourceLines("").length, 1, "Empty text is one empty line");
    equal(splitSourceLines("a\r\nb").map((line) => line.terminator), ["\r\n", ""],
        "Terminators are kept, so a line count computed here is the plugin's line count");

    equal(stripTrailingLineComment("DS_HOST == \"http://build\" // note"), "DS_HOST == \"http://build\" ",
        "The comment strip is quote-aware, so a URL in a string survives it");
    equal(classifyDirectiveLine("#  if FOO").keyword, "if", "Whitespace after the '#' is skipped");
    equal(classifyDirectiveLine("#if(A)").rest, "(A)", "The keyword run ends at '(' so '#if(A)' is a '#if'");
    equal(classifyDirectiveLine("#iffy").kind, "unknown", "'#iffy' is an unknown directive, not a mangled '#if'");
    equal(classifyDirectiveLine("  // #if FOO").kind, "none", "A commented-out directive is a comment");
    equal(classifyDirectiveLine("#Region Helpers").kind, "none", "Region directives pass through, case-insensitively");
    equal(classifyDirectiveLine("#REGION").kind, "none", "...in any case");
    equal(classifyDirectiveLine("#IF FOO").kind, "unknown", "A mis-cased directive is an error, not a silent no-op");
}

// -------------------------------------------------------------------------------------------------
// 2. Integer literals and the value domain
// -------------------------------------------------------------------------------------------------

function testValueDomain() {
    equal(parsePreprocessorInteger("42"), 42n, "Decimal");
    equal(parsePreprocessorInteger("0x1F"), 31n, "Lowercase 0x prefix");
    equal(parsePreprocessorInteger("0X1f"), 31n, "Uppercase 0X prefix");
    equal(parsePreprocessorInteger("-3"), -3n, "A signed literal counts, so '#define FOO -3' is an integer");
    equal(parsePreprocessorInteger("+7"), 7n, "...and so does an explicit '+'");
    equal(parsePreprocessorInteger("0755"), 755n, "No octal anywhere in this language, so 0755 is seven hundred and fifty-five");
    equal(parsePreprocessorInteger("12abc"), null, "Whole-string: a trailing remainder is not a literal");
    equal(parsePreprocessorInteger("0x"), null, "A prefix with no digits is not a literal");
    equal(parsePreprocessorInteger(""), null, "Neither is nothing");
    equal(parsePreprocessorInteger("-"), null, "Neither is a lone sign");
    equal(parsePreprocessorInteger("9223372036854775807"), 9223372036854775807n, "MAX_int64 fits");
    equal(parsePreprocessorInteger("-9223372036854775808"), -9223372036854775808n, "MIN_int64 fits, magnitude and all");
    equal(parsePreprocessorInteger("9223372036854775808"), null, "One past MAX_int64 is refused, not wrapped");

    // The reason the mirror uses BigInt. Both of these are the same Number and different int64s, so
    // a Number-based evaluator answers the first false and the second true -- silently, and only for
    // the projects whose defines happen to be large.
    expectConditionValue("9007199254740993 == 9007199254740993", true, {});
    expectConditionValue("9007199254740992 == 9007199254740993", false, {});
    // Overflow wraps rather than saturating, matching the C++, which does its arithmetic through
    // uint64 so signed overflow is never undefined behaviour. Written as `< 0` because the literal
    // -9223372036854775808 cannot be spelled in an expression: the grammar's INT is unsigned and the
    // `-` is a unary operator, so the tokenizer would refuse the magnitude on its own.
    expectConditionValue("9223372036854775807 + 1 < 0", true, {});
    expectConditionCode("9223372036854775808", "DSH1034", {},
        "an integer literal that does not fit is refused, not folded modulo 2^64");

    // Truncation toward zero, as in C and HLSL. JS's Number '/' would have produced -3.5 here.
    expectConditionValue("-7 / 2 == -3", true, {});
    expectConditionValue("-7 % 2 == -1", true, {});
    expectConditionValue("7 / -2 == -3", true, {});
    expectConditionCode("1 / 0", "DSH1041", {});
    expectConditionCode("1 % 0", "DSH1041", {});
    expectConditionCode("1 / (2 - 2)", "DSH1041", {});
}

// -------------------------------------------------------------------------------------------------
// 3. Identifier resolution -- the four rules, in order
// -------------------------------------------------------------------------------------------------

function testIdentifierResolution() {
    expectConditionValue("MISSING", false, {});
    expectConditionValue("MISSING == 0", true, {});
    // The empty-value row comes BEFORE the integer parse. Were it not, a bare `#define FOO` marker
    // would be the empty string, a string in a `#if` is DSH1040, and the commonest spelling of all
    // would be an error.
    expectConditionValue("MARKER", true, { MARKER: "" });
    expectConditionValue("MARKER == 1", true, { MARKER: "" });
    expectConditionValue("MARKER", true, { MARKER: "   " }, "Whitespace-only is still empty");
    expectConditionValue("QUALITY == 2", true, { QUALITY: "2" });
    expectConditionValue("QUALITY == 2", true, { QUALITY: " 2 " }, "A settings row typed with a stray space is a number");
    expectConditionValue("NEG == -3", true, { NEG: "-3" });
    expectConditionValue("PLATFORM == \"Windows\"", true, { PLATFORM: "Windows" });
    expectConditionValue("PLATFORM == \"windows\"", false, { PLATFORM: "Windows" },
        "String comparison is case-SENSITIVE");
    expectConditionValue("PLATFORM != \"Linux\"", true, { PLATFORM: "Windows" });

    // `#define PP_SUM 1 + 1` is the five-character string, not the integer 2.
    expectConditionCode("PP_SUM == 2", "DSH1040", { PP_SUM: "1 + 1" });

    // Names are case-sensitive: Foo and FOO are two defines.
    expectConditionValue("defined(Foo)", false, { FOO: "1" });
    expectConditionValue("defined(FOO)", true, { FOO: "1" });
    expectConditionValue("defined FOO", true, { FOO: "1" }, "Both spellings of 'defined'");
    expectConditionValue("defined(ZERO)", true, { ZERO: "0" }, "'defined' does not look at the value");
    expectConditionValue("!defined(MISSING)", true, {});
}

// -------------------------------------------------------------------------------------------------
// 4. Strings are never coerced to a truth value
// -------------------------------------------------------------------------------------------------

function testStringRefusals() {
    const defines = { PLATFORM: "Windows", QUALITY: "2" };
    expectConditionCode("PLATFORM", "DSH1040", defines);
    expectConditionCode("!PLATFORM", "DSH1040", defines);
    expectConditionCode("PLATFORM && QUALITY", "DSH1040", defines);
    expectConditionCode("QUALITY || PLATFORM", "DSH1040", { PLATFORM: "Windows", QUALITY: "0" });
    expectConditionCode("PLATFORM < \"x\"", "DSH1040", defines);
    expectConditionCode("PLATFORM >= \"1.9.0\"", "DSH1040", defines);
    expectConditionCode("PLATFORM + 1", "DSH1040", defines);
    expectConditionCode("PLATFORM == 1", "DSH1040", defines);
    expectConditionCode("1 == PLATFORM", "DSH1040", defines);
    expectConditionCode("\"a\" < \"b\"", "DSH1040", {});
    expectConditionValue("\"a\" == \"a\"", true, {}, "Equality is the one thing a string may do");
}

// -------------------------------------------------------------------------------------------------
// 5. Short-circuiting
// -------------------------------------------------------------------------------------------------

function testShortCircuit() {
    const defines = { PLATFORM: "Windows" };
    // The right operand is PARSED but not evaluated, so a type error in it is invisible -- exactly
    // as in C, and exactly what keeps its defines out of the build key.
    expectConditionValue("0 && PLATFORM", false, defines);
    expectConditionValue("1 || PLATFORM", true, defines);
    expectConditionValue("0 && 1 / 0", false, {}, "...and so is a division by zero");
    expectConditionValue("1 || 1 / 0", true, {});
    // But a MALFORMED right operand is still a syntax error, because the parse still happens.
    expectConditionCode("0 && (", "DSH1034", {});

    // A short-circuited define is not read at all, which is the property the build key needs.
    const read = [];
    const reader = (name) => {
        read.push(name);
        return name === "LEFT" ? { value: "0" } : { value: "1" };
    };
    const result = evaluateCondition("LEFT && RIGHT", reader);
    check(result.ok && result.value === false, "'LEFT && RIGHT' with LEFT=0 is false");
    equal(read, ["LEFT"], "The right operand of a false '&&' is never read");
}

// -------------------------------------------------------------------------------------------------
// 6. Grammar errors: DSH1034 (unfinished) versus DSH1042 (finished, with leftovers)
// -------------------------------------------------------------------------------------------------

function testGrammarErrors() {
    expectConditionCode("(1", "DSH1034", {});
    expectConditionCode("1 &&", "DSH1034", {});
    expectConditionCode("1 &&)", "DSH1034", {});
    expectConditionCode("&& 1", "DSH1034", {});
    expectConditionCode("1 & 2", "DSH1034", {}, "Bitwise operators are not in the grammar");
    expectConditionCode("\"unterminated", "DSH1034", {});
    expectConditionCode("0xZZ", "DSH1034", {});
    expectConditionCode("defined(1)", "DSH1034", {});

    expectConditionCode("1 2", "DSH1042", {});
    expectConditionCode("1)", "DSH1042", {});
    expectConditionCode("(1))", "DSH1042", {});

    expectConditionCode("", "DSH1036", {});
    expectConditionCode("   ", "DSH1036", {});

    expectConditionValue("!!1", true, {}, "Repeated unary operators are accepted");
    expectConditionValue("- -1 == 1", true, {});
    expectConditionValue("DS_ENGINE_MAJOR > 5 || (DS_ENGINE_MAJOR == 5 && DS_ENGINE_MINOR >= 7)", true,
        { DS_ENGINE_MAJOR: "5", DS_ENGINE_MINOR: "8" });
}

// -------------------------------------------------------------------------------------------------
// 7. Inactive regions
// -------------------------------------------------------------------------------------------------

function testInactiveRegions() {
    // 1 #if 0
    // 2 cut
    // 3 #else
    // 4 kept
    // 5 #endif
    equal(inactiveLineNumbers("#if 0\ncut\n#else\nkept\n#endif\n", {}), [2],
        "The false branch is dimmed and the directive lines are not");

    equal(inactiveLineNumbers("#if 1\nkept\n#else\ncut\n#endif\n", {}), [4],
        "...and the same the other way round");

    // A chain: the first true `#elif` wins, and every later branch is dead.
    const chain = [
        "#if A",        // 1
        "a",            // 2
        "#elif B",      // 3
        "b",            // 4
        "#elif C",      // 5
        "c",            // 6
        "#else",        // 7
        "d",            // 8
        "#endif"        // 9
    ].join("\n");
    equal(inactiveLineNumbers(chain, { B: "1", C: "1" }), [2, 6, 8],
        "The first true branch of a chain wins; later true conditions do not reopen it");
    equal(inactiveLineNumbers(chain, {}), [2, 4, 6],
        "With nothing defined the '#else' is the live branch");

    // Nesting, including a nested chain inside a cut branch: its own conditions are NOT evaluated,
    // only paired, so the whole inner block is dead whatever the inner condition says.
    const nested = [
        "#if 0",        // 1
        "outer",        // 2
        "#if 1",        // 3
        "inner",        // 4
        "#endif",       // 5
        "outer2",       // 6
        "#endif",       // 7
        "after"         // 8
    ].join("\n");
    equal(inactiveLineNumbers(nested, {}), [2, 4, 6],
        "A '#if 1' nested inside a cut branch stays cut");

    // A malformed condition inside a cut branch is not evaluated and therefore not an error, which
    // is what makes the whole file still dimmable.
    const deadNonsense = "#if 0\n#if )))\nx\n#endif\n#endif\n";
    const analysis = analyzeSource(deadNonsense, {});
    check(analysis.ok, "A condition inside a cut branch is never evaluated, so it cannot fail");
    equal(inactiveLineNumbers(deadNonsense, {}), [3], "...and its body is dimmed like the rest");

    // `#define` is file-local, takes effect only in an active region, and steers what follows.
    equal(inactiveLineNumbers("#define FANCY 1\n#if FANCY\nkept\n#else\ncut\n#endif\n", {}), [5],
        "A '#define' earlier in the file answers a later '#if'");
    // The '#define' on line 2 is one of the eight, so it stays at full strength like every other
    // directive line even though this build cuts it -- but it does nothing, which is why line 5 is
    // the dimmed one.
    equal(inactiveLineNumbers("#if 0\n#define FANCY 1\n#endif\n#if FANCY\ncut\n#endif\n", {}), [5],
        "A '#define' inside a cut branch does nothing, so the later '#if' is false");
    equal(inactiveLineNumbers("#undef FANCY\n#if FANCY\ncut\n#endif\n", { FANCY: "1" }), [3],
        "'#undef' removes an injected define for the rest of the file");
    equal(inactiveLineNumbers("#define MARK\n#if MARK\nkept\n#endif\n", {}), [],
        "A bare '#define' is a marker, which reads as 1");

    // The sugar.
    equal(inactiveLineNumbers("#ifdef FOO\nkept\n#else\ncut\n#endif\n", { FOO: "0" }), [4],
        "'#ifdef' asks whether the name exists, not what it says");
    equal(inactiveLineNumbers("#ifndef FOO\ncut\n#endif\n", { FOO: "0" }), [2],
        "'#ifndef' is its negation");

    // `#Region` is not a preprocessor directive: it passes through, and it is dimmed when cut.
    const regions = "#if 0\n#Region Helpers\nx\n#EndRegion\n#endif\n";
    const regionAnalysis = analyzeSource(regions, {});
    check(regionAnalysis.ok, "'#Region' inside a cut branch is not an unknown directive");
    equal(inactiveLineNumbers(regions, {}), [2, 3, 4], "...and is cut with the branch it sits in");

    // What the feature exists for: a `#if` wrapping an `import`.
    equal(inactiveLineNumbers(
        "#if DS_SUBSTRATE\nimport \"Shared/SubstrateHelpers.dsh\";\n#else\nimport \"Shared/LegacyHelpers.dsh\";\n#endif\n",
        { DS_SUBSTRATE: "1" }), [4], "A '#if' may wrap an 'import'");

    // Directive lines are never dimmed, including a nested chain inside a cut branch -- greying the
    // `#if` that explains the grey would hide the explanation.
    const directiveAnalysis = analyzeSource(nested, {});
    equal(directiveAnalysis.directiveLines, [1, 3, 5, 7], "All four directive lines are recognized");
    check(directiveAnalysis.directiveLines.every((line) => !inactiveLineNumbers(nested, {}).includes(line)),
        "No directive line is ever in a dimmed region");

    // A file with no directives has nothing to say.
    equal(inactiveLineNumbers("Shader(Name=\"M\") {\n}\n", {}), [], "A source with no directives dims nothing");
    equal(analyzeSource("Shader(Name=\"M\") {\n}\n", {}).hadDirectives, false, "...and reports no directives");
    equal(analyzeSource("#define A 1\n", {}).hadDirectives, true, "A '#define'-only file still has directives");
}

// -------------------------------------------------------------------------------------------------
// 8. The regression gate: `Function` / `GraphFunction` bodies are the shader compiler's
// -------------------------------------------------------------------------------------------------

function testOpaqueBodies() {
    // The shape of MF_MoonToonTranslucencyShadow.dsf, which is the case that proves the rule: read
    // as DreamShader source, every branch tests an undefined engine macro, `#else` wins, and the
    // editor would grey out the six live branches of a function that works.
    const hlsl = [
        "Function MoonToonBlendModeSwitch(",           // 1
        "\tin float3 Opaque,",                         // 2
        "\tout float3 Result)",                        // 3
        "{",                                           // 4
        "#if MATERIALBLENDING_SOLID",                  // 5
        "\tResult = Opaque;",                          // 6
        "#elif MATERIALBLENDING_MASKED",               // 7
        "\tResult = 0;",                               // 8
        "#else",                                       // 9
        "\tResult = 1;",                               // 10
        "#endif",                                      // 11
        "}",                                           // 12
        "",                                            // 13
        "Function Other(in float a, out float b)",     // 14
        "{",                                           // 15
        "#include \"/Engine/Private/Common.ush\"",     // 16
        "\tb = a;",                                    // 17
        "}"                                            // 18
    ].join("\n");

    const analysis = analyzeSource(hlsl, {});
    check(analysis.ok, "HLSL '#include' inside a Function body must not be DSH1035");
    equal(analysis.regions, [], "REGRESSION GATE: an HLSL '#if' chain inside a Function body dims nothing");
    equal(analysis.directiveLines, [], "...and contributes no directives at all");
    equal(analysis.hadDirectives, false, "...so a file whose only '#' lines are HLSL is still adoptable");

    // GraphFunction is opaque on the same terms.
    const graphFunction = "GraphFunction Helper(out float3 R)\n{\n#if PIXELSHADER\n\tR = 1;\n#endif\n}\n";
    equal(analyzeSource(graphFunction, {}).regions, [], "GraphFunction bodies are opaque too");

    // Neither `MaterialFunction` nor `VirtualFunction` may match on their `Function` tail.
    const virtualFunction = "VirtualFunction Foo(out float3 R);\n#if 0\ncut\n#endif\n";
    equal(inactiveLineNumbers(virtualFunction, {}), [3],
        "'VirtualFunction' is one token and does not open an opaque body");

    // A `}` inside a comment or a string must not close a body early and hand the rest back.
    const trickyBody = [
        "Function Tricky(out float3 R)",   // 1
        "{",                               // 2
        "\t// }",                          // 3
        "\tR = 1; // \"}\"",               // 4
        "#if MATERIALBLENDING_SOLID",      // 5
        "\tR = 0;",                        // 6
        "#endif",                          // 7
        "}",                               // 8
        "#if 0",                           // 9
        "cut",                             // 10
        "#endif"                           // 11
    ].join("\n");
    const tricky = analyzeSource(trickyBody, {});
    check(tricky.ok, "A '}' in a comment does not close a Function body");
    equal(tricky.regions, [{ startLine: 10, endLine: 10 }],
        "Only the real '#if' outside the body cuts anything");

    // The other half of the rule: a `#if` wrapping the WHOLE block does work, because the directives
    // are outside it.
    const wrapped = [
        "#if DS_SUBSTRATE",                                   // 1
        "Function ApplyShading(in float3 C, out float3 R)",   // 2
        "{",                                                  // 3
        "#if PIXELSHADER",                                    // 4
        "\tR = SubstratePath(C);",                            // 5
        "#endif",                                             // 6
        "}",                                                  // 7
        "#else",                                              // 8
        "Function ApplyShading(in float3 C, out float3 R)",   // 9
        "{ R = LegacyPath(C); }",                             // 10
        "#endif"                                              // 11
    ].join("\n");
    equal(inactiveLineNumbers(wrapped, { DS_SUBSTRATE: "0" }), [2, 3, 4, 5, 6, 7],
        "A '#if' around a whole Function block cuts the block, HLSL directives and all");
    equal(inactiveLineNumbers(wrapped, { DS_SUBSTRATE: "1" }), [9, 10],
        "...and the other way round, without the body's own '#if PIXELSHADER' being touched");
}

function testRealSourceTree(projectRoot) {
    if (!projectRoot) {
        notes.push("real source tree not scanned (no project root); the inline fixtures above still cover the gate");
        return 0;
    }

    const sources = [];
    const walk = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (_error) {
            return;
        }
        for (const entry of entries) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                // `Tests` holds the compiler's corpus, whose `.bad.` files are malformed on purpose.
                if (!["Intermediate", "Binaries", "Saved", "Tests", ".git"].includes(entry.name)) {
                    walk(full);
                }
            } else if (/\.(dsm|dsf|dsh)$/i.test(entry.name) && !entry.name.includes(".bad.")) {
                sources.push(full);
            }
        }
    };
    [path.join(projectRoot, "DShader"), path.join(projectRoot, "Plugins")].forEach(walk);

    // The stable assertion, and the only one this loop makes.
    //
    // `#include` outside a `Function` body is DSH1035 -- the declaration-level spelling is `import`.
    // Every `#include` in this tree is inside a body, so every file carrying one MUST analyze
    // cleanly. If the opaque-region tracker ever breaks, those files start failing with DSH1035 and
    // this catches it on real data rather than on a fixture written to agree with the code.
    //
    // What is deliberately NOT asserted is "no file produces regions". That is true today -- every
    // `#` directive in the tree is HLSL inside a body -- but it is true about the CONTENT of someone
    // else's project, and the first source to legitimately use `#if` would turn this file red for a
    // reason that has nothing to do with the extension.
    let withIncludes = 0;
    let withDirectives = 0;
    let refused = 0;
    for (const file of sources) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("#")) {
            continue;
        }
        const analysis = analyzeSource(text, {});
        if (/^[ \t]*#[ \t]*include\b/m.test(text)) {
            withIncludes += 1;
            check(analysis.ok,
                `${file}: an HLSL '#include' lives inside a Function body, so the scan must not raise ${analysis.error?.code}`);
        }
        if (analysis.ok && analysis.hadDirectives) {
            withDirectives += 1;
        }
        if (!analysis.ok) {
            refused += 1;
        }
    }

    // The named case from the design: read as DreamShader source, its six live branches would all be
    // greyed out and only the `#else` would look alive.
    const moonToon = path.join(projectRoot, "Plugins", "MoonToon", "DShader", "MaterialFunctions",
        "MF_MoonToonTranslucencyShadow.dsf");
    if (fs.existsSync(moonToon)) {
        const analysis = analyzeSource(fs.readFileSync(moonToon, "utf8"), {});
        check(analysis.ok, "MF_MoonToonTranslucencyShadow.dsf must analyze cleanly");
        equal(analysis.hadDirectives, false,
            "REGRESSION GATE (real file): its '#if MATERIALBLENDING_*' chain is HLSL, not a DreamShader directive");
        equal(analysis.regions, [], "...so not one of its lines may be dimmed");
        notes.push("MF_MoonToonTranslucencyShadow.dsf checked against the real file");
    }

    notes.push(`scanned ${sources.length} source file(s) under ${projectRoot}`
        + ` (${withIncludes} with an HLSL '#include', ${withDirectives} with DreamShader directives, ${refused} the scan refused)`);
    return sources.length;
}

// -------------------------------------------------------------------------------------------------
// 9. Structural errors: a refused file dims nothing
// -------------------------------------------------------------------------------------------------

function testStructuralErrors() {
    expectDiagnostic("#if 1\nx\n", "DSH1030", "an unclosed '#if'");
    expectDiagnostic("#if 1\n#if 1\nx\n#endif\n", "DSH1030", "one of two unclosed '#if's");
    expectDiagnostic("x\n#endif\n", "DSH1031", "a stray '#endif'");
    expectDiagnostic("x\n#else\n#endif\n", "DSH1032", "a stray '#else'");
    expectDiagnostic("x\n#elif 1\n", "DSH1032", "a stray '#elif'");
    expectDiagnostic("#if 1\n#else\n#elif 1\n#endif\n", "DSH1033", "an '#elif' after '#else'");
    expectDiagnostic("#if 1\n#else\n#else\n#endif\n", "DSH1033", "a second '#else'");
    expectDiagnostic("#IF FOO\n#endif\n", "DSH1035", "a mis-cased '#IF'");
    expectDiagnostic("#include \"x.dsh\"\n", "DSH1035", "'#include' at the declaration level");
    expectDiagnostic("#endfi\n", "DSH1035", "a typo that would leave everything below it enabled");
    expectDiagnostic("#if\n#endif\n", "DSH1036", "a '#if' with no expression");
    expectDiagnostic("#ifdef\n#endif\n", "DSH1036", "an '#ifdef' with no name");
    expectDiagnostic("#ifdef 1FOO\n#endif\n", "DSH1038", "an '#ifdef' with an unusable name");
    expectDiagnostic("#define 1FOO 1\n", "DSH1038", "a '#define' with an unusable name");
    expectDiagnostic("#define\n", "DSH1038", "a '#define' with no name at all");
    expectDiagnostic("#define DS_FOO 1\n", "DSH1039", "defining a reserved name");
    expectDiagnostic("#undef DS_SUBSTRATE\n", "DSH1039", "undefining a reserved name");
    expectDiagnostic("#if 1 2\n#endif\n", "DSH1042", "a complete condition with a leftover token");
    expectDiagnostic("#ifdef A B\n#endif\n", "DSH1042", "'#ifdef A B' desugars to '#if defined(A) B'");
    expectDiagnostic("#undef A B\n", "DSH1042", "'#undef' takes a name and nothing else");
    expectDiagnostic("#if 1\n#else junk\n#endif\n", "DSH1042", "'#else' takes no operand");
    expectDiagnostic("#if 1\n#endif MOONTOON_LEGACY\n", "DSH1042", "the C habit of labelling '#endif'");

    // `#else` / `#endif` belong to the CHAIN, so their shape is checked even inside a cut branch.
    expectDiagnostic("#if 0\n#if 1\n#endif junk\n#endif\n", "DSH1042",
        "'#endif' is checked whether or not its branch emits");

    // Depth: 64 levels are legal, the 65th is not.
    const open = (count) => Array.from({ length: count }, () => "#if 1").join("\n");
    const close = (count) => Array.from({ length: count }, () => "#endif").join("\n");
    check(analyzeSource(`${open(64)}\nx\n${close(64)}\n`, {}).ok, "Sixty-four levels of nesting are legal");
    expectDiagnostic(`${open(65)}\nx\n${close(65)}\n`, "DSH1037", "the sixty-fifth level");

    // Things that are legal and must stay so.
    check(analyzeSource("#define A B C\n", {}).ok, "'#define' has no trailing-token check: its value runs to end of line");
    check(analyzeSource("#if 1 // note\n#endif // note\n", {}).ok, "A trailing '//' comment is allowed on any directive");
    check(analyzeSource("#define ds_foo 1\n", {}).ok, "The reserved-prefix test is case-sensitive, so 'ds_foo' is ordinary");
    // The documented case: the trailing-comment strip is quote-aware, so the `//` in a URL does not
    // end the directive early and the comparison sees the whole string.
    equal(inactiveLineNumbers("#if DS_HOST == \"http://build\"\nkept\n#endif\n", { DS_HOST: "http://build" }), [],
        "A '//' inside a string literal does not end the directive");
    equal(inactiveLineNumbers("#if DS_HOST == \"http://build\"\nkept\n#endif\n", { DS_HOST: "http://other" }), [2],
        "...and the comparison it protects is a real one");
}

// -------------------------------------------------------------------------------------------------
// 10. Touched defines -- the build-key rule, mirrored so a future consumer can rely on it
// -------------------------------------------------------------------------------------------------

function testTouchedDefines() {
    const analysis = analyzeSource("#if defined(MISSING)\nx\n#endif\n#if PRESENT\ny\n#endif\n", {
        defines: { PRESENT: "1" }
    });
    equal(analysis.touchedDefines.get("MISSING"), "<undef>",
        "A define read while not defined is recorded with the sentinel, or adding it later would rebuild nothing");
    equal(analysis.touchedDefines.get("PRESENT"), "1", "A define that answered is recorded with its value");

    const local = analyzeSource("#define LOCAL 1\n#if LOCAL\nx\n#endif\n", {});
    check(!local.touchedDefines.has("LOCAL"),
        "A name the file defined itself is answered by the file's own text, so it is not recorded");

    const shortCircuited = analyzeSource("#if 0 && LATER\nx\n#endif\n", {});
    check(!shortCircuited.touchedDefines.has("LATER"), "A short-circuited operand is never read, so never recorded");

    const cut = analyzeSource("#if 0\n#if INSIDE\nx\n#endif\n#endif\n", {});
    check(!cut.touchedDefines.has("INSIDE"), "A condition inside a cut branch is not evaluated, so its names are not read");
}

// -------------------------------------------------------------------------------------------------
// 11. The manifest reader, and its degradation
// -------------------------------------------------------------------------------------------------

function testManifestReader() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dreamshader-preprocessor-"));
    try {
        const project = path.join(temporary, "Project");
        fs.mkdirSync(project, { recursive: true });
        fs.writeFileSync(path.join(project, "Project.uproject"), "{}", "utf8");

        // A project with no bridge output at all: the case of an older plugin, or one that has never
        // compiled. It must be silent and it must dim nothing.
        useProjectRoot(project);
        const absent = readPreprocessorDefinesManifest("");
        equal(absent.available, false, "A project with no manifest reports unavailable rather than throwing");
        equal(absent.defines.size, 0, "...and offers no defines to dim with");

        const bridge = path.join(project, "Saved", "DreamShader", "Bridge");
        fs.mkdirSync(bridge, { recursive: true });

        // Written by a plugin whose schema predates the field: also unavailable, not a crash.
        fs.writeFileSync(path.join(bridge, "preprocessor-defines.json"),
            JSON.stringify({ schema: "DreamShader.PreprocessorDefines", version: 1 }), "utf8");
        useProjectRoot(project);
        equal(readPreprocessorDefinesManifest("").available, false,
            "A manifest with no 'defines' array is treated as absent");

        // Malformed JSON: same.
        fs.writeFileSync(path.join(bridge, "preprocessor-defines.json"), "{ not json", "utf8");
        useProjectRoot(project);
        equal(readPreprocessorDefinesManifest("").available, false, "Unreadable JSON is treated as absent");

        fs.writeFileSync(path.join(bridge, "preprocessor-defines.json"), JSON.stringify({
            schema: "DreamShader.PreprocessorDefines",
            version: 1,
            revision: 3,
            defines: [
                { name: "DS_SUBSTRATE", value: "1", source: "Builtin", readOnly: true },
                { name: "DS_PLATFORM", value: "Windows", source: "Builtin", readOnly: true },
                { name: "MARKER", value: "", source: "Settings" },
                { name: "ds_foo", value: "9", source: "Settings" }
            ],
            fixtureDefines: [{ name: "FIXTURE", value: "7" }],
            conformance: [{ expr: "1 + 1 == 2", value: "1" }]
        }), "utf8");
        useProjectRoot(project);
        const present = readPreprocessorDefinesManifest("");
        equal(present.available, true, "A well-formed manifest is available");
        equal(present.revision, 3, "...and carries its revision");
        equal(present.defines.get("DS_SUBSTRATE"), "1", "...and its values");
        equal(present.defines.get("MARKER"), "", "An empty value survives the round trip, which is what makes it a marker");
        check(!present.defines.has("DS_FOO"), "Define names are case-sensitive: 'ds_foo' is not 'DS_FOO'");
        equal(present.fixtureDefines.get("FIXTURE"), "7", "Fixture defines are read separately");
        equal(present.conformance.length, 1, "...and so are the conformance vectors");

        // End to end, through the same call the decorator makes.
        equal(inactiveLineNumbers("#if DS_SUBSTRATE\nkept\n#else\ncut\n#endif\n", present.defines), [4],
            "The manifest's table drives the dimming");

        // The reader must not hand out a table the analyzer can mutate: `#define` writes to its own
        // copy, and a memoized manifest shared with the next call must not have grown a name.
        analyzeSource("#define SCRATCH 1\n", { defines: present.defines });
        check(!present.defines.has("SCRATCH"), "analyzeSource copies the table rather than writing through it");
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
        useProjectRoot("");
    }
}

// -------------------------------------------------------------------------------------------------
// 12. Conformance vectors -- the only tier that compares against the plugin itself
// -------------------------------------------------------------------------------------------------

function expectedVectorValue(vector) {
    if (typeof vector.value === "boolean") {
        return vector.value;
    }
    const text = String(vector.value).trim();
    // The plugin's verdict is a bool rendered as an integer; anything but a zero is true, matching
    // `Value.Integer != 0` at the bottom of EvaluateDreamShaderPreprocessorCondition.
    return text !== "" && text !== "0" && text.toLowerCase() !== "false";
}

function testConformanceVectors(projectRoot) {
    if (!projectRoot) {
        console.log("preprocessor smoke: skipped: no manifest — set DREAMSHADER_PROJECT_ROOT (or DREAMSHADER_CORPUS_DIR) to replay the plugin's own evaluator vectors.");
        return 0;
    }

    useProjectRoot(projectRoot);
    const manifest = readPreprocessorDefinesManifest("");
    if (!manifest.available) {
        console.log(`preprocessor smoke: skipped: no manifest — ${projectRoot} has no Saved/DreamShader/Bridge/preprocessor-defines.json yet (the plugin writes it on its first compile).`);
        return 0;
    }
    if (manifest.conformance.length === 0) {
        console.log(`preprocessor smoke: skipped: no manifest vectors — ${projectRoot}'s manifest carries no 'conformance' array, so nothing was compared against the plugin.`);
        return 0;
    }

    // The vectors are stated against `fixtureDefines`, which the plugin exports for exactly this
    // purpose; `defines` (the live project table) is used only if there are no fixtures, so that an
    // older manifest still gets replayed rather than silently skipped.
    const table = manifest.fixtureDefines.size > 0 ? manifest.fixtureDefines : manifest.defines;
    const which = manifest.fixtureDefines.size > 0 ? "fixtureDefines" : "defines";
    const reader = makeReader(table);

    const failures = [];
    for (const vector of manifest.conformance) {
        const expression = String(vector?.expr ?? "");
        const result = evaluateCondition(expression, reader);

        if (vector && vector.error) {
            if (result.ok) {
                failures.push(`'${expression}': expected ${vector.error}, evaluated to ${result.value}`);
            } else if (result.error.code !== String(vector.error)) {
                failures.push(`'${expression}': expected ${vector.error}, got ${result.error.code}`);
            }
            continue;
        }

        if (!result.ok) {
            failures.push(`'${expression}': expected ${vector?.value}, got ${result.error.code} (${result.error.message})`);
            continue;
        }
        const expected = expectedVectorValue(vector);
        if (result.value !== expected) {
            failures.push(`'${expression}': expected ${expected}, got ${result.value}`);
        }
    }

    checks += manifest.conformance.length;
    assert.strictEqual(failures.length, 0,
        `The JavaScript evaluator disagrees with the plugin on ${failures.length} of ${manifest.conformance.length} vector(s):\n  ${failures.join("\n  ")}`);

    notes.push(`replayed ${manifest.conformance.length} conformance vector(s) against ${which} (revision ${manifest.revision})`);
    return manifest.conformance.length;
}

// -------------------------------------------------------------------------------------------------

function main() {
    const projectRoot = resolveProjectRoot();

    testLineSplitting();
    testValueDomain();
    testIdentifierResolution();
    testStringRefusals();
    testShortCircuit();
    testGrammarErrors();
    testInactiveRegions();
    testOpaqueBodies();
    testStructuralErrors();
    testTouchedDefines();
    testManifestReader();
    testRealSourceTree(projectRoot);
    testConformanceVectors(projectRoot);

    for (const note of notes) {
        console.log(`preprocessor smoke: ${note}`);
    }
    console.log(`preprocessor smoke tests passed (${checks} checks)`);
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exit(1);
}
