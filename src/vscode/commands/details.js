"use strict";

const path = require("path");
const vscode = require("vscode");
const { createDebouncedDisposable } = require("../../common/debounce");
const { normalizeFsPath } = require("../../common/path");
const { findProjectRoot, isDreamShaderDocument } = require("../../project/projects");
const { parseDocument, getSettingMappingNameForKey, isBooleanSetting, SETTING_MAPPING_FALLBACKS } = require("../../language");
const { SETTINGS_ITEMS, VIRTUAL_FUNCTION_OPTION_ITEMS } = require("../../languageData");
const { collectDreamShaderSettingMappings } = require("../../bridge/manifests");

const DEFAULT_INDENT = "    ";

function registerDetailsCommands(context) {
    const manager = new MaterialDetailsPanelManager(context);
    context.subscriptions.push(
        manager,
        vscode.commands.registerCommand("dreamshader.showMaterialDetails", async (targetUri) => {
            await manager.show(targetUri);
        })
    );
}

// A form-based front end for a DreamShaderLang Settings/Options block: one row per known
// setting (CheckBox, Name, Value), reusing the same SETTINGS_ITEMS/VIRTUAL_FUNCTION_OPTION_ITEMS
// list and enum-mapping bridge the completion provider already uses, so the two stay in sync for
// free. Checking a row's box writes `Key = Value;` into the source; unchecking removes that line
// entirely -- the whole point is not having to remember exact Unreal property names/enum spellings
// to author a Settings block by hand.
class MaterialDetailsPanelManager {
    constructor(context) {
        this.context = context;
        this.panel = null;
        this.sourceFile = "";
        this.debouncedRender = createDebouncedDisposable(() => this.render(), 150);
        this.saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
            if (this.panel && this.isCurrentSource(document)) {
                this.debouncedRender.run();
            }
        });
        this.changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
            if (this.panel && this.isCurrentSource(event.document)) {
                this.debouncedRender.run();
            }
        });
        this.activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (this.panel) {
                this.followEditor(editor);
            }
        });
    }

    dispose() {
        this.debouncedRender.dispose();
        this.saveSubscription.dispose();
        this.changeSubscription.dispose();
        this.activeEditorSubscription.dispose();
    }

    isCurrentSource(document) {
        return Boolean(this.sourceFile) && normalizeFsPath(document.fileName) === this.sourceFile;
    }

    async show(targetUri) {
        const document = await getTargetDocument(targetUri);
        if (!document || !isDreamShaderDocument(document)) {
            vscode.window.showWarningMessage("DreamShader details needs an active DreamShaderLang document.");
            return;
        }
        this.sourceFile = normalizeFsPath(document.fileName);
        this.ensurePanel();
        this.render();
    }

    ensurePanel() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        this.panel = vscode.window.createWebviewPanel(
            "dreamshaderMaterialDetails",
            "DreamShader Details",
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true });
        this.panel.onDidDispose(() => {
            this.panel = null;
            this.sourceFile = "";
        });
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });
    }

    // Same reasoning as the material preview panel's own followEditor(): focus moving to
    // something that isn't a DreamShaderLang document (this panel itself, a terminal, the
    // sidebar) shouldn't blank out what's already showing -- only actually switching to a
    // different DreamShaderLang document should retarget the panel.
    followEditor(editor) {
        const document = editor?.document;
        if (!document || !isDreamShaderDocument(document)) {
            return;
        }
        const nextSourceFile = normalizeFsPath(document.fileName);
        if (nextSourceFile === this.sourceFile) {
            return;
        }
        this.sourceFile = nextSourceFile;
        this.render();
    }

    async handleMessage(message) {
        if (!message || typeof message !== "object") {
            return;
        }
        if (message.command === "toggle") {
            await this.applyToggle(message.key, Boolean(message.checked), message.value);
            return;
        }
        if (message.command === "value") {
            await this.applyValueChange(message.key, message.value);
        }
    }

    async getLiveDocument() {
        if (!this.sourceFile) {
            return null;
        }
        return vscode.workspace.textDocuments.find((entry) => normalizeFsPath(entry.fileName) === this.sourceFile)
            || vscode.workspace.openTextDocument(vscode.Uri.file(this.sourceFile));
    }

    async applyToggle(key, checked, pendingValue) {
        const document = await this.getLiveDocument();
        if (!document) {
            return;
        }
        const parsed = parseSettingsDocument(document);
        if (!parsed) {
            return;
        }
        const item = findSettingsItem(parsed.items, key);
        if (!item) {
            return;
        }
        const existing = parsed.entriesByKey.get(normalizeSettingKey(key));
        const edit = new vscode.WorkspaceEdit();
        if (checked) {
            if (existing) {
                // Already present (e.g. the panel was stale) -- nothing to add.
            } else {
                const type = classifySettingType(document, item);
                const valueText = formatValueForSource(type, pendingValue);
                applyInsertEdit(edit, document, parsed, key, valueText);
            }
        } else if (existing) {
            applyRemoveEdit(edit, document, existing);
        }
        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
        }
        this.debouncedRender.run();
    }

    async applyValueChange(key, rawValue) {
        const document = await this.getLiveDocument();
        if (!document) {
            return;
        }
        const parsed = parseSettingsDocument(document);
        if (!parsed) {
            return;
        }
        const existing = parsed.entriesByKey.get(normalizeSettingKey(key));
        if (!existing) {
            // Not checked yet -- the webview keeps the pending value locally and only writes it
            // to the source once the row's checkbox is checked (see applyToggle above).
            return;
        }
        const item = findSettingsItem(parsed.items, key);
        const type = classifySettingType(document, item);
        const valueText = formatValueForSource(type, rawValue);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(existing.valueOffset), document.positionAt(existing.endOffset)), valueText);
        await vscode.workspace.applyEdit(edit);
        this.debouncedRender.run();
    }

    render() {
        if (!this.panel) {
            return;
        }
        if (!this.sourceFile) {
            this.panel.webview.html = renderDetailsHtml({ sourceFile: "", blockLabel: "", tree: [], filterEmptyMessage: "No active DreamShaderLang document." });
            return;
        }
        const document = vscode.workspace.textDocuments.find((entry) => normalizeFsPath(entry.fileName) === this.sourceFile);
        if (!document) {
            this.panel.webview.html = renderDetailsHtml({ sourceFile: this.sourceFile, blockLabel: "", tree: [], filterEmptyMessage: "Document is not open." });
            return;
        }
        const parsed = parseSettingsDocument(document);
        if (!parsed) {
            this.panel.webview.html = renderDetailsHtml({
                sourceFile: this.sourceFile,
                blockLabel: "",
                tree: [],
                filterEmptyMessage: "No Shader/ShaderFunction/VirtualFunction block found in this file."
            });
            return;
        }
        const rows = parsed.items.map((item) => buildRow(document, item, parsed));
        this.panel.webview.html = renderDetailsHtml({
            sourceFile: this.sourceFile,
            blockLabel: `${parsed.block.kind} ${parsed.block.localName || parsed.block.name || ""} — ${parsed.sectionName}`,
            tree: buildRowTree(rows),
            filterEmptyMessage: ""
        });
    }
}

