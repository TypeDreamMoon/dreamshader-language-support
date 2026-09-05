"use strict";

// Greys out the `#if` branches this project will not compile.
//
// The value is that a conditional source stops being two texts a reader has to hold in their head.
// `#if DS_SUBSTRATE` cuts declarations -- a `ShadingModel` line, a whole `Outputs` block, an
// `import` -- and the branch that loses never reaches the parser, so nothing else in the editor has
// an opinion about it: no diagnostics, no symbols, no error markers. Without this the two branches
// look identical and only a compile tells you which one you were editing.
//
// Three rules shape everything below, and each one is a refusal:
//
//   1. OPACITY, NOT COLOUR. A dimmed region keeps its syntax highlighting and just fades; overriding
//      `color` would fight the user's theme and flatten the semantic highlighting the region still
//      legitimately has. This is also what the C/C++ extension does, so the effect is already
//      familiar to anyone who has read a conditional header in this editor.
//   2. THE DIRECTIVE LINES THEMSELVES NEVER FADE. `#if` / `#else` / `#endif` are the control flow --
//      they are the answer to "why is this grey" -- so they stay at full strength even when they
//      sit inside an outer branch that was cut. src/language/preprocessor.js enforces this; the
//      ranges that arrive here already exclude them.
//   3. NOTHING IS DIMMED UNLESS WE ARE SURE. No define manifest (an older plugin, or a project that
//      has never compiled), or a file the preprocessor would refuse (an unclosed `#if`, a malformed
//      condition, a mis-cased `#IF`) means zero regions, silently. A wrong grey is worse than no
//      grey: it points an author at the wrong branch, and unlike a missing grey it does not look
//      like a missing feature.
//
// The analysis itself is in src/language/preprocessor.js, which is a line-for-line mirror of the
// plugin's own scanner and evaluator and knows nothing about `vscode`. This file is only the wiring:
// which editors, which text, when to recompute, and what the fade looks like.

const vscode = require("vscode");
const { createDebouncedDisposable } = require("../common/debounce");
const { readPreprocessorDefinesManifest } = require("../bridge/manifests");
const { computeInactiveRegions } = require("../language/preprocessor");
const { collectKnownProjectRoots, isDreamShaderDocument } = require("../project/projects");

const DEFAULT_INACTIVE_OPACITY = 0.5;
// Long enough that typing a `#if` character by character does not restyle the file on every
// keystroke, short enough that finishing the directive greys the branch while the cursor is still
// there. The same 200ms the bridge refresh in activate.js settled on.
const REFRESH_DEBOUNCE_MS = 200;

const HOVER_MESSAGE = "DreamShader: cut by the preprocessor — this branch is not compiled with the project's current defines.";

function registerInactiveRegionDecorations(context) {
    const controller = new InactiveRegionDecorator();
    context.subscriptions.push(controller);
    controller.refresh();
    return controller;
}

