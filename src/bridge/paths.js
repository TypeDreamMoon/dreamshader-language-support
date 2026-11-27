"use strict";

// Where the editor's output for a project is, per the DreamSource layout (spec section 12):
//
//   <Project>/Intermediate/DreamSource/shader.db               everything the editor generates for tools
//   <Project>/Intermediate/DreamSource/Shader/Bridge/           request/response files and the heartbeat
//   <Project>/Intermediate/DreamSource/Shader/Preview/          preview images
//
// and, for a plugin that predates DreamSource, the old single folder
//
//   <Project>/Saved/DreamShader/Bridge/                         bridge.db, the json manifests, requests, Preview/
//   <Project>/Saved/DreamShader/Index/                          the symbol index files
//
// No `vscode` here: the language server and the smoke tests use this too.

const fs = require("fs");
const path = require("path");
const { normalizeFsPath } = require("../common/path");
const { DREAM_SHADER, GENERATED_DIRECTORY } = require("../project/dreamSource");

function join(projectRoot, ...parts) {
    return projectRoot ? normalizeFsPath(path.join(projectRoot, ...parts)) : "";
}

function exists(candidate) {
    try {
        return Boolean(candidate) && fs.existsSync(candidate);
    } catch (_error) {
        return false;
    }
}

// ---- the DreamSource layout ----------------------------------------------------------------------

function getGeneratedDirectory(projectRoot) {
    return join(projectRoot, ...GENERATED_DIRECTORY);
}

function getShaderDatabasePath(projectRoot) {
    return join(projectRoot, ...GENERATED_DIRECTORY, DREAM_SHADER.databaseFile);
}

function getShaderGeneratedDirectory(projectRoot) {
    return join(projectRoot, ...GENERATED_DIRECTORY, DREAM_SHADER.key);
}

function getCurrentBridgeDirectory(projectRoot) {
    return join(projectRoot, ...GENERATED_DIRECTORY, DREAM_SHADER.key, "Bridge");
}

function getCurrentPreviewDirectory(projectRoot) {
    return join(projectRoot, ...GENERATED_DIRECTORY, DREAM_SHADER.key, "Preview");
}

// ---- the layout before DreamSource ---------------------------------------------------------------

function getLegacyBridgeDirectory(projectRoot) {
    return join(projectRoot, "Saved", "DreamShader", "Bridge");
}

function getLegacyIndexDirectory(projectRoot) {
    return join(projectRoot, "Saved", "DreamShader", "Index");
}

function getLegacyBridgeFilePath(projectRoot, fileName) {
    const directory = getLegacyBridgeDirectory(projectRoot);
    return directory ? normalizeFsPath(path.join(directory, fileName)) : "";
}

/** The old bridge.db, which a pre-DreamSource plugin dual-wrote beside its json manifests. */
function getLegacyBridgeDatabasePath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "bridge.db");
}

/**
 * Whether this project's editor output is in the old layout: no shader.db, and the old folder is there.
 * A project with neither is answered with the new layout, which is where an up-to-date plugin will write.
 */
function usesLegacyLayout(projectRoot) {
    if (!projectRoot) {
        return false;
    }
    return !exists(getShaderDatabasePath(projectRoot))
        && !exists(getShaderGeneratedDirectory(projectRoot))
        && exists(getLegacyBridgeDirectory(projectRoot));
}

/**
 * The bridge's request/response folder (spec 12.4): the one an editor is alive in -- its `status.json`
 * exists only while it runs -- and otherwise the one this project's plugin writes to.
 */
function getBridgeDirectory(projectRoot) {
    if (!projectRoot) {
        return "";
    }
    const current = getCurrentBridgeDirectory(projectRoot);
    if (exists(path.join(current, "status.json"))) {
        return current;
    }
    const legacy = getLegacyBridgeDirectory(projectRoot);
    if (exists(path.join(legacy, "status.json"))) {
        return legacy;
    }
    return usesLegacyLayout(projectRoot) ? legacy : current;
}

/** Whether an editor holds this project's bridge in either layout: what a migration must refuse. */
function isBridgeAlive(projectRoot) {
    return Boolean(projectRoot)
        && (exists(path.join(getCurrentBridgeDirectory(projectRoot), "status.json"))
            || exists(path.join(getLegacyBridgeDirectory(projectRoot), "status.json")));
}

function getRequestDirectory(projectRoot) {
    const directory = getBridgeDirectory(projectRoot);
    return directory ? normalizeFsPath(path.join(directory, "Requests")) : "";
}

function getResponseDirectory(projectRoot) {
    const directory = getBridgeDirectory(projectRoot);
    return directory ? normalizeFsPath(path.join(directory, "Responses")) : "";
}

function getPreviewDirectory(projectRoot) {
    return usesLegacyLayout(projectRoot)
        ? join(projectRoot, "Saved", "DreamShader", "Bridge", "Preview")
        : getCurrentPreviewDirectory(projectRoot);
}

/** Both preview folders: what a webview has to be allowed to load from, whichever plugin wrote the image. */
function getPreviewDirectories(projectRoot) {
    return projectRoot
        ? [getCurrentPreviewDirectory(projectRoot), join(projectRoot, "Saved", "DreamShader", "Bridge", "Preview")]
        : [];
}

// ---- the old json manifests (read only when shader.db is not there) ------------------------------

function getDiagnosticsFilePath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "diagnostics.json");
}

function getPreviewFilePath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "preview.json");
}

function getMaterialExpressionManifestPath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "material-expressions.json");
}

function getSettingsManifestPath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "settings.json");
}

function getSubstrateBuiltinsManifestPath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "substrate-builtins.json");
}

// The resolved preprocessor define table (DreamShader.PreprocessorDefines), written by plugin
// versions that ship conditional compilation. Older plugins never write it, and the editor's
// inactive-branch dimming degrades to "dim nothing" rather than guessing at a table -- see
// readPreprocessorDefinesManifest in manifests.js.
function getPreprocessorDefinesManifestPath(projectRoot) {
    return getLegacyBridgeFilePath(projectRoot, "preprocessor-defines.json");
}

module.exports = {
    getGeneratedDirectory,
    getShaderDatabasePath,
    getShaderGeneratedDirectory,
    getCurrentBridgeDirectory,
    getCurrentPreviewDirectory,
    getLegacyBridgeDirectory,
    getLegacyIndexDirectory,
    getLegacyBridgeFilePath,
    getLegacyBridgeDatabasePath,
    usesLegacyLayout,
    getBridgeDirectory,
    isBridgeAlive,
    getRequestDirectory,
    getResponseDirectory,
    getPreviewDirectory,
    getPreviewDirectories,
    getDiagnosticsFilePath,
    getPreviewFilePath,
    getMaterialExpressionManifestPath,
    getSettingsManifestPath,
    getSubstrateBuiltinsManifestPath,
    getPreprocessorDefinesManifestPath,
    // Older name, kept for callers that only mean "the database the manifests come from".
    getBridgeDatabasePath: getLegacyBridgeDatabasePath
};
