"use strict";

const path = require("path");
const { parseDocument, parseCodeStatements } = require("./parser");
const { collectSymbols, collectCallables, flatten } = require("./symbols");
const { parseCallExpressionText } = require("./calls");
const { isTypeName, resolveTypeInfo, getMaterialAttributeMemberType, areTypesCompatible } = require("./types");
const { normalizeSymbolKey, stripCommentsPreserveLayout, splitTopLevelAssignment } = require("./utils");
const {
    MATERIAL_OUTPUT_NAME_SET,
    MATERIAL_ATTRIBUTE_MEMBER_NAME_SET
} = require("../languageData");

const SEVERITY = {
    Error: "Error",
    Warning: "Warning",
    Information: "Information"
};

function getDiagnostics(text, fileName = "", services = {}) {
    const ast = parseDocument(text);
    const diagnostics = [];
    const extension = path.extname(fileName || "").toLowerCase();
    const reachableCallables = mergeCallables(collectCallables(ast), callService(services, "collectReachableCallableSignatures", new Map()));

    addFileShapeDiagnostics(diagnostics, ast, text, extension);
    addImportDiagnostics(diagnostics, ast, services);
    addDuplicateCallableDiagnostics(diagnostics, ast);
    addBlockDiagnostics(diagnostics, ast, reachableCallables);
    addFunctionDiagnostics(diagnostics, ast, reachableCallables);
    addCycleDiagnostics(diagnostics, services, fileName);
    addBraceDiagnostics(diagnostics, text);
    return dedupeDiagnostics(diagnostics);
}

