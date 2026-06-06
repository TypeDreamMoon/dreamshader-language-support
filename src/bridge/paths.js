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
    getSubstrateBuiltinsManifestPath
};
