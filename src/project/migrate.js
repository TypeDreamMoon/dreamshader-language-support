"use strict";

// Moving a project's legacy `DShader/` to its DreamSource directory (spec 12.5), the disk half:
// refuses what planMigration refuses, else moves the folder, clears what an older plugin generated
// outside it, and re-aims the folder's DreamShader.code-workspace. No `vscode` here, so the smoke tests
// run it against a real directory; src/vscode/migration.js is the window around it.

const fs = require("fs");
const path = require("path");
const { planMigration, resolvePluginSourceDirectory, rewriteWorkspaceFile } = require("./dreamSource");
const { resolveProjectShaderSource, invalidateProjectRootCache } = require("./projects");
const { isBridgeAlive } = require("../bridge/paths");
const { invalidateBridgeDatabaseCache } = require("../bridge/database");

const WORKSPACE_FILE_NAME = "DreamShader.code-workspace";

/** Moves `from` to `to`; a rename where it can, a copy and delete across volumes. */
function moveDirectory(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if (!error || error.code !== "EXDEV") {
            throw error;
        }
        fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(from, { recursive: true, force: true });
    }
}

/**
 * Re-aims the moved folder's DreamShader.code-workspace (its paths are relative to itself). Returns
 * whether it was rewritten; a file that is not there, or not JSON, is left as it is.
 */
function rewriteMovedWorkspaceFile(from, to) {
    const workspaceFile = path.join(to, WORKSPACE_FILE_NAME);
    let text;
    try {
        text = fs.readFileSync(workspaceFile, "utf8");
    } catch (_error) {
        return false;
    }
    const rewritten = rewriteWorkspaceFile(text, from, to, (pluginDir) => {
        const found = resolvePluginSourceDirectory(pluginDir);
        return found ? found.directory : null;
    });
    if (rewritten === text) {
        return false;
    }
    fs.writeFileSync(workspaceFile, rewritten, "utf8");
    return true;
}

/** `{ ok, message, from?, to?, workspaceRewritten? }` for one project. */
function migrateProject(projectDir) {
    invalidateProjectRootCache();
    const root = resolveProjectShaderSource(projectDir);
    if (!root) {
        return { ok: false, message: "no Unreal project (.uproject) found." };
    }
    const plan = planMigration(root, isBridgeAlive(projectDir));
    if (!plan.ok) {
        return { ok: false, message: plan.reason };
    }
    try {
        moveDirectory(plan.from, plan.to);
    } catch (error) {
        return {
            ok: false,
            message: `could not move ${plan.from} to ${plan.to}: ${error && error.message}. A file in it may be open in another program.`
        };
    }
    for (const stale of plan.staleDirectories) {
        try {
            fs.rmSync(stale, { recursive: true, force: true });
        } catch (_error) {
            // Left behind is harmless: an updated plugin reads and writes Intermediate/DreamSource/ only.
        }
    }
    let workspaceRewritten = false;
    try {
        workspaceRewritten = rewriteMovedWorkspaceFile(plan.from, plan.to);
    } catch (_error) {
        // The editor regenerates it on Open Dream Shader Workspace.
    }
    invalidateProjectRootCache();
    invalidateBridgeDatabaseCache(projectDir);
    return { ok: true, from: plan.from, to: plan.to, workspaceRewritten, message: `moved ${plan.from} to ${plan.to}.` };
}

module.exports = {
    WORKSPACE_FILE_NAME,
    moveDirectory,
    rewriteMovedWorkspaceFile,
    migrateProject
};
