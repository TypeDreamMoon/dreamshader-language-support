"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
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
const DEFAULT_LIVE_PREVIEW_FPS = 2;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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
        this.mesh = "sphere";
        this.watchers = [];
        this.latestRequestId = "";
        this.latestRequestKey = "";
        this.latestResult = null;
        this.transportStatus = "Idle.";
        this.webSocket = null;
        this.webSocketProjectRoot = "";
        this.isDisposed = false;
        this.isRequesting = false;
        this.debouncedRender = createDebouncedDisposable(() => this.render(), 100);
        this.debouncedPreviewRequest = createDebouncedDisposable(() => {
            void this.requestPreview({ reason: "edit", force: false });
        }, getAutoRefreshDelayMs());
        this.saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
            if (this.panel && this.isCurrentSource(document)) {
                void this.requestPreview({ reason: "save", force: true });
            }
        });
        this.changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
            if (this.panel && this.isCurrentSource(event.document)) {
                this.debouncedPreviewRequest.run();
            }
        });
        this.activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (this.panel) {
                void this.followEditor(editor);
            }
        });
    }

    dispose() {
        this.isDisposed = true;
        this.disposeWatchers();
        this.disposeWebSocket();
        this.debouncedRender.dispose();
        this.debouncedPreviewRequest.dispose();
        this.saveSubscription.dispose();
        this.changeSubscription.dispose();
        this.activeEditorSubscription.dispose();
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

        await this.setTarget(document, normalizeFsPath(projectRoot), { request: false });
        this.ensurePanel();
        this.refreshWatchers();
        this.render("Requesting preview...");
        await this.requestPreview({ reason: "show", force: true });
    }

    ensurePanel() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            "dreamshaderMaterialPreview",
            "DreamShader Material Preview",
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(getPreviewDirectory(this.projectRoot))
                ]
            });
        this.panel.onDidDispose(() => {
            this.sendPreviewControl(false);
            this.panel = null;
            this.sourceFile = "";
            this.latestResult = null;
            this.disposeWatchers();
            this.disposeWebSocket();
        });
        this.panel.onDidChangeViewState((event) => {
            this.sendPreviewControl(event.webviewPanel.visible);
        });
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });
    }

    async followEditor(editor) {
        const document = editor?.document;
        if (!document || !isPreviewDocument(document)) {
            this.sourceFile = "";
            this.latestResult = null;
            this.latestRequestId = "";
            this.latestRequestKey = "";
            this.transportStatus = "No active .dsm material document.";
            this.render();
            return;
        }

        const projectRoot = findProjectRoot(document.fileName);
        if (!projectRoot) {
            this.sourceFile = normalizeFsPath(document.fileName);
            this.projectRoot = "";
            this.latestResult = null;
            this.transportStatus = "DreamShader could not locate the Unreal project root.";
            this.render();
            return;
        }

        const changed = await this.setTarget(document, normalizeFsPath(projectRoot), { request: false });
        if (changed) {
            this.ensurePanel();
            this.refreshWatchers();
            this.render("Requesting preview...");
            await this.requestPreview({ reason: "activeEditor", force: true });
        }
    }

    async setTarget(document, projectRoot, _options = {}) {
        const nextSourceFile = normalizeFsPath(document.fileName);
        const nextProjectRoot = normalizeFsPath(projectRoot);
        const changed = this.sourceFile !== nextSourceFile || this.projectRoot !== nextProjectRoot;
        if (!changed) {
            return false;
        }

        if (this.panel && this.projectRoot && this.projectRoot !== nextProjectRoot) {
            this.panel.dispose();
            this.panel = null;
        }

        this.projectRoot = nextProjectRoot;
        this.sourceFile = nextSourceFile;
        this.latestResult = null;
        this.latestRequestId = "";
        this.latestRequestKey = "";
        this.transportStatus = "Ready.";
        this.ensureWebSocket();
        return true;
    }

    async handleMessage(message) {
        if (!message || typeof message !== "object") {
            return;
        }
        if (message.command === "refresh") {
            await this.requestPreview({ reason: "manual", force: true });
            return;
        }
        if (message.command === "mesh") {
            this.mesh = ["sphere", "plane", "cube"].includes(message.value) ? message.value : "sphere";
            await this.requestPreview({ reason: "mesh", force: true });
            return;
        }
        if (message.command === "frameRendered") {
            this.sendPreviewControl(this.panel?.visible !== false, message.frameIndex);
        }
    }

    async requestPreview({ reason = "manual", force = false } = {}) {
        if (this.isRequesting || !this.projectRoot || !this.sourceFile) {
            return;
        }

        const document = vscode.workspace.textDocuments.find((entry) => normalizeFsPath(entry.fileName) === this.sourceFile);
        if (document?.isDirty) {
            const saved = await document.save();
            if (!saved) {
                this.render("DreamShader preview skipped because the current material could not be saved.");
                return;
            }
        }

        const version = document?.version || 0;
        const requestKey = `${this.sourceFile}|${version}|${this.mesh}`;
        if (!force && this.latestRequestKey === requestKey) {
            return;
        }

        this.isRequesting = true;
        this.latestRequestKey = requestKey;
        this.latestRequestId = createRequestId();
        try {
            const payload = {
                type: "previewMaterial",
                requestId: this.latestRequestId,
                sourceFile: this.sourceFile,
                width: 512,
                height: 512,
                mesh: this.mesh,
                stream: true,
                frameRate: getLivePreviewFrameRate(),
                reason
            };
            if (getPreviewTransport() !== "file" && this.sendWebSocket(payload)) {
                this.transportStatus = "Sent preview request over WebSocket.";
            } else {
                writePreviewMaterialRequest(this.projectRoot, this.sourceFile, {
                    width: payload.width,
                    height: payload.height,
                    mesh: payload.mesh,
                    requestId: payload.requestId
                });
                this.transportStatus = "Sent preview request through file bridge.";
            }
            vscode.window.setStatusBarMessage(`DreamShader requested preview for ${path.basename(this.sourceFile)}.`, 2500);
            this.render("Waiting for Unreal Editor preview output...");
        } catch (error) {
            this.render(`Failed to request preview: ${formatError(error)}`);
        } finally {
            this.isRequesting = false;
        }
    }

    ensureWebSocket() {
        if (getPreviewTransport() === "file" || !this.projectRoot) {
            this.disposeWebSocket();
            return;
        }
        if (this.webSocket && this.webSocketProjectRoot === this.projectRoot) {
            return;
        }
        this.disposeWebSocket();
        this.webSocketProjectRoot = this.projectRoot;
        this.webSocket = new DreamShaderPreviewSocket({
            port: getPreviewPort(),
            onMessage: (message) => this.handleWebSocketMessage(message),
            onStatus: (status) => {
                this.transportStatus = status;
                this.debouncedRender.run();
            }
        });
        this.webSocket.connect();
    }

    sendWebSocket(payload) {
        this.ensureWebSocket();
        return Boolean(this.webSocket?.sendJson(payload));
    }

    handleWebSocketMessage(message) {
        if (!message || typeof message !== "object") {
            return;
        }
        if (message.requestId && this.latestRequestId && message.requestId !== this.latestRequestId) {
            return;
        }
        if (message.sourceFile && this.sourceFile && normalizeFsPath(message.sourceFile) !== this.sourceFile) {
            return;
        }
        if (message.type === "previewFrame") {
            this.latestResult = {
                ...(this.latestResult || {}),
                ...message,
                status: "ready",
                imagePath: message.imagePath ? normalizeFsPath(message.imagePath) : this.latestResult?.imagePath || "",
                updatedAtUtc: message.updatedAtUtc || new Date().toISOString()
            };
            this.transportStatus = "Streaming live preview over WebSocket.";
            if (message.imageBase64 && this.panel) {
                this.panel.webview.postMessage({
                    command: "previewFrame",
                    imageUri: `data:image/png;base64,${message.imageBase64}`,
                    frameIndex: message.frameIndex,
                    updatedAtUtc: this.latestResult.updatedAtUtc,
                    transportStatus: this.transportStatus
                });
            }
            return;
        }
        if (message.type !== "previewResult") {
            return;
        }
        this.latestResult = {
            ...message,
            status: message.status || "ready",
            imagePath: message.imagePath ? normalizeFsPath(message.imagePath) : "",
            updatedAtUtc: message.updatedAtUtc || new Date().toISOString()
        };
        this.transportStatus = "Preview updated over WebSocket.";
        this.render();
    }

    disposeWebSocket() {
        if (this.webSocket) {
            this.webSocket.dispose();
        }
        this.webSocket = null;
        this.webSocketProjectRoot = "";
    }

    sendPreviewControl(visible, frameIndex = undefined) {
        if (!this.webSocket?.connected) {
            return;
        }
        this.webSocket.sendJson({
            type: "previewControl",
            requestId: this.latestRequestId,
            sourceFile: this.sourceFile,
            stream: Boolean(visible),
            frameRate: getLivePreviewFrameRate(),
            ackFrameIndex: Number.isInteger(frameIndex) ? frameIndex : undefined
        });
    }

    refreshWatchers() {
        this.disposeWatchers();
        if (!this.projectRoot) {
            return;
        }

        const addWatcher = (watcher) => {
            watcher.onDidCreate(() => this.debouncedRender.run());
            watcher.onDidChange(() => this.debouncedRender.run());
            watcher.onDidDelete(() => this.debouncedRender.run());
            this.watchers.push(watcher);
        };
        addWatcher(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(this.projectRoot), "Saved/DreamShader/Bridge/preview.json")));
        addWatcher(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(this.projectRoot), "Saved/DreamShader/Bridge/Preview/*.png")));
    }

    disposeWatchers() {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    isCurrentSource(document) {
        return Boolean(document?.fileName && this.sourceFile && normalizeFsPath(document.fileName) === this.sourceFile);
    }

    render(overrideStatus = "") {
        if (!this.panel) {
            return;
        }
        const bridgeResult = readPreviewResult(this.projectRoot, this.sourceFile);
        const result = this.latestResult || bridgeResult;
        const status = overrideStatus || getPreviewStatusText(result);
        const imageUri = result?.imageBase64
            ? `data:image/png;base64,${result.imageBase64}`
            : result?.imagePath && fs.existsSync(result.imagePath)
                ? this.panel.webview.asWebviewUri(vscode.Uri.file(result.imagePath)).toString()
                : "";
        this.panel.webview.html = renderPreviewHtml({
            status,
            result,
            imageUri,
            mesh: this.mesh,
            sourceFile: this.sourceFile,
            transportStatus: this.transportStatus
        });
    }
}