async function getTargetDocument(targetUri) {
    if (targetUri instanceof vscode.Uri) {
        return vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === targetUri.toString())
            || vscode.workspace.openTextDocument(targetUri);
    }
    return vscode.window.activeTextEditor?.document;
}

function normalizeSettingKey(key) {
    return String(key || "").trim().toLowerCase();
}

// VirtualFunction blocks author their Settings-like block as `Options { ... }` and pull rows from
// VIRTUAL_FUNCTION_OPTION_ITEMS; every other block kind uses `Settings { ... }` /
// SETTINGS_ITEMS -- mirrors allowedSectionsForBlock()/addSettings() in completions.js exactly, so
// this panel offers the same rows completion would.
function getSectionPlan(blockKind) {
    if (blockKind === "VirtualFunction") {
        return { sectionName: "Options", items: VIRTUAL_FUNCTION_OPTION_ITEMS };
    }
    return { sectionName: "Settings", items: SETTINGS_ITEMS };
}

// SETTINGS_ITEMS carries several UE property aliases as separate rows (e.g. "Domain" alongside
// "MaterialDomain", "RenderType" alongside "BlendMode") -- useful for completion (either spelling
// is valid DSL syntax), but redundant/confusing as two independently-checkable Details rows for
// what's really one underlying property. Every alias item already self-describes this via its own
// .detail string ("Alias of MaterialDomain" etc.), so canonical-vs-alias is derived from that
// rather than a second hand-maintained list that could drift out of sync with languageData.js.
const ALIAS_DETAIL_PATTERN = /^Alias of (.+)$/;

