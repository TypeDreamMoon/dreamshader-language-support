"use strict";

// The file patterns that mean "the editor's output for this project changed", per layout (spec 12.3):
// shader.db and its WAL now; the old Saved/DreamShader/Bridge files for a plugin from before
// DreamSource. Never `-shm`: every reader touches it, so watching it would make each read trigger the
// next one.

const vscode = require("vscode");

/** shader.db and shader.db-wal, relative to a project root. */
const SHADER_DATABASE_PATTERN = "Intermediate/DreamSource/{shader.db,shader.db-wal}";

/** The ini files a project's source directory is configured in (spec 12.1), relative to a project root. */
const SOURCE_SETTINGS_PATTERN = "Config/{DefaultDreamSource.ini,DefaultEngine.ini}";

/** `Saved/DreamShader/Bridge/<name>` for each of the old files, relative to a project root. */
function legacyBridgePattern(...fileNames) {
    return fileNames.length === 1
        ? `Saved/DreamShader/Bridge/${fileNames[0]}`
        : `Saved/DreamShader/Bridge/{${fileNames.join(",")}}`;
}

/** A watcher on `pattern` under `root` that calls `onChange` for every create, change and delete. */
function watchUnder(root, pattern, onChange) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), pattern));
    watcher.onDidCreate(() => onChange());
    watcher.onDidChange(() => onChange());
    watcher.onDidDelete(() => onChange());
    return watcher;
}

module.exports = {
    SHADER_DATABASE_PATTERN,
    SOURCE_SETTINGS_PATTERN,
    legacyBridgePattern,
    watchUnder
};
