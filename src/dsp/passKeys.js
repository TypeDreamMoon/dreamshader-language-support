"use strict";

// The vocabulary of a `.dsp`, as the plugin exported it:
//
//     <Project>/Saved/DreamShader/Bridge/pass-keys.json
//
// (schema `DreamShader.PassKeys`, version 1; Docs/tools/workspace.md of the plugin). Every key a `#pragma pipeline`,
// a buffer and each pass kind takes -- with what kind of value it wants, its default and a description -- the
// injection points in frame order, the formats, and the spellings each kind of value takes. It is written at bridge
// startup and on *Open Dream Shader Workspace*, so a project whose editor never ran has none; then the copy bundled
// with the extension (resources/pass-keys.json, the plugin 2.1.0's own, without a project's layer names) answers
// instead, and says so.
//
// Every field is read defensively: an unknown one is ignored, a missing one is empty. No `vscode` here: the smoke
// tests run this under plain node.

const fs = require("fs");
const path = require("path");
const { normalizeFsPath } = require("../common/path");

const PASS_KEYS_SCHEMA = "DreamShader.PassKeys";
const PASS_KEYS_VERSION = 1;
const PASS_KEYS_FILE_NAME = "pass-keys.json";
const BUNDLED_PASS_KEYS_PATH = path.join(__dirname, "..", "..", "resources", PASS_KEYS_FILE_NAME);

function getPassKeysPath(projectRoot) {
    return projectRoot ? normalizeFsPath(path.join(projectRoot, "Saved", "DreamShader", "Bridge", PASS_KEYS_FILE_NAME)) : "";
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asStrings(value) {
    return asArray(value).filter((entry) => typeof entry === "string" && entry);
}

function normalizeKey(raw) {
    return {
        name: String((raw && raw.name) || ""),
        value: String((raw && raw.value) || ""),
        default: String((raw && raw.default) || ""),
        required: Boolean(raw && raw.required),
        detail: String((raw && raw.detail) || "")
    };
}

function normalizeKeys(value) {
    return asArray(value).map(normalizeKey).filter((key) => key.name);
}

/** The file as a value, or null when it is not pass-keys.json at all. A version this code does not know is read anyway -- every field is optional -- and flagged. */
function normalizePassKeys(raw) {
    if (!raw || typeof raw !== "object" || raw.schema !== PASS_KEYS_SCHEMA) {
        return null;
    }

    // Every top-level list of spellings, by its own name: a key's `value` names the list it is completed from
    // (`meshMode` -> `meshModes`, `viewFlags` -> `viewFlags`), so a list the plugin adds later is completed without
    // a change here.
    const lists = {};
    for (const [name, value] of Object.entries(raw)) {
        const strings = asStrings(value);
        if (Array.isArray(value) && strings.length > 0 && strings.length === value.length) {
            lists[name] = strings;
        }
    }

    const version = Number(raw.version) || 0;
    return {
        version,
        knownVersion: version === PASS_KEYS_VERSION,
        supported: raw.supported !== false,
        unsupportedReason: String(raw.unsupportedReason || ""),
        injectionPoints: asArray(raw.injectionPoints).map((entry) => ({
            name: String((entry && entry.name) || ""),
            order: Number(entry && entry.order) || 0,
            postProcess: Boolean(entry && entry.postProcess),
            resolution: String((entry && entry.resolution) || "")
        })).filter((entry) => entry.name),
        pipelineKeys: normalizeKeys(raw.pipelineKeys),
        bufferKeys: normalizeKeys(raw.bufferKeys),
        commonPassKeys: normalizeKeys(raw.commonPassKeys),
        bindingStatements: normalizeKeys(raw.bindingStatements),
        passKinds: asArray(raw.passKinds).map((entry) => ({
            name: String((entry && entry.name) || ""),
            detail: String((entry && entry.detail) || ""),
            keys: normalizeKeys(entry && entry.keys)
        })).filter((entry) => entry.name),
        filterKinds: asArray(raw.filterKinds).map((entry) => ({
            name: String((entry && entry.name) || ""),
            snippet: String((entry && entry.snippet) || ""),
            detail: String((entry && entry.detail) || "")
        })).filter((entry) => entry.name),
        bufferFormats: asStrings(raw.bufferFormats),
        builtinBuffers: asStrings(raw.builtinBuffers),
        layerNames: asStrings(raw.layerNames),
        weightParameter: String(raw.weightParameter || ""),
        lists
    };
}

function readPassKeysFile(filePath) {
    try {
        // A file saved by hand may carry a BOM; the plugin writes none.
        return normalizePassKeys(JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, "")));
    } catch (_error) {
        return null;
    }
}

