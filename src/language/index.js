"use strict";

const parser = require("./parser");
const context = require("./context");
const symbols = require("./symbols");
const completions = require("./completions");
const diagnostics = require("./diagnostics");
const providers = require("./providers");
const calls = require("./calls");
const indexer = require("./indexer");
const formatter = require("./formatter");
const functionBuiltins = require("./functionBuiltins");
const features = require("./features");

module.exports = {
    ...parser,
    ...context,
    ...symbols,
    ...completions,
    ...diagnostics,
    ...providers,
    ...calls,
    ...indexer,
    ...formatter,
    ...functionBuiltins,
    ...features
};