function getAliasCanonicalName(item) {
    const match = ALIAS_DETAIL_PATTERN.exec(item.detail || "");
    return match ? match[1] : null;
}

// Only canonical items become rows; a document that already has an alias-spelled entry (e.g. a
// hand-written `Domain = "Surface";`) is still recognized under the canonical row via
// buildAliasKeyResolutionMap() below, so no data becomes invisible by hiding the alias row.
function getCanonicalItems(items) {
    return items.filter((item) => !getAliasCanonicalName(item));
}

function buildAliasKeyResolutionMap(items) {
    const map = new Map();
    for (const item of items) {
        const canonicalName = getAliasCanonicalName(item);
        if (canonicalName) {
            map.set(normalizeSettingKey(item.name), normalizeSettingKey(canonicalName));
        }
    }
    return map;
}

// Groups UE struct/array-shaped settings the same way the native Material Editor's Details panel
// would show them -- "LightmassSettings.EmissiveBoost" etc. as members of an expandable
// "LightmassSettings" struct row, "PhysicalMaterialMap[0..3]" as members of an expandable
// "PhysicalMaterialMap" array row -- instead of four unrelated-looking flat checkboxes each.
function computeGroupInfo(name) {
    const arrayMatch = /^(.+)\[(\d+)\]$/.exec(name);
    if (arrayMatch) {
        return { groupKey: arrayMatch[1], groupLabel: arrayMatch[1], memberLabel: `[${arrayMatch[2]}]`, isArray: true };
    }
    const dotIndex = name.indexOf(".");
    if (dotIndex > 0) {
        return { groupKey: name.slice(0, dotIndex), groupLabel: name.slice(0, dotIndex), memberLabel: name.slice(dotIndex + 1), isArray: false };
    }
    return null;
}

// Builds an ordered list of { type: "row", row } and { type: "group", label, isArray, members }
// nodes from the flat row list -- a group node is created at the position of its first member,
// preserving SETTINGS_ITEMS' own ordering (its array/struct members are already adjacent there).
function buildRowTree(rows) {
    const tree = [];
    const groupIndexByKey = new Map();
    for (const row of rows) {
        const info = computeGroupInfo(row.key);
        if (!info) {
            tree.push({ type: "row", row });
            continue;
        }
        if (!groupIndexByKey.has(info.groupKey)) {
            groupIndexByKey.set(info.groupKey, tree.length);
            tree.push({ type: "group", groupKey: info.groupKey, label: info.groupLabel, isArray: info.isArray, members: [] });
        }
        tree[groupIndexByKey.get(info.groupKey)].members.push({ ...row, memberLabel: info.memberLabel });
    }
    return tree;
}

function findTargetBlock(parsedDocument) {
    // bodyOpenOffset stays -1 when the parser never found a '{' for this block (a syntax error,
    // or a file mid-edit -- e.g. "Shader" typed but the opening brace not yet reached). Treating
    // that as a valid target would compute an insert offset of bodyOpenOffset + 1 == 0 and splice
    // new content in at the very start of the document.
    return (parsedDocument.blocks || []).find((block) => block.kind !== "Template" && Array.isArray(block.sections) && block.bodyOpenOffset >= 0);
}

