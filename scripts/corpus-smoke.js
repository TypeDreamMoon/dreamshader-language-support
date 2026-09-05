"use strict";

// The extension, checked against the compiler's own corpus.
//
// Everything else in `scripts/` tests this codebase against fixtures this codebase wrote, which
// proves it agrees with itself. This one runs over the DreamShader plugin's `Tests/Corpus` -- the
// files the C++ parser is tested with -- and asserts the two things that can be asserted without an
// engine:
//
//   * A source the compiler accepts produces no diagnostic here. A false positive is the worse of
//     the two failures: it tells an author their file is broken when the build will take it.
//   * A source the compiler rejects for a reason visible in the text produces one here. Not every
//     `.bad.` file qualifies -- most fail on something only the engine knows -- so the ones that do
//     are listed by name rather than assumed, and the list is the record of what this half owns.
//
// `checkPreprocessorDirectives` runs before either of those and needs no corpus: the compiler's
// conditional compilation is a rule about plain text, which is this file's subject, and its fixtures
// have to be inline because the corpus has no source carrying a `#if` yet.
//
// Opt-in, because the plugin is not part of this repository:
//
//   $env:DREAMSHADER_CORPUS_DIR = 'I:\...\Plugins\DreamShader'; npm run test:corpus

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const language = require("../src/language");

const CORPUS = process.env.DREAMSHADER_CORPUS_DIR;

/**
 * The negative corpus this half is answerable for, and the compiler's own wording for each.
 *
 * A `.bad.` file not listed here fails on something semantic -- a type mismatch, a missing asset --
 * which stays with the compiler for the reason the whole codebase is arranged around: two sources of
 * truth on the same question drift, and the way that shows up is the editor and the build
 * disagreeing.
 */
const EXPECTED_REJECTIONS = new Map([
    ["L_UnterminatedBlock.bad.dsm", { message: /Unclosed '\{'/ }],
    ["L_UnterminatedString.bad.dsm", { message: /missing a trailing ';'/ }],
    ["T_FunctionNoOut.bad.dsh", { message: /must declare at least one out parameter|should declare at least one out parameter/, code: "DSH3011" }],
    ["T_FunctionReturnVoid.bad.dsh", { message: /cannot use a bare 'return;'/, code: "DSH3012" }],
    ["T_ShaderNoName.bad.dsm", { message: /Shader\(Name="\.\.\."\) is required\./, code: "DSH3031" }],
    ["T_TwoShaders.bad.dsm", { message: /Only one top-level Shader block is currently supported\./, code: "DSH3030" }]
]);

/**
 * Every DSHnnnn this extension emits, checked against the compiler's published pages.
 *
 * The code is the compiler's stable identity for a rule -- `DreamShaderDiagnostic.h` says as much,
 * and names the editor extensions as one of the things keying off it. So a code here that the
 * compiler does not publish is either a typo or a rule that has since been renumbered, and both are
 * worse than emitting no code at all.
 */
function assertCodesArePublished(corpusRoot) {
    const emitted = new Set();
    const walkSource = (file) => {
        for (const match of fs.readFileSync(file, "utf8").matchAll(/"(DSH\d{4})"/g)) {
            emitted.add(match[1]);
        }
    };
    walkSource(path.join(__dirname, "..", "src", "language", "diagnostics.js"));
    if (emitted.size === 0) {
        return 0;
    }

    const published = new Set();
    const docsDirectory = path.join(corpusRoot, "Docs", "diagnostics");
    let pages;
    try {
        pages = fs.readdirSync(docsDirectory);
    } catch (_error) {
        console.log("  (no Docs/diagnostics in the corpus; skipped the code check)");
        return 0;
    }
    for (const page of pages) {
        for (const match of fs.readFileSync(path.join(docsDirectory, page), "utf8").matchAll(/generated:begin (DSH\d{4})/g)) {
            published.add(match[1]);
        }
    }

    const unknown = [...emitted].filter((code) => !published.has(code)).sort();
    assert.deepStrictEqual(unknown, [], "DSH codes emitted here that the compiler does not publish");
    return emitted.size;
}

/**
 * Conditional compilation, read by the side that has no define table.
 *
 * `#if` / `#ifdef` / `#ifndef` / `#elif` / `#else` / `#endif` / `#define` / `#undef` arrived in the
 * compiler's 1.9.0. The corpus carries no source with one yet -- every preprocessor test over there
 * is an inline string in `DreamShaderPreprocessorTests.cpp` -- so the fixtures are inline here too,
 * and when the corpus does grow one the sweep in `main()` picks it up with no change here.
 *
 * The compiler resolves a `#if` against a table injected from C++, the project settings and
 * `dsc -D`, and cuts the branch that loses. This side has none of those and never will, so it does
 * the only other correct thing: it blanks the directive LINES and keeps BOTH branches. Every symbol
 * in the file stays reachable and every `import` stays a dependency -- the same direction the
 * compiler's own dependency graph errs in, and for the same reason. An editor offering a symbol from
 * a branch this build happens to cut is a small annoyance; an editor hiding the symbol under the
 * cursor is not an editor.
 *
 * Needs no corpus, so it runs either way.
 */
