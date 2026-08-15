"use strict";

// Import resolution, checked against a real directory tree.
//
// `resolveImportPath` is the one part of the extension whose answer is a fact about the file system,
// so it is the one part that cannot be tested with injected services the way `language-smoke.js`
// tests everything else -- every case here builds the tree it asks about.
//
// The table it checks is the plugin's Docs/language/import.md: three candidates in order, each
// containment-checked against a root, and an unqualified specifier that never leaves the root owning
// the importing file. That last rule is what this file exists for. Before source roots, everything
// resolved against `<Project>/DShader` and was containment-checked against it, so every import
// written inside a plugin's own `DShader` tree -- the form a plugin's sources are *supposed* to use
// -- reported as unresolvable while the engine compiled it without complaint.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveImportPath, collectAvailableImports } = require("../src/project/imports");
const { invalidateProjectRootCache } = require("../src/project/projects");

function write(filePath, text = "") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
}

function makeTempDirectory(prefix) {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * A project with one plugin, nested a directory deep under `Plugins` the way UE lets plugins be
 * grouped, so the discovery walk is exercised rather than just the flat case.
 */
const project = makeTempDirectory("dreamshader-imports-");
const pluginRoot = path.join(project, "Plugins", "Category", "MoonToon");

write(path.join(project, "Fixture.uproject"), JSON.stringify({ FileVersion: 3 }));
write(path.join(project, "Secret.dsh"));
write(path.join(project, "DShader", "Top.dsm"));
write(path.join(project, "DShader", "Materials", "M_Project.dsm"));
write(path.join(project, "DShader", "Shared", "Common.dsh"));
write(path.join(project, "DShader", "Packages", "@scope", "pkg", "Library", "Noise.dsh"));
write(path.join(project, "Loose", "Stray.dsm"));

write(path.join(pluginRoot, "MoonToon.uplugin"), JSON.stringify({ FileVersion: 3 }));
write(path.join(pluginRoot, "DShader", "Materials", "M_Plugin.dsm"));
write(path.join(pluginRoot, "DShader", "Shared", "Toon.dsh"));
write(path.join(pluginRoot, "DShader", "Packages", "@scope", "toonpkg", "Lib.dsh"));

// A plugin with no `.uproject` anywhere above it -- a plugin repository opened on its own, which is
// how a plugin author works on one. Nothing here can discover a root list for it, so it is the case
// the ancestor-`DShader` fallback is for.
const standalone = makeTempDirectory("dreamshader-standalone-");
write(path.join(standalone, "Standalone.uplugin"), JSON.stringify({ FileVersion: 3 }));
write(path.join(standalone, "DShader", "Materials", "M_Standalone.dsm"));
write(path.join(standalone, "DShader", "Shared", "Alone.dsh"));

invalidateProjectRootCache();

const projectMaterial = path.join(project, "DShader", "Materials", "M_Project.dsm");
const projectTop = path.join(project, "DShader", "Top.dsm");
const pluginMaterial = path.join(pluginRoot, "DShader", "Materials", "M_Plugin.dsm");
const looseMaterial = path.join(project, "Loose", "Stray.dsm");
const standaloneMaterial = path.join(standalone, "DShader", "Materials", "M_Standalone.dsm");

function assertResolves(fromFilePath, specifier, expected, message) {
    assert.strictEqual(
        resolveImportPath(fromFilePath, specifier),
        expected.replace(/\\/g, "/"),
        message);
}

function assertUnresolved(fromFilePath, specifier, message) {
    assert.strictEqual(resolveImportPath(fromFilePath, specifier), "", message);
}

// ------------------------------------------------------------------ the three candidates, in order

assertResolves(projectMaterial, "Shared/Common.dsh",
    path.join(project, "DShader", "Shared", "Common.dsh"),
    "Candidate 2 should find a file under the owning root's source directory");
assertResolves(projectMaterial, "Shared/Common",
    path.join(project, "DShader", "Shared", "Common.dsh"),
    "A specifier with no extension should gain '.dsh'");
assertResolves(projectMaterial, "../Shared/Common.dsh",
    path.join(project, "DShader", "Shared", "Common.dsh"),
    "Candidate 1 may climb as far as the containing root");
assertResolves(projectMaterial, "@scope/pkg/Library/Noise.dsh",
    path.join(project, "DShader", "Packages", "@scope", "pkg", "Library", "Noise.dsh"),
    "Candidate 3 should find a package file -- '@' is an ordinary directory character");
assertResolves(projectMaterial, "Packages/@scope/pkg/Library/Noise.dsh",
    path.join(project, "DShader", "Packages", "@scope", "pkg", "Library", "Noise.dsh"),
    "The same package file is reachable through candidate 2 by its path under the root");
assertUnresolved(projectTop, "../Secret.dsh",
    "Containment should skip every candidate that resolves outside its own root");

// ------------------------------------------------------------------------ roots do not leak either way

assertResolves(pluginMaterial, "Shared/Toon.dsh",
    path.join(pluginRoot, "DShader", "Shared", "Toon.dsh"),
    "A plugin's source should resolve against that plugin's own root");
assertResolves(pluginMaterial, "@scope/toonpkg/Lib.dsh",
    path.join(pluginRoot, "DShader", "Packages", "@scope", "toonpkg", "Lib.dsh"),
    "A plugin root carries its own Packages directory");
assertUnresolved(pluginMaterial, "Shared/Common.dsh",
    "An unqualified specifier must not reach the project root from inside a plugin");
assertUnresolved(projectMaterial, "Shared/Toon.dsh",
    "...nor the other way, which is what stops a new plugin changing what an existing import means");

// -------------------------------------------------------------------------- crossing a root on purpose

for (const qualifier of ["Plugin.MoonToon", "Plugins.MoonToon", "Plugin/MoonToon", "Plugins/MoonToon", "plugin.moontoon"]) {
    assertResolves(projectMaterial, `${qualifier}:Shared/Toon.dsh`,
        path.join(pluginRoot, "DShader", "Shared", "Toon.dsh"),
        `'${qualifier}:' should name the MoonToon root`);
}
assertResolves(pluginMaterial, "Project:Shared/Common.dsh",
    path.join(project, "DShader", "Shared", "Common.dsh"),
    "'Project:' should name the project root from inside a plugin");
assertResolves(projectMaterial, "Plugin.MoonToon:@scope/toonpkg/Lib.dsh",
    path.join(pluginRoot, "DShader", "Packages", "@scope", "toonpkg", "Lib.dsh"),
    "A qualified specifier tries the target root's Packages directory second");
assertUnresolved(projectMaterial, "Plugin.NotInstalled:Shared/Toon.dsh",
    "A qualifier naming no live root resolves to nothing");
assertUnresolved(pluginMaterial, "Plugin.MoonToon:../../Secret.dsh",
    "A qualified candidate is containment-checked like any other");

// Text before a ':' that is not one of the qualifier shapes is not a qualifier: the specifier is
// resolved as an ordinary path, which is what keeps a Windows drive letter failing the way it did.
assertUnresolved(projectMaterial, "C:/Nowhere/Probe.dsh",
    "An absolute path outside every root should stay unresolved");

// ------------------------------------------------------------------------------- files outside a root

assertResolves(looseMaterial, "Shared/Common.dsh",
    path.join(project, "DShader", "Shared", "Common.dsh"),
    "A file under no root falls back to the project's directories, as it did before roots existed");
assertUnresolved(looseMaterial, "../Secret.dsh",
    "...but its own-directory candidate is confined to its own directory, so no '..' resolves through it");

assertResolves(standaloneMaterial, "Shared/Alone.dsh",
    path.join(standalone, "DShader", "Shared", "Alone.dsh"),
    "A plugin opened with no .uproject above it still resolves inside its own DShader tree");
assertResolves(standaloneMaterial, "Plugin.Standalone:Shared/Alone.dsh",
    path.join(standalone, "DShader", "Shared", "Alone.dsh"),
    "...and the fallback root answers to the plugin's own name");

// ----------------------------------------------------------------------------- completion candidates

const pluginImports = collectAvailableImports(pluginMaterial);
assert(pluginImports.includes("Shared/Toon.dsh"),
    "Completion should offer the owning root's files bare");
assert(pluginImports.includes("@scope/toonpkg/Lib.dsh"),
    "Completion should offer the owning root's packages by their package-style path");
assert(!pluginImports.includes("Shared/Common.dsh"),
    "Completion must not offer a bare path from a root the file cannot see -- it would complete straight into a diagnostic");
assert(pluginImports.includes("Project:Shared/Common.dsh"),
    "Another root's files should be offered in the qualified form that reaches them");
for (const specifier of pluginImports) {
    assert(resolveImportPath(pluginMaterial, specifier),
        `Every offered specifier should resolve from the file it was offered for: ${specifier}`);
}

const projectImports = collectAvailableImports(projectMaterial);
assert(projectImports.includes("Shared/Common.dsh") && projectImports.includes("Plugin.MoonToon:Shared/Toon.dsh"),
    "The project root sees its own files bare and the plugin's qualified");

fs.rmSync(project, { recursive: true, force: true });
fs.rmSync(standalone, { recursive: true, force: true });

console.log("import resolution smoke tests passed");