class DreamShaderPreviewSocket {
    constructor({ port, onMessage, onStatus }) {
        this.port = port;
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.socket = null;
        this.connected = false;
        this.handshakeBuffer = Buffer.alloc(0);
        this.frameBuffer = Buffer.alloc(0);
    }

    connect() {
        this.dispose();
        this.connected = false;
        this.handshakeBuffer = Buffer.alloc(0);
        this.frameBuffer = Buffer.alloc(0);
        const key = crypto.randomBytes(16).toString("base64");
        const socket = net.createConnection({ host: "127.0.0.1", port: this.port });
        this.socket = socket;
        socket.setNoDelay(true);
        socket.on("connect", () => {
            socket.write([
                "GET /dreamshader-preview HTTP/1.1",
                `Host: 127.0.0.1:${this.port}`,
                "Upgrade: websocket",
                "Connection: Upgrade",
                `Sec-WebSocket-Key: ${key}`,
                "Sec-WebSocket-Version: 13",
                "Sec-WebSocket-Protocol: binary",
                "",
                ""
            ].join("\r\n"));
        });
        socket.on("data", (chunk) => this.handleData(chunk, key));
        socket.on("error", () => {
            this.onStatus?.("WebSocket unavailable; using file bridge fallback.");
        });
        socket.on("close", () => {
            const wasConnected = this.connected;
            this.connected = false;
            if (wasConnected) {
                this.onStatus?.("WebSocket closed; using file bridge fallback.");
            }
        });
    }

