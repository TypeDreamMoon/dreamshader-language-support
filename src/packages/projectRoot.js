"use strict";

const {
    findProjectRootForCommand,
    findProjectRootFromCandidate,
    findProjectRootFromDirectory
} = require("../project/projects");
const { normalizeFsPath } = require("../common/path");

module.exports = {
    findProjectRootForCommand,
    findProjectRootFromCandidate,
    findProjectRootFromDirectory,
    normalizeFsPath
};
