"use strict";

// Starting the language server, and the one thing the client has to keep telling it.
//
// Not bundled, so the server runs from the same `src/` the extension ships. That is a deliberate
// difference from the sibling extension: `bridge/database.js` loads sql.js's WASM by resolving a
// path inside `node_modules`, and a bundler that inlined the JavaScript would leave that path
// pointing at nothing. This .vsix already ships `node_modules`, so there is nothing to gain by it.

const path = require("path");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

const { LANGUAGE_ID, LOCAL_DIAGNOSTIC_COLLECTION_NAME } = require("../languageData");
const { BRIDGE_CHANGED_NOTIFICATION } = require("../lspProtocol");

function createLanguageClient(context) {
    const serverModule = context.asAbsolutePath(path.join("src", "server", "server.js"));
    const serverOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ["--nolazy", "--inspect=6018"] }
        }
    };

    const clientOptions = {
        // No scheme filter, matching the selectors the providers used: an untitled buffer is still
        // DreamShaderLang, and most of what the server does needs nothing from disk.
        documentSelector: [{ language: LANGUAGE_ID }],
        // The same name the in-process collection had. The two owners -- this for what the source
        // says, `dreamshader` for what the engine reported -- stay separate exactly as before, and
        // keeping the name means nothing filtering on it notices the move.
        diagnosticCollectionName: LOCAL_DIAGNOSTIC_COLLECTION_NAME
    };

    const client = new LanguageClient(LANGUAGE_ID, "DreamShaderLang", serverOptions, clientOptions);

    return {
        client,
        start: () => client.start(),
        stop: () => client.stop(),
        /**
         * "The Bridge output changed."
         *
         * Sent from the client's own watchers rather than registered as a server-side watch, because
         * some of those watchers are rooted at a project root that need not be inside any workspace
         * folder -- and a watch registered through the protocol would not see it.
         */
        notifyBridgeChanged: () => {
            if (client.needsStart()) {
                return;
            }
            void client.sendNotification(BRIDGE_CHANGED_NOTIFICATION);
        }
    };
}

module.exports = {
    createLanguageClient
};
