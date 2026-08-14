"use strict";

// The ambient environment, injected once by whichever process is running.
//
// Two processes now use the language layer: the extension host, where this is backed by `vscode`,
// and the language server, where it is backed by what the client told us at `initialize`. The layer
// itself must not know which -- so instead of a `require("vscode")` in a try/catch, which is what
// this replaces, the environment is handed in.
//
// Everything here is synchronous on purpose. `findProjectRoot` sits under completion, which fires on
// every keystroke, and it cannot await a settings round trip. On the server side `getSetting` reads
// a snapshot the server refreshes when the client says the configuration changed -- so the value can
// be one notification stale, which is exactly as stale as the old `getConfiguration()` read was
// between the change and the cache invalidation that followed it.
//
// Whoever changes the settings or the folder list is responsible for calling
// `invalidateProjectRootCache()` afterwards; see the note on that function for what it costs not to.

const NO_HOST = {
    /** A `dreamshader.*` setting, or `fallback` when there is nothing to read it from. */
    getSetting: (_name, fallback) => fallback,
    /** Absolute paths of the open workspace folders. */
    getWorkspaceFolderPaths: () => [],
    /**
     * The focused document's path. Server side this is always empty: LSP has no active editor, and
     * the only callers are commands, which run on the client.
     */
    getActiveDocumentPath: () => "",
    /** Paths of every open document. Commands only, for the same reason. */
    getOpenDocumentPaths: () => []
};

let current = NO_HOST;

function setHost(host) {
    current = { ...NO_HOST, ...host };
}

function host() {
    return current;
}

module.exports = {
    setHost,
    host
};
