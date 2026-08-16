"use strict";

// DreamShader material preview — extension-host half.
//
// The live pixels no longer pass through this process. When the transport is WebSocket the webview
// (media/preview.js) owns the socket and paints raw RGBA8 frames straight onto a canvas; this file
// only manages the panel, resolves the socket URL, tracks which .dsm is active, and — new in this
// version — turns VS Code breakpoints in the active .dsm into "probe" (Start-Previewing-Node)
// requests and paints the resolved probe line back into the editor gutter.
//
// The file-bridge transport is kept as a one-shot fallback for setups where the WebSocket server is
// disabled (dreamshader.previewTransport = "file"): the host writes a request file, watches
// preview.json + the PNG it names, and hands the webview a single frame to show.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { createDebouncedDisposable } = require("../../common/debounce");
const { readJsonFile } = require("../../common/json");
const { normalizeFsPath } = require("../../common/path");
const { getPreviewDirectory, getPreviewFilePath } = require("../../bridge/paths");
const { writePreviewMaterialRequest } = require("../../bridge/requests");
const { findProjectRoot, isDreamShaderDocument } = require("../../project/projects");

const DEFAULT_PREVIEW_PORT = 17864;
const DEFAULT_AUTO_REFRESH_DELAY_MS = 1200;
const DEFAULT_LIVE_PREVIEW_FPS = 12;
const MAX_LIVE_PREVIEW_FPS = 60;
const DEFAULT_ORBIT_YAW = -157.5;
const DEFAULT_ORBIT_PITCH = -11.25;

function registerPreviewCommands(context) {
    const manager = new MaterialPreviewPanelManager(context);
    context.subscriptions.push(
        manager,
        vscode.commands.registerCommand("dreamshader.showMaterialPreview", async (targetUri) => {
            await manager.show(targetUri);
        })
    );
}