    dispose() {
        if (this.socket) {
            this.socket.destroy();
        }
        this.socket = null;
        this.connected = false;
    }

    sendJson(payload) {
        if (!this.socket || !this.connected) {
            return false;
        }
        this.socket.write(encodeClientFrame(Buffer.from(JSON.stringify(payload), "utf8"), 0x1));
        return true;
    }

    handleData(chunk, key) {
        if (!this.connected) {
            this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
            const marker = this.handshakeBuffer.indexOf("\r\n\r\n");
            if (marker < 0) {
                return;
            }
            const header = this.handshakeBuffer.slice(0, marker).toString("utf8");
            const rest = this.handshakeBuffer.slice(marker + 4);
            if (!isValidHandshake(header, key)) {
                this.onStatus?.("WebSocket handshake failed; using file bridge fallback.");
                this.dispose();
                return;
            }
            this.connected = true;
            this.onStatus?.("WebSocket connected.");
            if (rest.length > 0) {
                this.handleFrameData(rest);
            }
            return;
        }
        this.handleFrameData(chunk);
    }

    handleFrameData(chunk) {
        this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
        for (;;) {
            const decoded = decodeServerFrame(this.frameBuffer);
            if (!decoded) {
                return;
            }
            this.frameBuffer = this.frameBuffer.slice(decoded.consumed);
            if (decoded.opcode === 0x8) {
                this.dispose();
                return;
            }
            if (decoded.opcode !== 0x1 && decoded.opcode !== 0x2) {
                continue;
            }
            const text = decoded.payload.toString("utf8");
            try {
                this.onMessage?.(JSON.parse(text));
            } catch (_error) {
                this.onStatus?.("Received invalid DreamShader preview message.");
            }
        }
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
    return {
        ...result,
        imagePath: result.imagePath ? normalizeFsPath(result.imagePath) : ""
    };
}

function getPreviewStatusText(result) {
    if (!result) {
        return "Waiting for Unreal Editor preview output.";
    }
    if (result.status === "ready") {
        return result.message || "Preview ready.";
    }
    if (result.status === "error") {
        return result.message || "Preview failed.";
    }
    return result.message || "Preview is pending.";
}

function getPreviewPort() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewWebSocketPort", DEFAULT_PREVIEW_PORT);
    const numeric = Number(configured);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(65535, Math.floor(numeric))) : DEFAULT_PREVIEW_PORT;
}

