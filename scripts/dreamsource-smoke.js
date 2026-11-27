"use strict";

// The DreamSource layout (spec section 12), checked without an editor:
//
//   1. where the source directory is configured, and which of the two places is read (pure, on a fake fs)
//   2. the same against a real project tree: source roots, plugin roots, the ancestor fallback
//   3. Intermediate/DreamSource/shader.db, built here with node:sqlite the way the plugin writes it, read
//      through every reader the editor features use -- and the old Saved/DreamShader layout as fallback
//   4. moving DShader/ to DreamSource/Shader, workspace file included

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { setHost } = require("../src/host");
const dreamSource = require("../src/project/dreamSource");
const projects = require("../src/project/projects");
const paths = require("../src/bridge/paths");
const database = require("../src/bridge/database");
const manifests = require("../src/bridge/manifests");
const { createIndexStore, describeIndexLocation } = require("../src/dss/indexStore");
const { createCatalogReader } = require("../src/dss/catalog");
const { createPassKeysReader } = require("../src/dsp/passKeys");
const { createPipelineIndexReader, expectedIndexPath } = require("../src/dsp/pipelineIndex");
const { migrateProject } = require("../src/project/migrate");
const { resolveImportPath } = require("../src/project/imports");

let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (actual, expected, message) => { checks++; assert.deepStrictEqual(actual, expected, message); };
const norm = (value) => String(value || "").replace(/\\/g, "/");

const notices = [];
function useProjectRoot(root) {
    setHost({
        getSetting: (name, fallback) => (name === "projectRoot" ? root : fallback),
        getWorkspaceFolderPaths: () => (root ? [root] : []),
        getActiveDocumentPath: () => "",
        getOpenDocumentPaths: () => [],
        notify: (level, message) => notices.push({ level, message })
    });
    projects.invalidateProjectRootCache();
}

function write(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
}

// ------------------------------------------------------------------------------------- 1. the table, on a fake fs
{
    const parse = dreamSource.parseSourceDirectorySetting;
    const section = dreamSource.DREAM_SHADER.settingsSection;
    eq(parse(`[${section}]\nSourceDirectory=(Path="Art/Shaders")\n`, section), "Art/Shaders", "the FDirectoryPath spelling");
    eq(parse(`[${section}]\r\nSourceDirectory=Art\\Shaders\\\r\n`, section), "Art/Shaders", "a bare value, backslashes and a trailing one");
    eq(parse(`[${section}]\nSourceDirectory=(Path="C:/Abs")\n`, section), undefined, "an absolute path stands for nothing");
    eq(parse(`[Other]\nSourceDirectory=X\n`, section), undefined, "another section's key is not ours");
    eq(parse(`[${section}]\nSourceDirectory=A\nSourceDirectory=B\n`, section), "B", "the last assignment wins");

    const files = new Map();
    const dirs = new Set();
    const fakeFs = {
        isDirectory: (p) => dirs.has(norm(p)),
        isFile: (p) => files.has(norm(p)),
        readText: (p) => files.get(norm(p)),
        list: () => []
    };
    const join = (...parts) => parts.join("/");
    const P = "/p";
    const read = () => dreamSource.readConfiguredSourceDirectory(P, undefined, fakeFs, join);

    eq(read(), { setting: "DreamSource/Shader", origin: "default" }, "nothing configured: the default");
    files.set("/p/Config/DefaultEngine.ini", "[/Script/DreamShader.DreamShaderSettings]\nSourceDirectory=(Path=\"DShader\")\n");
    eq(read(), { setting: "DreamSource/Shader", origin: "default" }, "the legacy key at its old default counts as unset");
    files.set("/p/Config/DefaultEngine.ini", "[/Script/DreamShader.DreamShaderSettings]\nSourceDirectory=(Path=\"MyShaders\")\n");
    eq(read(), { setting: "MyShaders", origin: "legacySetting" }, "a custom legacy value is still honoured");
    files.set("/p/Config/DefaultDreamSource.ini", `[${section}]\nSourceDirectory=(Path="DreamSource/Shader")\n`);
    eq(read(), { setting: "DreamSource/Shader", origin: "dreamSource" }, "DefaultDreamSource.ini outranks the legacy key");
    files.delete("/p/Config/DefaultEngine.ini");

    const resolve = () => dreamSource.resolveProjectSourceRoot(P, undefined, fakeFs, join);
    eq(resolve().state, "none", "neither folder");
    eq(resolve().directory, "/p/DreamSource/Shader", "...and the configured one is where sources go");
    dirs.add("/p/DShader");
    eq([resolve().state, resolve().directory], ["legacy", "/p/DShader"], "only the old folder: read it");
    ok(/DShader\/ is deprecated/.test(dreamSource.deprecationNotice(resolve())), "and say it is deprecated");
    dirs.add("/p/DreamSource/Shader");
    eq([resolve().state, resolve().directory], ["configuredAndLegacy", "/p/DreamSource/Shader"], "both: the new one wins");
    ok(/is ignored/.test(dreamSource.deprecationNotice(resolve())), "and the old one is said to be ignored");
    dirs.delete("/p/DShader");
    eq([resolve().state, dreamSource.deprecationNotice(resolve())], ["configured", undefined], "only the new one: nothing to say");

    files.set("/p/Config/DefaultDreamSource.ini", `[${section}]\nSourceDirectory=DShader\n`);
    dirs.add("/p/DShader");
    eq(resolve().state, "configured", "a setting that names the old folder itself is not 'both'");

    dirs.add("/pl/DShader");
    eq(dreamSource.resolvePluginSourceDirectory("/pl", undefined, fakeFs, join), { directory: "/pl/DShader", legacy: true }, "a plugin's old folder");
    dirs.add("/pl/DreamSource/Shader");
    eq(dreamSource.resolvePluginSourceDirectory("/pl", undefined, fakeFs, join), { directory: "/pl/DreamSource/Shader", legacy: false }, "a plugin's new folder wins");

    const legacyRoot = { projectDir: "/p", configuredSetting: "DreamSource/Shader", configuredDir: "/p/DreamSource/Shader", legacyDir: "/p/DShader", state: "legacy" };
    ok(!dreamSource.planMigration(legacyRoot, true).ok, "no move while an editor holds the bridge");
    ok(!dreamSource.planMigration({ ...legacyRoot, state: "configuredAndLegacy" }, false).ok, "no move onto an existing folder");
    const plan = dreamSource.planMigration(legacyRoot, false, undefined, join);
    eq([plan.ok, plan.from, plan.to], [true, "/p/DShader", "/p/DreamSource/Shader"], "a move from the old folder to the new");
    eq(plan.staleDirectories, ["/p/Saved/DreamShader/Bridge", "/p/Saved/DreamShader/Index", "/p/Intermediate/DreamShader"], "with the old generated output to clear");
}

