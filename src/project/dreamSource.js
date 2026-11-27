"use strict";

// Where DreamShader's sources and generated data live, per the DreamSource layout
// (Plan/DreamSource/dreamsource-layout-spec.md, section 12 for this language).
//
//   <Project>/DreamSource/Shader/                    the project's sources (configurable)
//   <Project>/DShader/                               the old place: still read, and asked to move
//   <Plugin>/DreamSource/Shader/, <Plugin>/DShader/  a plugin's, same rule, not configurable
//   <Project>/Intermediate/DreamSource/shader.db     what the editor generates for us to read
//
// Ported from the dreamgui extension's src/core/dreamSource.ts, which is the reference; the one
// addition is the legacy key in DefaultEngine.ini, which DreamShader had before DreamSource existed.
//
// Pure apart from the default filesystem below: every function takes the filesystem as an argument,
// so the whole table is tested without a disk. No `vscode` here.

const fs = require("fs");
const path = require("path");

const DREAM_SHADER = Object.freeze({
    /** The language key, also the folder name under DreamSource/. */
    key: "Shader",
    /** The folder a project or plugin used before DreamSource. */
    legacyName: "DShader",
    /** The ini section of UDreamShaderSourceSettings in Config/DefaultDreamSource.ini. */
    settingsSection: "/Script/DreamShader.DreamShaderSourceSettings",
    /** The pre-DreamSource home of the same key: UDreamShaderSettings in DefaultEngine.ini. */
    legacySettingsFile: ["Config", "DefaultEngine.ini"],
    legacySettingsSection: "/Script/DreamShader.DreamShaderSettings",
    /** Values of the legacy key that only restate the old default, and so mean "not set". */
    legacyDefaultValues: ["DShader"],
    /** The database file under Intermediate/DreamSource/. */
    databaseFile: "shader.db"
});

const DREAM_SOURCE_DIRECTORY = "DreamSource";
const SETTINGS_INI = ["Config", "DefaultDreamSource.ini"];
const GENERATED_DIRECTORY = ["Intermediate", "DreamSource"];

/** What an older plugin generated outside the source folder; shader.db and Intermediate/DreamSource replace them. */
const LEGACY_GENERATED_DIRECTORIES = [
    ["Saved", "DreamShader", "Bridge"],
    ["Saved", "DreamShader", "Index"],
    ["Intermediate", "DreamShader"]
];

/** The node filesystem, in the shape every function below asks for. */
const nodeFs = {
    isDirectory(candidate) {
        try {
            return Boolean(candidate) && fs.statSync(candidate).isDirectory();
        } catch (_error) {
            return false;
        }
    },
    isFile(candidate) {
        try {
            return Boolean(candidate) && fs.statSync(candidate).isFile();
        } catch (_error) {
            return false;
        }
    },
    readText(candidate) {
        try {
            return fs.readFileSync(candidate, "utf8");
        } catch (_error) {
            return undefined;
        }
    },
    list(directory) {
        try {
            return fs.readdirSync(directory);
        } catch (_error) {
            return [];
        }
    }
};

function defaultSourceDirectory(language = DREAM_SHADER) {
    return `${DREAM_SOURCE_DIRECTORY}/${language.key}`;
}

/** A Windows drive, a UNC share or a rooted path: anything that is not relative to the project. */
function isAbsoluteSetting(value) {
    return /^[A-Za-z]:/.test(value) || value.startsWith("/") || value.startsWith("\\");
}

function unwrapDirectoryValue(raw) {
    let value = String(raw).trim();
    const struct = /^\(\s*Path\s*=\s*(.*?)\s*\)$/i.exec(value);
    if (struct) {
        value = struct[1].trim();
    }
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
        value = value.slice(1, -1);
    }
    return value;
}

/**
 * The `SourceDirectory` of one section of an ini file, as the project-relative path it names, or
 * undefined when the section or key is missing, empty or absolute (an absolute path works on one
 * machine; the default stands in for it). Both `(Path="x")`, which is how an FDirectoryPath saves, and a
 * bare `x` are read; the last assignment wins, as it does when Unreal reads the file.
 */
