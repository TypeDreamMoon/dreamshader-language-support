"use strict";

// What the language layer is allowed to reach outside its own text.
//
// `language/` takes this object and calls through it rather than importing any of it directly --
// which is why the layer never needed to know whether it was running in an editor. Moving it here
// changed one thing: `document.fileName` became a conversion from the uri, since the protocol's
// `TextDocument` has no such property.

const fs = require("fs");
const path = require("path");
const languageCore = require("../language");
const { collectAvailableImports, resolveImportPath } = require("../project/imports");
const { findProjectRoot } = require("../project/projects");
const {
    collectMaterialExpressionSymbols,
    getUEBuiltinItems,
    getSubstrateBuiltinItems,
    collectDreamShaderSettingMappings
} = require("../bridge/manifests");
const { fileNameOf } = require("./documents");

function createLanguageServices(document, services = {}) {
    const indexCache = services.languageIndexCache;
    const activePath = fileNameOf(document);

    return {
        resolveImportPath(importPath) {
            return resolveImportPath(activePath, importPath);
        },
        collectAvailableHeaderImports() {
            return collectAvailableImports(activePath);
        },
        collectMaterialExpressionSymbols() {
            return collectMaterialExpressionSymbols(activePath);
        },
        getUEBuiltinItems() {
            return getUEBuiltinItems(activePath);
        },
        getSubstrateBuiltinItems() {
            return getSubstrateBuiltinItems(activePath);
        },
        collectDreamShaderSettingMappings(mappingName) {
            return collectDreamShaderSettingMappings(activePath, mappingName);
        },
        collectReachableCallableSignatures() {
            return getLanguageIndex(document, indexCache).callables;
        },
        collectReachableFunctionDefinitions() {
            return getLanguageIndex(document, indexCache).functionDefinitions;
        },
        getLanguageIndex() {
            return getLanguageIndex(document, indexCache);
        },
        collectProjectContentPluginNames() {
            return collectProjectContentPluginNames(findProjectRoot(activePath));
        }
    };
}

function getLanguageIndex(document, indexCache) {
    if (indexCache && typeof indexCache.get === "function") {
        return indexCache.get(document);
    }

    const activePath = fileNameOf(document);
    return languageCore.buildDocumentIndex({
        fileName: activePath,
        text: document.getText(),
        resolveImportPath(importPath, fromFilePath) {
            return resolveImportPath(fromFilePath || activePath, importPath);
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
    collectProjectContentPluginNames
};