/**
 * A project's pass-keys.json, re-read when its modification time changes, with the bundled copy behind it.
 * `get()` answers `{ keys, source, path }`: `source` is `project`, `bundled`, or `none` when neither reads.
 */
function createPassKeysReader(projectRoot, bundledPath = BUNDLED_PASS_KEYS_PATH) {
    const projectPath = getPassKeysPath(projectRoot);
    let cached = { mtimeMs: -1, keys: null };
    let bundled;

    function readBundled() {
        if (bundled === undefined) {
            bundled = bundledPath ? readPassKeysFile(bundledPath) : null;
        }
        return bundled;
    }

    function get() {
        if (projectPath) {
            let mtimeMs = -1;
            try {
                mtimeMs = fs.statSync(projectPath).mtimeMs;
            } catch (_error) {
                mtimeMs = -1;
            }
            if (mtimeMs !== cached.mtimeMs) {
                cached = { mtimeMs, keys: mtimeMs >= 0 ? readPassKeysFile(projectPath) : null };
            }
            if (cached.keys) {
                return { keys: cached.keys, source: "project", path: projectPath };
            }
        }
        const fallback = readBundled();
        return fallback
            ? { keys: fallback, source: "bundled", path: normalizeFsPath(bundledPath) }
            : { keys: null, source: "none", path: "" };
    }

    return { projectPath, get };
}

// ------------------------------------------------------------------------------------------------- questions

/** The keys a place takes: `{ scope: "pipeline" }`, `{ scope: "buffer" }`, or `{ scope: "pass", kind }`. */
function keysFor(keys, place) {
    if (!keys || !place) {
        return [];
    }
    if (place.scope === "pipeline") {
        return keys.pipelineKeys;
    }
    if (place.scope === "buffer") {
        return keys.bufferKeys;
    }
    if (place.scope === "pass") {
        const kind = keys.passKinds.find((entry) => entry.name === place.kind);
        // A kind nobody knows -- misspelt, or half typed -- takes whatever some kind takes.
        const own = kind ? kind.keys : keys.passKinds.flatMap((entry) => entry.keys);
        const seen = new Set();
        return own.concat(keys.commonPassKeys).filter((key) => !seen.has(key.name) && seen.add(key.name));
    }
    return [];
}

function findKey(keys, place, name) {
    return keysFor(keys, place).find((key) => key.name === name) || null;
}

/** The list a kind of value is completed from, by the naming rule the plugin follows; empty when it names none. */
function listFor(keys, valueKind) {
    if (!keys || !valueKind) {
        return [];
    }
    if (valueKind === "injection") {
        return keys.injectionPoints.map((entry) => entry.name);
    }
    const candidates = [valueKind, `${valueKind}s`, valueKind.replace(/y$/, "ies")];
    for (const candidate of candidates) {
        if (keys.lists[candidate]) {
            return keys.lists[candidate];
        }
    }
    return [];
}

function findInjectionPoint(keys, name) {
    return keys ? keys.injectionPoints.find((entry) => entry.name === name) || null : null;
}

function findPassKind(keys, name) {
    return keys ? keys.passKinds.find((entry) => entry.name === name) || null : null;
}

/** What a hover says about a key, as markdown. */
function describeKey(keys, key, placeLabel) {
    const lines = [`**${key.name}**${placeLabel ? ` -- ${placeLabel}` : ""}`];
    if (key.detail) {
        lines.push("", key.detail);
    }
    const facts = [];
    if (key.required) {
        facts.push("required");
    } else if (key.default) {
        facts.push(`default: \`${key.default}\``);
    }
    const values = listFor(keys, key.value);
    if (values.length > 0) {
        facts.push(`one of ${values.map((value) => `\`${value}\``).join(", ")}`);
    } else if (key.value) {
        facts.push(`value: ${key.value}`);
    }
    if (facts.length > 0) {
        lines.push("", `*${facts.join(" · ")}*`);
    }
    return lines.join("\n");
}

function describeInjectionPoint(point) {
    const facts = [`#${point.order} in the frame`, `${point.resolution || "?"} resolution`];
    if (point.postProcess) {
        facts.push("inside the post-process chain");
    }
    return `**${point.name}** -- injection point\n\n*${facts.join(" · ")}*`;
}

module.exports = {
    PASS_KEYS_SCHEMA,
    PASS_KEYS_VERSION,
    PASS_KEYS_FILE_NAME,
    BUNDLED_PASS_KEYS_PATH,
    getPassKeysPath,
    normalizePassKeys,
    createPassKeysReader,
    keysFor,
    findKey,
    listFor,
    findInjectionPoint,
    findPassKind,
    describeKey,
    describeInjectionPoint
};
