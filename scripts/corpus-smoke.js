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
    ["L_UnterminatedBlock.bad.dsm", /Unclosed '\{'/],
    ["L_UnterminatedString.bad.dsm", /missing a trailing ';'/],
    ["T_FunctionNoOut.bad.dsh", /must declare at least one out parameter|should declare at least one out parameter/],
    ["T_FunctionReturnVoid.bad.dsh", /cannot use a bare 'return;'/],
    ["T_ShaderNoName.bad.dsm", /Shader\(Name="\.\.\."\) is required\./],
    ["T_TwoShaders.bad.dsm", /Only one top-level Shader block is currently supported\./]
]);

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
    if (!CORPUS) {
        console.log("corpus smoke tests skipped (DREAMSHADER_CORPUS_DIR is not set)");
        return;
    }

    const { good, bad } = collect(CORPUS);
    assert(good.length > 0, `no .dsm/.dsf/.dsh files under ${CORPUS}`);

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
        const messages = language.getDiagnostics(fs.readFileSync(file, "utf8"), file, {})
            .map((diagnostic) => diagnostic.message);
        if (!messages.some((message) => expected.test(message))) {
            misses.push(`${name}: expected ${expected}, got ${messages.length ? messages.join(" | ") : "nothing"}`);
        }
    }
    assert.deepStrictEqual(misses, [], `${misses.length} rejections the compiler makes and this does not`);

    // A name in the list that is no longer in the corpus is a stale expectation, which would
    // otherwise sit there passing forever without checking anything.
    const present = new Set(bad.map((file) => path.basename(file)));
    const stale = [...EXPECTED_REJECTIONS.keys()].filter((name) => !present.has(name));
    assert.deepStrictEqual(stale, [], "expected rejections naming files that are no longer in the corpus");

    console.log(`corpus smoke tests passed (${good.length} accepted, ${EXPECTED_REJECTIONS.size} of ${bad.length} rejected sources owned here)`);
}

main();