function parseSettingsDocument(document) {
    const text = document.getText();
    const parsedDocument = parseDocument(text);
    const block = findTargetBlock(parsedDocument);
    if (!block) {
        return null;
    }
    const plan = getSectionPlan(block.kind);
    const section = block.sections.find((entry) => entry.name === plan.sectionName) || null;
    const aliasKeyResolution = buildAliasKeyResolutionMap(plan.items);
    const entriesByKey = new Map();
    for (const entry of (section?.entries || [])) {
        if (entry.kind === "assignment") {
            const normalizedName = normalizeSettingKey(entry.name);
            // An existing entry written under an alias spelling (e.g. `Domain = ...`) is still
            // filed under its canonical key, so the canonical row (the only one shown -- see
            // getCanonicalItems()) correctly reflects it as present regardless of which spelling
            // is actually in the source.
            entriesByKey.set(aliasKeyResolution.get(normalizedName) || normalizedName, entry);
        }
    }
    return { block, section, sectionName: plan.sectionName, items: getCanonicalItems(plan.items), entriesByKey, documentText: text };
}

function findSettingsItem(items, key) {
    return items.find((item) => normalizeSettingKey(item.name) === normalizeSettingKey(key));
}

// Mirrors isBooleanSetting()/getSettingMappingNameForKey() from completions.js exactly, plus a
// check for the asset-path snippet shape createAssetSettingItem() produces, so a row's value
// control matches whatever the completion provider would have offered for that same key.
function classifySettingType(document, item) {
    const mappingName = getSettingMappingNameForKey(item.name);
    if (mappingName) {
        return { kind: "enum", mappingName };
    }
    if (isBooleanSetting(item.name)) {
        return { kind: "boolean" };
    }
    if (typeof item.insertText === "string" && item.insertText.includes("Path(")) {
        return { kind: "asset" };
    }
    return { kind: "text" };
}

