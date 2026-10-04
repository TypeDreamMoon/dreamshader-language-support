"use strict";

// The symbol index of a project's 2.0 sources, as the plugin wrote it.
//
// The extension does not read `.dss` text for meaning. The compiler does that, and after every compile
// -- and on `dsc index` -- it writes what it found to
//
//     <Project>/Saved/DreamShader/Index/<root>/<source path relative to that root>.index.json
//
// (schema `dreamshader-symbol-index`, version 1): the declarations of the file and of every header it
// includes, each with its kind, signature, doc and position; every mention of a name as a span; the
// resolved include paths; the parameter schema. This module finds those files, keeps them parsed, and
// answers "which index describes this source" -- for a `.dss` its own, for a `.dsh` any index that
// includes it, since a header has none of its own.
//
// No `vscode` here: the smoke tests run this under plain node.

const fs = require("fs");
const path = require("path");
const { normalizeFsPath } = require("../common/path");

const INDEX_SCHEMA = "dreamshader-symbol-index";
const INDEX_SUFFIX = ".index.json";

function getIndexDirectory(projectRoot) {
    return projectRoot ? normalizeFsPath(path.join(projectRoot, "Saved", "DreamShader", "Index")) : "";
}

/** Paths compare without case on the platforms Unreal's editor runs on, and the index spells them the engine's way. */
function pathKey(filePath) {
    return normalizeFsPath(path.resolve(String(filePath || ""))).toLowerCase();
}

function listIndexFiles(directory, found = []) {
    let entries = [];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_error) {
        return found;
    }
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            listIndexFiles(full, found);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(INDEX_SUFFIX)) {
            found.push(full);
        }
    }
    return found;
}

