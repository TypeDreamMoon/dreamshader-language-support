"use strict";

const fs = require("fs");
const path = require("path");
const { writeJsonFile } = require("../common/json");
const { normalizeFsPath } = require("../common/path");
const { getRequestDirectory } = require("./paths");

function writeBridgeRequest(projectRoot, payload) {
    const requestDirectory = getRequestDirectory(projectRoot);
    fs.mkdirSync(requestDirectory, { recursive: true });
    const requestPath = path.join(requestDirectory, `request-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`);
    writeJsonFile(requestPath, payload);
    return normalizeFsPath(requestPath);
}

function writeRecompileRequest(projectRoot, scope, sourceFile) {
    const payload = {
        action: "recompile",
        scope
    };
    if (scope === "file" && sourceFile) {
        payload.sourceFile = normalizeFsPath(sourceFile);
    }
    return writeBridgeRequest(projectRoot, payload);
}

function writeCleanGeneratedShadersRequest(projectRoot) {
    return writeBridgeRequest(projectRoot, {
        action: "cleanGeneratedShaders"
    });
}

function writePreviewMaterialRequest(projectRoot, sourceFile, options = {}) {
    const payload = {
        action: "previewMaterial",
        sourceFile: normalizeFsPath(sourceFile),
        width: clampPreviewSize(options.width, 512),
        height: clampPreviewSize(options.height, 512),
        mesh: String(options.mesh || "sphere")
    };
    if (options.requestId) {
        payload.requestId = String(options.requestId);
    }
    return writeBridgeRequest(projectRoot, payload);
}

function clampPreviewSize(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.max(64, Math.min(2048, Math.floor(numeric)));
}

module.exports = {
    writeBridgeRequest,
    writeRecompileRequest,
    writeCleanGeneratedShadersRequest,
    writePreviewMaterialRequest
};