class InactiveRegionDecorator {
    constructor() {
        this.decorationType = null;
        this.decorationOpacity = null;
        this.watchers = [];
        this.watcherRootsKey = "";

        this.debouncedRefresh = createDebouncedDisposable(() => this.refresh(), REFRESH_DEBOUNCE_MS);

        this.subscriptions = [
            this.debouncedRefresh,
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.refreshWatchers();
                this.refresh();
            }),
            vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
            vscode.workspace.onDidChangeTextDocument((event) => {
                // Only for a document actually on screen: an edit applied to a background document
                // (a refactor, a formatter) cannot change what anybody is looking at, and rerunning
                // the scan for it would be work with nothing to show for it.
                if (vscode.window.visibleTextEditors.some((editor) => editor.document === event.document)) {
                    this.debouncedRefresh.run();
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("dreamshader.preprocessor")) {
                    return;
                }
                // The opacity lives inside the decoration type, so a changed value means a new type;
                // the old one has to go or its decorations stay on screen at the old strength.
                this.disposeDecorationType();
                this.refresh();
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.refreshWatchers();
                this.refresh();
            })
        ];

        this.refreshWatchers();
    }

    dispose() {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions = [];
        this.disposeWatchers();
        this.disposeDecorationType();
    }

    // ---- decoration type -------------------------------------------------

    getInactiveOpacity() {
        const configured = vscode.workspace.getConfiguration("dreamshader").get("preprocessor.inactiveOpacity");
        const value = Number(configured);
        if (!Number.isFinite(value)) {
            return DEFAULT_INACTIVE_OPACITY;
        }
        // Clamped rather than trusted: `package.json` states the range, but a settings file written
        // by hand or synced from another machine can hold anything, and `opacity: 0` would make a
        // whole branch invisible with no hint that it is still there.
        return Math.min(1, Math.max(0.1, value));
    }

    isEnabled() {
        return vscode.workspace.getConfiguration("dreamshader").get("preprocessor.dimInactiveRegions") !== false;
    }

    ensureDecorationType() {
        const opacity = this.getInactiveOpacity();
        if (this.decorationType && this.decorationOpacity === opacity) {
            return this.decorationType;
        }
        this.disposeDecorationType();
        this.decorationOpacity = opacity;
        this.decorationType = vscode.window.createTextEditorDecorationType({
            // `opacity` and nothing else. No `color`, no `backgroundColor`: see rule 1 in the header.
            // `rangeBehavior` keeps the fade from swallowing text typed at either edge of a region
            // in the moment before the debounced rescan catches up.
            opacity: `${opacity}`,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
        return this.decorationType;
    }

    disposeDecorationType() {
        if (this.decorationType) {
            this.decorationType.dispose();
            this.decorationType = null;
        }
        this.decorationOpacity = null;
    }

    // ---- refresh ---------------------------------------------------------

    refresh() {
        const enabled = this.isEnabled();
        const decorationType = enabled ? this.ensureDecorationType() : this.decorationType;
        if (!decorationType) {
            return;
        }

        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(decorationType, enabled ? this.computeRanges(editor) : []);
        }

        if (!enabled) {
            // Cleared above with the type still alive, so the ranges actually come off screen; only
            // then is it safe to drop it. Disposing first would have left them painted.
            this.disposeDecorationType();
        }
    }

    computeRanges(editor) {
        const document = editor.document;
        if (!isDreamShaderDocument(document)) {
            return [];
        }

        const manifest = readPreprocessorDefinesManifest(document.fileName);
        if (!manifest.available) {
            // Rule 3. An older plugin, or a project whose bridge has never been written, cannot tell
            // us which branch wins -- so nothing is claimed, and nothing is logged either: a project
            // with no conditionals is the overwhelmingly common case and does not want a warning.
            return [];
        }

        const regions = computeInactiveRegions(document.getText(), { defines: manifest.defines });
        const ranges = [];
        for (const region of regions) {
            // The analyzer counts lines the way the plugin does, which is also the way VS Code does,
            // but a clamp costs nothing and a range past the end of the document throws.
            const startLine = region.startLine - 1;
            const endLine = Math.min(region.endLine - 1, document.lineCount - 1);
            if (startLine < 0 || startLine > endLine) {
                continue;
            }
            ranges.push({
                range: new vscode.Range(
                    new vscode.Position(startLine, 0),
                    document.lineAt(endLine).range.end),
                hoverMessage: HOVER_MESSAGE
            });
        }
        return ranges;
    }

    // ---- watchers --------------------------------------------------------

    // The define table is a bridge artifact: it changes when the project's *Preprocessor Defines*
    // are edited, when a C++ registration lands, or simply when the editor next writes its bridge
    // output. None of those touches the source file, so without a watcher a source could sit on
    // screen greyed by a table that no longer exists.
    refreshWatchers() {
        const roots = collectKnownProjectRoots(vscode.window.activeTextEditor?.document?.fileName || "");
        const rootsKey = roots.join("|");
        if (this.watcherRootsKey === rootsKey && this.watchers.length > 0) {
            return;
        }

        this.disposeWatchers();
        this.watcherRootsKey = rootsKey;

        const register = (watcher) => {
            watcher.onDidCreate(() => this.debouncedRefresh.run());
            watcher.onDidChange(() => this.debouncedRefresh.run());
            watcher.onDidDelete(() => this.debouncedRefresh.run());
            this.watchers.push(watcher);
        };

        register(vscode.workspace.createFileSystemWatcher("**/Saved/DreamShader/Bridge/preprocessor-defines.json"));
        for (const root of roots) {
            // A project root can sit outside every workspace folder -- the extension resolves one
            // from the active file, not only from the folder list -- and the glob above would never
            // fire for it. These are what cover that case.
            register(vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(root), "Saved/DreamShader/Bridge/preprocessor-defines.json")));
            register(vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(root), "Saved/DreamShader/Bridge/bridge.db")));
        }
    }

    disposeWatchers() {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
        this.watcherRootsKey = "";
    }
}

module.exports = {
    registerInactiveRegionDecorations
};
