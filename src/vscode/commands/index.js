"use strict";

const { registerBridgeCommands } = require("./bridge");

function registerCommands(context, services) {
    registerBridgeCommands(context, services.refreshBridge);
    tryRegisterOptional("./templates", "registerTemplateCommands", context);
    tryRegisterOptional("./packages", "registerPackageCommands", context);
}

function tryRegisterOptional(modulePath, exportName, context) {
    try {
        const mod = require(modulePath);
        if (typeof mod[exportName] === "function") {
            mod[exportName](context);
        }
    } catch (error) {
        console.warn(`DreamShader optional command module '${modulePath}' was not registered: ${error.message}`);
    }
}

module.exports = {
    registerCommands
};
