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
// Must match the FMath::Clamp(FrameRate, 0.25, 60.0) ceiling in
// DreamShaderPreviewWebSocketServer.cpp's GetFrameIntervalSeconds().
const MAX_LIVE_PREVIEW_FPS = 60;
// Must match FDreamShaderPreviewRequest's own defaults (DreamShaderPreviewRenderer.h), which in
// turn match USceneThumbnailInfo::OrbitYaw/OrbitPitch's engine defaults.
const DEFAULT_ORBIT_YAW = -157.5;
const DEFAULT_ORBIT_PITCH = -11.25;
// Matches SAssetThumbnailEditModeTools::OnMouseMove's own drag-to-rotate convention for this exact
// ThumbnailInfo->OrbitYaw/OrbitPitch mechanism (Content Browser asset-thumbnail rotate) --
// OrbitYaw/OrbitPitch += -CursorDelta, 1:1 pixel-to-degree. NOT EditorViewportClient's 0.2deg/px
// free-look camera convention, which is a different feature (full 3D viewport fly-camera) using
// the opposite sign; that was the wrong precedent to copy and is why dragging felt backwards.
const ORBIT_DRAG_SENSITIVITY = 1;
// Matches SAssetThumbnailEditModeTools::OnMouseMove's own exact +/-90 clamp for this interaction.
const ORBIT_PITCH_LIMIT = 90;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
// Must match PreviewWireTypeJson/PreviewWireTypeBinary in DreamShaderPreviewWebSocketServer.cpp.
const PREVIEW_WIRE_TYPE_JSON = 1;
const PREVIEW_WIRE_TYPE_BINARY = 2;
// How often to retry the WebSocket connection while it's down (e.g. the Unreal Editor was closed
// or hasn't started the preview server yet) -- keeps the disconnected banner honest instead of
// requiring the user to manually refresh/reopen the panel once the engine comes back.
const RECONNECT_INTERVAL_MS = 4000;

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
        // Per-panel override for the live preview frame rate, set from the panel's own toolbar
        // control; null means "follow the dreamshader.previewLiveFrameRate setting". Not persisted
        // across panel sessions, matching this.mesh's lifetime.
        this.frameRateOverride = null;
        // Orbit camera angles in degrees, driven by drag-to-rotate in the webview. Defaults match
        // USceneThumbnailInfo's own (SceneThumbnailInfo.cpp) so a panel that's never been dragged
        // renders identically to the engine's baseline framing.
        this.orbitYaw = DEFAULT_ORBIT_YAW;
        this.orbitPitch = DEFAULT_ORBIT_PITCH;
        this.watchers = [];
        this.latestRequestId = "";
        this.latestRequestKey = "";
        this.latestResult = null;
        this.transportStatus = "Idle.";
        this.webSocket = null;
        this.webSocketProjectRoot = "";
        this.reconnectTimer = null;
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
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    retryWebSocketIfDisconnected() {
        if (!this.panel || !this.projectRoot || getPreviewTransport() === "file") {
            return;
        }
        if (this.webSocket?.connected) {
            return;
        }
        this.ensureWebSocket();
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
        this.reconnectTimer = setInterval(() => this.retryWebSocketIfDisconnected(), RECONNECT_INTERVAL_MS);
        this.panel.onDidDispose(() => {
            this.sendPreviewControl(false);
            this.panel = null;
            this.sourceFile = "";
            this.latestResult = null;
            this.disposeWatchers();
            this.disposeWebSocket();
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
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
            // Focus moved to something that isn't a .dsm document -- the preview panel itself,
            // a terminal, the sidebar, an unrelated file, or no editor at all (activeTextEditor is
            // undefined whenever a non-editor UI surface has focus). None of that means the user
            // wants to stop previewing the current material, so just leave the existing preview
            // showing; only actually switching to a different .dsm tab below should change it.
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
        if (message.command === "frameRate") {
            const numeric = Number(message.value);
            this.frameRateOverride = Number.isFinite(numeric) ? Math.max(0, Math.min(MAX_LIVE_PREVIEW_FPS, numeric)) : null;
            // A rate change doesn't need a full re-request (no material/mesh state changes) -- it
            // rides the same previewControl message that already carries frameRate on every frame
            // ack, so the engine picks it up on its next throttle check.
            this.sendPreviewControl(this.panel?.visible !== false);
            return;
        }
        if (message.command === "orbit") {
            const yaw = Number(message.yaw);
            const pitch = Number(message.pitch);
            if (Number.isFinite(yaw)) {
                this.orbitYaw = yaw;
            }
            if (Number.isFinite(pitch)) {
                this.orbitPitch = Math.max(-ORBIT_PITCH_LIMIT, Math.min(ORBIT_PITCH_LIMIT, pitch));
            }
            // Same reasoning as the frameRate control above -- rotating doesn't change what
            // material/mesh is being rendered, so it rides the existing previewControl message
            // instead of a full re-request.
            this.sendPreviewControl(this.panel?.visible !== false);
            return;
        }
        if (message.command === "frameRendered") {
            this.sendPreviewControl(this.panel?.visible !== false, message.frameIndex);
        }
    }

    getEffectiveFrameRate() {
        return this.frameRateOverride !== null ? this.frameRateOverride : getLivePreviewFrameRate();
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
                orbitYaw: this.orbitYaw,
                orbitPitch: this.orbitPitch,
                stream: true,
                frameRate: this.getEffectiveFrameRate(),
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
        // Only skip when the existing socket is still actually connected -- previously this also
        // skipped whenever a (dead) socket object merely existed, so a dropped connection was
        // never retried until the whole panel was closed and reopened.
        if (this.webSocket?.connected && this.webSocketProjectRoot === this.projectRoot) {
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
            frameRate: this.getEffectiveFrameRate(),
            orbitYaw: this.orbitYaw,
            orbitPitch: this.orbitPitch,
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
            frameRate: this.getEffectiveFrameRate(),
            orbitYaw: this.orbitYaw,
            orbitPitch: this.orbitPitch,
            sourceFile: this.sourceFile,
            transportStatus: this.transportStatus,
            // Only meaningful in WebSocket mode -- file-bridge mode never has a socket at all, and
            // that's an intentional setting, not a disconnection.
            showDisconnectedBanner: getPreviewTransport() !== "file" && !this.webSocket?.connected
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
        // The server sends a JSON text frame (metadata) immediately followed by a binary frame
        // (raw image bytes, no Base64) for both the initial previewResult and every streamed
        // previewFrame -- correlated purely by arrival order on this one connection (TCP already
        // guarantees that order), not by any explicit id in the binary frame itself.
        this.lastJsonMessage = null;
    }

    connect() {
        this.dispose();
        this.connected = false;
        this.handshakeBuffer = Buffer.alloc(0);
        this.frameBuffer = Buffer.alloc(0);
        this.lastJsonMessage = null;
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
            // The engine's WebSocketNetworking module has no real per-message text/binary opcode
            // control -- INetworkingWebSocket::Send()'s third bool only toggles an internal 4-byte
            // length prefix, and every message actually goes out as a WS *binary* frame regardless
            // (FWebSocket::OnRawWebSocketWritable always calls lws_write with LWS_WRITE_BINARY). So
            // the WS opcode can't tell a JSON message apart from an image here; instead every
            // DreamShader preview message is self-describing on top of that: [4-byte LE length]
            // [1-byte type tag][payload], written by SendTagged() in
            // DreamShaderPreviewWebSocketServer.cpp. decoded.payload is exactly one such message
            // (one Send()+Flush() call produces exactly one WS frame).
            if (decoded.payload.length < 5) {
                continue;
            }
            const declaredLength = decoded.payload.readUInt32LE(0);
            const typeTag = decoded.payload[4];
            const content = decoded.payload.slice(5);
            if (declaredLength !== content.length + 1) {
                this.onStatus?.("Received invalid DreamShader preview message.");
                continue;
            }
            if (typeTag === PREVIEW_WIRE_TYPE_BINARY) {
                // Raw image bytes for whichever JSON message most recently arrived (previewResult
                // or previewFrame) -- re-dispatch it merged with the image, converting to Base64
                // once here (cheap, local) purely so the existing webview <img> data-URI path
                // doesn't need to change; the wire itself never carries Base64.
                if (this.lastJsonMessage) {
                    this.onMessage?.({
                        ...this.lastJsonMessage,
                        imageBase64: content.toString("base64")
                    });
                }
                continue;
            }
            if (typeTag !== PREVIEW_WIRE_TYPE_JSON) {
                continue;
            }
            try {
                const message = JSON.parse(content.toString("utf8"));
                this.lastJsonMessage = message;
                this.onMessage?.(message);
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
    return Number.isFinite(numeric) ? Math.max(0, Math.min(MAX_LIVE_PREVIEW_FPS, numeric)) : DEFAULT_LIVE_PREVIEW_FPS;
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

function renderPreviewHtml({ status, result, imageUri, mesh, frameRate, orbitYaw, orbitPitch, sourceFile, transportStatus, showDisconnectedBanner }) {
    const nonce = String(Date.now());
    const safeStatus = escapeHtml(status);
    const safeSource = escapeHtml(sourceFile ? path.basename(sourceFile) : "No active .dsm material");
    const safeAsset = escapeHtml(result?.assetPath || "");
    const updatedAt = escapeHtml(result?.updatedAtUtc || "");
    const safeTransportStatus = escapeHtml(transportStatus || "");
    const safeFrameRate = escapeHtml(String(Number.isFinite(frameRate) ? frameRate : DEFAULT_LIVE_PREVIEW_FPS));
    const initialOrbitYaw = Number.isFinite(orbitYaw) ? orbitYaw : DEFAULT_ORBIT_YAW;
    const initialOrbitPitch = Number.isFinite(orbitPitch) ? orbitPitch : DEFAULT_ORBIT_PITCH;
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
    padding: 16px 18px 20px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
}
* {
    box-sizing: border-box;
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
    border-radius: 4px;
    padding: 6px 12px;
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms ease;
}
button:hover {
    background: var(--vscode-button-hoverBackground);
}
button:focus, select:focus, input:focus {
    outline: none;
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
}
select, input[type="number"] {
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    transition: border-color 120ms ease;
}
input[type="number"] {
    width: 48px;
    padding: 5px 6px;
    font: inherit;
}
.fps-label {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
}
.source {
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.preview-wrap {
    position: relative;
}
.preview {
    display: grid;
    place-items: center;
    min-height: 280px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-sideBar-background);
    cursor: grab;
    transition: border-color 150ms ease;
}
.preview-wrap.disconnected .preview {
    border-color: var(--vscode-inputValidation-warningBorder, #b89500);
}
.preview.dragging {
    cursor: grabbing;
}
img {
    display: block;
    max-width: min(100%, 720px);
    width: 100%;
    height: auto;
    image-rendering: auto;
    -webkit-user-drag: none;
    user-select: none;
    border-radius: 5px;
    transition: opacity 200ms ease;
}
#axisGizmo {
    position: absolute;
    top: 10px;
    right: 10px;
    pointer-events: none;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}
#axisGizmo text {
    font-size: 12px;
    font-weight: 700;
    font-family: var(--vscode-font-family);
    paint-order: stroke fill;
    stroke: var(--vscode-editor-background);
    stroke-width: 3px;
    stroke-linejoin: round;
}
.disconnect-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 6px 6px 0 0;
    background: var(--vscode-inputValidation-warningBackground, #7a5c00);
    border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
    border-bottom: none;
    color: var(--vscode-inputValidation-warningForeground, #ffffff);
    font-size: 12px;
    line-height: 1.4;
    animation: pulse 1.8s ease-in-out infinite alternate;
}
@keyframes pulse {
    from { opacity: 1; }
    to { opacity: 0.82; }
}
.preview-wrap.disconnected .preview img {
    opacity: 0.5;
}
.status {
    margin-top: 14px;
    color: ${isError ? "var(--vscode-errorForeground)" : "var(--vscode-descriptionForeground)"};
    line-height: 1.45;
}
.meta {
    margin-top: 6px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.5;
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
        <label class="fps-label" for="frameRate">FPS</label>
        <input id="frameRate" type="number" min="0" max="${MAX_LIVE_PREVIEW_FPS}" step="1" value="${safeFrameRate}" title="Live preview frame rate (0 disables continuous streaming)" aria-label="Live preview frame rate">
        <div class="source">${safeSource}</div>
    </div>
    <div class="preview-wrap${showDisconnectedBanner ? " disconnected" : ""}" id="previewWrap">
        ${showDisconnectedBanner ? `<div class="disconnect-banner" id="disconnectBanner">&#9888; Disconnected from Unreal Editor &mdash; retrying&hellip;</div>` : ""}
        <div class="preview">
            ${cacheBustedImageUri ? `<img src="${cacheBustedImageUri}" alt="Material preview">` : `<div>${safeStatus}</div>`}
        </div>
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
    <div class="status">${safeStatus}</div>
    ${safeTransportStatus ? `<div class="meta">Transport: ${safeTransportStatus}</div>` : ""}
    ${safeAsset ? `<div class="meta">Asset: ${safeAsset}</div>` : ""}
    ${updatedAt ? `<div class="meta">Updated: ${updatedAt}</div>` : ""}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ command: "refresh" }));
document.getElementById("mesh").addEventListener("change", (event) => vscode.postMessage({ command: "mesh", value: event.target.value }));
document.getElementById("frameRate").addEventListener("change", (event) => {
    const value = Number(event.target.value);
    vscode.postMessage({ command: "frameRate", value: Number.isFinite(value) ? value : ${DEFAULT_LIVE_PREVIEW_FPS} });
});

(function setupOrbitDrag() {
    const SENSITIVITY = ${ORBIT_DRAG_SENSITIVITY};
    const PITCH_LIMIT = ${ORBIT_PITCH_LIMIT};
    const previewEl = document.querySelector(".preview");
    const axisIds = ["X", "Y", "Z"];
    const axisVectors = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
    let yaw = ${initialOrbitYaw};
    let pitch = ${initialOrbitPitch};
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function normalizeYaw(value) {
        let result = value % 360;
        if (result > 180) result -= 360;
        if (result < -180) result += 360;
        return result;
    }

    // Purely a decorative on-screen compass (like UE's own viewport axis gizmo) -- this is a
    // simplified spherical rotation for the 2D projection, not the engine's actual camera matrix,
    // so it doesn't need to match FMaterialThumbnailScene's math bit-for-bit.
    function updateGizmo(currentYaw, currentPitch) {
        const yawRad = (currentYaw * Math.PI) / 180;
        const pitchRad = (currentPitch * Math.PI) / 180;
        const radius = 30;
        axisIds.forEach((id) => {
            const [vx, vy, vz] = axisVectors[id];
            const x = vx * Math.cos(yawRad) + vz * Math.sin(yawRad);
            const z = -vx * Math.sin(yawRad) + vz * Math.cos(yawRad);
            const y2 = vy * Math.cos(pitchRad) - z * Math.sin(pitchRad);
            const screenX = x * radius;
            const screenY = -y2 * radius;
            const line = document.getElementById("axisLine" + id);
            const tip = document.getElementById("axisTip" + id);
            const label = document.getElementById("axisLabel" + id);
            if (line) {
                line.setAttribute("x2", screenX.toFixed(2));
                line.setAttribute("y2", screenY.toFixed(2));
            }
            if (tip) {
                tip.setAttribute("cx", screenX.toFixed(2));
                tip.setAttribute("cy", screenY.toFixed(2));
            }
            if (label) {
                label.setAttribute("x", (screenX * 1.25).toFixed(2));
                label.setAttribute("y", (screenY * 1.25).toFixed(2));
            }
        });
    }

    if (previewEl) {
        previewEl.addEventListener("mousedown", (event) => {
            dragging = true;
            lastX = event.clientX;
            lastY = event.clientY;
            previewEl.classList.add("dragging");
            event.preventDefault();
        });
        window.addEventListener("mousemove", (event) => {
            if (!dragging) {
                return;
            }
            const deltaX = event.clientX - lastX;
            const deltaY = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            yaw = normalizeYaw(yaw - deltaX * SENSITIVITY);
            pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - deltaY * SENSITIVITY));
            updateGizmo(yaw, pitch);
            vscode.postMessage({ command: "orbit", yaw, pitch });
        });
        window.addEventListener("mouseup", () => {
            if (dragging) {
                dragging = false;
                previewEl.classList.remove("dragging");
            }
        });
    }

    updateGizmo(yaw, pitch);
})();

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
