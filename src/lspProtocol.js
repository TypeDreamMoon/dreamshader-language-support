"use strict";

// The custom half of the client/server contract.
//
// Deliberately one message. Everything the language answers is a standard request, and everything
// the client shows -- the preview, the package store, the Bridge diagnostics tree, the status bar --
// is client-side work that the server has no part in. The one thing that genuinely crosses is below.

/**
 * Client -> server. "The Bridge output changed; the manifests you read are stale."
 *
 * `bridge.db` and `diagnostics.json` are written by the running Unreal Editor, and the server reads
 * them for completion and for the local diagnostics -- material expressions, Substrate builtins,
 * settings mappings. The client already watches them, because its own diagnostics tree is built from
 * the same files, and it watches them in two ways: a workspace-wide glob, and a pattern rooted at
 * each known project root. That second one is why this is a notification rather than a
 * `didChangeWatchedFiles` registration on the server: a project root is allowed to sit outside every
 * workspace folder, and a watch registered through the protocol would not see it.
 */
const BRIDGE_CHANGED_NOTIFICATION = "dreamshader/bridgeChanged";

/** The settings section both halves read. */
const SETTINGS_SECTION = "dreamshader";

module.exports = {
    BRIDGE_CHANGED_NOTIFICATION,
    SETTINGS_SECTION
};