function unquote(rawValue) {
    const trimmed = String(rawValue || "").trim();
    if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function extractAssetPath(rawValue) {
    const trimmed = String(rawValue || "").trim();
    const match = /^Path\s*\((.*)\)$/i.exec(trimmed);
    return match ? unquote(match[1]) : unquote(trimmed);
}

function readCurrentValue(type, entry) {
    if (!entry) {
        return "";
    }
    if (type.kind === "boolean") {
        // Real DreamShaderLang source quotes booleans (e.g. `TwoSided = "True";` -- see
        // M_Animated.dsm), so unquote before comparing rather than assuming a bare token.
        return normalizeSettingKey(unquote(entry.value)) === "true";
    }
    if (type.kind === "asset") {
        return extractAssetPath(entry.value);
    }
    return unquote(entry.value);
}

function formatValueForSource(type, rawValue) {
    if (type.kind === "boolean") {
        // Quoted to match the convention real DreamShaderLang source already uses (M_Animated.dsm:
        // `TwoSided = "True";`) -- an unquoted true/false parses identically, but this keeps rows
        // this panel writes visually consistent with hand-authored ones.
        return rawValue ? "\"true\"" : "\"false\"";
    }
    if (type.kind === "asset") {
        return `Path(${String(rawValue || "").trim()})`;
    }
    // Enum and plain text both write as a quoted literal -- matches SETTINGS_ITEMS' own default
    // snippet convention (createSettingItem() defaults to `${name} = "$0";`) and is accepted for
    // enum aliases the same as an unquoted token would be (Unquote() strips it before matching).
    const text = String(rawValue ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return `"${text}"`;
}

function collectEnumOptions(document, mappingName) {
    const mapped = collectDreamShaderSettingMappings(document, mappingName);
    if (Array.isArray(mapped) && mapped.length > 0) {
        return mapped;
    }
    return (SETTING_MAPPING_FALLBACKS.get(mappingName) || []).map((alias) => ({ alias, name: alias, displayName: alias }));
}

function buildRow(document, item, parsed) {
    const entry = parsed.entriesByKey.get(normalizeSettingKey(item.name));
    const type = classifySettingType(document, item);
    const row = {
        key: item.name,
        detail: item.detail || "",
        checked: Boolean(entry),
        type: type.kind,
        value: readCurrentValue(type, entry)
    };
    if (type.kind === "enum") {
        row.options = collectEnumOptions(document, type.mappingName).map((mapping) => mapping.alias);
        if (!row.value && row.options.length > 0) {
            row.value = row.options[0];
        } else if (row.value && !row.options.includes(row.value)) {
            // The source already has a value this document's mapping bridge doesn't know about
            // (a typo, or an enum alias added on the engine side after this workspace's bridge
            // data was last regenerated) -- keep it selectable and visibly correct instead of the
            // <select> silently falling back to its first option with no indication of a mismatch.
            row.options = [row.value, ...row.options];
        }
    }
    return row;
}

function computeIndentForSection(documentText, section) {
    if (section && section.entries && section.entries.length > 0) {
        const firstEntry = section.entries.find((entry) => entry.kind === "assignment") || section.entries[0];
        const lineStart = documentText.lastIndexOf("\n", firstEntry.startOffset) + 1;
        const leading = documentText.slice(lineStart, firstEntry.startOffset);
        if (/^[ \t]*$/.test(leading)) {
            return leading;
        }
    }
    return DEFAULT_INDENT;
}

// Inserts a new `Key = Value;` line, creating the whole Settings/Options section (and picking a
// reasonable insertion point right after the block's opening brace) if it doesn't exist yet.
function applyInsertEdit(edit, document, parsed, key, valueText) {
    const { block, section, sectionName } = parsed;
    if (section) {
        const indent = computeIndentForSection(parsed.documentText, section);
        const lastEntry = section.entries.length > 0 ? section.entries[section.entries.length - 1] : null;
        const insertOffset = lastEntry ? findStatementEndOffset(parsed.documentText, lastEntry) : section.bodyOpenOffset;
        const insertPos = document.positionAt(insertOffset);
        const line = `\n${indent}${key} = ${valueText};`;
        edit.insert(document.uri, insertPos, line);
        return;
    }
    const blockIndent = DEFAULT_INDENT;
    const entryIndent = DEFAULT_INDENT + DEFAULT_INDENT;
    const text = `\n${blockIndent}${sectionName}\n${blockIndent}{\n${entryIndent}${key} = ${valueText};\n${blockIndent}}\n`;
    edit.insert(document.uri, document.positionAt(block.bodyOpenOffset + 1), text);
}

function findStatementEndOffset(documentText, entry) {
    let offset = entry.endOffset;
    while (offset < documentText.length && documentText[offset] !== ";") {
        offset += 1;
    }
    return offset < documentText.length ? offset + 1 : offset;
}

// Removes the full line(s) the entry occupies (including the terminating ';' and line break) when
// it's the only thing on those lines, so unchecking a row doesn't leave a blank line behind;
// otherwise falls back to removing just the statement's own span.
function applyRemoveEdit(edit, document, entry) {
    const text = document.getText();
    const semicolonOffset = findStatementEndOffset(text, entry);
    const startPos = document.positionAt(entry.startOffset);
    const endPos = document.positionAt(semicolonOffset);
    const startLine = document.lineAt(startPos.line);
    const endLine = document.lineAt(Math.min(endPos.line, document.lineCount - 1));
    const isWholeStartLine = startLine.text.slice(0, startPos.character).trim() === "";
    const isWholeEndLine = endLine.text.slice(endPos.character).trim() === "";
    if (isWholeStartLine && isWholeEndLine) {
        edit.delete(document.uri, new vscode.Range(startLine.range.start, endLine.rangeIncludingLineBreak.end));
        return;
    }
    edit.delete(document.uri, new vscode.Range(startPos, endPos));
}

function renderDetailsHtml({ sourceFile, blockLabel, tree, filterEmptyMessage }) {
    const nonce = String(Date.now());
    const safeSource = escapeHtml(sourceFile ? path.basename(sourceFile) : "");
    const safeBlockLabel = escapeHtml(blockLabel);
    const hasRows = tree.length > 0;
    const treeHtml = tree.map((node) => (node.type === "group" ? renderGroupHtml(node) : renderRowHtml(node.row))).join("\n");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* {
    box-sizing: border-box;
}
body {
    margin: 0;
    padding: 16px 18px 20px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
}
.toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}
.toolbar input[type="text"] {
    flex: 1;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 6px 10px;
    font: inherit;
    transition: border-color 120ms ease;
}
.toolbar input[type="text"]:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
}
.block-label {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
}
table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
}
tr.setting-row td, tr.group-header td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    vertical-align: middle;
}
tr.setting-row {
    transition: background-color 100ms ease;
}
tr.setting-row:hover td {
    background: var(--vscode-list-hoverBackground);
}
tr.setting-row.unchecked .name-cell, tr.setting-row.unchecked .detail-text {
    color: var(--vscode-descriptionForeground);
}
.checkbox-cell {
    width: 24px;
}
.name-cell {
    white-space: nowrap;
}
tr.group-member .name-cell {
    padding-left: 22px;
}
.detail-text {
    display: block;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}