class MaterialPreviewPanelManager {
    constructor(context) {
        this.context = context;
        this.panel = null;
        this.projectRoot = "";
        this.sourceFile = "";
        // View state persisted across source switches and panel re-inits (never persisted to disk,
        // matching the old panel's lifetime).
        this.mesh = "sphere";
        this.frameRateOverride = null;
        this.orbitYaw = DEFAULT_ORBIT_YAW;
        this.orbitPitch = DEFAULT_ORBIT_PITCH;
        // The probe line the engine actually resolved this session's breakpoint to (0 = none), used
        // only to drive the gutter decoration.
        this.resolvedProbeLine = 0;

        this.watchers = [];
        this.isDisposed = false;
        this.webviewReady = false;

        this.probeDecoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.infoForeground"),
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            backgroundColor: new vscode.ThemeColor("editor.stackFrameHighlightBackground"),
            gutterIconPath: makeProbeGutterIcon(context),
            gutterIconSize: "contain"
        });

        this.debouncedFileRefresh = createDebouncedDisposable(() => this.pushFileFrame(), 150);

        this.saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
            if (this.panel && this.isCurrentSource(document) && getPreviewTransport() === "file") {
                // WebSocket sessions recompile on the bridge's own save watcher; only the file
                // transport needs a nudge here.
                void this.requestFilePreview();
            }
        });
        this.breakpointsSubscription = vscode.debug.onDidChangeBreakpoints(() => this.syncBreakpoints());
        this.activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (this.panel) {
                void this.followEditor(editor);
            }
            this.applyProbeDecoration();
        });
    }

    dispose() {
        this.isDisposed = true;
        this.disposeWatchers();
        this.debouncedFileRefresh.dispose();
        this.saveSubscription.dispose();
        this.breakpointsSubscription.dispose();
        this.activeEditorSubscription.dispose();
        this.probeDecoration.dispose();
    }

    async show(targetUri) {
        const document = await getTargetDocument(targetUri);
        if (!document || !isPreviewDocument(document)) {
            vscode.window.showWarningMessage("DreamShader material preview needs an active .dsm material document.");
            return;
        }
        const projectRoot = findProjectRoot(document.fileName);
        if (!projectRoot) {
            vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
            return;
        }

        this.sourceFile = normalizeFsPath(document.fileName);
        this.projectRoot = normalizeFsPath(projectRoot);
        this.resolvedProbeLine = 0;
        await this.ensurePanel();
        this.refreshWatchers();
        await this.sendInit();
    }

    async ensurePanel() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        this.webviewReady = false;
        this.panel = vscode.window.createWebviewPanel(
            "dreamshaderMaterialPreview",
            "DreamShader Material Preview",
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, "media"),
                    vscode.Uri.file(getPreviewDirectory(this.projectRoot))
                ]
            });

        this.panel.webview.html = await this.renderHtml();

        this.panel.onDidDispose(() => {
            this.panel = null;
            this.webviewReady = false;
            this.sourceFile = "";
            this.resolvedProbeLine = 0;
            this.disposeWatchers();
            this.applyProbeDecoration();
        });
        this.panel.onDidChangeViewState((event) => {
            this.postToWebview({ type: "visibility", visible: event.webviewPanel.visible });
        });
        this.panel.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message));
    }

    async followEditor(editor) {
        const document = editor?.document;
        if (!document || !isPreviewDocument(document)) {
            return;
        }
        const projectRoot = findProjectRoot(document.fileName);
        if (!projectRoot) {
            return;
        }
        const nextSource = normalizeFsPath(document.fileName);
        if (nextSource === this.sourceFile && normalizeFsPath(projectRoot) === this.projectRoot) {
            return;
        }
        this.sourceFile = nextSource;
        this.projectRoot = normalizeFsPath(projectRoot);
        this.resolvedProbeLine = 0;
        await this.ensurePanel();
        this.refreshWatchers();
        await this.sendInit();
    }

    async sendInit() {
        if (!this.panel) {
            return;
        }
        const transport = getPreviewTransport();
        const config = {
            transport,
            sourceFile: this.sourceFile,
            mesh: this.mesh,
            frameRate: this.getEffectiveFrameRate(),
            orbitYaw: this.orbitYaw,
            orbitPitch: this.orbitPitch,
            probeLine: this.activeBreakpointLine()
        };
        if (transport === "file") {
            const result = readPreviewResult(this.projectRoot, this.sourceFile);
            config.fileImageUri = this.fileImageUri(result);
            this.postToWebview({ type: "init", config });
            await this.requestFilePreview();
        } else {
            config.wsUrl = await this.resolveWebSocketUrl();
            this.postToWebview({ type: "init", config });
        }
        this.syncBreakpoints();
    }

    async resolveWebSocketUrl() {
        const port = getPreviewPort();
        try {
            const external = await vscode.env.asExternalUri(vscode.Uri.parse(`ws://127.0.0.1:${port}/dreamshader-preview`));
            return external.toString();
        } catch (_error) {
            return `ws://127.0.0.1:${port}/dreamshader-preview`;
        }
    }

    // ---- webview -> host --------------------------------------------------

    handleWebviewMessage(message) {
        if (!message || typeof message !== "object") {
            return;
        }
        switch (message.command) {
            case "ready":
                this.webviewReady = true;
                void this.sendInit();
                break;
            case "orbit":
                if (Number.isFinite(message.yaw)) this.orbitYaw = message.yaw;
                if (Number.isFinite(message.pitch)) this.orbitPitch = message.pitch;
                break;
            case "mesh":
                if (typeof message.value === "string") this.mesh = message.value;
                break;
            case "frameRate":
                if (Number.isFinite(message.value)) this.frameRateOverride = Math.max(0, Math.min(MAX_LIVE_PREVIEW_FPS, message.value));
                break;
            case "probeResolved":
                this.resolvedProbeLine = Number(message.line) || 0;
                this.applyProbeDecoration();
                break;
            case "requestRefresh":
                void this.requestFilePreview();
                break;
            case "asset":
                if (message.assetPath) {
                    vscode.window.setStatusBarMessage(`DreamShader preview: ${message.assetPath}`, 2500);
                }
                break;
            default:
                break;
        }
    }

    // ---- breakpoints ------------------------------------------------------

    // The engine previews one value at a time, so the active probe is the topmost enabled breakpoint
    // in the current .dsm. Returns its 1-based line, or 0 when there is none.
    activeBreakpointLine() {
        if (!this.sourceFile) {
            return 0;
        }
        let best = 0;
        for (const bp of vscode.debug.breakpoints) {
            if (!(bp instanceof vscode.SourceBreakpoint) || !bp.enabled) {
                continue;
            }
            if (normalizeFsPath(bp.location.uri.fsPath) !== this.sourceFile) {
                continue;
            }
            const line = bp.location.range.start.line + 1;
            if (best === 0 || line < best) {
                best = line;
            }
        }
        return best;
    }

    syncBreakpoints() {
        if (!this.panel) {
            return;
        }
        const line = this.activeBreakpointLine();
        this.postToWebview({ type: "setBreakpoint", line });
        if (line === 0) {
            this.resolvedProbeLine = 0;
            this.applyProbeDecoration();
        }
    }

    applyProbeDecoration() {
        for (const editor of vscode.window.visibleTextEditors) {
            if (normalizeFsPath(editor.document.fileName) !== this.sourceFile || !this.panel || this.resolvedProbeLine <= 0) {
                editor.setDecorations(this.probeDecoration, []);
                continue;
            }
            const zeroBased = this.resolvedProbeLine - 1;
            if (zeroBased < 0 || zeroBased >= editor.document.lineCount) {
                editor.setDecorations(this.probeDecoration, []);
                continue;
            }
            const range = editor.document.lineAt(zeroBased).range;
            editor.setDecorations(this.probeDecoration, [{
                range,
                hoverMessage: "DreamShader: previewing this line's value"
            }]);
        }
    }

    // ---- file-bridge fallback --------------------------------------------

    async requestFilePreview() {
        if (getPreviewTransport() !== "file" || !this.projectRoot || !this.sourceFile) {
            return;
        }
        const document = vscode.workspace.textDocuments.find((entry) => normalizeFsPath(entry.fileName) === this.sourceFile);
        if (document?.isDirty) {
            await document.save();
        }
        writePreviewMaterialRequest(this.projectRoot, this.sourceFile, {
            width: 512,
            height: 512,
            mesh: this.mesh,
            requestId: createRequestId()
        });
        this.postToWebview({ type: "status", text: "Requested preview through the file bridge…" });
    }

    pushFileFrame() {
        if (!this.panel || getPreviewTransport() !== "file") {
            return;
        }
        const result = readPreviewResult(this.projectRoot, this.sourceFile);
        const imageUri = this.fileImageUri(result);
        if (imageUri) {
            this.postToWebview({ type: "fileFrame", imageUri });
        }
        if (result?.message) {
            this.postToWebview({ type: "status", text: result.message });
        }
    }

    fileImageUri(result) {
        if (!this.panel || !result?.imagePath || !fs.existsSync(result.imagePath)) {
            return "";
        }
        const base = this.panel.webview.asWebviewUri(vscode.Uri.file(result.imagePath)).toString();
        return `${base}?t=${encodeURIComponent(result.updatedAtUtc || Date.now())}`;
    }

    refreshWatchers() {
        this.disposeWatchers();
        if (!this.projectRoot || getPreviewTransport() !== "file") {
            return;
        }
        const add = (watcher) => {
            watcher.onDidCreate(() => this.debouncedFileRefresh.run());
            watcher.onDidChange(() => this.debouncedFileRefresh.run());
            this.watchers.push(watcher);
        };
        add(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(this.projectRoot), "Saved/DreamShader/Bridge/preview.json")));
        add(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(this.projectRoot), "Saved/DreamShader/Bridge/Preview/*.png")));
    }

    disposeWatchers() {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    // ---- helpers ----------------------------------------------------------

    isCurrentSource(document) {
        return Boolean(document?.fileName && this.sourceFile && normalizeFsPath(document.fileName) === this.sourceFile);
    }

    getEffectiveFrameRate() {
        return this.frameRateOverride !== null ? this.frameRateOverride : getLivePreviewFrameRate();
    }

    postToWebview(message) {
        this.panel?.webview.postMessage(message);
    }

    async renderHtml() {
        const webview = this.panel.webview;
        const nonce = crypto.randomBytes(16).toString("base64");
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "preview.js"));
        const port = getPreviewPort();
        // The webview opens the WebSocket itself, so connect-src must allow the resolved ws origin.
        const wsExternal = await this.resolveWebSocketUrl();
        let wsOrigin = `ws://127.0.0.1:${port} wss://127.0.0.1:${port}`;
        try {
            const parsed = vscode.Uri.parse(wsExternal);
            wsOrigin = `${parsed.scheme}://${parsed.authority}`;
        } catch (_error) {
            // keep the loopback default
        }
        const csp = [
            "default-src 'none'",
            `img-src ${webview.cspSource} data: blob:`,
            `style-src ${webview.cspSource} 'nonce-${nonce}'`,
            `script-src 'nonce-${nonce}'`,
            `connect-src ${wsOrigin}`
        ].join("; ");
        return renderPreviewHtml({ nonce, csp, scriptUri: scriptUri.toString(), maxFps: MAX_LIVE_PREVIEW_FPS });
    }
}