function addFileShapeDiagnostics(diagnostics, ast, text, extension) {
    const topLevelKinds = new Set(flatten(ast.blocks).map((block) => block.kind));
    if (extension === ".dsm" && !["Shader", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend", "GraphFunction", "VirtualFunction"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader implementation (.dsm) should declare a top-level Shader, ShaderFunction, ShaderLayer, ShaderLayerBlend, GraphFunction, or VirtualFunction block.", SEVERITY.Warning));
    }

    if (extension === ".dsf" && !["ShaderFunction", "Function", "GraphFunction", "Namespace", "VirtualFunction"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader function file (.dsf) should declare ShaderFunction assets or reusable Function, GraphFunction, Namespace, or VirtualFunction blocks.", SEVERITY.Warning));
    }

    if (extension === ".dsf" && ["Shader", "ShaderLayer", "ShaderLayerBlend"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader function file (.dsf) may not declare Shader, ShaderLayer, or ShaderLayerBlend blocks.", SEVERITY.Error));
    }

    if (extension === ".dsh" && ["Shader", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader header (.dsh) may only contain import statements, Function blocks, GraphFunction blocks, Namespace blocks, and VirtualFunction declarations.", SEVERITY.Error));
    }
}

function addImportDiagnostics(diagnostics, ast, services) {
    for (const importStatement of ast.imports || []) {
        if (!importStatement.path) {
            diagnostics.push(makeDiagnostic(importStatement.startOffset, importStatement.endOffset, "DreamShader import is missing a quoted path.", SEVERITY.Error));
            continue;
        }
        const resolver = services && services.resolveImportPath;
        if (typeof resolver !== "function") {
            continue;
        }
        let resolved = "";
        try {
            resolved = resolver(importStatement.path);
        } catch (_error) {
            resolved = "";
        }
        if (!resolved) {
            diagnostics.push(makeDiagnostic(
                importStatement.pathOffset,
                importStatement.pathOffset + importStatement.path.length,
                `DreamShader import '${importStatement.path}' could not be resolved.`,
                SEVERITY.Error));
        }
    }
}

function addDuplicateCallableDiagnostics(diagnostics, ast) {
    const seen = new Map();
    for (const block of flatten(ast.blocks)) {
        if (!["Function", "GraphFunction", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend", "VirtualFunction"].includes(block.kind)) {
            continue;
        }
        const key = normalizeSymbolKey(block.namespace ? `${block.namespace}::${block.name}` : block.name);
        if (!key) {
            continue;
        }
        if (!seen.has(key)) {
            seen.set(key, []);
        }
        seen.get(key).push(block);
    }

    for (const [name, blocks] of seen.entries()) {
        if (blocks.length < 2) {
            continue;
        }
        for (const block of blocks) {
            diagnostics.push(makeDiagnostic(
                block.nameOffset,
                block.nameOffset + (block.nameRangeLength || block.localName?.length || block.name?.length || name.length),
                `DreamShader callable '${block.name}' is declared more than once in this file.`,
                SEVERITY.Error));
        }
    }
}

function addBlockDiagnostics(diagnostics, ast, reachableCallables) {
    for (const block of flatten(ast.blocks)) {
        if (block.kind === "Namespace" || block.kind === "Function" || block.kind === "GraphFunction") {
            continue;
        }
        const allowed = new Set(allowedSectionsForBlock(block.kind));
        const sectionsByName = new Map();
        for (const section of block.sections || []) {
            if (!allowed.has(section.name)) {
                diagnostics.push(makeDiagnostic(section.nameOffset, section.nameOffset + section.name.length, `${block.kind} does not support a ${section.name} section.`, SEVERITY.Error));
            }
            if (!sectionsByName.has(section.name)) {
                sectionsByName.set(section.name, []);
            }
            sectionsByName.get(section.name).push(section);
        }

        for (const [name, sections] of sectionsByName.entries()) {
            if (sections.length < 2) {
                continue;
            }
            for (const section of sections) {
                diagnostics.push(makeDiagnostic(section.nameOffset, section.nameOffset + name.length, `${block.kind} declares ${name} more than once.`, SEVERITY.Error));
            }
        }

        for (const section of block.sections || []) {
            addSectionEntryDiagnostics(diagnostics, block, section, ast, reachableCallables);
        }

        addRequiredSectionDiagnostics(diagnostics, block, sectionsByName);
        addShaderLayerShapeDiagnostics(diagnostics, block, sectionsByName);
        addSubstrateSettingDiagnostics(diagnostics, block, sectionsByName);
    }
}

function addRequiredSectionDiagnostics(diagnostics, block, sectionsByName) {
    if (block.kind === "VirtualFunction") {
        if (!sectionsByName.has("Outputs")) {
            diagnostics.push(makeDiagnostic(block.startOffset, Math.min(block.endOffset, block.startOffset + block.kind.length), `VirtualFunction '${block.name}' must declare an Outputs section.`, SEVERITY.Error));
        }
        const options = sectionsByName.get("Options")?.[0] || sectionsByName.get("Settings")?.[0];
        if (!options) {
            diagnostics.push(makeDiagnostic(block.startOffset, Math.min(block.endOffset, block.startOffset + block.kind.length), `VirtualFunction '${block.name}' must declare Options = { Asset = Path(...); }.`, SEVERITY.Error));
        } else {
            const hasAsset = (options.entries || []).some((entry) => entry.kind === "assignment" && normalizeSymbolKey(entry.name) === "asset");
            if (!hasAsset) {
                diagnostics.push(makeDiagnostic(options.nameOffset, options.nameOffset + options.name.length, `VirtualFunction '${block.name}' Options must include Asset = Path(...);`, SEVERITY.Error));
            }
        }
    }
    if ((block.kind === "Shader" || block.kind === "ShaderFunction") && !sectionsByName.has("Graph")) {
        diagnostics.push(makeDiagnostic(block.startOffset, Math.min(block.endOffset, block.startOffset + block.kind.length), `${block.kind} '${block.name}' should declare a Graph section.`, SEVERITY.Warning));
    }
}

function addShaderLayerShapeDiagnostics(diagnostics, block, sectionsByName) {
    if (block.kind !== "ShaderLayer" && block.kind !== "ShaderLayerBlend") {
        return;
    }
    const outputsSection = sectionsByName.get("Outputs")?.[0];
    const outputs = (outputsSection?.entries || []).filter((entry) => entry.kind === "declaration");
    if (outputs.length !== 1 || !resolveTypeInfo(outputs[0]?.type)?.isMaterialAttributes) {
        diagnostics.push(makeDiagnostic(
            outputsSection ? outputsSection.nameOffset : block.startOffset,
            outputsSection ? outputsSection.nameOffset + outputsSection.name.length : block.startOffset + block.kind.length,
            `${block.kind} '${block.name}' must declare exactly one MaterialAttributes output.`,
            SEVERITY.Error));
    }

    if (block.kind === "ShaderLayerBlend") {
        const inputsSection = sectionsByName.get("Inputs")?.[0];
        const inputs = (inputsSection?.entries || []).filter((entry) => entry.kind === "declaration");
        const materialAttributesInputCount = inputs.filter((entry) => resolveTypeInfo(entry.type)?.isMaterialAttributes).length;
        if (materialAttributesInputCount < 2) {
            diagnostics.push(makeDiagnostic(
                inputsSection ? inputsSection.nameOffset : block.startOffset,
                inputsSection ? inputsSection.nameOffset + inputsSection.name.length : block.startOffset + block.kind.length,
                `ShaderLayerBlend '${block.name}' must declare at least two MaterialAttributes inputs.`,
                SEVERITY.Error));
        }
    }
}

function addSubstrateSettingDiagnostics(diagnostics, block, sectionsByName) {
    const settings = sectionsByName.get("Settings")?.[0];
    if (!settings) {
        return;
    }
    const shadingModel = (settings.entries || [])
        .find((entry) => entry.kind === "assignment" && normalizeSymbolKey(entry.name) === "shadingmodel");
    if (!shadingModel) {
        return;
    }
    const value = unquote(shadingModel.value);
    if (!["substrate", "strata"].includes(normalizeSymbolKey(value))) {
        return;
    }
    if (block.kind === "ShaderLayer" || block.kind === "ShaderLayerBlend") {
        return;
    }
    const outputs = sectionsByName.get("Outputs")?.[0];
    const hasMaterialAttributesOutput = (outputs?.entries || []).some((entry) =>
        (entry.kind === "declaration" && resolveTypeInfo(entry.type)?.isMaterialAttributes)
        || (entry.kind === "binding" && /^Base\s*\.\s*(MaterialAttributes|Attributes)\s*$/i.test(entry.target || "")));
    if (!hasMaterialAttributesOutput) {
        diagnostics.push(makeDiagnostic(
            shadingModel.valueOffset,
            shadingModel.valueOffset + String(shadingModel.value || "").length,
            "Substrate/Strata materials should output MaterialAttributes or bind Base.MaterialAttributes.",
            SEVERITY.Information));
    }
}

function addSectionEntryDiagnostics(diagnostics, block, section, ast, reachableCallables) {
    const seenNames = new Map();
    if (section.name === "Settings" || section.name === "Options") {
        for (const entry of section.entries || []) {
            if (entry.kind !== "assignment") {
                diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, `${section.name} entry should use Name = Value; syntax.`, SEVERITY.Error));
            }
            if (!entry.terminated) {
                diagnostics.push(makeDiagnostic(entry.endOffset, entry.endOffset, `${section.name} statement is missing a trailing ';'.`, SEVERITY.Error));
            }
        }
        return;
    }

    if (section.name === "Graph") {
        addGraphDiagnostics(diagnostics, block, section, ast, reachableCallables);
        return;
    }

    for (const entry of section.entries || []) {
        if (entry.kind === "invalid") {
            diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, `${section.name} statement is not a valid declaration or binding.`, SEVERITY.Error));
            continue;
        }

        if (entry.kind === "binding") {
            validateOutputBinding(diagnostics, entry);
            if (!entry.terminated) {
                diagnostics.push(makeDiagnostic(entry.endOffset, entry.endOffset, "Outputs binding is missing a trailing ';'.", SEVERITY.Error));
            }
            continue;
        }

        if (entry.kind !== "declaration") {
            continue;
        }

        if (!isTypeName(entry.type)) {
            diagnostics.push(makeDiagnostic(entry.startOffset, entry.startOffset + String(entry.type || "").length, `Unknown DreamShader type '${entry.type}'.`, SEVERITY.Warning));
        }
        const key = normalizeSymbolKey(entry.name);
        if (key) {
            if (!seenNames.has(key)) {
                seenNames.set(key, []);
            }
            seenNames.get(key).push(entry);
        }
        if (!entry.terminated) {
            diagnostics.push(makeDiagnostic(entry.endOffset, entry.endOffset, `${section.name} statement is missing a trailing ';'.`, SEVERITY.Error));
        }
    }

    for (const [name, entries] of seenNames.entries()) {
        if (entries.length < 2) {
            continue;
        }
        for (const entry of entries) {
            diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, `Declaration '${entry.name || name}' is declared more than once in ${section.name}.`, SEVERITY.Error));
        }
    }
}

