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

module.exports = {
    writeBridgeRequest,
    writeRecompileRequest,
    writeCleanGeneratedShadersRequest
};