async function getTargetDocument(targetUri) {
    if (targetUri instanceof vscode.Uri) {
        return vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === targetUri.toString())
            || vscode.workspace.openTextDocument(targetUri);
    }
    return vscode.window.activeTextEditor?.document;
}

function isPreviewDocument(document) {
    return Boolean(document && isDreamShaderDocument(document) && path.extname(document.fileName).toLowerCase() === ".dsm");
}

function readPreviewResult(projectRoot, sourceFile) {
    const previewFile = getPreviewFilePath(projectRoot);
    const result = readJsonFile(previewFile, null);
    if (!result || typeof result !== "object") {
        return null;
    }
    if (sourceFile && result.sourceFile && normalizeFsPath(result.sourceFile) !== normalizeFsPath(sourceFile)) {
        return null;
    }
    return { ...result, imagePath: result.imagePath ? normalizeFsPath(result.imagePath) : "" };
}

function getPreviewPort() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewWebSocketPort", DEFAULT_PREVIEW_PORT);
    const numeric = Number(configured);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(65535, Math.floor(numeric))) : DEFAULT_PREVIEW_PORT;
}

function getPreviewTransport() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewTransport", "websocket");
    return configured === "file" ? "file" : "websocket";
}

function getLivePreviewFrameRate() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewLiveFrameRate", DEFAULT_LIVE_PREVIEW_FPS);
    const numeric = Number(configured);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(MAX_LIVE_PREVIEW_FPS, numeric)) : DEFAULT_LIVE_PREVIEW_FPS;
}

