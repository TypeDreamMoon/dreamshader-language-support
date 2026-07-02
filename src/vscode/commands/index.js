"use strict";

const { registerBridgeCommands } = require("./bridge");
const { registerTemplateCommands } = require("./templates");
const { registerPackageCommands } = require("./packages");
const { registerPreviewCommands } = require("./preview");
const { registerDetailsCommands } = require("./details");

function registerCommands(context, services) {
    registerBridgeCommands(context, services.refreshBridge);
    registerPreviewCommands(context);
    registerDetailsCommands(context);
    registerTemplateCommands(context);
    registerPackageCommands(context);
}

module.exports = {
    registerCommands
};