function getAutoRefreshDelayMs() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewAutoRefreshDelayMs", DEFAULT_AUTO_REFRESH_DELAY_MS);
    const numeric = Number(configured);
    return Number.isFinite(numeric) ? Math.max(250, Math.min(10000, Math.floor(numeric))) : DEFAULT_AUTO_REFRESH_DELAY_MS;
}

function getPreviewTransport() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewTransport", "websocket");
    return configured === "file" ? "file" : "websocket";
}

function getLivePreviewFrameRate() {
    const configured = vscode.workspace.getConfiguration("dreamshader").get("previewLiveFrameRate", DEFAULT_LIVE_PREVIEW_FPS);
    const numeric = Number(configured);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(10, numeric)) : DEFAULT_LIVE_PREVIEW_FPS;
}

function createRequestId() {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function encodeClientFrame(payload, opcode) {
    const length = payload.length;
    const headerLength = length < 126 ? 6 : length <= 0xffff ? 8 : 14;
    const frame = Buffer.alloc(headerLength + length);
    frame[0] = 0x80 | opcode;
    if (length < 126) {
        frame[1] = 0x80 | length;
        crypto.randomBytes(4).copy(frame, 2);
        maskPayload(payload, frame.slice(2, 6), frame, 6);
    } else if (length <= 0xffff) {
        frame[1] = 0x80 | 126;
        frame.writeUInt16BE(length, 2);
        crypto.randomBytes(4).copy(frame, 4);
        maskPayload(payload, frame.slice(4, 8), frame, 8);
    } else {
        frame[1] = 0x80 | 127;
        frame.writeBigUInt64BE(BigInt(length), 2);
        crypto.randomBytes(4).copy(frame, 10);
        maskPayload(payload, frame.slice(10, 14), frame, 14);
    }
    return frame;
}

function maskPayload(payload, mask, frame, offset) {
    for (let index = 0; index < payload.length; index += 1) {
        frame[offset + index] = payload[index] ^ mask[index % 4];
    }
}

function decodeServerFrame(buffer) {
    if (buffer.length < 2) {
        return null;
    }
    const opcode = buffer[0] & 0x0f;
    const masked = Boolean(buffer[1] & 0x80);
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
        if (buffer.length < offset + 2) {
            return null;
        }
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        if (buffer.length < offset + 8) {
            return null;
        }
        const bigLength = buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            return null;
        }
        length = Number(bigLength);
        offset += 8;
    }

    let mask = null;
    if (masked) {
        if (buffer.length < offset + 4) {
            return null;
        }
        mask = buffer.slice(offset, offset + 4);
        offset += 4;
    }
    if (buffer.length < offset + length) {
        return null;
    }
    const payload = Buffer.from(buffer.slice(offset, offset + length));
    if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
            payload[index] ^= mask[index % 4];
        }
    }
    return { opcode, payload, consumed: offset + length };
}