function checkPreprocessorDirectives() {
    // preprocessor.md's own worked example. The two branches differ in a `Settings` line, in the
    // NAMES of the outputs and in their TYPES -- which is the whole reason `#if` exists here, since
    // no arrangement of switch nodes reaches any of those.
    const conditional = [
        'Shader(Name="Materials/M_Conditional", Root="Game")',
        "{",
        "    Settings = {",
        '        Domain = "Surface";',
        "#if !DS_SUBSTRATE",
        '        ShadingModel = "DefaultLit";',
        "#endif",
        "    }",
        "",
        "    Properties {",
        "        vec3 Tint = vec3(0.8, 0.2, 0.1);",
        "    }",
        "",
        "    Outputs = {",
        "#if DS_SUBSTRATE",
        "        Substrate Surface;",
        "        Base.FrontMaterial = Surface;",
        "#else",
        "        vec3 BaseColor;",
        "        Base.BaseColor = BaseColor;",
        "#endif",
        "    }",
        "",
        "    Graph = {",
        "#if DS_SUBSTRATE",
        "        Surface = Substrate.Slab(DiffuseAlbedo = Tint, Roughness = 0.4);",
        "#else",
        "        BaseColor = Tint;",
        "#endif",
        "    }",
        "}"
    ].join("\n");

    const [shader] = language.getDocumentSymbols(conditional);
    const sectionOf = (name) => (shader.children || []).find((child) => child.name === name);
    const labelsIn = (name) => (sectionOf(name)?.children || []).map((child) => `${child.name}:${child.detail}`);

    // Both branches, with their declared types intact. The type is the assertion that bites: a
    // directive line carries no `;`, so a `#if` left in the text is swallowed by the statement after
    // it and `Substrate Surface;` comes back as a declaration of type `#if DS_SUBSTRATE Substrate`.
    assert.deepStrictEqual(labelsIn("Settings"), ["Domain:setting", "ShadingModel:setting"],
        "a Settings line behind a `#if` is still a setting");
    assert.deepStrictEqual(labelsIn("Outputs"),
        ["Surface:Substrate", "Base.FrontMaterial:binding", "BaseColor:vec3", "Base.BaseColor:binding"],
        "both Outputs branches are indexed, with the types they declare");
    assert.deepStrictEqual(labelsIn("Graph"), ["Surface:setting", "BaseColor:setting"],
        "both Graph branches are indexed");

    // Offsets do not drift. Directive lines are blanked to an equal-length run of spaces rather than
    // removed, so every symbol's range still points at the identifier in the text the author sees --
    // which is what go-to-definition, hover, rename and the completion replace range all ride on.
    // (The compiler conserves LINES instead, for its diagnostics; the two are not the same promise,
    // and DSH9001 exists because line conservation alone is not enough to splice bytes with.)
    for (const [section, name, anchor] of [
        ["Properties", "Tint", "vec3 Tint"],
        ["Outputs", "Surface", "Substrate Surface"],
        ["Outputs", "BaseColor", "vec3 BaseColor"]
    ]) {
        const symbol = sectionOf(section).children.find((child) => child.name === name);
        assert.strictEqual(
            conditional.slice(symbol.selectionStartOffset, symbol.selectionEndOffset), name,
            `${section}.${name} selection range should still cover its identifier`);
        assert.strictEqual(symbol.selectionStartOffset, conditional.indexOf(anchor) + anchor.length - name.length,
            `${section}.${name} offset drifted`);
    }

    // No diagnostic may land on a directive line. Asserted as an overlap test rather than a count,
    // so an unrelated rule firing on the fixture stays this file's business and not this test's.
    const directiveRanges = [];
    for (const match of conditional.matchAll(/^[ \t]*#[ \t]*(?:if|ifdef|ifndef|elif|else|endif|define|undef)\b[^\n]*/gm)) {
        directiveRanges.push([match.index, match.index + match[0].length]);
    }
    assert.strictEqual(directiveRanges.length, 8, "the fixture should carry eight directive lines");
    const onDirective = language.getDiagnostics(conditional, "M_Conditional.dsm", {})
        .filter((diagnostic) => directiveRanges.some(([start, end]) =>
            diagnostic.startOffset < end && diagnostic.endOffset > start))
        .map((diagnostic) => `${diagnostic.severity} ${diagnostic.message}`);
    assert.deepStrictEqual(onDirective, [], "diagnostics reported on a preprocessor directive line");

    // A `Function` / `GraphFunction` body is the shader compiler's, `#` lines included. Getting this
    // wrong is silent rather than loud: MoonToon's blend-mode switch would keep compiling and start
    // returning the wrong value for every blend mode, because the wrong preprocessor answered.
    const hlsl = [
        "Function MoonToonBlendModeSwitch(",
        "\tin float3 Opaque,",
        "\tin float3 Masked,",
        "\tout float3 Result)",
        "{",
        "#if MATERIALBLENDING_SOLID",
        "\tResult = Opaque;",
        "#elif MATERIALBLENDING_MASKED",
        "\tResult = Masked;",
        "#else",
        "\tResult = 0;",
        "#endif",
        "}",
        "",
        "Function SelfContained Remap01(in float value, out float result) {",
        '#include "/Engine/Private/Common.ush"',
        "\tresult = saturate(value * 0.5 + 0.5);",
        "}",
        "",
        "GraphFunction WindPulse(in float2 uv, out float pulse) {",
        "#if 1",
        "\tpulse = sin(uv.x);",
        "#endif",
        "}"
    ].join("\n");

    assert.strictEqual(language.stripPreprocessorDirectivesPreserveLayout(hlsl), hlsl,
        "every directive here is inside a body, so the text comes back byte for byte");
    const bodies = language.parseDocument(hlsl).blocks;
    assert.deepStrictEqual(bodies.map((block) => `${block.kind} ${block.name}`),
        ["Function MoonToonBlendModeSwitch", "Function Remap01", "GraphFunction WindPulse"],
        "a signature spanning lines, a modifier and a GraphFunction are all bodies");
    for (const block of bodies) {
        assert.strictEqual(block.bodyText, hlsl.slice(block.bodyOffset, block.bodyCloseOffset),
            `${block.name} body text must reach the generated .ush unchanged`);
    }
    assert(bodies[0].bodyText.includes("#elif MATERIALBLENDING_MASKED"));
    assert(bodies[1].bodyText.includes('#include "/Engine/Private/Common.ush"'));

    // The other direction of the same rule: a `#if` around whole Function blocks is DreamShader's,
    // and both blocks are indexed.
    const wrapped = language.parseDocument([
        "#if DS_SUBSTRATE",
        "Function ApplySubstrate(in float3 C, out float3 R) { R = SubstratePath(C); }",
        "#else",
        "Function ApplyLegacy(in float3 C, out float3 R) { R = LegacyPath(C); }",
        "#endif"
    ].join("\n"));
    assert.deepStrictEqual(wrapped.blocks.map((block) => block.name), ["ApplySubstrate", "ApplyLegacy"],
        "a `#if` outside the bodies selects between them, so both are declarations here");

    // `#Region` is a different thing wearing a similar hat, and the parser has always matched it
    // case-insensitively (`IsGraphDirective` compares with `ESearchCase::IgnoreCase`). The eight
    // preprocessor keywords are the opposite: lowercase only, because the compiler answers a
    // mis-cased `#IF` or a mistyped `#endfi` with DSH1035 rather than letting it quietly do nothing.
    for (const spelling of ['#Region "Main"', '#region "main"', "#REGION x", "#EndRegion", "#endregion"]) {
        assert.strictEqual(language.stripPreprocessorDirectivesPreserveLayout(spelling), spelling,
            `${spelling} is the parser's, not the preprocessor's`);
    }
    const lowercaseRegion = language.getDocumentSymbols([
        'Shader(Name="Materials/M_Region")',
        "{",
        "    Graph = {",
        '#region "surface"',
        "        Color = 1.0;",
        "#endregion",
        "    }",
        "}"
    ].join("\n"))[0];
    assert.deepStrictEqual(
        lowercaseRegion.children.find((child) => child.name === "Graph").children.map((child) => child.name),
        ["Color"],
        "a lowercase #region must fold away like a capitalised one, not glue itself to the statement after it");
    for (const line of ["#IF FOO", "#Endif", "#ifdefined FOO", "#endfi", '#include "x"']) {
        assert.strictEqual(language.stripPreprocessorDirectivesPreserveLayout(`${line}\nvec3 A;`), `${line}\nvec3 A;`,
            `${line} is none of the eight spellings, so it stays for the compiler to reject`);
    }

    console.log("preprocessor directive checks passed (both branches indexed, offsets held, bodies untouched)");
}

function collect(root) {
    const good = [];
    const bad = [];

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
                if ([".git", "node_modules", "Intermediate", "Binaries", "Saved"].includes(entry.name)) {
                    continue;
                }
                walk(full);
                continue;
            }
            if (!/\.(dsm|dsf|dsh)$/i.test(entry.name)) {
                continue;
            }
            (/\.bad\./i.test(entry.name) ? bad : good).push(full);
        }
    };

    walk(root);
    return { good, bad };
}

