"use strict";

const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "..", "test", "extension", "suite");
    const workspacePath = path.resolve(__dirname, "..", "test", "extension", "workspace");

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [
            workspacePath,
            "--disable-extensions"
        ]
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