function normalizeSpan(entry) {
    return {
        file: normalizeFsPath(entry.file || ""),
        fileKey: pathKey(entry.file || ""),
        line: Number(entry.line) || 1,
        column: Number(entry.column) || 1,
        offset: Number(entry.offset) || 0,
        length: Number(entry.length) || 0
    };
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeBinding(entry) {
    return {
        ...normalizeSpan(entry || {}),
        slot: String((entry && entry.slot) || ""),
        buffer: String((entry && entry.buffer) || ""),
        previous: Boolean(entry && entry.previous)
    };
}

/**
 * The `pipeline` section a `.dsp`'s index carries (plugin 2.1.0): the `#pragma pipeline` values as bound, the
 * parameters, the buffers and the passes with their bindings. Every span is the plugin's: a buffer's and a pass's point
 * at the name, a parameter's and a binding's cover the whole statement. Null for a source of any other kind.
 */
function normalizePipeline(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const strings = (value) => asArray(value).map(String);
    return {
        order: Number(raw.order) || 0,
        injection: String(raw.injection || ""),
        views: strings(raw.views),
        requires: strings(raw.requires),
        enabled: String(raw.enabled || ""),
        pragmaSpan: raw.pragmaSpan && typeof raw.pragmaSpan === "object" ? normalizeSpan(raw.pragmaSpan) : null,
        uniforms: asArray(raw.uniforms).map((entry) => ({
            ...normalizeSpan(entry || {}),
            name: String((entry && entry.name) || ""),
            type: String((entry && entry.type) || ""),
            default: String((entry && entry.default) || ""),
            group: String((entry && entry.group) || ""),
            desc: String((entry && entry.desc) || "")
        })).filter((entry) => entry.name),
        buffers: asArray(raw.buffers).map((entry) => ({
            ...normalizeSpan(entry || {}),
            name: String((entry && entry.name) || ""),
            format: String((entry && entry.format) || ""),
            resolution: String((entry && entry.resolution) || ""),
            scale: Number(entry && entry.scale) || 0,
            size: asArray(entry && entry.size).map((value) => Number(value) || 0),
            history: Boolean(entry && entry.history),
            export: Boolean(entry && entry.export),
            desc: String((entry && entry.desc) || "")
        })).filter((entry) => entry.name),
        passes: asArray(raw.passes).map((entry) => {
            const bindings = (entry && entry.bindings) || {};
            return {
                ...normalizeSpan(entry || {}),
                name: String((entry && entry.name) || ""),
                kind: String((entry && entry.kind) || ""),
                injection: String((entry && entry.injection) || ""),
                enabled: String((entry && entry.enabled) || ""),
                material: String((entry && entry.material) || ""),
                materialObject: String((entry && entry.materialObject) || ""),
                shader: String((entry && entry.shader) || ""),
                entry: String((entry && entry.entry) || ""),
                desc: String((entry && entry.desc) || ""),
                reads: asArray(bindings.reads).map(normalizeBinding),
                writes: asArray(bindings.writes).map(normalizeBinding),
                params: asArray(bindings.params).map((param) => ({
                    ...normalizeSpan(param || {}),
                    target: String((param && param.target) || ""),
                    source: String((param && param.source) || ""),
                    parameter: String((param && param.parameter) || "")
                }))
            };
        }).filter((entry) => entry.name),
        injectionPoints: strings(raw.injectionPoints),
        formats: strings(raw.formats)
    };
}

function normalizeIndex(raw, indexPath) {
    if (!raw || raw.schema !== INDEX_SCHEMA || !Array.isArray(raw.declarations)) {
        return null;
    }
    const declarations = raw.declarations.map((entry) => ({
        ...normalizeSpan(entry),
        kind: String(entry.kind || ""),
        name: String(entry.name || ""),
        container: String(entry.container || ""),
        role: String(entry.role || ""),
        signature: String(entry.signature || ""),
        type: String(entry.type || ""),
        doc: String(entry.doc || ""),
        asset: String(entry.asset || ""),
        library: String(entry.library || ""),
        pin: String(entry.pin || "")
    })).filter((entry) => entry.name);

    const references = new Map();
    for (const group of Array.isArray(raw.references) ? raw.references : []) {
        const name = String(group.name || "");
        if (!name) {
            continue;
        }
        const spans = (Array.isArray(group.spans) ? group.spans : []).map(normalizeSpan);
        references.set(name, (references.get(name) || []).concat(spans));
    }

    return {
        indexPath: normalizeFsPath(indexPath),
        version: Number(raw.version) || 1,
        file: normalizeFsPath(raw.file || ""),
        fileKey: pathKey(raw.file || ""),
        declarations,
        references,
        includes: (Array.isArray(raw.includes) ? raw.includes : []).map((entry) => normalizeFsPath(entry)),
        includeKeys: new Set((Array.isArray(raw.includes) ? raw.includes : []).map(pathKey)),
        parameters: Array.isArray(raw.parameters) ? raw.parameters : [],
        pipeline: normalizePipeline(raw.pipeline)
    };
}

/**
 * One project's indices, read lazily and re-read by modification time. `refresh()` is cheap when nothing
 * changed: one directory walk and one `stat` per file.
 */
function createIndexStore(projectRoot) {
    const directory = getIndexDirectory(projectRoot);
    /** indexPath -> { mtimeMs, index } */
    const entries = new Map();

    function refresh() {
        const present = new Set();
        for (const indexPath of listIndexFiles(directory)) {
            present.add(indexPath);
            let mtimeMs = 0;
            try {
                mtimeMs = fs.statSync(indexPath).mtimeMs;
            } catch (_error) {
                continue;
            }
            const known = entries.get(indexPath);
            if (known && known.mtimeMs === mtimeMs) {
                continue;
            }
            let index = null;
            try {
                index = normalizeIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")), indexPath);
            } catch (_error) {
                // Half-written while the editor saves it; the next refresh reads it whole.
                index = null;
            }
            entries.set(indexPath, { mtimeMs, index });
        }
        for (const indexPath of [...entries.keys()]) {
            if (!present.has(indexPath)) {
                entries.delete(indexPath);
            }
        }
    }

    function all() {
        return [...entries.values()].map((entry) => entry.index).filter(Boolean);
    }

    /**
     * The indices that describe a source, best first: its own, then -- for a header -- every index that
     * includes it, newest first, because the newest compile saw the header as it is now.
     */
    function findForSource(sourceFile) {
        const key = pathKey(sourceFile);
        const own = [];
        const including = [];
        for (const [indexPath, entry] of entries) {
            if (!entry.index) {
                continue;
            }
            if (entry.index.fileKey === key) {
                own.push({ indexPath, ...entry });
            } else if (entry.index.includeKeys.has(key)) {
                including.push({ indexPath, ...entry });
            }
        }
        including.sort((left, right) => right.mtimeMs - left.mtimeMs);
        return own.concat(including).map((entry) => entry.index);
    }

    return {
        projectRoot: normalizeFsPath(projectRoot || ""),
        directory,
        refresh,
        all,
        findForSource
    };
}

module.exports = {
    INDEX_SCHEMA,
    INDEX_SUFFIX,
    getIndexDirectory,
    pathKey,
    normalizeIndex,
    normalizePipeline,
    createIndexStore
};
