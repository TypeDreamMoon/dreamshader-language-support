"use strict";

const { registerBridgeCommands } = require("./bridge");
const { registerTemplateCommands } = require("./templates");
const { registerPackageCommands } = require("./packages");

function registerCommands(context, services) {
    registerBridgeCommands(context, services.refreshBridge);
    registerTemplateCommands(context);
    registerPackageCommands(context);
}

module.exports = {
    registerCommands
};