function validateOutputBinding(diagnostics, entry) {
    const target = String(entry.target || "").trim();
    const baseMatch = /^Base\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
    const expressionMatch = /^Expression\s*\([^)]*\)\s*\.\s*Pin\s*\[[^\]]+\]$/.exec(target);
    if (baseMatch) {
        const memberKey = normalizeSymbolKey(baseMatch[1]);
        if (!MATERIAL_OUTPUT_NAME_SET.has(memberKey)) {
            diagnostics.push(makeDiagnostic(entry.startOffset, entry.startOffset + target.length, `Unknown material output Base.${baseMatch[1]}.`, SEVERITY.Warning));
        }
        return;
    }
    if (expressionMatch) {
        return;
    }
    diagnostics.push(makeDiagnostic(entry.startOffset, entry.startOffset + target.length, "Outputs bindings should target Base.<Property> or Expression(...).Pin[n].", SEVERITY.Warning));
}

function addFunctionDiagnostics(diagnostics, ast, reachableCallables) {
    for (const block of flatten(ast.blocks)) {
        if (block.kind !== "Function" && block.kind !== "GraphFunction") {
            continue;
        }
        let sawOut = false;
        for (const param of block.params || []) {
            if (param.kind === "invalid") {
                diagnostics.push(makeDiagnostic(param.startOffset, param.endOffset, `${block.kind} '${block.name}' has an invalid parameter declaration.`, SEVERITY.Error));
                continue;
            }
            if (!["in", "out", "inout"].includes(param.qualifier)) {
                diagnostics.push(makeDiagnostic(param.startOffset, param.endOffset, `Unsupported parameter qualifier '${param.qualifier}'.`, SEVERITY.Error));
            }
            if (param.qualifier === "out" || param.qualifier === "inout") {
                sawOut = true;
            }
            if (!isTypeName(param.type)) {
                diagnostics.push(makeDiagnostic(param.startOffset, param.startOffset + String(param.type || "").length, `Unknown DreamShader type '${param.type}'.`, SEVERITY.Warning));
            }
        }
        if (!sawOut) {
            diagnostics.push(makeDiagnostic(block.nameOffset, block.nameOffset + (block.nameRangeLength || block.name.length), `${block.kind} '${block.name}' should declare at least one out parameter.`, SEVERITY.Warning));
        }

        if (block.kind === "Function") {
            addFunctionBodyDiagnostics(diagnostics, block);
        } else {
            addGraphFunctionBodyDiagnostics(diagnostics, ast, block, reachableCallables);
        }
    }
}