.value-cell {
    width: 45%;
}
.value-cell select, .value-cell input[type="text"] {
    width: 100%;
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    padding: 5px 6px;
    font: inherit;
    transition: border-color 120ms ease;
}
.value-cell select:focus, .value-cell input[type="text"]:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
}
tr.group-header td {
    padding-top: 10px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    background: var(--vscode-sideBar-background);
}
tr.group-header:hover td {
    background: var(--vscode-list-hoverBackground);
}
.group-toggle {
    display: inline-block;
    width: 12px;
    transition: transform 120ms ease;
}
tr.group-header.collapsed .group-toggle {
    transform: rotate(-90deg);
}
.group-badge {
    font-weight: 400;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background, rgba(127, 127, 127, 0.2));
    border-radius: 8px;
    padding: 1px 7px;
    margin-left: 8px;
}
.empty {
    color: var(--vscode-descriptionForeground);
    margin-top: 12px;
}
</style>
</head>
<body>
    <div class="block-label">${safeBlockLabel}${safeSource ? ` (${safeSource})` : ""}</div>
    ${hasRows ? `<div class="toolbar"><input id="filter" type="text" placeholder="Filter settings..."></div>` : ""}
    ${hasRows
        ? `<table><tbody id="rows">\n${treeHtml}\n</tbody></table>`
        : `<div class="empty">${escapeHtml(filterEmptyMessage || "No settings available.")}</div>`}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelectorAll("input.include-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
        const key = event.target.getAttribute("data-key");
        const row = document.getElementById("row-" + key);
        const valueControl = row ? row.querySelector(".value-control") : null;
        const value = valueControl ? readControlValue(valueControl) : "";
        vscode.postMessage({ command: "toggle", key, checked: event.target.checked, value });
    });
});

document.querySelectorAll(".value-control").forEach((control) => {
    control.addEventListener("change", (event) => {
        const key = event.target.getAttribute("data-key");
        vscode.postMessage({ command: "value", key, value: readControlValue(event.target) });
    });
});

function readControlValue(control) {
    if (control.type === "checkbox") {
        return control.checked;
    }
    return control.value;
}

function groupMembers(groupKey) {
    return document.querySelectorAll('tr.group-member[data-group="' + CSS.escape(groupKey) + '"]');
}

// A group member's real visibility depends on BOTH whether the filter currently matches it and
// whether its group header is collapsed -- track them as two independent flags per row rather
// than a single CSS class, since a collapsed group with a matching filter should stay collapsed
// (not force-expand), and re-expanding it later should respect whatever the filter currently is.
function updateMemberDisplay(member) {
    const hidden = member.dataset.filterHidden === "true" || member.dataset.collapsedHidden === "true";
    member.style.display = hidden ? "none" : "";
}

