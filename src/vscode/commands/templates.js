"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { findProjectRootForCommand } = require("../../packages/projectRoot");
const {
    buildTemplate,
    getTemplateSpec,
    isSafeRelativePath,
    normalizeTemplateRelativePath
} = require("../../templates");

function registerTemplateCommands(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("dreamshader.createMaterial", async () => {
            await createDreamShaderTemplateCommand("material");
        }),
        vscode.commands.registerCommand("dreamshader.createFunctionFile", async () => {
            await createDreamShaderTemplateCommand("functionFile");
        }),
        vscode.commands.registerCommand("dreamshader.createHeader", async () => {
            await createDreamShaderTemplateCommand("header");
        }),
        vscode.commands.registerCommand("dreamshader.createTextureSample", async () => {
            await createDreamShaderTemplateCommand("texture");
        }),
        vscode.commands.registerCommand("dreamshader.createNoiseMaterial", async () => {
            await createDreamShaderTemplateCommand("noise");
        })
    );
}

async function createDreamShaderTemplateCommand(kind) {
    const projectRoot = findProjectRootForCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const template = getTemplateSpec(kind);
    if (!template) {
        return;
    }

    const relativePathInput = await vscode.window.showInputBox({
        title: template.title,
        prompt: template.prompt,
        placeHolder: template.placeHolder,
        validateInput: (value) => {
            const normalized = normalizeTemplateRelativePath(value, template.extension);
            if (!normalized) {
                return "A file name is required.";
            }
            return isSafeRelativePath(normalized) ? undefined : "Use a relative path inside DShader without '..'.";
        }
    });
    if (!relativePathInput) {
        return;
    }

    const relativePath = normalizeTemplateRelativePath(relativePathInput, template.extension);
    const targetPath = path.resolve(projectRoot, "DShader", relativePath);
    const dshaderRoot = path.resolve(projectRoot, "DShader");
    const relativeToRoot = path.relative(dshaderRoot, targetPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        vscode.window.showErrorMessage("DreamShader template path must stay inside DShader.");
        return;
    }

    if (fs.existsSync(targetPath)) {
        const replace = await vscode.window.showQuickPick([
            { label: "$(replace) Replace existing file", description: path.basename(targetPath), value: "replace" },
            { label: "$(circle-slash) Cancel", value: "cancel" }
        ], {
            title: "DreamShader file already exists",
            placeHolder: targetPath
        });
        if (!replace || replace.value !== "replace") {
            return;
        }
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buildTemplate(kind, relativePath), "utf8");
    await vscode.window.showTextDocument(vscode.Uri.file(targetPath));
    vscode.window.showInformationMessage(`Created ${path.basename(targetPath)}.`);
}

module.exports = {
    createDreamShaderTemplateCommand,
    registerTemplateCommands
};