function addFunctionBodyDiagnostics(diagnostics, block) {
    for (const match of stripCommentsPreserveLayout(block.bodyText || "").matchAll(/\bUE\s*\./g)) {
        diagnostics.push(makeDiagnostic(
            block.bodyOffset + match.index,
            block.bodyOffset + match.index + match[0].length,
            "UE.* material graph nodes are not valid inside Function. Use GraphFunction when you need to call UE graph nodes.",
            SEVERITY.Error));
    }
}

function addGraphFunctionBodyDiagnostics(diagnostics, ast, block, reachableCallables) {
    const context = { ast, block, kind: "GraphFunctionBody", section: null, offset: block.endOffset };
    const symbols = collectSymbols(ast, context, reachableCallables);
    addGraphStatementDiagnostics(diagnostics, block.bodyText || "", block.bodyOffset || block.bodyOpenOffset + 1, symbols, reachableCallables);
}

function addGraphDiagnostics(diagnostics, block, section, ast, reachableCallables) {
    const context = { ast, block, section, kind: "Graph", offset: section.endOffset };
    const symbols = collectSymbols(ast, context, reachableCallables);
    addGraphStatementDiagnostics(diagnostics, section.bodyText || "", section.bodyOffset, symbols, reachableCallables);
}

function addGraphStatementDiagnostics(diagnostics, bodyText, baseOffset, symbols, reachableCallables) {
    for (const statement of parseCodeStatements(bodyText, baseOffset)) {
        if (!statement.terminated && statement.text.trim()) {
            diagnostics.push(makeDiagnostic(statement.endOffset, statement.endOffset, "Graph statement is missing a trailing ';'.", SEVERITY.Error));
        }

        if (statement.kind === "declarations") {
            for (const declaration of statement.declarations || []) {
                const typeInfo = resolveTypeInfo(declaration.type);
                if (!typeInfo) {
                    diagnostics.push(makeDiagnostic(declaration.startOffset, declaration.startOffset + String(declaration.type || "").length, `Unsupported Graph variable type '${declaration.type}' for '${declaration.name}'.`, SEVERITY.Warning));
                    continue;
                }
                if (declaration.valueText) {
                    addExpressionDiagnostics(diagnostics, declaration.valueText, declaration.valueOffset, symbols, reachableCallables);
                }
                symbols.set(normalizeSymbolKey(declaration.name), {
                    name: declaration.name,
                    type: declaration.type,
                    detail: `${declaration.type} local variable`,
                    typeInfo
                });
            }
            continue;
        }

        if (statement.kind === "assignment") {
            addExpressionDiagnostics(diagnostics, statement.valueText, statement.valueOffset, symbols, reachableCallables);
            validateAssignmentTarget(diagnostics, statement, symbols);
            continue;
        }

        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (callExpression) {
            validateCallableArguments(diagnostics, callExpression, symbols, reachableCallables, true);
            continue;
        }

        addExpressionDiagnostics(diagnostics, statement.text, statement.startOffset, symbols, reachableCallables);
    }
}

