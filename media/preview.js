"use strict";

// DreamShader material preview — webview runtime.
//
// This runs inside the preview webview and owns the live connection to the Unreal Editor. Moving the
// WebSocket in here (instead of the extension host forwarding base64 PNGs) is the whole point of the
// rewrite: raw RGBA8 frames arrive as ArrayBuffers and go straight onto a <canvas> with
// putImageData — no base64, no PNG decode, no host<->webview copy per frame. That is what makes
// 30–60 FPS streaming affordable.
//
// Wire framing (server -> client), matching FDreamShaderPreviewWebSocketServer:
//   one WS binary frame = [u32 length][u8 tag][payload], length counts the tag.
//     tag 1 = UTF-8 JSON          (previewResult / previewFrame / probeState / error)
//     tag 2 = PNG bytes           (legacy encoding:"png" — the JSON previewFrame came just before)
//     tag 3 = raw frame           (encoding:"raw"): 24-byte LE header + width*height*4 RGBA8
//   raw header: u8 version, u8 format, u16 width, u16 height, u16 flags, u32 frameIndex,
//               f32 orbitYaw, f32 orbitPitch, u32 probeLine
// Client -> server messages are JSON text frames.

(function () {
    const vscode = acquireVsCodeApi();

    // Frame flag bits (mirror EDreamShaderPreviewFrameFlags in the engine).
    const FLAG_COMPILING = 1 << 0;
    const FLAG_PROBE_ACTIVE = 1 << 1;
    const FLAG_PROBE_PENDING = 1 << 2;
    const FLAG_KEYFRAME = 1 << 3;

    const WIRE_JSON = 1;
    const WIRE_PNG = 2;
    const WIRE_RAW = 3;

    const RECONNECT_MIN_MS = 500;
    const RECONNECT_MAX_MS = 8000;
    // Cap the requested render size so a maximized panel on a HiDPI display does not ask the engine
    // for a 4K readback every frame.
    const MAX_RENDER_DIMENSION = 1024;

    const state = {
        config: null,
        socket: null,
        connected: false,
        reconnectDelay: RECONNECT_MIN_MS,
        reconnectTimer: null,
        wantOpen: false,
        requestId: "",
        // Desired probe line (0 = none). The host owns breakpoints; we translate the active one into
        // setProbe/clearProbe on the engine.
        desiredProbeLine: 0,
        desiredProbeName: "",
        sentProbeLine: -1,
        mesh: "sphere",
        frameRate: 12,
        orbitYaw: -157.5,
        orbitPitch: -11.25,
        width: 512,
        height: 512,
        visible: true,
        lastFrameIndex: -1,
        // A reusable ImageData sized to the current frame; putImageData wants exactly-sized data.
        imageData: null,
    };

    const canvas = document.getElementById("frame");
    const ctx = canvas.getContext("2d", { alpha: false });
    const statusEl = document.getElementById("status");
    const probeEl = document.getElementById("probe");
    const bannerEl = document.getElementById("banner");
    const stageEl = document.getElementById("stage");

    function setStatus(text) {
        if (statusEl) {
            statusEl.textContent = text || "";
        }
    }

    function setProbeLabel(text, kind) {
        if (!probeEl) {
            return;
        }
        probeEl.textContent = text || "";
        probeEl.className = "probe" + (kind ? " probe-" + kind : "");
        // Explicit values (never "") so it does not fall back to the class's own display:none when we
        // mean to show it — the CSP forbids HTML inline style attributes, so visibility is driven from
        // JS here rather than from a `style="display:none"` in the markup.
        probeEl.style.display = text ? "block" : "none";
    }

    function setBanner(text) {
        if (!bannerEl) {
            return;
        }
        bannerEl.textContent = text || "";
        bannerEl.style.display = text ? "block" : "none";
        if (stageEl) {
            stageEl.classList.toggle("disconnected", Boolean(text));
        }
    }

    function post(message) {
        vscode.postMessage(message);
    }

    // ---- socket lifecycle -------------------------------------------------

    function clearReconnectTimer() {
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
    }

    function scheduleReconnect() {
        if (!state.wantOpen || state.reconnectTimer) {
            return;
        }
        setBanner("Disconnected from Unreal Editor — retrying…");
        state.reconnectTimer = setTimeout(() => {
            state.reconnectTimer = null;
            openSocket();
        }, state.reconnectDelay);
        state.reconnectDelay = Math.min(state.reconnectDelay * 2, RECONNECT_MAX_MS);
    }

    function openSocket() {
        if (!state.config || !state.config.wsUrl) {
            return;
        }
        closeSocket();
        state.wantOpen = true;
        let socket;
        try {
            socket = new WebSocket(state.config.wsUrl);
        } catch (error) {
            setStatus("Could not open preview connection: " + (error && error.message ? error.message : error));
            scheduleReconnect();
            return;
        }
        socket.binaryType = "arraybuffer";
        state.socket = socket;

        socket.addEventListener("open", () => {
            state.connected = true;
            state.reconnectDelay = RECONNECT_MIN_MS;
            setBanner("");
            sendPreviewRequest(false);
        });
        socket.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                // The engine never sends text frames, but tolerate one rather than throwing.
                return;
            }
            handleBinary(new Uint8Array(event.data));
        });
        socket.addEventListener("close", () => {
            state.connected = false;
            state.socket = null;
            if (state.wantOpen) {
                scheduleReconnect();
            }
        });
        socket.addEventListener("error", () => {
            // close fires next; let it drive the reconnect.
        });
    }

    function closeSocket() {
        clearReconnectTimer();
        if (state.socket) {
            try {
                state.socket.close();
            } catch (_error) {
                // ignore
            }
        }
        state.socket = null;
        state.connected = false;
    }

    function sendJson(message) {
        if (state.socket && state.connected) {
            state.socket.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    function sendPreviewRequest(force) {
        if (!state.config) {
            return;
        }
        state.requestId = String(Date.now()) + "-" + Math.floor(Math.random() * 100000);
        state.sentProbeLine = -1;
        setStatus("Requesting preview…");
        sendJson({
            type: "previewMaterial",
            requestId: state.requestId,
            sourceFile: state.config.sourceFile,
            encoding: "raw",
            width: state.width,
            height: state.height,
            mesh: state.mesh,
            orbitYaw: state.orbitYaw,
            orbitPitch: state.orbitPitch,
            frameRate: state.visible ? state.frameRate : 0,
            stream: true,
            force: Boolean(force),
        });
        // Re-assert the probe against the (possibly regenerated) source.
        syncProbe(true);
    }

    function sendControl(extra) {
        sendJson(Object.assign({
            type: "previewControl",
            requestId: state.requestId,
            sourceFile: state.config ? state.config.sourceFile : "",
            stream: state.visible,
            frameRate: state.visible ? state.frameRate : 0,
            orbitYaw: state.orbitYaw,
            orbitPitch: state.orbitPitch,
            width: state.width,
            height: state.height,
        }, extra || {}));
    }

    function syncProbe(forceResend) {
        if (!state.connected) {
            return;
        }
        if (state.desiredProbeLine > 0) {
            if (forceResend || state.sentProbeLine !== state.desiredProbeLine) {
                sendJson({
                    type: "setProbe",
                    requestId: state.requestId,
                    line: state.desiredProbeLine,
                    name: state.desiredProbeName || "",
                });
                state.sentProbeLine = state.desiredProbeLine;
            }
        } else if (forceResend || state.sentProbeLine !== 0) {
            sendJson({ type: "clearProbe", requestId: state.requestId });
            state.sentProbeLine = 0;
        }
    }

    // ---- inbound frames ---------------------------------------------------

    function handleBinary(bytes) {
        if (bytes.length < 5) {
            return;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const declaredLength = view.getUint32(0, true);
        const tag = bytes[4];
        const content = bytes.subarray(5);
        if (declaredLength !== content.length + 1) {
            return;
        }
        if (tag === WIRE_JSON) {
            let message;
            try {
                message = JSON.parse(new TextDecoder("utf-8").decode(content));
            } catch (_error) {
                return;
            }
            handleJsonMessage(message);
        } else if (tag === WIRE_RAW) {
            handleRawFrame(content);
        } else if (tag === WIRE_PNG) {
            handlePngFrame(content);
        }
    }

    function handleJsonMessage(message) {
        if (!message || typeof message !== "object") {
            return;
        }
        switch (message.type) {
            case "previewResult":
                if (message.status === "error") {
                    setStatus(message.message || "Preview failed.");
                } else {
                    setStatus(message.message || "Streaming preview.");
                    if (message.assetPath) {
                        post({ command: "asset", assetPath: message.assetPath });
                    }
                }
                break;
            case "probeState":
                handleProbeState(message);
                break;
            case "previewFrame":
                // Legacy PNG metadata; the PNG bytes follow as a tag-2 message. Nothing to do here
                // except carry the flags forward for the label.
                applyFrameFlags(Number(message.flags) || 0, Number(message.frameIndex) || 0, 0);
                break;
            default:
                break;
        }
    }

    function handleProbeState(message) {
        if (message.status === "attached") {
            const name = message.name ? " (" + message.name + ")" : "";
            setProbeLabel("● breakpoint: line " + message.line + name, "active");
            post({ command: "probeResolved", line: Number(message.line) || 0 });
        } else if (message.status === "pending") {
            setProbeLabel("○ breakpoint pending: " + (message.message || "waiting for compile"), "pending");
            post({ command: "probeResolved", line: 0 });
        } else {
            setProbeLabel("", "");
            post({ command: "probeResolved", line: 0 });
        }
    }

    function ensureImageData(width, height) {
        if (!state.imageData || state.imageData.width !== width || state.imageData.height !== height) {
            state.imageData = ctx.createImageData(width, height);
        }
        return state.imageData;
    }

    function resizeCanvasTo(width, height) {
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
    }

    function handleRawFrame(content) {
        if (content.length < 24) {
            return;
        }
        const header = new DataView(content.buffer, content.byteOffset, 24);
        const version = header.getUint8(0);
        const format = header.getUint8(1);
        if (version !== 1 || format !== 1) {
            return;
        }
        const width = header.getUint16(2, true);
        const height = header.getUint16(4, true);
        const flags = header.getUint16(6, true);
        const frameIndex = header.getUint32(8, true);
        const orbitYaw = header.getFloat32(12, true);
        const orbitPitch = header.getFloat32(16, true);
        const probeLine = header.getUint32(20, true);

        const pixels = content.subarray(24);
        if (pixels.length < width * height * 4) {
            return;
        }

        resizeCanvasTo(width, height);
        const imageData = ensureImageData(width, height);
        imageData.data.set(pixels.subarray(0, width * height * 4));
        ctx.putImageData(imageData, 0, 0);

        applyFrameFlags(flags, frameIndex, probeLine);
        ackFrame(frameIndex);
        // Keep the on-screen gizmo in step with the authoritative angles the engine rendered.
        if (orbitYaw === orbitYaw && orbitPitch === orbitPitch) {
            updateGizmo(orbitYaw, orbitPitch);
        }
    }

    function handlePngFrame(bytes) {
        // Legacy path: decode via an Image and draw once. Kept so an encoding:"png" session (or the
        // file fallback below) still shows something.
        const blob = new Blob([bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            resizeCanvasTo(image.naturalWidth, image.naturalHeight);
            ctx.drawImage(image, 0, 0);
            URL.revokeObjectURL(url);
        };
        image.onerror = () => URL.revokeObjectURL(url);
        image.src = url;
    }

    function applyFrameFlags(flags, frameIndex, probeLine) {
        state.lastFrameIndex = frameIndex;
        const parts = [];
        if (flags & FLAG_COMPILING) {
            parts.push("compiling shaders…");
        }
        if (flags & FLAG_PROBE_ACTIVE) {
            parts.push(probeLine > 0 ? "breakpoint @ line " + probeLine : "breakpoint");
        } else if (flags & FLAG_PROBE_PENDING) {
            parts.push("breakpoint pending");
        }
        setStatus(parts.length ? parts.join("  ·  ") : "Live preview");
    }

    function ackFrame(frameIndex) {
        sendJson({
            type: "previewControl",
            requestId: state.requestId,
            sourceFile: state.config ? state.config.sourceFile : "",
            stream: state.visible,
            frameRate: state.visible ? state.frameRate : 0,
            ackFrameIndex: frameIndex,
        });
    }

    // ---- viewport sizing --------------------------------------------------

    function measureAndSendSize() {
        if (!stageEl) {
            return;
        }
        const rect = stageEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            // The panel is hidden or not laid out yet; a zero-size request would be clamped to the
            // 64px floor and then have to be corrected on the next resize.
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        // The frame MUST be square. Previews render through the engine's FThumbnailPreviewScene,
        // whose projection matrix is built as FReversedZPerspectiveMatrix(halfFov, 1, 1, near) --
        // the aspect is hardcoded to 1:1 and is not derived from the view rect. So a non-square
        // render target does not show more of the scene, it stretches the sphere into an ellipse.
        // Ask for the largest square that fits and let the canvas letterbox it (object-fit: contain)
        // inside whatever shape the panel happens to be.
        const side = Math.max(64, Math.min(
            MAX_RENDER_DIMENSION,
            Math.round(Math.min(rect.width, rect.height) * dpr)));
        if (side !== state.width || side !== state.height) {
            state.width = side;
            state.height = side;
            if (state.connected) {
                sendControl();
            }
        }
    }

    let resizeTimer = null;
    function scheduleMeasure() {
        if (resizeTimer) {
            clearTimeout(resizeTimer);
        }
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            measureAndSendSize();
        }, 150);
    }

    if (typeof ResizeObserver !== "undefined" && stageEl) {
        new ResizeObserver(scheduleMeasure).observe(stageEl);
    }
    window.addEventListener("resize", scheduleMeasure);

    // ---- orbit gizmo + drag ----------------------------------------------

    const axisIds = ["X", "Y", "Z"];
    const axisVectors = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

    function normalizeYaw(value) {
        let result = value % 360;
        if (result > 180) result -= 360;
        if (result < -180) result += 360;
        return result;
    }

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
            if (line) { line.setAttribute("x2", screenX.toFixed(2)); line.setAttribute("y2", screenY.toFixed(2)); }
            if (tip) { tip.setAttribute("cx", screenX.toFixed(2)); tip.setAttribute("cy", screenY.toFixed(2)); }
            if (label) { label.setAttribute("x", (screenX * 1.25).toFixed(2)); label.setAttribute("y", (screenY * 1.25).toFixed(2)); }
        });
    }

    (function setupDrag() {
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        if (!stageEl) {
            return;
        }
        stageEl.addEventListener("mousedown", (event) => {
            dragging = true;
            lastX = event.clientX;
            lastY = event.clientY;
            stageEl.classList.add("dragging");
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
            state.orbitYaw = normalizeYaw(state.orbitYaw - deltaX);
            state.orbitPitch = Math.max(-90, Math.min(90, state.orbitPitch - deltaY));
            updateGizmo(state.orbitYaw, state.orbitPitch);
            sendControl();
            post({ command: "orbit", yaw: state.orbitYaw, pitch: state.orbitPitch });
        });
        window.addEventListener("mouseup", () => {
            if (dragging) {
                dragging = false;
                stageEl.classList.remove("dragging");
            }
        });
    })();

    // ---- toolbar controls -------------------------------------------------

    const meshSelect = document.getElementById("mesh");
    if (meshSelect) {
        meshSelect.addEventListener("change", (event) => {
            state.mesh = event.target.value;
            sendControl({ mesh: state.mesh });
            post({ command: "mesh", value: state.mesh });
        });
    }
    const fpsInput = document.getElementById("fps");
    if (fpsInput) {
        fpsInput.addEventListener("change", (event) => {
            const value = Number(event.target.value);
            state.frameRate = Number.isFinite(value) ? Math.max(0, Math.min(60, value)) : state.frameRate;
            sendControl();
            post({ command: "frameRate", value: state.frameRate });
        });
    }
    const refreshButton = document.getElementById("refresh");
    if (refreshButton) {
        refreshButton.addEventListener("click", () => {
            if (state.config && state.config.transport === "file") {
                post({ command: "requestRefresh" });
            } else {
                sendPreviewRequest(true);
            }
        });
    }

    // ---- host messages ----------------------------------------------------

    window.addEventListener("message", (event) => {
        const message = event.data || {};
        switch (message.type) {
            case "init":
                applyInit(message.config);
                break;
            case "setBreakpoint":
                state.desiredProbeLine = Number(message.line) || 0;
                state.desiredProbeName = message.name || "";
                syncProbe(false);
                break;
            case "setMesh":
                if (meshSelect && message.value) {
                    meshSelect.value = message.value;
                }
                state.mesh = message.value || state.mesh;
                sendControl({ mesh: state.mesh });
                break;
            case "setFrameRate":
                state.frameRate = Number(message.value) || state.frameRate;
                if (fpsInput) {
                    fpsInput.value = String(state.frameRate);
                }
                sendControl();
                break;
            case "visibility":
                state.visible = Boolean(message.visible);
                sendControl();
                break;
            case "refresh":
                sendPreviewRequest(true);
                break;
            case "fileFrame":
                showFileFrame(message.imageUri);
                break;
            case "status":
                setStatus(message.text || "");
                break;
            default:
                break;
        }
    });

    function applyInit(config) {
        if (!config) {
            return;
        }
        const sameSource = state.config && state.config.sourceFile === config.sourceFile;
        state.config = config;
        state.mesh = config.mesh || state.mesh;
        state.frameRate = Number.isFinite(config.frameRate) ? config.frameRate : state.frameRate;
        state.orbitYaw = Number.isFinite(config.orbitYaw) ? config.orbitYaw : state.orbitYaw;
        state.orbitPitch = Number.isFinite(config.orbitPitch) ? config.orbitPitch : state.orbitPitch;
        state.desiredProbeLine = Number(config.probeLine) || 0;
        state.desiredProbeName = config.probeName || "";
        if (meshSelect && state.mesh) {
            meshSelect.value = state.mesh;
        }
        if (fpsInput) {
            fpsInput.value = String(state.frameRate);
        }
        updateGizmo(state.orbitYaw, state.orbitPitch);
        measureAndSendSize();

        if (config.transport === "file") {
            // No socket: the host drives frames via fileFrame messages.
            closeSocket();
            setBanner("");
            if (config.fileImageUri) {
                showFileFrame(config.fileImageUri);
            }
            return;
        }

        if (!sameSource || !state.connected) {
            openSocket();
        } else {
            // Same source, still connected: just re-point and re-request.
            sendPreviewRequest(false);
        }
    }

    function showFileFrame(imageUri) {
        if (!imageUri) {
            return;
        }
        const image = new Image();
        image.onload = () => {
            resizeCanvasTo(image.naturalWidth, image.naturalHeight);
            ctx.drawImage(image, 0, 0);
        };
        image.src = imageUri;
    }

    post({ command: "ready" });
})();