function isValidHandshake(header, key) {
    if (!/^HTTP\/1\.1 101\b/i.test(header)) {
        return false;
    }
    const accept = crypto.createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
    return header.toLowerCase().includes(`sec-websocket-accept: ${accept}`.toLowerCase());
}

function renderPreviewHtml({ status, result, imageUri, mesh, sourceFile, transportStatus }) {
    const nonce = String(Date.now());
    const safeStatus = escapeHtml(status);
    const safeSource = escapeHtml(sourceFile ? path.basename(sourceFile) : "No active .dsm material");
    const safeAsset = escapeHtml(result?.assetPath || "");
    const updatedAt = escapeHtml(result?.updatedAtUtc || "");
    const safeTransportStatus = escapeHtml(transportStatus || "");
    const isError = result?.status === "error";
    const cacheBustedImageUri = imageUri && !imageUri.startsWith("data:")
        ? `${imageUri}?t=${encodeURIComponent(result?.updatedAtUtc || Date.now())}`
        : imageUri || "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body {
    margin: 0;
    padding: 16px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
}
.toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
}
button, select {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 3px;
    padding: 6px 10px;
    font: inherit;
}
select {
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
}
.source {
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.preview {
    display: grid;
    place-items: center;
    min-height: 280px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
}
img {
    display: block;
    max-width: min(100%, 720px);
    width: 100%;
    height: auto;
    image-rendering: auto;
}
.status {
    margin-top: 12px;
    color: ${isError ? "var(--vscode-errorForeground)" : "var(--vscode-descriptionForeground)"};
    line-height: 1.45;
}
.meta {
    margin-top: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.45;
}
</style>
</head>
<body>
    <div class="toolbar">
        <button id="refresh" type="button">Refresh</button>
        <select id="mesh" aria-label="Preview mesh">
            <option value="sphere"${mesh === "sphere" ? " selected" : ""}>Sphere</option>
            <option value="plane"${mesh === "plane" ? " selected" : ""}>Plane</option>
            <option value="cube"${mesh === "cube" ? " selected" : ""}>Cube</option>
        </select>
        <div class="source">${safeSource}</div>
    </div>
    <div class="preview">
        ${cacheBustedImageUri ? `<img src="${cacheBustedImageUri}" alt="Material preview">` : `<div>${safeStatus}</div>`}
    </div>
    <div class="status">${safeStatus}</div>
    ${safeTransportStatus ? `<div class="meta">Transport: ${safeTransportStatus}</div>` : ""}
    ${safeAsset ? `<div class="meta">Asset: ${safeAsset}</div>` : ""}
    ${updatedAt ? `<div class="meta">Updated: ${updatedAt}</div>` : ""}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ command: "refresh" }));
document.getElementById("mesh").addEventListener("change", (event) => vscode.postMessage({ command: "mesh", value: event.target.value }));
window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.command !== "previewFrame" || !message.imageUri) {
        return;
    }
    let image = document.querySelector(".preview img");
    if (!image) {
        const preview = document.querySelector(".preview");
        preview.innerHTML = "";
        image = document.createElement("img");
        image.alt = "Material preview";
        preview.appendChild(image);
    }
    image.src = message.imageUri;
    const metaItems = document.querySelectorAll(".meta");
    if (metaItems.length > 0 && message.transportStatus) {
        metaItems[0].textContent = "Transport: " + message.transportStatus;
    }
    vscode.postMessage({ command: "frameRendered", frameIndex: message.frameIndex });
});
</script>
</body>
</html>`;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatError(error) {
    return error && error.message ? error.message : String(error);
}

module.exports = {
    registerPreviewCommands,
    readPreviewResult,
    DreamShaderPreviewSocket
};