function validateAssignmentTarget(diagnostics, statement, symbols) {
    const target = String(statement.target || "").trim();
    const memberMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
    if (memberMatch) {
        const baseSymbol = symbols.get(normalizeSymbolKey(memberMatch[1]));
        if (!baseSymbol) {
            diagnostics.push(makeDiagnostic(statement.startOffset, statement.startOffset + memberMatch[1].length, `Unknown MaterialAttributes variable '${memberMatch[1]}'.`, SEVERITY.Warning));
            return;
        }
        if (!baseSymbol.typeInfo?.isMaterialAttributes) {
            diagnostics.push(makeDiagnostic(statement.startOffset, statement.startOffset + memberMatch[1].length, `Graph variable '${memberMatch[1]}' is not a MaterialAttributes value.`, SEVERITY.Warning));
            return;
        }
        if (!MATERIAL_ATTRIBUTE_MEMBER_NAME_SET.has(normalizeSymbolKey(memberMatch[2]))) {
            const memberOffset = statement.startOffset + target.indexOf(memberMatch[2]);
            diagnostics.push(makeDiagnostic(memberOffset, memberOffset + memberMatch[2].length, `Unknown MaterialAttributes member '${memberMatch[2]}'.`, SEVERITY.Warning));
        }
        return;
    }
    const existing = symbols.get(normalizeSymbolKey(target));
    if (!existing && /^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
        symbols.set(normalizeSymbolKey(target), { name: target, typeInfo: null });
    }
}

function addExpressionDiagnostics(diagnostics, text, baseOffset, symbols, reachableCallables) {
    const clean = stripCommentsPreserveLayout(text);
    const known = new Set([...symbols.keys(), "ue", "true", "false", "default"]);
    for (const [key] of mapEntries(reachableCallables)) {
        known.add(normalizeSymbolKey(String(key).split("::").pop()));
        known.add(normalizeSymbolKey(key));
    }

    for (const match of clean.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g)) {
        const callExpression = parseCallExpressionText(clean.slice(match.index), baseOffset + match.index);
        if (callExpression) {
            validateCallableArguments(diagnostics, callExpression, symbols, reachableCallables, false);
        }
    }

    const ignoredRanges = collectIgnoredIdentifierRanges(clean);

    for (const match of clean.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const base = normalizeSymbolKey(match[1]);
        const member = normalizeSymbolKey(match[2]);
        if (base === "ue" || base === "base") {
            continue;
        }
        const typeInfo = symbols.get(base)?.typeInfo || resolveTypeInfo(match[1]);
        if (typeInfo?.isMaterialAttributes && !MATERIAL_ATTRIBUTE_MEMBER_NAME_SET.has(member)) {
            diagnostics.push(makeDiagnostic(
                baseOffset + match.index,
                baseOffset + match.index + match[0].length,
                `Unknown MaterialAttributes member '${match[2]}'.`,
                SEVERITY.Warning));
        }
    }

    for (const match of clean.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        if (isOffsetInRanges(match.index, ignoredRanges)) {
            continue;
        }
        const name = match[1];
        const key = normalizeSymbolKey(name);
        if (known.has(key) || isTypeName(name) || isHlslKnownName(key)) {
            continue;
        }
        const charBefore = clean[Math.max(0, match.index - 1)];
        const charAfter = clean[match.index + name.length];
        if (charBefore === "." || charAfter === "." || charAfter === ":" || charBefore === ":" || charAfter === "(") {
            continue;
        }
        diagnostics.push(makeDiagnostic(
            baseOffset + match.index,
            baseOffset + match.index + name.length,
            `Identifier '${name}' is not declared in this scope.`,
            SEVERITY.Warning));
    }
}

