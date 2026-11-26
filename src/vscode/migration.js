"use strict";

// The old `DShader/` folder: said once per project per window (spec 12.5), with a way to move it and a
// way to stop hearing about it. What to say is project/dreamSource.js's; the move itself is
// project/migrate.js's; this file asks the window. Mirrors the dreamgui extension's src/migration.ts.

const path = require("path");
const vscode = require("vscode");
const { DREAM_SHADER, deprecationNotice, samePath } = require("../project/dreamSource");
const { findProjectRoot, findProjectRootForCommand, resolveProjectShaderSource } = require("../project/projects");
const { migrateProject } = require("../project/migrate");

const DISMISSED_KEY = "dreamshader.dreamSource.dismissed";
const MIGRATE = "Migrate to DreamSource";
const DONT_SHOW = "Don't show again";

function dismissalKey(projectDir, state) {
    return `${state}|${projectDir.replace(/\\/g, "/").toLowerCase()}`;
}

function registerDreamSourceMigration(context, { onMigrated = () => {} } = {}) {
    const asked = new Set();

    const isDismissed = (key) => (context.globalState.get(DISMISSED_KEY) || []).includes(key);
    const dismiss = async (key) => {
        const current = context.globalState.get(DISMISSED_KEY) || [];
        if (!current.includes(key)) {
            await context.globalState.update(DISMISSED_KEY, [...current, key]);
        }
    };

    const migrate = async (projectDir) => {
        const result = migrateProject(projectDir);
        if (!result.ok) {
            void vscode.window.showWarningMessage(`DreamShader: ${result.message}`);
            return;
        }
        onMigrated(projectDir);
        const reopened = (vscode.workspace.workspaceFolders || []).some((folder) =>
            samePath(folder.uri.fsPath, result.from)
            || folder.uri.fsPath.toLowerCase().startsWith(result.from.toLowerCase() + path.sep));
        void vscode.window.showInformationMessage(`DreamShader: ${result.message}`
            + (reopened ? " This window was opened on the old folder; reopen it from the new one." : "")
            + " Files open from the old folder need opening again.");
    };

    const check = (documentPath) => {
        const projectDir = findProjectRoot(documentPath || "");
        if (!projectDir) {
            return;
        }
        const root = resolveProjectShaderSource(projectDir);
        const notice = root ? deprecationNotice(root, DREAM_SHADER) : undefined;
        const key = root ? dismissalKey(projectDir, root.state) : "";
        if (!notice || asked.has(key) || isDismissed(key)) {
            return;
        }
        asked.add(key);
        const actions = root.state === "legacy" ? [MIGRATE, DONT_SHOW] : [DONT_SHOW];
        void vscode.window.showWarningMessage(`DreamShader: ${notice}`, ...actions).then(async (choice) => {
            if (choice === MIGRATE) {
                await migrate(projectDir);
            } else if (choice === DONT_SHOW) {
                await dismiss(key);
            }
        });
    };

    context.subscriptions.push(vscode.commands.registerCommand("dreamshader.migrateToDreamSource", async () => {
        const projectDir = findProjectRootForCommand();
        if (!projectDir) {
            void vscode.window.showWarningMessage("DreamShader: no Unreal project (.uproject) found for this window.");
            return;
        }
        await migrate(projectDir);
    }));

    check(vscode.window.activeTextEditor?.document?.uri?.fsPath);
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        const fileName = editor?.document?.uri?.fsPath;
        if (fileName && /\.(dsm|dsf|dsh|dss|dsi|dsp)$/i.test(fileName)) {
            check(fileName);
        }
    }));
}

module.exports = {
    registerDreamSourceMigration
};