function main() {
    checkPreprocessorDirectives();

    if (!CORPUS) {
        console.log("corpus smoke tests skipped (DREAMSHADER_CORPUS_DIR is not set)");
        return;
    }

    const { good, bad } = collect(CORPUS);
    assert(good.length > 0, `no .dsm/.dsf/.dsh files under ${CORPUS}`);

    // "A source with no directives comes back byte for byte" is the compiler's own promise, and this
    // is the cheapest place to hold this side to it: every `#` in the corpus today is a `#Region` or
    // an HLSL directive inside a `Function` body, so the preprocessor pass must be a no-op over all
    // of it. It is also what makes the sweep below a fair test -- a parser fed identical text cannot
    // have changed its mind about anything.
    const rewritten = [...good, ...bad].filter((file) => {
        const text = fs.readFileSync(file, "utf8");
        return language.stripPreprocessorDirectivesPreserveLayout(text) !== text;
    }).map((file) => path.relative(CORPUS, file));
    assert.deepStrictEqual(rewritten, [],
        `${rewritten.length} sources changed by a preprocessor pass that should have found nothing to cut`);

    const falsePositives = [];
    for (const file of good) {
        for (const diagnostic of language.getDiagnostics(fs.readFileSync(file, "utf8"), file, {})) {
            falsePositives.push(`${path.relative(CORPUS, file)}: ${diagnostic.severity} ${diagnostic.message}`);
        }
    }
    assert.deepStrictEqual(falsePositives, [],
        `${falsePositives.length} diagnostics on sources the compiler accepts`);

    const misses = [];
    for (const file of bad) {
        const name = path.basename(file);
        const expected = EXPECTED_REJECTIONS.get(name);
        if (!expected) {
            continue;
        }
        const found = language.getDiagnostics(fs.readFileSync(file, "utf8"), file, {});
        const match = found.find((diagnostic) => expected.message.test(diagnostic.message));
        if (!match) {
            misses.push(`${name}: expected ${expected.message}, got ${found.length ? found.map((d) => d.message).join(" | ") : "nothing"}`);
            continue;
        }
        if (expected.code && match.code !== expected.code) {
            misses.push(`${name}: expected code ${expected.code}, got ${match.code || "none"}`);
        }
    }
    assert.deepStrictEqual(misses, [], `${misses.length} rejections the compiler makes and this does not`);

    const codeCount = assertCodesArePublished(CORPUS);

    // Every symbol, at every depth, has a name.
    //
    // The client rejects a falsy one with "name must not be falsy", and it converts the tree in one
    // pass -- so a single nameless node three levels down fails the whole documentSymbol request and
    // takes the outline, the breadcrumbs and go-to-symbol with it. In-process that throw was
    // swallowed per-provider and only left the outline blank, which is how a nameless Graph
    // assignment sat here unnoticed since May. Asserted over the corpus rather than a fixture,
    // because the shape that broke it is in almost every real file and in none of the fixtures.
    const nameless = [];
    let symbolCount = 0;
    const walkSymbols = (nodes, file, trail) => {
        for (const node of nodes || []) {
            symbolCount += 1;
            if (!node.name) {
                nameless.push(`${path.relative(CORPUS, file)}: ${[...trail, `<${node.kind}/${node.detail}>`].join(" > ")}`);
            }
            walkSymbols(node.children, file, [...trail, node.name || "?"]);
        }
    };
    for (const file of [...good, ...bad]) {
        walkSymbols(language.getDocumentSymbols(fs.readFileSync(file, "utf8")), file, []);
    }
    assert.deepStrictEqual(nameless, [], `${nameless.length} symbols with no name`);

    // A name in the list that is no longer in the corpus is a stale expectation, which would
    // otherwise sit there passing forever without checking anything.
    const present = new Set(bad.map((file) => path.basename(file)));
    const stale = [...EXPECTED_REJECTIONS.keys()].filter((name) => !present.has(name));
    assert.deepStrictEqual(stale, [], "expected rejections naming files that are no longer in the corpus");

    console.log(`corpus smoke tests passed (${good.length} accepted, ${EXPECTED_REJECTIONS.size} of ${bad.length} rejected sources owned here, ${codeCount} DSH codes all published, ${symbolCount} symbols all named)`);
}

main();