function parseSourceDirectorySetting(iniText, section) {
    let inSection = false;
    let found;
    for (const rawLine of String(iniText).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(";") || line.startsWith("#")) {
            continue;
        }
        const header = /^\[(.*)\]$/.exec(line);
        if (header) {
            inSection = header[1].trim().toLowerCase() === section.toLowerCase();
            continue;
        }
        if (!inSection) {
            continue;
        }
        const assignment = /^([+\-.!]?)([^=]+?)\s*=\s*(.*)$/.exec(line);
        if (!assignment || assignment[2].trim().toLowerCase() !== "sourcedirectory") {
            continue;
        }
        if (assignment[1] === "-" || assignment[1] === "!") {
            found = undefined;
            continue;
        }
        found = unwrapDirectoryValue(assignment[3]);
    }
    if (found === undefined) {
        return undefined;
    }
    const normalized = found.replace(/\\/g, "/").replace(/\/+$/, "").trim();
    if (!normalized || isAbsoluteSetting(normalized)) {
        return undefined;
    }
    return normalized;
}

/**
 * The project-relative source directory and where it came from (spec 12.1): DefaultDreamSource.ini,
 * then the legacy key in DefaultEngine.ini (its old default `DShader` counts as unset), then the default.
 * `origin` is `dreamSource`, `legacySetting` or `default`.
 */
function readConfiguredSourceDirectory(projectDir, language = DREAM_SHADER, fileSystem = nodeFs, join = path.join) {
    const text = fileSystem.readText(join(projectDir, ...SETTINGS_INI));
    const configured = text !== undefined ? parseSourceDirectorySetting(text, language.settingsSection) : undefined;
    if (configured !== undefined) {
        return { setting: configured, origin: "dreamSource" };
    }
    if (language.legacySettingsFile) {
        const legacyText = fileSystem.readText(join(projectDir, ...language.legacySettingsFile));
        const legacy = legacyText !== undefined ? parseSourceDirectorySetting(legacyText, language.legacySettingsSection) : undefined;
        const isOldDefault = legacy !== undefined
            && (language.legacyDefaultValues || []).some((value) => value.toLowerCase() === legacy.toLowerCase());
        if (legacy !== undefined && !isOldDefault) {
            return { setting: legacy, origin: "legacySetting" };
        }
    }
    return { setting: defaultSourceDirectory(language), origin: "default" };
}