function validateCallableArguments(diagnostics, callExpression, symbols, reachableCallables, standalone) {
    if (!callExpression || isHlslKnownName(normalizeSymbolKey(callExpression.callee)) || normalizeSymbolKey(callExpression.callee).startsWith("ue.") || isTypeName(callExpression.callee) || normalizeSymbolKey(callExpression.callee) === "path") {
        for (let index = 0; index < (callExpression?.arguments || []).length; index += 1) {
            const arg = callExpression.arguments[index];
            if (arg.isNamed) {
                if (shouldValidateNamedArgumentValue(callExpression.callee, arg.name, arg.valueText)) {
                    addExpressionDiagnostics(diagnostics, arg.valueText, arg.valueOffset, symbols, reachableCallables);
                }
                continue;
            }
            if (shouldSkipPositionalArgumentValue(callExpression.callee, arg.valueText, index)) {
                continue;
            }
            addExpressionDiagnostics(diagnostics, arg.valueText, arg.valueOffset, symbols, reachableCallables);
        }
        return;
    }

    const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
    const signature = signatures[0];
    if (!signature) {
        return;
    }

    const inputs = signature.inputs || [];
    const outputs = signature.outputs || [];
    const optionalTailCount = countOptionalTailInputs(inputs);
    const minInputs = inputs.length - optionalTailCount;
    const expected = standalone ? inputs.length + outputs.length : inputs.length;
    const minExpected = standalone ? minInputs + outputs.length : minInputs;
    const received = callExpression.arguments.length;
    if (received < minExpected || received > expected) {
        diagnostics.push(makeDiagnostic(
            callExpression.calleeOffset,
            callExpression.endOffset,
            expected === minExpected
                ? `${signature.kind || "DreamShader callable"} '${signature.name || callExpression.callee}' expects ${expected} argument${expected === 1 ? "" : "s"} but got ${received}.`
                : `${signature.kind || "DreamShader callable"} '${signature.name || callExpression.callee}' expects ${minExpected}-${expected} arguments but got ${received}.`,
            SEVERITY.Warning));
        return;
    }

    const inputArgumentCount = standalone ? received - outputs.length : received;
    for (let index = 0; index < inputArgumentCount; index += 1) {
        const arg = callExpression.arguments[index];
        if (arg && !isDefaultArgumentText(arg.valueText)) {
            addExpressionDiagnostics(diagnostics, arg.valueText, arg.valueOffset, symbols, reachableCallables);
        }
    }

    if (!standalone) {
        return;
    }

    for (let index = 0; index < outputs.length; index += 1) {
        const arg = callExpression.arguments[inputArgumentCount + index];
        const expectedOutput = outputs[index];
        if (!arg || arg.isNamed || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg.valueText)) {
            diagnostics.push(makeDiagnostic(
                arg ? arg.startOffset : callExpression.endOffset,
                arg ? arg.endOffset : callExpression.endOffset,
                `${signature.kind || "DreamShader callable"} '${signature.name || callExpression.callee}' out argument '${expectedOutput.name}' must be a plain variable name.`,
                SEVERITY.Warning));
            continue;
        }
        const existing = symbols.get(normalizeSymbolKey(arg.valueText));
        if (existing?.type && expectedOutput.type && !areTypesCompatible(existing.type, expectedOutput.type)) {
            diagnostics.push(makeDiagnostic(arg.startOffset, arg.endOffset, `Out variable '${arg.valueText}' does not match result type '${expectedOutput.type}'.`, SEVERITY.Warning));
            continue;
        }
        symbols.set(normalizeSymbolKey(arg.valueText), {
            name: arg.valueText,
            type: expectedOutput.type,
            detail: `${expectedOutput.type} Graph out variable`,
            typeInfo: resolveTypeInfo(expectedOutput.type)
        });
    }
}

function countOptionalTailInputs(inputs) {
    let count = 0;
    for (let index = inputs.length - 1; index >= 0; index -= 1) {
        if (!inputs[index]?.optional) {
            break;
        }
        count += 1;
    }
    return count;
}

function addCycleDiagnostics(diagnostics, services, fileName) {
    const cycles = callService(services, "collectFunctionCycles", [], fileName);
    const currentPath = normalizePath(fileName);
    for (const cycle of cycles || []) {
        const local = cycle.find((entry) => normalizePath(entry.fsPath) === currentPath);
        if (!local) {
            continue;
        }
        const cyclePath = cycle.map((entry) => entry.name || entry.localName).join(" -> ");
        diagnostics.push(makeDiagnostic(
            local.nameOffset,
            local.nameOffset + (local.nameRangeLength || String(local.name || local.localName || "").length),
            `DreamShader Function cycle detected: ${cyclePath}. HLSL cannot compile recursive DreamShader functions.`,
            SEVERITY.Error));
    }
}

function isDefaultArgumentText(text) {
    return normalizeSymbolKey(text) === "default";
}

function isHlslKnownName(key) {
    return [
        "if", "else", "for", "while", "do", "switch", "case", "return", "break", "continue",
        "const", "static", "struct", "sin", "cos", "tan", "saturate", "lerp", "clamp", "dot",
        "cross", "normalize", "pow", "sqrt", "abs", "min", "max", "frac", "floor", "ceil",
        "ddx", "ddy", "fmod", "length", "mul", "reflect", "rsqrt", "smoothstep", "step", "exp", "exp2", "log", "log2",
        "mix", "fract", "mod"
    ].includes(key);
}

