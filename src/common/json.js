"use strict";

const fs = require("fs");

function readJsonFile(filePath, fallback = null) {
    if (!filePath) {
        return fallback;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_error) {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

module.exports = {
    readJsonFile,
    writeJsonFile
};