function normalizeForCompare(value) {
    return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Case-blind, slash-blind: what Windows means by "the same directory". */
function samePath(first, second) {
    return normalizeForCompare(first) === normalizeForCompare(second);
}

/**
 * Which of the two places the project's sources are read from (spec 11.2 / 12.2):
 *
 *   configured          only the configured directory exists
 *   configuredAndLegacy both exist: the configured one is used, the old one is ignored (and said so)
 *   legacy              only the old one exists: still used, and asked to move
 *   none                neither: anything that creates a source creates it in the configured one
 *
 * `directory` is what the rest of the extension uses: the active directory, or the configured one when
 * there is none yet, since that is where the editor will create it.
 */
function resolveProjectSourceRoot(projectDir, language = DREAM_SHADER, fileSystem = nodeFs, join = path.join) {
    const { setting, origin } = readConfiguredSourceDirectory(projectDir, language, fileSystem, join);
    const configuredDir = join(projectDir, ...setting.split("/"));
    const legacyDir = join(projectDir, language.legacyName);
    const hasConfigured = fileSystem.isDirectory(configuredDir);
    // A setting that names the old folder itself is not "both": it is the configured one.
    const hasLegacy = !samePath(configuredDir, legacyDir) && fileSystem.isDirectory(legacyDir);
    let state;
    if (hasConfigured) {
        state = hasLegacy ? "configuredAndLegacy" : "configured";
    } else {
        state = hasLegacy ? "legacy" : "none";
    }
    const activeDir = state === "legacy" ? legacyDir : state === "none" ? undefined : configuredDir;
    return {
        projectDir,
        configuredDir,
        configuredSetting: setting,
        settingOrigin: origin,
        legacyDir,
        state,
        activeDir,
        directory: activeDir || configuredDir
    };
}

/**
 * A plugin's source root: `<Plugin>/DreamSource/Shader`, or failing that `<Plugin>/DShader`; null when it
 * has neither. Not configurable.
 */
function resolvePluginSourceDirectory(pluginDir, language = DREAM_SHADER, fileSystem = nodeFs, join = path.join) {
    const current = join(pluginDir, DREAM_SOURCE_DIRECTORY, language.key);
    if (fileSystem.isDirectory(current)) {
        return { directory: current, legacy: false };
    }
    const legacy = join(pluginDir, language.legacyName);
    if (fileSystem.isDirectory(legacy)) {
        return { directory: legacy, legacy: true };
    }
    return null;
}

function generatedDirectory(projectDir, join = path.join) {
    return join(projectDir, ...GENERATED_DIRECTORY);
}

function databasePath(projectDir, language = DREAM_SHADER, join = path.join) {
    return join(generatedDirectory(projectDir, join), language.databaseFile);
}

// ---- the old folder: saying so, and moving it ------------------------------------------------

function displayRelative(root) {
    return `${root.configuredSetting.replace(/\/+$/, "")}/`;
}

/** The one-line notice for a project still on (or still carrying) its old folder; undefined when there is nothing to say. */
function deprecationNotice(root, language = DREAM_SHADER) {
    const legacy = `${language.legacyName}/`;
    const target = displayRelative(root);
    switch (root.state) {
        case "legacy":
            return `${legacy} is deprecated. Move it to ${target} -- Dream sources now live together under `
                + `${DREAM_SOURCE_DIRECTORY}/. It keeps working until you do.`;
        case "configuredAndLegacy":
            return `${legacy} is ignored because ${target} exists. Merge what is in it into ${target} and delete it.`;
        default:
            return undefined;
    }
}

/**
 * Whether the old folder can be moved to the configured one: only from the `legacy` state (moving onto
 * an existing folder would be a merge, which is the author's call), and only with no editor running (it
 * holds the folder open, has the `.dreampass` shader directory mapped, and keeps writing into it).
 */
function planMigration(root, editorRunning, language = DREAM_SHADER, join = path.join) {
    const legacy = `${language.legacyName}/`;
    const target = displayRelative(root);
    switch (root.state) {
        case "configured":
            return { ok: false, reason: `The project already uses ${target}; there is no ${legacy} to move.` };
        case "none":
            return { ok: false, reason: `The project has no ${legacy} to move.` };
        case "configuredAndLegacy":
            return {
                ok: false,
                reason: `${target} already exists, so moving ${legacy} onto it would be a merge. Merge the two by hand and delete ${legacy}.`
            };
        default:
            break;
    }
    if (editorRunning) {
        return {
            ok: false,
            reason: `The Unreal editor has this project open. Close it first: it holds ${legacy} open and keeps writing into it.`
        };
    }
    return {
        ok: true,
        from: root.legacyDir,
        to: root.configuredDir,
        staleDirectories: LEGACY_GENERATED_DIRECTORIES.map((parts) => join(root.projectDir, ...parts))
    };
}

/**
 * DreamShader.code-workspace after its folder moved from `fromDir` to `toDir`: every folder `path` is
 * relative to the file, so each one that pointed somewhere else is re-aimed from the new place. A
 * plugin's old `DShader` folder is swapped for the plugin's current root when `resolvePluginRoot` (given
 * the plugin directory) names one. Text that is not JSON comes back unchanged.
 */
function rewriteWorkspaceFile(text, fromDir, toDir, resolvePluginRoot = () => null, language = DREAM_SHADER) {
    let workspace;
    try {
        workspace = JSON.parse(String(text).replace(/^﻿/, ""));
    } catch (_error) {
        return text;
    }
    if (!workspace || !Array.isArray(workspace.folders)) {
        return text;
    }
    for (const folder of workspace.folders) {
        if (!folder || typeof folder.path !== "string" || path.isAbsolute(folder.path)) {
            continue;
        }
        const resolved = path.resolve(fromDir, folder.path);
        if (samePath(resolved, fromDir)) {
            continue; // "." -- the folder itself, which moved with the file
        }
        let target = resolved;
        if (path.basename(resolved).toLowerCase() === language.legacyName.toLowerCase()) {
            const replacement = resolvePluginRoot(path.dirname(resolved));
            if (replacement) {
                target = replacement;
            }
        }
        folder.path = path.relative(toDir, target).replace(/\\/g, "/") || ".";
    }
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
    return JSON.stringify(workspace, null, "\t").replace(/\n/g, eol) + eol;
}

module.exports = {
    DREAM_SHADER,
    DREAM_SOURCE_DIRECTORY,
    SETTINGS_INI,
    GENERATED_DIRECTORY,
    LEGACY_GENERATED_DIRECTORIES,
    nodeFs,
    defaultSourceDirectory,
    isAbsoluteSetting,
    parseSourceDirectorySetting,
    readConfiguredSourceDirectory,
    resolveProjectSourceRoot,
    resolvePluginSourceDirectory,
    generatedDirectory,
    databasePath,
    samePath,
    deprecationNotice,
    planMigration,
    rewriteWorkspaceFile
};