function createRequestId() {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// A tiny info-colored dot for the previewed line's gutter, as a data URI so it needs no bundled asset.
function makeProbeGutterIcon() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="#3aa0ff"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`);
}

function renderPreviewHtml({ nonce, csp, scriptUri, maxFps }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
body { margin: 0; padding: 12px 14px 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); }
* { box-sizing: border-box; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
button, select, input[type="number"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 4px; padding: 6px 12px; font: inherit; cursor: pointer; }
select, input[type="number"] { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); cursor: auto; }
input[type="number"] { width: 52px; padding: 5px 6px; }
button:hover { background: var(--vscode-button-hoverBackground); }
.fps-label { color: var(--vscode-descriptionForeground); font-size: 12px; }
.stage { position: relative; width: 100%; aspect-ratio: 1 / 1; max-height: 70vh; display: grid; place-items: center; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background); cursor: grab; overflow: hidden; }
.stage.dragging { cursor: grabbing; }
.stage.disconnected { border-color: var(--vscode-inputValidation-warningBorder, #b89500); }
canvas { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; image-rendering: auto; display: block; }
#axisGizmo { position: absolute; top: 10px; right: 10px; pointer-events: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35)); }
#axisGizmo text { font-size: 12px; font-weight: 700; paint-order: stroke fill; stroke: var(--vscode-editor-background); stroke-width: 3px; stroke-linejoin: round; }
#banner { display: none; position: absolute; top: 0; left: 0; right: 0; z-index: 2; padding: 7px 12px; background: var(--vscode-inputValidation-warningBackground, #7a5c00); border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #b89500); color: var(--vscode-inputValidation-warningForeground, #fff); font-size: 12px; }
.probe { margin-top: 10px; padding: 5px 9px; border-radius: 4px; font-size: 12px; display: none; }
.probe-active { background: var(--vscode-editor-stackFrameHighlightBackground, rgba(58,160,255,0.18)); color: var(--vscode-foreground); }
.probe-pending { background: var(--vscode-inputValidation-warningBackground, #4a3b00); color: var(--vscode-inputValidation-warningForeground, #fff); }
.status { margin-top: 10px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
.hint { margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; opacity: 0.8; }
</style>
</head>
<body>
<div class="toolbar">
    <button id="refresh" type="button">Refresh</button>
    <select id="mesh" aria-label="Preview mesh">
        <option value="sphere">Sphere</option>
        <option value="plane">Plane</option>
        <option value="cube">Cube</option>
        <option value="cylinder">Cylinder</option>
        <option value="shaderball">Shader Ball</option>
    </select>
    <label class="fps-label" for="fps">FPS</label>
    <input id="fps" type="number" min="0" max="${maxFps}" step="1" value="12" title="Live preview frame rate (0 pauses streaming)">
</div>
<div class="stage" id="stage">
    <div id="banner"></div>
    <canvas id="frame" width="512" height="512"></canvas>
    <svg id="axisGizmo" viewBox="-44 -44 88 88" width="80" height="80" xmlns="http://www.w3.org/2000/svg">
        <circle cx="0" cy="0" r="38" fill="var(--vscode-editor-background)" fill-opacity="0.65" stroke="var(--vscode-panel-border)" stroke-width="1"></circle>
        <line id="axisLineZ" x1="0" y1="0" x2="0" y2="0" stroke="#2f8fef" stroke-width="3.5" stroke-linecap="round"></line>
        <line id="axisLineY" x1="0" y1="0" x2="0" y2="0" stroke="#3ddc5a" stroke-width="3.5" stroke-linecap="round"></line>
        <line id="axisLineX" x1="0" y1="0" x2="0" y2="0" stroke="#ff4b3e" stroke-width="3.5" stroke-linecap="round"></line>
        <circle id="axisTipZ" cx="0" cy="0" r="3.5" fill="#2f8fef"></circle>
        <circle id="axisTipY" cx="0" cy="0" r="3.5" fill="#3ddc5a"></circle>
        <circle id="axisTipX" cx="0" cy="0" r="3.5" fill="#ff4b3e"></circle>
        <circle cx="0" cy="0" r="2.5" fill="var(--vscode-descriptionForeground)"></circle>
        <text id="axisLabelZ" x="0" y="0" fill="#2f8fef" text-anchor="middle" dominant-baseline="middle">Z</text>
        <text id="axisLabelY" x="0" y="0" fill="#3ddc5a" text-anchor="middle" dominant-baseline="middle">Y</text>
        <text id="axisLabelX" x="0" y="0" fill="#ff4b3e" text-anchor="middle" dominant-baseline="middle">X</text>
    </svg>
</div>
<div class="probe" id="probe"></div>
<div class="status" id="status">Connecting…</div>
<div class="hint">Set a breakpoint (F9) on a Graph line to preview that value on the mesh.</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

module.exports = {
    registerPreviewCommands,
    readPreviewResult
};