function collectIgnoredIdentifierRanges(text) {
    const ranges = collectStringRanges(text);
    for (const call of collectCallArgumentRanges(text)) {
        const callee = normalizeSymbolKey(call.callee);
        for (let index = 0; index < call.arguments.length; index += 1) {
            const argument = call.arguments[index];
            const assignment = findTopLevelAssignmentRange(text, argument.start, argument.end);
            if (assignment) {
                ranges.push({ start: assignment.nameStart, end: assignment.nameEnd });
                const valueText = text.slice(assignment.valueStart, assignment.valueEnd);
                if (!shouldValidateNamedArgumentValue(call.callee, text.slice(assignment.nameStart, assignment.nameEnd), valueText)) {
                    ranges.push({ start: assignment.valueStart, end: assignment.valueEnd });
                }
                continue;
            }

            if (callee === "path" && index === 0 && isBarePathRoot(argument.text)) {
                ranges.push({ start: argument.start, end: argument.end });
            }
        }
    }
    return ranges;
}

function collectStringRanges(text) {
    const ranges = [];
    let inString = false;
    let stringStart = -1;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (!inString) {
            if (char === "\"") {
                inString = true;
                stringStart = index;
            }
            continue;
        }

        if (char === "\n" || char === "\r") {
            ranges.push({ start: stringStart, end: index });
            inString = false;
            stringStart = -1;
            continue;
        }
        if (char === "\\") {
            index += 1;
            continue;
        }
        if (char === "\"") {
            ranges.push({ start: stringStart, end: index + 1 });
            inString = false;
            stringStart = -1;
        }
    }
    if (inString && stringStart >= 0) {
        ranges.push({ start: stringStart, end: text.length });
    }
    return ranges;
}

function findTopLevelAssignmentRange(text, startOffset, endOffset) {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    let inString = false;
    for (let index = startOffset; index < endOffset; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
            } else if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "(") {
            paren += 1;
            continue;
        }
        if (char === ")") {
            paren = Math.max(0, paren - 1);
            continue;
        }
        if (char === "[") {
            bracket += 1;
            continue;
        }
        if (char === "]") {
            bracket = Math.max(0, bracket - 1);
            continue;
        }
        if (char === "{") {
            brace += 1;
            continue;
        }
        if (char === "}") {
            brace = Math.max(0, brace - 1);
            continue;
        }
        if (char === "=" && paren === 0 && bracket === 0 && brace === 0) {
            const left = trimRange(text, startOffset, index);
            const right = trimRange(text, index + 1, endOffset);
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text.slice(left.start, left.end))) {
                return null;
            }
            return {
                nameStart: left.start,
                nameEnd: left.end,
                valueStart: right.start,
                valueEnd: right.end
            };
        }
    }
    return null;
}

function trimRange(text, startOffset, endOffset) {
    let start = startOffset;
    let end = endOffset;
    while (start < end && /\s/.test(text[start])) {
        start += 1;
    }
    while (end > start && /\s/.test(text[end - 1])) {
        end -= 1;
    }
    return { start, end };
}

function collectCallArgumentRanges(text) {
    const calls = [];
    for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g)) {
        const callee = match[1];
        const calleeOffset = match.index + match[0].indexOf(callee);
        const openOffset = match.index + match[0].lastIndexOf("(");
        const closeOffset = findMatchingParen(text, openOffset);
        if (closeOffset < 0) {
            continue;
        }
        calls.push({
            callee,
            start: calleeOffset,
            openOffset,
            closeOffset,
            arguments: splitArgumentRanges(text, openOffset + 1, closeOffset)
        });
    }
    return calls;
}

function splitArgumentRanges(text, startOffset, endOffset) {
    const result = [];
    let start = startOffset;
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    let inString = false;
    for (let index = startOffset; index < endOffset; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
            } else if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "(") {
            paren += 1;
            continue;
        }
        if (char === ")") {
            paren = Math.max(0, paren - 1);
            continue;
        }
        if (char === "[") {
            bracket += 1;
            continue;
        }
        if (char === "]") {
            bracket = Math.max(0, bracket - 1);
            continue;
        }
        if (char === "{") {
            brace += 1;
            continue;
        }
        if (char === "}") {
            brace = Math.max(0, brace - 1);
            continue;
        }
        if (char === "," && paren === 0 && bracket === 0 && brace === 0) {
            pushArgumentRange(result, text, start, index);
            start = index + 1;
        }
    }
    pushArgumentRange(result, text, start, endOffset);
    return result;
}