// ------------------------------------------------------------------------------------ 2-4. a real project on disk
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dreamsource-smoke-"));
const writers = [];
try {
    const project = norm(path.join(temporary, "Demo"));
    write(`${project}/Demo.uproject`, "{}");
    useProjectRoot(project);

    // ---- 2. roots
    write(`${project}/DShader/Materials/M_Old.dss`, "// old\n");
    write(`${project}/Plugins/Fx/Fx.uplugin`, "{}");
    write(`${project}/Plugins/Fx/DShader/Shared/Common.dsh`, "// fx\n");
    write(`${project}/Plugins/Tools/Tools.uplugin`, "{}");
    write(`${project}/Plugins/Tools/DreamSource/Shader/Lib/Util.dsh`, "// tools\n");
    write(`${project}/Plugins/Tools/DShader/Ignored.dsh`, "// shadowed by DreamSource/Shader\n");

    let roots = projects.collectSourceRoots(project);
    eq(norm(roots[0].directory), `${project}/DShader`, "a project with only DShader/ is read from there");
    ok(roots[0].legacy && roots[0].isProjectRoot, "...flagged as the legacy place");
    eq(norm(projects.getPackagesDirectory(project)), `${project}/DShader/Packages`, "Packages/ follows the source directory");
    const byPlugin = Object.fromEntries(roots.filter((root) => root.pluginName).map((root) => [root.pluginName, norm(root.directory)]));
    eq(byPlugin, { Fx: `${project}/Plugins/Fx/DShader`, Tools: `${project}/Plugins/Tools/DreamSource/Shader` }, "plugins: DreamSource/Shader first, DShader otherwise");
    eq(norm(resolveImportPath(`${project}/Plugins/Tools/DreamSource/Shader/Lib/A.dss`, "Util.dsh")), `${project}/Plugins/Tools/DreamSource/Shader/Lib/Util.dsh`, "imports resolve inside a DreamSource/Shader plugin root");

    const outside = norm(path.join(temporary, "Loose", "DreamSource", "Shader", "X", "M.dss"));
    write(outside, "");
    eq(norm(projects.findAncestorSourceRoot(outside).directory), norm(path.join(temporary, "Loose", "DreamSource", "Shader")), "a DreamSource/Shader ancestor is a root by its name");

    // ---- 4. the move (before shader.db exists, as it would be for a project upgrading)
    write(`${project}/DShader/DreamShader.code-workspace`, JSON.stringify({
        folders: [
            { name: "DreamShader Source", path: "." },
            { name: "Plugin: Fx", path: "../Plugins/Fx/DShader" },
            { name: "Plugin: Tools", path: "../Plugins/Tools/DShader" }
        ],
        settings: { "files.associations": { "*.dss": "dreamshader-dss" } }
    }, null, "\t"));
    write(`${project}/Saved/DreamShader/Bridge/settings.json`, "{}");
    write(`${project}/Saved/DreamShader/Index/Project/X.dss.index.json`, "{}");
    write(`${project}/Intermediate/DreamShader/GeneratedShaders/A.ush`, "");

    write(`${project}/Saved/DreamShader/Bridge/status.json`, "{}");
    ok(!migrateProject(project).ok, "the move is refused while an editor is alive");
    fs.rmSync(`${project}/Saved/DreamShader/Bridge/status.json`);

    const moved = migrateProject(project);
    ok(moved.ok, `the move succeeds: ${moved.message}`);
    ok(fs.existsSync(`${project}/DreamSource/Shader/Materials/M_Old.dss`) && !fs.existsSync(`${project}/DShader`), "DShader/ is now DreamSource/Shader/");
    ok(!fs.existsSync(`${project}/Saved/DreamShader/Bridge`) && !fs.existsSync(`${project}/Saved/DreamShader/Index`)
        && !fs.existsSync(`${project}/Intermediate/DreamShader`), "and the old generated output is gone");
    const workspace = JSON.parse(fs.readFileSync(`${project}/DreamSource/Shader/DreamShader.code-workspace`, "utf8"));
    eq(workspace.folders.map((folder) => folder.path), [".", "../../Plugins/Fx/DShader", "../../Plugins/Tools/DreamSource/Shader"],
        "the workspace file's plugin folders are re-aimed from the new place, to each plugin's current root");
    eq(workspace.settings["files.associations"]["*.dss"], "dreamshader-dss", "and the rest of it is kept");
    ok(moved.workspaceRewritten, "...and says so");
    eq(migrateProject(project).ok, false, "a second move has nothing to move");

    roots = projects.collectSourceRoots(project);
    eq([norm(roots[0].directory), roots[0].legacy], [`${project}/DreamSource/Shader`, false], "the roots follow the move");

    // ---- 3. shader.db
    const dbPath = paths.getShaderDatabasePath(project);
    eq(norm(dbPath), `${project}/Intermediate/DreamSource/shader.db`, "shader.db's place");
    eq(database.getShaderDatabaseStatus(project), "absent", "no shader.db yet");
    eq(norm(paths.getBridgeDirectory(project)), `${project}/Intermediate/DreamSource/Shader/Bridge`, "a project with no old output talks to the new bridge folder");

    if (!database.isSqliteAvailable()) {
        throw new Error("node:sqlite is not available in this Node; the database half cannot be checked");
    }
    const { DatabaseSync } = require("node:sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    // Left open for the whole test, as the editor might: what a reader sees must include what is still in -wal.
    const writer = new DatabaseSync(dbPath);
    writers.push(writer);
    writer.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE settings_mappings(kind TEXT NOT NULL, alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, value INTEGER NOT NULL, name TEXT, display_name TEXT, source TEXT NOT NULL, PRIMARY KEY(kind, normalized_alias));
        CREATE TABLE material_expressions(name TEXT PRIMARY KEY, class_name TEXT NOT NULL, path_name TEXT NOT NULL, default_output_type TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE substrate_builtins(name TEXT PRIMARY KEY, qualified_name TEXT NOT NULL, class_name TEXT NOT NULL, output_type TEXT NOT NULL, is_substrate_output INTEGER NOT NULL, detail TEXT, example TEXT, snippet TEXT, json TEXT NOT NULL);
        CREATE TABLE diagnostics(path TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at_utc TEXT NOT NULL);
        CREATE TABLE documents(name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_utc TEXT NOT NULL);
        CREATE TABLE source_index(root TEXT NOT NULL, path TEXT NOT NULL, json TEXT NOT NULL, updated_utc TEXT NOT NULL, PRIMARY KEY(root, path));`);
    const setMeta = writer.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)");
    const bump = (part) => {
        const current = (key) => Number((writer.prepare("SELECT value FROM meta WHERE key = ?").get(key) || { value: 0 }).value);
        setMeta.run(`${part}_revision`, String(current(`${part}_revision`) + 1));
        setMeta.run("revision", String(current("revision") + 1));
    };
    setMeta.run("schema", "1");
    setMeta.run("producer", "DreamShader@test");
    setMeta.run("diagnostics_updated_utc", "2026-11-26T10:00:00.000Z");

    const material = `${project}/DreamSource/Shader/Materials/M_Old.dss`;
    writer.prepare("INSERT INTO diagnostics VALUES(?, ?, ?)").run(material,
        JSON.stringify({ path: material, diagnostics: [{ severity: "error", message: "boom", line: 2, column: 3, code: "DSH1001" }] }), "2026-11-26T09:00:00.000Z");
    bump("diagnostics");
    writer.prepare("INSERT INTO material_expressions VALUES(?, ?, ?, ?, ?)").run("ZZTestNode", "MaterialExpressionZZTestNode", "/Script/Engine.X", "float",
        JSON.stringify({ name: "ZZTestNode", className: "MaterialExpressionZZTestNode" }));
    bump("material_expressions");
    writer.prepare("INSERT INTO settings_mappings VALUES(?, ?, ?, ?, ?, ?, ?)").run("shadingModels", "ZZToon", "zztoon", 7, "MSM_ZZToon", "ZZ Toon", "test");
    bump("settings_mappings");

    const docs = writer.prepare("INSERT OR REPLACE INTO documents VALUES(?, ?, ?)");
    const passKeysText = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "dsp", "pass-keys.json"), "utf8");
    docs.run("pass-keys", passKeysText, "2026-11-26T09:00:00.000Z");
    docs.run("builtin-catalog", JSON.stringify({ schema: "dreamshader-builtin-catalog", version: 1, engine: "5.8", expressions: [
        { namespace: "UE", shortName: "Multiply", className: "MaterialExpressionMultiply", inputs: [{ name: "A", type: "float" }], outputs: [{ name: "", type: "float" }] }
    ] }), "2026-11-26T09:00:00.000Z");
    docs.run("preprocessor-defines", JSON.stringify({ schema: "DreamShader.PreprocessorDefines", version: 1, revision: 4, defines: [{ name: "DS_TEST", value: "3" }] }), "x");
    docs.run("preview", JSON.stringify({ version: 1, status: "ready", sourceFile: material, imagePath: `${project}/Intermediate/DreamSource/Shader/Preview/a.png` }), "x");
    bump("documents");

    const sourceIndex = (file) => JSON.stringify({ schema: "dreamshader-symbol-index", version: 1, file, declarations: [{ kind: "function", name: "Glow", file, line: 1, column: 1 }], references: [], includes: [] });
    writer.prepare("INSERT INTO source_index VALUES(?, ?, ?, ?)").run("Project", "Materials/M_Old.dss", sourceIndex(material), "2026-11-26T09:00:00.000Z");
    const passFile = `${project}/DreamSource/Shader/Passes/CP_X.dsp`;
    write(passFile, "");
    writer.prepare("INSERT INTO source_index VALUES(?, ?, ?, ?)").run("Project", "Passes/CP_X.dsp",
        JSON.stringify({ ...JSON.parse(sourceIndex(passFile)), pipeline: { passes: [{ name: "Blur", kind: "compute", file: passFile, line: 3, column: 1 }] } }), "2026-11-26T09:00:00.000Z");
    bump("index");

    // Stale files from an older plugin beside an updated one: never read while shader.db is there.
    write(`${project}/Saved/DreamShader/Bridge/diagnostics.json`, JSON.stringify({ version: 1, files: [{ path: "stale", diagnostics: [] }] }));
    write(`${project}/Saved/DreamShader/Bridge/preprocessor-defines.json`, JSON.stringify({ defines: [{ name: "STALE", value: "1" }] }));

    eq(database.getShaderDatabaseStatus(project), "ready", "shader.db, schema 1: ready");
    const diagnostics = database.queryDiagnosticsFromDatabase(project);
    eq([diagnostics.files.length, diagnostics.files[0].diagnostics[0].code, diagnostics.updatedAtUtc],
        [1, "DSH1001", "2026-11-26T10:00:00.000Z"], "diagnostics, rebuilt from rows, stamped from meta -- read through the open writer's WAL");
    ok(database.queryDiagnosticsFromDatabase(project) === diagnostics, "unchanged: the same answer, not a re-read");

    ok(manifests.collectMaterialExpressionSymbols(project).some((entry) => entry.name === "ZZTestNode"), "material expressions from shader.db");
    ok(manifests.collectDreamShaderSettingMappings(material, "shadingModels").some((entry) => entry.alias === "ZZToon"), "settings mappings from shader.db");
    const defines = manifests.readPreprocessorDefinesManifest(material);
    eq([defines.available, defines.revision, defines.defines.get("DS_TEST"), defines.defines.has("STALE")], [true, 4, "3", false],
        "preprocessor defines from the document, the stale json ignored");

    const keys = createPassKeysReader(project).get();
    eq([keys.source, norm(keys.path)], ["project", norm(dbPath)], "pass keys from the document");
    ok(createCatalogReader(project).get().byName.has("UE.Multiply"), "the builtin catalog from the document");
    eq(database.readShaderDocument(project, database.DOCUMENTS.preview).status, "ready", "the preview result from the document");

    const store = createIndexStore(project);
    store.refresh();
    eq(store.findForSource(material).map((index) => index.declarations[0].name), ["Glow"], "the symbol index from source_index");
    eq(norm(describeIndexLocation(project)), norm(dbPath), "...and says where it came from");
    eq(norm(expectedIndexPath(project, passFile)), `${norm(dbPath)}#Project/Passes/CP_X.dsp`, "a .dsp's index is keyed by root and relative path");
    eq(createPipelineIndexReader(project).lookup(passFile).index.pipeline.passes[0].name, "Blur", "and found by that key");

    writer.prepare("UPDATE source_index SET json = ? WHERE path = ?").run(
        sourceIndex(material).replace("\"Glow\"", "\"Shine\""), "Materials/M_Old.dss");
    bump("index");
    store.refresh();
    eq(store.findForSource(material).map((index) => index.declarations[0].name), ["Shine"], "a bumped index revision is re-read");

    setMeta.run("schema", "2");
    notices.length = 0;
    eq(database.getShaderDatabaseStatus(project), "unsupported", "a schema this side does not know");
    eq(database.queryDiagnosticsFromDatabase(project), null, "...is not read");
    eq(manifests.readPreprocessorDefinesManifest(`${project}/x.dss`).available, false, "...and the stale json is not read instead");
    database.getShaderDatabaseStatus(project);
    eq(notices.filter((notice) => notice.level === "warning").length, 1, "the author is told once");
    setMeta.run("schema", "1");

    write(`${project}/Intermediate/DreamSource/Shader/Bridge/status.json`, "{}");
    eq(norm(paths.getBridgeDirectory(project)), `${project}/Intermediate/DreamSource/Shader/Bridge`, "the live editor's bridge folder");
    ok(paths.isBridgeAlive(project), "...which is what refuses a migration");

    writer.close();
    writers.length = 0;

    // ---- 3b. the old layout, for a plugin from before DreamSource
    const old = norm(path.join(temporary, "Old"));
    write(`${old}/Old.uproject`, "{}");
    write(`${old}/DShader/M.dss`, "");
    write(`${old}/Saved/DreamShader/Bridge/diagnostics.json`, JSON.stringify({ version: 1, updatedAtUtc: "t", files: [{ path: `${old}/DShader/M.dss`, diagnostics: [] }] }));
    write(`${old}/Saved/DreamShader/Bridge/preprocessor-defines.json`, JSON.stringify({ revision: 2, defines: [{ name: "OLD", value: "1" }] }));
    write(`${old}/Saved/DreamShader/Bridge/status.json`, "{}");
    useProjectRoot(old);
    notices.length = 0;
    eq(database.getShaderDatabaseStatus(old), "absent", "no shader.db");
    ok(paths.usesLegacyLayout(old), "the old layout");
    eq(norm(paths.getBridgeDirectory(old)), `${old}/Saved/DreamShader/Bridge`, "an old plugin's live bridge is talked to where it listens");
    eq(manifests.readPreprocessorDefinesManifest(`${old}/DShader/M.dss`).defines.get("OLD"), "1", "the old json is read");
    manifests.readPreprocessorDefinesManifest(`${old}/DShader/M.dss`);
    eq(notices.filter((notice) => notice.level === "info").length, 1, "and the author is told, once, to update the plugin");
} finally {
    for (const writer of writers) {
        try {
            writer.close();
        } catch (_error) {
            // already closed
        }
    }
    useProjectRoot("");
    fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(`dreamsource smoke: ok (${checks} checks)`);
