"use strict";

const path = require("path");

function normalizeFsPath(value) {
    return String(value || "").replace(/\\/g, "/");
}

function isSubPath(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSameOrSubPath(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

module.exports = {
    normalizeFsPath,
    isSubPath,
    isSameOrSubPath
};
