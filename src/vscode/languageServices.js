"use strict";

const fs = require("fs");
const path = require("path");
const languageCore = require("../language");
const { collectAvailableImports, resolveImportPath } = require("../project/imports");
const { findProjectRoot } = require("../project/projects");
const { getPackagesDirectory } = require("../project/projects");
const {
    collectMaterialExpressionSymbols,
    getUEBuiltinItemsForDocument,
    getSubstrateBuiltinItemsForDocument,
    collectDreamShaderSettingMappings
} = require("../bridge/manifests");

function createLanguageServices(document) {
    return {
        resolveImportPath(importPath) {
            return resolveImportPath(document.fileName, importPath);
        },
        collectAvailableHeaderImports() {
            return collectAvailableImports(document.fileName);
        },
        collectMaterialExpressionSymbols() {
            return collectMaterialExpressionSymbols(document);
        },
        getUEBuiltinItems() {
            return getUEBuiltinItemsForDocument(document);
        },
        getSubstrateBuiltinItems() {
            return getSubstrateBuiltinItemsForDocument(document);
        },
        collectDreamShaderSettingMappings(mappingName) {
            return collectDreamShaderSettingMappings(document, mappingName);
        },
        collectReachableCallableSignatures() {
            return getLanguageIndex(document).callables;
        },
        collectReachableFunctionDefinitions() {
            return getLanguageIndex(document).functionDefinitions;
        },
        getLanguageIndex() {
            return getLanguageIndex(document);
        },
        collectProjectContentPluginNames() {
            return collectProjectContentPluginNames(findProjectRoot(document.fileName));
        }
    };
}

function getLanguageIndex(document) {
    return languageCore.buildDocumentIndex({
        fileName: document.fileName,
        text: document.getText(),
        resolveImportPath(importPath, fromFilePath) {
            return resolveImportPath(fromFilePath || document.fileName, importPath);
        },
        readFileText(filePath) {
            return fs.readFileSync(filePath, "utf8");
        }
    });
}

function collectProjectContentPluginNames(projectRoot) {
    const names = new Set();
    if (!projectRoot) {
        return [];
    }
    const pluginsRoot = path.join(projectRoot, "Plugins");
    collectPluginNames(pluginsRoot, names, 0);
    return Array.from(names).sort();
}

function collectPluginNames(directory, names, depth) {
    if (!directory || depth > 4 || !fs.existsSync(directory)) {
        return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".uplugin")) {
            names.add(path.basename(entry.name, ".uplugin"));
            continue;
        }
        if (entry.isDirectory()) {
            collectPluginNames(fullPath, names, depth + 1);
        }
    }
}

module.exports = {
    createLanguageServices,
    getLanguageIndex,
    collectProjectContentPluginNames,
    getPackagesDirectory
};