function pushArgumentRange(result, text, startOffset, endOffset) {
    const raw = text.slice(startOffset, endOffset);
    const leading = raw.search(/\S|$/);
    const trailing = raw.length - raw.trimEnd().length;
    const start = startOffset + leading;
    const end = endOffset - trailing;
    if (end > start) {
        result.push({ start, end, text: text.slice(start, end) });
    }
}

function findMatchingParen(text, openOffset) {
    let depth = 0;
    let inString = false;
    for (let index = openOffset; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
            } else if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function isOffsetInRanges(offset, ranges) {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

function shouldValidateNamedArgumentValue(callee, name, valueText) {
    const calleeKey = normalizeSymbolKey(callee);
    const nameKey = normalizeSymbolKey(name);
    if (calleeKey === "path") {
        return false;
    }
    if (calleeKey.startsWith("ue.") && ["class", "outputtype", "resulttype", "output", "source", "destination", "parameter"].includes(nameKey)) {
        return false;
    }
    return !isBareLiteralToken(valueText);
}

function shouldSkipPositionalArgumentValue(callee, valueText, argumentIndex) {
    const calleeKey = normalizeSymbolKey(callee);
    if (calleeKey === "path" && argumentIndex <= 0 && isBarePathRoot(valueText)) {
        return true;
    }
    return false;
}

function isBareLiteralToken(text) {
    return /^[A-Za-z_][A-Za-z0-9_./-]*$/.test(String(text || "").trim());
}

function isBarePathRoot(text) {
    return /^(Game|Engine|Plugin(?:s)?(?:\.[A-Za-z_][A-Za-z0-9_]*)?)$/i.test(String(text || "").trim());
}

function addBraceDiagnostics(diagnostics, text) {
    const clean = stripCommentsPreserveLayout(text);
    const stack = [];
    const pairs = new Map([["}", "{"], [")", "("], ["]", "["]]);
    const openers = new Set(["{", "(", "["]);
    const closers = new Set(["}", ")", "]"]);
    let inString = false;
    for (let index = 0; index < clean.length; index += 1) {
        const char = clean[index];
        if (inString) {
            if (char === "\n" || char === "\r") {
                inString = false;
                continue;
            }
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (openers.has(char)) {
            stack.push({ char, offset: index });
        } else if (closers.has(char)) {
            const expected = pairs.get(char);
            const last = stack.pop();
            if (!last || last.char !== expected) {
                diagnostics.push(makeDiagnostic(index, index + 1, `Unmatched '${char}'.`, SEVERITY.Error));
            }
        }
    }

    for (const item of stack) {
        diagnostics.push(makeDiagnostic(item.offset, item.offset + 1, `Unclosed '${item.char}'.`, SEVERITY.Error));
    }
}

function allowedSectionsForBlock(kind) {
    if (kind === "Shader") {
        return ["Properties", "Settings", "Outputs", "Graph"];
    }
    if (kind === "ShaderFunction" || kind === "ShaderLayer" || kind === "ShaderLayerBlend") {
        return ["Properties", "Inputs", "Outputs", "Results", "Graph", "Settings"];
    }
    if (kind === "VirtualFunction") {
        return ["Options", "Settings", "Properties", "Inputs", "Outputs", "Results"];
    }
    return [];
}

function mergeCallables(local, reachable) {
    const result = new Map();
    for (const [key, entries] of mapEntries(reachable)) {
        result.set(key, Array.isArray(entries) ? [...entries] : [entries]);
    }
    for (const [key, entries] of mapEntries(local)) {
        if (!result.has(key)) {
            result.set(key, []);
        }
        result.get(key).push(...entries);
    }
    return result;
}

function mapEntries(value) {
    if (!value) {
        return [];
    }
    if (value instanceof Map) {
        return value.entries();
    }
    if (typeof value === "object") {
        return Object.entries(value);
    }
    return [];
}

function callService(services, name, fallback, ...args) {
    const fn = services && services[name];
    if (typeof fn !== "function") {
        return fallback;
    }
    try {
        const value = fn(...args);
        return value === undefined ? fallback : value;
    } catch (_error) {
        return fallback;
    }
}

function unquote(text) {
    const value = String(text || "").trim();
    return value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
}

function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function makeDiagnostic(startOffset, endOffset, message, severity = SEVERITY.Error) {
    return {
        startOffset: Math.max(0, startOffset || 0),
        endOffset: Math.max(Math.max(0, startOffset || 0), endOffset || startOffset || 0),
        message,
        severity
    };
}

function dedupeDiagnostics(diagnostics) {
    const seen = new Set();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.startOffset}:${diagnostic.endOffset}:${diagnostic.severity}:${diagnostic.message}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

module.exports = {
    getDiagnostics,
    SEVERITY
};
