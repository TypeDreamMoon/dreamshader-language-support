"use strict";

const fs = require("fs");
const path = require("path");
const { parseDocument } = require("./parser");
const { collectCallables, flatten } = require("./symbols");
const { collectCallNames } = require("./calls");
const { normalizeSymbolKey, normalizeFsPath } = require("./utils");

function buildDocumentIndex({ fileName = "", text = "", resolveImportPath, readFileText } = {}) {
    const files = [];
    const visited = new Set();
    const readText = typeof readFileText === "function"
        ? readFileText
        : (fsPath) => fs.readFileSync(fsPath, "utf8");

    const visit = (fsPath, sourceText, isRoot) => {
        const normalizedPath = normalizeFsPath(fsPath || `memory://${files.length}`);
        if (visited.has(normalizedPath)) {
            return;
        }
        visited.add(normalizedPath);
        const ast = parseDocument(sourceText || "");
        const callables = collectCallables(ast);
        const functions = flatten(ast.blocks)
            .filter((block) => block.kind === "Function" || block.kind === "GraphFunction")
            .map((block) => ({
                kind: block.kind,
                name: block.namespace ? `${block.namespace}::${block.name}` : block.name,
                localName: block.name,
                fsPath: normalizedPath,
                nameOffset: block.nameOffset,
                nameRangeLength: block.nameRangeLength || String(block.name || "").length,
                bodyText: block.bodyText || "",
                modifier: block.modifier || ""
            }));

        files.push({ fsPath: normalizedPath, text: sourceText || "", ast, callables, functions, isRoot });

        for (const importStatement of ast.imports || []) {
            if (typeof resolveImportPath !== "function") {
                continue;
            }
            const resolved = resolveImportPath(importStatement.path, normalizedPath);
            if (!resolved || visited.has(normalizeFsPath(resolved))) {
                continue;
            }
            try {
                visit(resolved, readText(resolved), false);
            } catch (_error) {
                // Import diagnostics report unreadable files separately.
            }
        }
    };

    visit(fileName, text, true);
    return makeIndex(files);
}

function makeIndex(files) {
    const callables = new Map();
    const functionDefinitions = new Map();
    const functionEntries = [];

    for (const file of files) {
        for (const [key, entries] of file.callables.entries()) {
            if (!callables.has(key)) {
                callables.set(key, []);
            }
            callables.get(key).push(...entries.map((entry) => ({
                ...entry,
                fsPath: file.fsPath,
                sourceKind: file.isRoot ? "local" : "imported"
            })));
        }

        for (const fn of file.functions) {
            const location = {
                kind: fn.kind,
                name: fn.name,
                localName: fn.localName,
                nameRangeLength: fn.nameRangeLength,
                fsPath: fn.fsPath,
                nameOffset: fn.nameOffset,
                sourceKind: file.isRoot ? "local" : "imported"
            };
            const key = normalizeSymbolKey(fn.name);
            if (!functionDefinitions.has(key)) {
                functionDefinitions.set(key, []);
            }
            functionDefinitions.get(key).push(location);
            if (fn.localName && normalizeSymbolKey(fn.localName) !== key) {
                const localKey = normalizeSymbolKey(fn.localName);
                if (!functionDefinitions.has(localKey)) {
                    functionDefinitions.set(localKey, []);
                }
                functionDefinitions.get(localKey).push(location);
            }
            functionEntries.push(fn);
        }
    }

    return {
        files,
        callables,
        functionDefinitions,
        functionEntries,
        cycles: detectFunctionCycles(functionEntries)
    };
}

function detectFunctionCycles(functionEntries) {
    const byName = new Map();
    for (const fn of functionEntries) {
        for (const name of [fn.name, fn.localName].filter(Boolean)) {
            const key = normalizeSymbolKey(name);
            if (!byName.has(key)) {
                byName.set(key, []);
            }
            byName.get(key).push(fn);
        }
    }

    const dependencies = new Map();
    for (const fn of functionEntries) {
        const deps = [];
        const seen = new Set();
        for (const callName of collectCallNames(fn.bodyText)) {
            for (const target of byName.get(normalizeSymbolKey(callName)) || []) {
                const depKey = `${target.fsPath}:${target.nameOffset}`;
                if (depKey === `${fn.fsPath}:${fn.nameOffset}` || seen.has(depKey)) {
                    deps.push(target);
                    seen.add(depKey);
                    continue;
                }
                seen.add(depKey);
                deps.push(target);
            }
        }
        dependencies.set(fn, deps);
    }

    const cycles = [];
    const state = new Map();
    const stack = [];
    const emitted = new Set();

    const visit = (fn) => {
        const current = state.get(fn) || "new";
        if (current === "done") {
            return;
        }
        if (current === "visiting") {
            const index = stack.indexOf(fn);
            if (index >= 0) {
                const cycle = [...stack.slice(index), fn];
                const key = cycle.map((entry) => `${entry.fsPath}:${entry.nameOffset}`).join(">");
                if (!emitted.has(key)) {
                    emitted.add(key);
                    cycles.push(cycle);
                }
            }
            return;
        }
        state.set(fn, "visiting");
        stack.push(fn);
        for (const dep of dependencies.get(fn) || []) {
            visit(dep);
        }
        stack.pop();
        state.set(fn, "done");
    };

    for (const fn of functionEntries) {
        visit(fn);
    }
    return cycles;
}

function collectWorkspaceHeaders(rootDirectory, options = {}) {
    const headers = new Set();
    const roots = Array.isArray(rootDirectory) ? rootDirectory : [rootDirectory];
    for (const root of roots.filter(Boolean)) {
        collectHeaderFiles(path.resolve(root), path.resolve(root), headers, options);
    }
    return Array.from(headers).sort();
}

function collectHeaderFiles(rootDirectory, currentDirectory, outHeaders, options) {
    let entries = [];
    try {
        entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch (_error) {
        return;
    }
    for (const entry of entries) {
        const absolutePath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
            if (options.skipTopLevelPackages && normalizeFsPath(currentDirectory) === normalizeFsPath(rootDirectory) && entry.name.toLowerCase() === "packages") {
                continue;
            }
            collectHeaderFiles(rootDirectory, absolutePath, outHeaders, options);
            continue;
        }
        if (path.extname(entry.name).toLowerCase() !== ".dsh") {
            continue;
        }
        outHeaders.add(normalizeFsPath(path.relative(rootDirectory, absolutePath)));
    }
}

module.exports = {
    buildDocumentIndex,
    collectWorkspaceHeaders,
    detectFunctionCycles
};
