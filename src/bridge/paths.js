"use strict";

const path = require("path");
const { normalizeFsPath } = require("../common/path");

function getBridgeDirectory(projectRoot) {
    return projectRoot ? normalizeFsPath(path.join(projectRoot, "Saved", "DreamShader", "Bridge")) : "";
}

function getRequestDirectory(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "Requests"));
}

function getDiagnosticsFilePath(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "diagnostics.json"));
}

// The plugin dual-writes every Bridge manifest (material expressions, Substrate builtins, settings
// mappings, diagnostics) to this single SQLite database alongside the legacy per-manifest JSON
// files. The JSON files are deprecated and scheduled for removal in DreamShader plugin 1.7.0; the
// database is preferred whenever it's present, with JSON as a fallback for older plugin versions.
function getBridgeDatabasePath(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "bridge.db"));
}

function getPreviewFilePath(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "preview.json"));
}

function getPreviewDirectory(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "Preview"));
}

function getMaterialExpressionManifestPath(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "material-expressions.json"));
}

function getSettingsManifestPath(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "settings.json"));
}

function getSubstrateBuiltinsManifestPath(projectRoot) {
    return normalizeFsPath(path.join(getBridgeDirectory(projectRoot), "substrate-builtins.json"));
}

module.exports = {
    getBridgeDirectory,
    getRequestDirectory,
    getDiagnosticsFilePath,
    getPreviewFilePath,
    getPreviewDirectory,
    getMaterialExpressionManifestPath,
    getSettingsManifestPath,
    getSubstrateBuiltinsManifestPath,
    getBridgeDatabasePath
};