document.querySelectorAll("tr.group-header").forEach((header) => {
    header.addEventListener("click", () => {
        header.classList.toggle("collapsed");
        const collapsed = header.classList.contains("collapsed");
        groupMembers(header.getAttribute("data-group")).forEach((member) => {
            member.dataset.collapsedHidden = collapsed ? "true" : "";
            updateMemberDisplay(member);
        });
    });
});

const filterInput = document.getElementById("filter");
if (filterInput) {
    filterInput.addEventListener("input", (event) => {
        const needle = event.target.value.trim().toLowerCase();
        document.querySelectorAll("tr.group-header").forEach((header) => {
            const groupKey = header.getAttribute("data-group");
            let anyVisible = false;
            groupMembers(groupKey).forEach((member) => {
                const matches = !needle || rowMatchesFilter(member, needle);
                member.dataset.filterHidden = matches ? "" : "true";
                anyVisible = anyVisible || matches;
                updateMemberDisplay(member);
            });
            header.style.display = !needle || anyVisible ? "" : "none";
        });
        document.querySelectorAll("tr.setting-row:not([data-group])").forEach((row) => {
            row.style.display = !needle || rowMatchesFilter(row, needle) ? "" : "none";
        });
    });
}

function rowMatchesFilter(row, needle) {
    const key = (row.getAttribute("data-key") || "").toLowerCase();
    const detail = (row.getAttribute("data-detail") || "").toLowerCase();
    return key.includes(needle) || detail.includes(needle);
}
</script>
</body>
</html>`;
}

function renderGroupHtml(group) {
    const safeGroupKey = escapeHtml(group.groupKey);
    const safeLabel = escapeHtml(group.label);
    const badge = group.isArray ? `${group.members.length} elements` : "struct";
    const header = `<tr class="group-header" data-group="${safeGroupKey}">
    <td class="checkbox-cell"></td>
    <td colspan="2"><span class="group-toggle">&#9662;</span>${safeLabel}<span class="group-badge">${escapeHtml(badge)}</span></td>
</tr>`;
    const members = group.members.map((row) => renderRowHtml(row, { groupKey: group.groupKey })).join("\n");
    return `${header}\n${members}`;
}

function renderRowHtml(row, options = {}) {
    const safeKey = escapeHtml(row.key);
    const safeDetail = escapeHtml(row.detail);
    const displayName = escapeHtml(row.memberLabel || row.key);
    const groupAttr = options.groupKey ? ` data-group="${escapeHtml(options.groupKey)}"` : "";
    const rowClass = `setting-row${row.checked ? "" : " unchecked"}${options.groupKey ? " group-member" : ""}`;
    return `<tr class="${rowClass}" id="row-${safeKey}" data-key="${safeKey}" data-detail="${safeDetail}"${groupAttr}>
    <td class="checkbox-cell"><input type="checkbox" class="include-checkbox" data-key="${safeKey}"${row.checked ? " checked" : ""}></td>
    <td class="name-cell">${displayName}${safeDetail ? `<span class="detail-text">${safeDetail}</span>` : ""}</td>
    <td class="value-cell">${renderValueControlHtml(row)}</td>
</tr>`;
}

function renderValueControlHtml(row) {
    const safeKey = escapeHtml(row.key);
    if (row.type === "enum") {
        const options = (row.options || []).map((option) => {
            const safeOption = escapeHtml(option);
            const selected = option === row.value ? " selected" : "";
            return `<option value="${safeOption}"${selected}>${safeOption}</option>`;
        }).join("");
        return `<select class="value-control" data-key="${safeKey}">${options}</select>`;
    }
    if (row.type === "boolean") {
        return `<input type="checkbox" class="value-control" data-key="${safeKey}"${row.value ? " checked" : ""}>`;
    }
    const safeValue = escapeHtml(row.value);
    const placeholder = row.type === "asset" ? "/Game/Path/To/Asset" : "";
    return `<input type="text" class="value-control" data-key="${safeKey}" value="${safeValue}" placeholder="${placeholder}">`;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

module.exports = {
    registerDetailsCommands
};
