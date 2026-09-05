"use strict";

const path = require("path");
const { parseDocument, parseCodeStatements } = require("./parser");
const { collectSymbols, collectCallables, flatten } = require("./symbols");
const { parseCallExpressionText } = require("./calls");
const { isFunctionBuiltinName } = require("./functionBuiltins");
const { isTypeName, resolveTypeInfo, getMaterialAttributeMemberType, areTypesCompatible } = require("./types");
const {
    IDENTIFIER_PATTERN,
    QUALIFIED_IDENTIFIER_PATTERN,
    normalizeSymbolKey,
    stripCommentsPreserveLayout,
    splitTopLevelAssignment,
    isValidIdentifier
} = require("./utils");
const {
    MATERIAL_OUTPUT_NAME_SET,
    MATERIAL_ATTRIBUTE_MEMBER_NAME_SET,
    SUBSTRATE_BUILTIN_ITEMS
} = require("../languageData");

// THE PREPROCESSOR MIRROR LIVES IN ONE FILE, AND THIS IS NOT IT.
//
// `src/language/preprocessor.js` is the extension's only copy of the plugin's directive scanner and
// condition grammar. Everything below that touches a `#` line goes through it: the directive
// classifier, the opaque-region tracker, the comment strip, the name/value split, the two name
// predicates and the condition parser.
//
// There is a reason to insist on that, and it is the feature itself. Conditional compilation exists
// so an author can write one source that two builds read differently, and its whole failure mode is
// silent divergence -- a branch the editor greys and the compiler keeps, a directive the editor
// accepts and the compiler refuses. An extension carrying TWO scanners of its own would be that
// same failure one level up: two files, both plausible, drifting apart a fix at a time, with the
// disagreement surfacing as a wrong squiggle nobody can source. A second copy is not redundancy
// here; it is the bug.
//
// Which copy survives was not a matter of taste either. `scripts/preprocessor-smoke.js` replays the
// conformance vectors the plugin EXPORTS -- expected verdicts recorded from the C++ evaluator
// itself -- and it replays them through `preprocessor.js`. That file is pinned to the compiler by
// evidence; any copy living here would be pinned to nothing but its author's reading of the same
// spec. So this file lost, and deliberately: ~700 lines of a parallel scanner were deleted in
// favour of calling the one that is checked.
//
// What stays here is the part that is genuinely this file's own: the DIAGNOSTICS -- which range to
// underline, which DSHnnnn to raise, and what to say -- since `preprocessor.js` reports whole lines
// to a dimmer and stops at the first refusal, while an editor has to point at a column and keep
// going. See the section header further down for the codes this pass does and does not emit.
const {
    DIRECTIVE_KEYWORDS,
    DIRECTIVE_KIND,
    GRAPH_DIRECTIVE_KEYWORDS,
    MAX_CONDITIONAL_DEPTH,
    checkConditionSyntax,
    classifyDirectiveLine,
    createOpaqueRegionTracker,
    isReservedDefineName,
    isValidDefineName,
    splitNameAndValue,
    splitSourceLines,
    stripTrailingLineComment
} = require("./preprocessor");

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
    const substrateBuiltinNames = getSubstrateBuiltinNameSet(services);

    // The `#` layer: one scan, shared by three passes below.
    //
    // Derived from the RAW `text` on purpose, and this is the one line in the file that must not be
    // "tidied" to read from the AST. `parseDocument` above blanks every directive line before
    // parsing -- which is what keeps the statement splitters from gluing a line that carries no `;`
    // onto the statement after it -- so by the time anything reads `ast`, or any `bodyText` or
    // `section.bodyText` hanging off it, the directives are a run of equal-length spaces. This
    // argument is the only copy of the file that still has them, and a pass fed the other copy
    // would find no directives at all and report nothing, quietly.
    const directives = collectPreprocessorDirectives(text);
    const conditionalChains = collectConditionalBranchChains(directives, String(text || "").length);

    // First, as in the plugin: the preprocessor runs before `import` extraction and before the
    // declaration parser, so a directive that is malformed is malformed whatever the rest of the
    // file turns out to be.
    addPreprocessorDiagnostics(diagnostics, directives);
    addFileShapeDiagnostics(diagnostics, ast, text, extension, conditionalChains);
    addImportDiagnostics(diagnostics, ast, services);
    addDuplicateCallableDiagnostics(diagnostics, ast, conditionalChains);
    addBlockDiagnostics(diagnostics, ast, reachableCallables, substrateBuiltinNames);
    addFunctionDiagnostics(diagnostics, ast, reachableCallables, substrateBuiltinNames);
    addCycleDiagnostics(diagnostics, services, fileName);
    addBraceDiagnostics(diagnostics, text);
    return dedupeDiagnostics(diagnostics);
}

function addFileShapeDiagnostics(diagnostics, ast, text, extension, conditionalChains = []) {
    const topLevelKinds = new Set(flatten(ast.blocks).map((block) => block.kind));
    if (extension === ".dsm" && !["Shader", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend", "GraphFunction", "VirtualFunction"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader implementation (.dsm) should declare a top-level Shader, ShaderFunction, ShaderLayer, ShaderLayerBlend, GraphFunction, or VirtualFunction block.", SEVERITY.Warning));
    }

    if (extension === ".dsf" && !["ShaderFunction", "ShaderLayer", "ShaderLayerBlend", "Function", "GraphFunction", "Namespace", "VirtualFunction"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader function file (.dsf) should declare ShaderFunction, ShaderLayer, or ShaderLayerBlend assets, or reusable Function, GraphFunction, Namespace, or VirtualFunction blocks.", SEVERITY.Warning));
    }

    if (extension === ".dsf" && topLevelKinds.has("Shader")) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader function file (.dsf) may not declare Shader blocks.", SEVERITY.Error));
    }

    if (extension === ".dsh" && ["Shader", "ShaderFunction", "ShaderLayer", "ShaderLayerBlend"].some((kind) => topLevelKinds.has(kind))) {
        diagnostics.push(makeDiagnostic(0, Math.min(1, text.length), "DreamShader header (.dsh) may only contain import statements, Function blocks, GraphFunction blocks, Namespace blocks, and VirtualFunction declarations.", SEVERITY.Error));
    }

    addShaderBlockDiagnostics(diagnostics, ast, conditionalChains);
}

/**
 * The two things the compiler asks of a top-level Shader block before it looks inside one.
 *
 * Both are refusals, not warnings: `DreamShaderParser.cpp` returns a parse failure for each, so a
 * file that trips either produces no material at all. The wording is the compiler's own -- an editor
 * that phrased the same refusal differently would read as a second, disagreeing opinion.
 */
function addShaderBlockDiagnostics(diagnostics, ast, conditionalChains = []) {
    const shaders = (ast.blocks || []).filter((block) => block.kind === "Shader");

    for (let index = 1; index < shaders.length; index += 1) {
        const block = shaders[index];
        // "More than one" is a question about what the PARSER ends up seeing, and the preprocessor
        // runs first: two Shader blocks in different branches of one `#if` chain are never both in
        // the text it hands over. Both arms are parsed on this side (there is no define table to
        // choose between them), so without this test a source that guards a whole Shader block --
        // which `preprocessor.md` documents, orphan warning and all -- would be an error here and
        // fine in the build.
        const coexists = shaders.some((other, otherIndex) => otherIndex < index
            && !areInExclusiveConditionalBranches(conditionalChains, block.kindOffset, other.kindOffset));
        if (!coexists) {
            continue;
        }
        diagnostics.push(makeDiagnostic(
            block.kindOffset,
            block.kindOffset + "Shader".length,
            "Only one top-level Shader block is currently supported.",
            SEVERITY.Error,
            "DSH3030"));
    }

    for (const block of shaders) {
        // Read from the attribute list rather than `block.name`, which falls back to the kind when
        // there is no `Name=` -- so a nameless Shader is literally named "Shader" here.
        const named = (block.attributes || []).some((attribute) =>
            attribute.name === "Name" && String(attribute.value || "").replace(/^"|"$/g, "").length > 0);
        if (!named) {
            diagnostics.push(makeDiagnostic(
                block.kindOffset,
                block.kindOffset + "Shader".length,
                "Shader(Name=\"...\") is required.",
                SEVERITY.Error,
                "DSH3031"));
        }
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

function addDuplicateCallableDiagnostics(diagnostics, ast, conditionalChains = []) {
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
            // A declaration is a duplicate only of one the preprocessor could emit ALONGSIDE it.
            // Both arms of a `#if` are indexed on this side, so without this test the idiom
            // `preprocessor.md` spells out in full -- one `Function ApplyShading` per branch, which
            // is the only way to pick between two HLSL bodies at generation time -- would be a hard
            // error in every conditional source. Mutual exclusion is a property of the chain, not of
            // what the conditions say, so it is knowable with no define table.
            const collides = blocks.some((other) => other !== block
                && !areInExclusiveConditionalBranches(conditionalChains, block.startOffset, other.startOffset));
            if (!collides) {
                continue;
            }
            diagnostics.push(makeDiagnostic(
                block.nameOffset,
                block.nameOffset + (block.nameRangeLength || block.localName?.length || block.name?.length || name.length),
                `DreamShader callable '${block.name}' is declared more than once in this file.`,
                SEVERITY.Error));
        }
    }
}

function addBlockDiagnostics(diagnostics, ast, reachableCallables, substrateBuiltinNames) {
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
            addSectionEntryDiagnostics(diagnostics, block, section, ast, reachableCallables, substrateBuiltinNames);
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
    const hasFrontMaterialOutput = (outputs?.entries || []).some((entry) =>
        (entry.kind === "declaration" && resolveTypeInfo(entry.type)?.isSubstrate)
        || (entry.kind === "binding" && /^Base\s*\.\s*FrontMaterial\s*$/i.test(entry.target || "")));
    if (!hasMaterialAttributesOutput && !hasFrontMaterialOutput) {
        diagnostics.push(makeDiagnostic(
            shadingModel.valueOffset,
            shadingModel.valueOffset + String(shadingModel.value || "").length,
            "Substrate/Strata materials should bind Base.FrontMaterial or output MaterialAttributes.",
            SEVERITY.Information));
    }
}

function addSectionEntryDiagnostics(diagnostics, block, section, ast, reachableCallables, substrateBuiltinNames) {
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
        addGraphDiagnostics(diagnostics, block, section, ast, reachableCallables, substrateBuiltinNames);
        return;
    }

    if (section.name === "Layout") {
        addLayoutDiagnostics(diagnostics, section);
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

function addFunctionDiagnostics(diagnostics, ast, reachableCallables, substrateBuiltinNames) {
    for (const block of flatten(ast.blocks)) {
        if (block.kind !== "Function" && block.kind !== "GraphFunction") {
            continue;
        }
        // A return type (`Function float Luma(...)`) is itself the single output.
        let sawOut = Boolean(block.returnType);
        if (block.returnType && !isTypeName(block.returnType)) {
            diagnostics.push(makeDiagnostic(
                block.returnTypeOffset,
                block.returnTypeOffset + String(block.returnType).length,
                `Unknown DreamShader type '${block.returnType}'.`,
                SEVERITY.Warning));
        }
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
            // An error, as it is in the compiler: a function with no output is a hard parse failure
            // there, and the condition is decided entirely from this block's own signature, so
            // there is no uncertainty for a warning to represent. Reporting it softer than the
            // build does is the "editor says fine, build says no" failure in miniature.
            //
            // The kind is this file's ("GraphFunction 'X'..." where the compiler always says
            // "Function 'X'..."), which the compiler's own code contract allows: the DSHnnnn is the
            // identity, and that is precisely what frees the text.
            diagnostics.push(makeDiagnostic(block.nameOffset, block.nameOffset + (block.nameRangeLength || block.name.length), `${block.kind} '${block.name}' must declare at least one out parameter.`, SEVERITY.Error, "DSH3011"));
        }

        addBareReturnDiagnostics(diagnostics, block);

        if (block.kind === "Function") {
            addFunctionBodyDiagnostics(diagnostics, block);
        } else {
            addGraphFunctionBodyDiagnostics(diagnostics, ast, block, reachableCallables, substrateBuiltinNames);
        }
    }
}

/**
 * `return;` inside a function that declared a return type.
 *
 * The compiler lowers a return type into a synthetic `__return` out parameter by rewriting `return`
 * to `__return =`, which leaves a bare `return;` as `__return =;` -- so it refuses rather than
 * emitting that. Ported from the rewriter itself (`DreamShaderParser.cpp`), including the two
 * conditions that keep it from firing on things that only look like one: identifier boundaries on
 * both sides, so `returned;` is not a match, and brace depth zero, so a `return;` inside a nested
 * block is left to the HLSL compiler rather than claimed here.
 */
function addBareReturnDiagnostics(diagnostics, block) {
    if (!block.returnType || !block.bodyText) {
        return;
    }

    const body = stripCommentsPreserveLayout(block.bodyText);
    let depth = 0;

    for (let index = 0; index < body.length; index += 1) {
        const character = body[index];
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0 || character !== "r" || body.slice(index, index + 6) !== "return") {
            continue;
        }

        const before = index > 0 ? body[index - 1] : "";
        const after = body[index + 6] || "";
        if (isIdentifierCharacter(before) || isIdentifierCharacter(after)) {
            continue;
        }

        let probe = index + 6;
        while (probe < body.length && /\s/.test(body[probe])) {
            probe += 1;
        }
        if (body[probe] === ";") {
            diagnostics.push(makeDiagnostic(
                block.bodyOffset + index,
                block.bodyOffset + probe + 1,
                "A function with a return type cannot use a bare 'return;'. Return a value, e.g. 'return expr;'.",
                SEVERITY.Error,
                "DSH3012"));
        }
        index += 5;
    }
}

function isIdentifierCharacter(character) {
    return /[A-Za-z0-9_]/.test(character || "");
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

function addGraphFunctionBodyDiagnostics(diagnostics, ast, block, reachableCallables, substrateBuiltinNames) {
    const context = { ast, block, kind: "GraphFunctionBody", section: null, offset: block.endOffset };
    const symbols = collectSymbols(ast, context, reachableCallables);
    addGraphStatementDiagnostics(diagnostics, block.bodyText || "", block.bodyOffset || block.bodyOpenOffset + 1, symbols, reachableCallables, substrateBuiltinNames);
}

function addGraphDiagnostics(diagnostics, block, section, ast, reachableCallables, substrateBuiltinNames) {
    const context = { ast, block, section, kind: "Graph", offset: section.endOffset };
    const symbols = collectSymbols(ast, context, reachableCallables);
    addGraphRegionDirectiveDiagnostics(diagnostics, section.bodyText || "", section.bodyOffset);
    addGraphStatementDiagnostics(diagnostics, section.bodyText || "", section.bodyOffset, symbols, reachableCallables, substrateBuiltinNames);
}

function addLayoutDiagnostics(diagnostics, section) {
    for (const entry of section.entries || []) {
        if (!entry.terminated && entry.text.trim()) {
            diagnostics.push(makeDiagnostic(entry.endOffset, entry.endOffset, "Layout statement is missing a trailing ';'.", SEVERITY.Error));
        }

        if (entry.kind !== "layout") {
            diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, "Layout statement should be Node(...) or Comment(...).", SEVERITY.Error));
            continue;
        }

        const layoutKind = normalizeSymbolKey(entry.layoutKind);
        if (layoutKind !== "node" && layoutKind !== "comment") {
            diagnostics.push(makeDiagnostic(entry.callExpression?.calleeOffset ?? entry.startOffset, (entry.callExpression?.calleeOffset ?? entry.startOffset) + String(entry.layoutKind || "").length, `Unknown Layout statement '${entry.layoutKind}'.`, SEVERITY.Error));
            continue;
        }

        const args = collectNamedArguments(entry.callExpression?.arguments || []);
        if (!args.valid) {
            diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, "Layout arguments must use Key=Value syntax.", SEVERITY.Error));
            continue;
        }

        for (const duplicate of args.duplicates) {
            diagnostics.push(makeDiagnostic(duplicate.nameOffset, duplicate.nameOffset + duplicate.name.length, `Layout argument '${duplicate.name}' is declared more than once.`, SEVERITY.Error, "DSH3105"));
        }

        if (layoutKind === "node") {
            validateRequiredTextLayoutArgument(diagnostics, args.map, "Var", entry);
            validateRequiredIntLayoutArgument(diagnostics, args.map, "X", entry);
            validateRequiredIntLayoutArgument(diagnostics, args.map, "Y", entry);
        } else {
            validateRequiredTextLayoutArgument(diagnostics, args.map, "Name", entry);
            validateRequiredIntLayoutArgument(diagnostics, args.map, "X", entry);
            validateRequiredIntLayoutArgument(diagnostics, args.map, "Y", entry);
            validateRequiredIntLayoutArgument(diagnostics, args.map, "W", entry);
            validateRequiredIntLayoutArgument(diagnostics, args.map, "H", entry);
            validateOptionalColorLayoutArgument(diagnostics, args.map);
        }
    }
}

function collectNamedArguments(args) {
    const map = new Map();
    const duplicates = [];
    let valid = true;
    for (const arg of args || []) {
        if (!arg.isNamed) {
            valid = false;
            continue;
        }
        const key = normalizeSymbolKey(arg.name);
        if (map.has(key)) {
            duplicates.push(arg);
        } else {
            map.set(key, arg);
        }
    }
    return { map, duplicates, valid };
}

function validateRequiredTextLayoutArgument(diagnostics, args, name, entry) {
    const arg = args.get(normalizeSymbolKey(name));
    if (!arg || !unquote(arg.valueText).trim()) {
        diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, `Layout argument '${name}' is required.`, SEVERITY.Error));
    }
}

function validateRequiredIntLayoutArgument(diagnostics, args, name, entry) {
    const arg = args.get(normalizeSymbolKey(name));
    if (!arg) {
        diagnostics.push(makeDiagnostic(entry.startOffset, entry.endOffset, `Layout argument '${name}' is required.`, SEVERITY.Error));
        return;
    }
    if (!/^[+-]?\d+$/.test(unquote(arg.valueText).trim())) {
        diagnostics.push(makeDiagnostic(arg.valueOffset, arg.endOffset, `Layout argument '${name}' must be an integer.`, SEVERITY.Error));
    }
}

function validateOptionalColorLayoutArgument(diagnostics, args) {
    const arg = args.get("color");
    if (!arg) {
        return;
    }
    if (!/^float4\s*\(\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[fF])?\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[fF])?\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[fF])?\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[fF])?\s*\)$/i.test(unquote(arg.valueText).trim())) {
        diagnostics.push(makeDiagnostic(arg.valueOffset, arg.endOffset, "Layout Comment Color must be a float4 literal.", SEVERITY.Error, "DSH3110"));
    }
}

function addGraphRegionDirectiveDiagnostics(diagnostics, bodyText, baseOffset) {
    const openRegions = [];
    let lineStart = 0;
    const source = String(bodyText || "");
    const lines = source.split(/\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index].replace(/\r$/, "");
        const trimmed = rawLine.trim();
        if (isRegionDirective(trimmed, "#Region")) {
            const name = parseRegionDirectiveName(trimmed, "#Region");
            if (!name) {
                const directiveOffset = baseOffset + lineStart + Math.max(0, rawLine.indexOf("#"));
                diagnostics.push(makeDiagnostic(directiveOffset, directiveOffset + "#Region".length, "Graph #Region must include a name.", SEVERITY.Error));
            }
            openRegions.push({ name, offset: baseOffset + lineStart + Math.max(0, rawLine.indexOf("#")) });
        } else if (isRegionDirective(trimmed, "#EndRegion")) {
            if (openRegions.length === 0) {
                const directiveOffset = baseOffset + lineStart + Math.max(0, rawLine.indexOf("#"));
                diagnostics.push(makeDiagnostic(directiveOffset, directiveOffset + "#EndRegion".length, "Graph #EndRegion has no matching #Region.", SEVERITY.Error));
            } else {
                openRegions.pop();
            }
        }
        lineStart += lines[index].length + 1;
    }

    for (const region of openRegions) {
        diagnostics.push(makeDiagnostic(region.offset, region.offset + "#Region".length, `Graph #Region '${region.name || ""}' is missing #EndRegion.`, SEVERITY.Error));
    }
}

function isRegionDirective(trimmedLine, directive) {
    return trimmedLine.length >= directive.length
        && trimmedLine.slice(0, directive.length).toLowerCase() === directive.toLowerCase()
        && (trimmedLine.length === directive.length || /\s|"/.test(trimmedLine[directive.length]));
}

function parseRegionDirectiveName(trimmedLine, directive) {
    return unquote(trimmedLine.slice(directive.length).trim()).trim();
}

// =============================================================================================
// Preprocessor directives: #if / #ifdef / #ifndef / #elif / #else / #endif / #define / #undef
//
// The SCANNING is `src/language/preprocessor.js`'s -- see the note at the top of this file for why
// it may only exist once and why that copy is the one that survived. What is here is the reporting
// layer on top of it: which range to underline, which DSHnnnn to raise, and what to say. The wording
// is the plugin's, minus the `file(line):` prefix every message there carries: a diagnostic range
// already says where, and an editor that reworded the same refusal would read as a second,
// disagreeing opinion.
//
// STRUCTURE AND SYNTAX ONLY, and that is a boundary rather than an omission. DSH1040 (a string where
// a number was required) and DSH1041 (division or modulo by zero) are NOT emitted here and must not
// be: both require actually EVALUATING the expression, and evaluation needs the define table --
// five tiers resolved inside a running editor, including a `DS_SUBSTRATE` read off a CVar, C++
// `RegisterDreamShaderDefine` calls and a provider delegate pulled at compile time. None of it
// exists on this side. Anyone tempted to "just handle the literal cases" should notice that
// `#if PP_SUM == 2` is DSH1040 or not depending on what `PP_SUM` was defined to, which is the same
// missing table wearing a hat.
//
// That is why the condition check calls `checkConditionSyntax` rather than `evaluateCondition`:
// same tokenizer, same grammar, same messages, but with the evaluator's type and value rules turned
// off, so the two value-dependent codes cannot be reached by accident. (`addConditionExpressionDiagnostics`
// drops them if they ever are.) Reading the table off the bridge manifest to enable them is a real
// option and a deliberately rejected one: a diagnostic that appears only when a generated JSON file
// happens to exist is a diagnostic nobody can reproduce.
//
// The absent table has a second consequence, and it is the one that decides how this pass behaves.
// The plugin checks only the branch it is emitting: a directive inside a branch that was cut is
// skipped entirely, exactly as in C. This pass cannot tell a cut branch from a live one, so it
// checks EVERY branch. The trade is deliberate and it runs in the direction that catches mistakes:
// a deliberately-dead branch holding a malformed directive is flagged here and green in the build,
// while the alternative -- staying silent everywhere, since any branch might be the dead one --
// would hide precisely the silent-rot failure `preprocessor.md` warns about. Chain shape (DSH1030
// through DSH1033) is not a trade at all: the plugin checks `#else` / `#endif` unconditionally too,
// because they belong to the chain and not to the branch they sit in.
// =============================================================================================

/**
 * Every `#` line in the file that the preprocessor would look at, in order, with its offsets.
 *
 * One scan for the whole `#` layer: the diagnostics pass and the branch-chain collector below both
 * read this list, so there is one line splitter, one directive classifier and one opaque-region
 * tracker between them rather than a copy each.
 *
 * OPAQUE REGIONS -- the `Function` / `GraphFunction` bodies the preprocessor does not descend into
 * -- come from `createOpaqueRegionTracker`, the character-level brace counter that mirrors the
 * plugin's `FOpaqueRegionTracker`, and NOT from the AST. Two reasons, and the second is the one
 * that matters in an editor. First, it is what the plugin actually does; reading block ranges off
 * the AST is a different approximation of it, and "close enough" between two brace counters is
 * exactly the drift this whole arrangement exists to prevent. Second, it still works on a file too
 * broken to parse -- and a half-typed file is precisely when an author needs the squiggles to be
 * right, since a parse failure would otherwise empty the range list and hand every HLSL `#if` in
 * the file to the DreamShader scanner.
 *
 * Why the regions exist at all: a Function body is raw HLSL and its `#` lines belong to HLSL's
 * preprocessor, with the shader compiler's defines in scope. Across this project's whole source
 * tree every HLSL `#` directive in a `.dsm` / `.dsf` / `.dsh` (nine files: six `#include` and three
 * `#if` chains, `MF_MoonToonTranslucencyShadow.dsf` among them) sits inside one. A pass that
 * descended would light all nine up red every day and teach authors that the squiggles are noise.
 */
function collectPreprocessorDirectives(text) {
    const source = String(text || "");
    if (source.indexOf("#") < 0) {
        return [];
    }

    const directives = [];
    const opaqueRegion = createOpaqueRegionTracker();
    const lines = splitSourceLines(source);
    let lineStart = 0;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].content;
        const nextLineOffset = lineStart + line.length + lines[index].terminator.length;

        // Asked BEFORE the line is scanned, so a `Function` declaration line is still ordinary
        // source and the body's closing `}` line is still the last opaque one.
        const opaque = opaqueRegion.isOpaque();
        const classified = opaque ? null : classifyDirectiveLine(line);

        // Advanced for every line, opaque or not: skipping it inside a region already open would
        // lose the brace that closes it.
        opaqueRegion.scanLine(line);

        if (classified && classified.hashIndex >= 0) {
            const startOffset = lineStart + classified.hashIndex;
            directives.push({
                kind: classified.kind,
                keyword: classified.keyword,
                lineNumber: index + 1,
                startOffset,
                // A bare `#` has no keyword to underline, so the range is the `#` itself rather than
                // the run of whitespace that followed it.
                endOffset: classified.keyword ? lineStart + classified.restIndex : startOffset + 1,
                rest: classified.rest,
                restOffset: lineStart + classified.restIndex,
                nextLineOffset
            });
        }

        lineStart = nextLineOffset;
    }

    return directives;
}

function addPreprocessorDiagnostics(diagnostics, directives) {
    const chain = [];
    for (const directive of directives) {
        processPreprocessorDirective(diagnostics, directive, chain);
    }

    if (chain.length > 0) {
        // Pointed at the innermost `#if` still open -- the one whose `#endif` the file ran out
        // before reaching. One diagnostic, not one per open block: the plugin raises exactly one,
        // and the count is what tells an author the others exist. The `'#if'` in the text is the
        // plugin's literal wording, kept even when the unclosed directive is spelled `#ifdef`.
        const innermost = chain[chain.length - 1];
        diagnostics.push(makeDiagnostic(
            innermost.startOffset,
            innermost.endOffset,
            `this '#if' is never closed; the file ends with ${chain.length} conditional block(s) still open.`,
            SEVERITY.Error,
            "DSH1030"));
    }
}

/**
 * The branch ranges of every `#if` chain outside a `Function` / `GraphFunction` body.
 *
 * BOTH arms of a `#if` are parsed and indexed on this side, because there is no define table to
 * choose between them. That is the right call for symbols -- an editor that hid the declaration
 * under the cursor because some switch it cannot see is off would be broken -- but it means the two
 * halves of the idiom `preprocessor.md` documents in full,
 *
 *     #if DS_SUBSTRATE
 *     Function ApplyShading(in float3 C, out float3 R) { R = SubstratePath(C); }
 *     #else
 *     Function ApplyShading(in float3 C, out float3 R) { R = LegacyPath(C); }
 *     #endif
 *
 * both reach the duplicate-declaration rules, which would then call the blessed way of picking
 * between two HLSL bodies an error in every conditional source.
 *
 * These ranges are what those rules consult instead. Nothing is evaluated: `#if` / `#elif` / `#else`
 * are alternatives BY CONSTRUCTION, so "these two can never both be emitted" is a property of the
 * chain's shape and is knowable without the table. What is not knowable -- which one wins -- is
 * never asked.
 */
function collectConditionalBranchChains(directives, sourceLength) {
    const chains = [];
    const open = [];

    for (const directive of directives) {
        // A branch starts on the line AFTER its directive and ends where the next one begins, so a
        // declaration on the directive line itself belongs to neither -- which cannot happen, since
        // a directive occupies its whole line.
        const nextLineStart = directive.nextLineOffset;
        const { kind } = directive;

        if (kind === DIRECTIVE_KIND.If || kind === DIRECTIVE_KIND.IfDef || kind === DIRECTIVE_KIND.IfNDef) {
            // The end runs to the end of the text until an `#elif` / `#else` / `#endif` closes it,
            // which is also the right answer for a chain the file never closes.
            const chain = { branches: [{ start: nextLineStart, end: sourceLength }] };
            chains.push(chain);
            open.push(chain);
            continue;
        }

        if (open.length === 0) {
            // A stray `#elif` / `#else` / `#endif`, or one of the two graph directives, or an
            // unknown one. DSH1031 / DSH1032 have already been said about the first kind; here it is
            // simply not a chain.
            continue;
        }

        if (kind === DIRECTIVE_KIND.Elif || kind === DIRECTIVE_KIND.Else) {
            const branches = open[open.length - 1].branches;
            branches[branches.length - 1].end = directive.startOffset;
            branches.push({ start: nextLineStart, end: sourceLength });
            continue;
        }

        if (kind === DIRECTIVE_KIND.Endif) {
            const branches = open[open.length - 1].branches;
            branches[branches.length - 1].end = directive.startOffset;
            open.pop();
        }
    }

    return chains;
}

/** True when two offsets sit in different branches of one chain, so only ever one of them is emitted. */
function areInExclusiveConditionalBranches(chains, offsetA, offsetB) {
    for (const chain of chains || []) {
        const first = chain.branches.findIndex((branch) => offsetA >= branch.start && offsetA < branch.end);
        if (first < 0) {
            continue;
        }
        const second = chain.branches.findIndex((branch) => offsetB >= branch.start && offsetB < branch.end);
        if (second >= 0 && first !== second) {
            return true;
        }
    }
    return false;
}

function processPreprocessorDirective(diagnostics, directive, chain) {
    const { kind, keyword } = directive;
    const spelling = `#${keyword}`;

    if (kind === DIRECTIVE_KIND.None) {
        // `#Region` / `#EndRegion`, in any case -- the classifier matches them case-insensitively
        // because the parser does. They belong to the parser, and their own pairing is checked by
        // addGraphRegionDirectiveDiagnostics, over the Graph body they are only legal in.
        return;
    }

    if (kind === DIRECTIVE_KIND.Unknown) {
        // The classifier matches the eight case-SENSITIVELY, so `#IF` lands here rather than acting
        // as `#if`. That is the point of the code: a swallowed `#endfi` leaves everything below it
        // unconditionally enabled, and a `#IF` that quietly does nothing is the same failure from
        // the other side.
        diagnostics.push(makeDiagnostic(
            directive.startOffset,
            directive.endOffset,
            `unknown preprocessor directive '#${keyword}'. ${suggestPreprocessorDirective(keyword)}`,
            SEVERITY.Error,
            "DSH1035"));
        return;
    }

    // Quote-aware, because `#if DS_HOST == "http://build"` compares against the whole URL. Done
    // once, before anything reads an operand, so a trailing comment can never land in one.
    const tail = stripTrailingLineComment(directive.rest);
    const tailOffset = directive.restOffset;

    if (kind === DIRECTIVE_KIND.If || kind === DIRECTIVE_KIND.IfDef || kind === DIRECTIVE_KIND.IfNDef) {
        if (chain.length === MAX_CONDITIONAL_DEPTH) {
            // Exactly at the limit, so the 65th `#if` reports and the 66th does not pile on. The
            // frame is still pushed below: dropping it would turn the matching `#endif` into a
            // stray DSH1031 and cascade a depth complaint into a shape complaint.
            diagnostics.push(makeDiagnostic(
                directive.startOffset,
                directive.endOffset,
                `'${spelling}' nesting is deeper than the limit of ${MAX_CONDITIONAL_DEPTH}.`,
                SEVERITY.Error,
                "DSH1037"));
        }

        if (kind === DIRECTIVE_KIND.If) {
            addConditionExpressionDiagnostics(diagnostics, tail, tailOffset, spelling, directive);
        } else {
            // `#ifdef NAME` is `#if defined(NAME)` and `#ifndef NAME` its negation. Nothing at all
            // is a MISSING operand, the same failure as a bare `#if`; something unusable is an
            // invalid NAME. Different mistakes, different codes -- and the surplus-token case is
            // DSH1042 because the desugared `#if defined(A) B` would say so.
            const operand = splitOperand(tail, tailOffset);
            if (!operand.name) {
                diagnostics.push(makeDiagnostic(
                    directive.startOffset,
                    directive.endOffset,
                    `'${spelling}' requires a define name.`,
                    SEVERITY.Error,
                    "DSH1036"));
            } else if (!isValidDefineName(operand.name)) {
                diagnostics.push(makeDiagnostic(
                    operand.nameOffset,
                    operand.nameEndOffset,
                    `'${spelling}' needs a name made of letters, digits and underscores and not starting with a digit; got '${operand.name}'.`,
                    SEVERITY.Error,
                    "DSH1038"));
            } else if (operand.value) {
                // Reading a reserved name is fine, which is why `#ifdef DS_SUBSTRATE` never reaches
                // the DSH1039 check -- only defining or undefining one does.
                addTrailingTokenDiagnostic(diagnostics, spelling, operand.value, operand.valueOffset);
            }
        }

        chain.push({
            keyword,
            startOffset: directive.startOffset,
            endOffset: directive.endOffset,
            elseLine: 0
        });
        return;
    }

    if (kind === DIRECTIVE_KIND.Elif || kind === DIRECTIVE_KIND.Else) {
        if (chain.length === 0) {
            diagnostics.push(makeDiagnostic(
                directive.startOffset,
                directive.endOffset,
                `'${spelling}' without a matching '#if'.`,
                SEVERITY.Error,
                "DSH1032"));
            return;
        }

        const frame = chain[chain.length - 1];
        if (frame.elseLine) {
            diagnostics.push(makeDiagnostic(
                directive.startOffset,
                directive.endOffset,
                `'${spelling}' after the '#else' on line ${frame.elseLine}, which already closed this chain.`,
                SEVERITY.Error,
                "DSH1033"));
            return;
        }

        if (kind === DIRECTIVE_KIND.Else) {
            // `#else` takes no operand at all, so anything left is trailing. The frame is marked
            // even when that check fired: a second `#else` below is still a second `#else`, and
            // swallowing DSH1033 because the first one had a stray token helps nobody.
            const remainder = tail.trim();
            if (remainder) {
                addTrailingTokenDiagnostic(diagnostics, spelling, remainder, tailOffset + tail.indexOf(remainder));
            }
            frame.elseLine = directive.lineNumber;
            return;
        }

        addConditionExpressionDiagnostics(diagnostics, tail, tailOffset, spelling, directive);
        return;
    }

    if (kind === DIRECTIVE_KIND.Endif) {
        if (chain.length === 0) {
            diagnostics.push(makeDiagnostic(
                directive.startOffset,
                directive.endOffset,
                "'#endif' without a matching '#if'.",
                SEVERITY.Error,
                "DSH1031"));
            return;
        }

        // `#endif MOONTOON_LEGACY` is C's habit of labelling a long chain, and it is not spelled
        // that way here -- `// MOONTOON_LEGACY` is. Checked unconditionally, as `#else` is above and
        // for the same reason: both belong to the chain, not to the branch they sit in.
        const remainder = tail.trim();
        if (remainder) {
            addTrailingTokenDiagnostic(diagnostics, spelling, remainder, tailOffset + tail.indexOf(remainder));
        }
        chain.pop();
        return;
    }

    // `#define` / `#undef`.
    const operand = splitOperand(tail, tailOffset);
    if (!isValidDefineName(operand.name)) {
        // A missing name reports here too, `got ''` and all: unlike `#ifdef`, `#define` has no
        // operand-less form for DSH1036 to be confused with, so one code covers both.
        diagnostics.push(makeDiagnostic(
            operand.name ? operand.nameOffset : directive.startOffset,
            operand.name ? operand.nameEndOffset : directive.endOffset,
            `'${spelling}' needs a name made of letters, digits and underscores and not starting with a digit; got '${operand.name}'.`,
            SEVERITY.Error,
            "DSH1038"));
        return;
    }

    if (isReservedDefineName(operand.name)) {
        diagnostics.push(makeDiagnostic(
            operand.nameOffset,
            operand.nameEndOffset,
            `'${operand.name}' is a read-only built-in constant, so '${spelling}' cannot change it. The 'DS_' prefix is reserved by DreamShader.`,
            SEVERITY.Error,
            "DSH1039"));
        return;
    }

    // `#define` is the one directive with no trailing check at all: its value runs to the end of the
    // line, so `#define A B C` is legal with the value `B C`. `#undef A B` has no such excuse.
    if (kind === DIRECTIVE_KIND.Undef && operand.value) {
        addTrailingTokenDiagnostic(diagnostics, spelling, operand.value, operand.valueOffset);
    }
}

/**
 * DSH1042: the operand parsed completely and there are still tokens after it.
 *
 * One raise site for every directive, because `#if 1 2`, `#ifdef A B`, `#undef A B` and
 * `#endif junk` are one mistake with one fix -- delete it, or comment it out -- and the plugin
 * makes the same call for the same reason: `#ifdef A B` desugars to `#if defined(A) B`, so any rule
 * that gave the sugar and the desugared form different codes would be incoherent.
 */
function addTrailingTokenDiagnostic(diagnostics, spelling, remainder, remainderOffset) {
    const first = splitOperand(remainder, remainderOffset);
    diagnostics.push(makeDiagnostic(
        first.nameOffset,
        first.nameEndOffset,
        `'${spelling}' is already complete before '${first.name}'. Nothing may follow a directive but a '//' comment.`,
        SEVERITY.Error,
        "DSH1042"));
}

/**
 * `splitNameAndValue` with its offsets rebased onto the document.
 *
 * The split itself -- name is the first whitespace-delimited token, taken WHOLE and validated
 * afterwards, value is everything after it -- belongs to the mirror; the only thing this side adds
 * is the base offset, because a diagnostic underlines a range in a file and the mirror answers in
 * indices into the tail it was handed.
 */
function splitOperand(text, offset) {
    const split = splitNameAndValue(text);
    return {
        name: split.name,
        nameOffset: offset + split.nameOffset,
        nameEndOffset: offset + split.nameEndOffset,
        value: split.value,
        valueOffset: offset + split.valueOffset
    };
}

/**
 * The advice half of DSH1035.
 *
 * One phrasing cannot serve both of the mistakes that reach it. `#include` is someone reaching for
 * the HLSL they know, and the answer is a different construct entirely; `#endfi` and `#IF` are
 * someone reaching for the right directive and missing, and the answer is a spelling.
 */
function suggestPreprocessorDirective(keyword) {
    const lowered = String(keyword || "").toLowerCase();

    if (lowered === "include") {
        return "'#include' is HLSL: it is recognized inside a Function body and nowhere else. At the declaration level, use import \"...\" instead.";
    }

    // Candidates are everything legal on a `#` line: the eight this pass acts on, plus the two it
    // leaves to the parser. A typo for `#endregion` deserves the same help as one for `#endif`.
    // Order is load-bearing -- ties go to the first candidate at a given distance -- and the mirror
    // declares `DIRECTIVE_KEYWORDS` in the order the language documents, which is the order the
    // list here always had.
    let nearest = "";
    let nearestDistance = Infinity;
    for (const candidate of [...Object.keys(DIRECTIVE_KEYWORDS), ...GRAPH_DIRECTIVE_KEYWORDS]) {
        // Scaled, not fixed: two edits from `endif` is still recognizably `endif`, while two edits
        // from `if` is any two-letter word at all, and suggesting it would be noise.
        const maxDistance = candidate.length <= 3 ? 1 : 2;
        const distance = computeEditDistance(lowered, candidate);
        if (distance <= maxDistance && distance < nearestDistance) {
            nearest = candidate;
            nearestDistance = distance;
        }
    }

    if (!nearest) {
        return "A '#' line must be #if, #ifdef, #ifndef, #elif, #else, #endif, #define or #undef, or one of the parser's #Region / #EndRegion.";
    }

    // Distance zero means the spelling was right and only the case was wrong. That IS the
    // diagnosis, and worth saying outright rather than dressing up as a "did you mean".
    return nearestDistance === 0
        ? `Preprocessor directives are lowercase: write '#${nearest}'.`
        : `Did you mean '#${nearest}'?`;
}

/** Levenshtein, on strings short enough that the obvious two-row table is the whole story. */
function computeEditDistance(left, right) {
    let previous = [];
    for (let column = 0; column <= right.length; column += 1) {
        previous.push(column);
    }

    for (let row = 1; row <= left.length; row += 1) {
        const current = [row];
        for (let column = 1; column <= right.length; column += 1) {
            const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
            current.push(Math.min(substitution, previous[column] + 1, current[column - 1] + 1));
        }
        previous = current;
    }

    return previous[right.length];
}

/**
 * `#if` / `#elif` conditions: tokenized, parsed for SHAPE, never evaluated.
 *
 * The two codes split on one mechanical question -- did the expression finish? -- with no judgement
 * involved. Everything the parse itself refuses is DSH1034: the expression is incomplete or
 * malformed and there is nothing to evaluate (`(1`, `1 &&`, `&&1`, `1 &&)`). Reaching the leftover
 * check means the opposite: a whole, well-formed expression was consumed and something is still
 * sitting after it (`1 2`, `1)`, `(1))`), which is not a broken expression but a finished directive
 * with extra text -- the same mistake, with the same fix, as `#ifdef A B` or `#endif junk`.
 */
function addConditionExpressionDiagnostics(diagnostics, expressionText, expressionOffset, spelling, directive) {
    const result = checkConditionSyntax(expressionText);
    if (result.ok) {
        return;
    }

    const { code, message, startOffset, endOffset } = result.error;

    if (code === "DSH1040" || code === "DSH1041") {
        // The two value-dependent codes -- see the section header. `checkConditionSyntax` parses
        // without evaluating, so DSH1041 is unreachable and DSH1040 survives only for a condition
        // that is nothing but a string literal (`#if "x"`), which needs the table to judge exactly
        // as `#if DS_PLATFORM` does. Both are dropped here rather than half-answered.
        return;
    }

    if (code === "DSH1036") {
        // A missing condition has no token to underline -- there are none -- so the directive
        // itself is the range.
        diagnostics.push(makeDiagnostic(
            directive.startOffset,
            directive.endOffset,
            `'${spelling}' requires a condition expression.`,
            SEVERITY.Error,
            "DSH1036"));
        return;
    }

    if (code === "DSH1042") {
        // A finished expression with something after it. The surplus token always has a real span
        // (it is a token the parse stopped in front of, never the End sentinel), so it is read back
        // out of the condition text rather than scraped off the mirror's own wording.
        diagnostics.push(makeDiagnostic(
            expressionOffset + startOffset,
            expressionOffset + endOffset,
            `'${spelling}' is already complete before '${expressionText.slice(startOffset, endOffset)}'. `
            + "Nothing may follow a directive but a '//' comment.",
            SEVERITY.Error,
            "DSH1042"));
        return;
    }

    // DSH1034. An error AT the end of the condition has nothing to underline, so it falls back to
    // the directive keyword rather than rendering as a caret against empty space.
    const empty = startOffset >= endOffset;
    diagnostics.push(makeDiagnostic(
        empty ? directive.startOffset : expressionOffset + startOffset,
        empty ? directive.endOffset : expressionOffset + endOffset,
        `invalid '${spelling}' condition: ${message}`,
        SEVERITY.Error,
        code));
}

function addGraphStatementDiagnostics(diagnostics, bodyText, baseOffset, symbols, reachableCallables, substrateBuiltinNames) {
    for (const statement of parseCodeStatements(bodyText, baseOffset)) {
        processGraphStatement(diagnostics, statement, symbols, reachableCallables, substrateBuiltinNames);
    }
}

function processGraphStatement(diagnostics, statement, symbols, reachableCallables, substrateBuiltinNames) {
    {
        if (!statement.terminated && statement.text.trim() && !isIncompleteGraphStatementText(statement.text)) {
            diagnostics.push(makeDiagnostic(statement.endOffset, statement.endOffset, "Graph statement is missing a trailing ';'.", SEVERITY.Error));
        }

        if (statement.kind === "control") {
            // `if`/`for`/`while` blocks: validate the condition (for `for`, the condition clause is
            // raw HLSL, so skip it) and recurse into the branch bodies, sharing the symbol map so
            // branch-local declarations resolve. The block itself needs no trailing ';'.
            if (statement.controlKeyword !== "for" && statement.conditionText && statement.conditionText.trim()) {
                addExpressionDiagnostics(diagnostics, statement.conditionText, statement.conditionOffset, symbols, reachableCallables, substrateBuiltinNames);
            }
            for (const child of statement.children || []) {
                processGraphStatement(diagnostics, child, symbols, reachableCallables, substrateBuiltinNames);
            }
            return;
        }

        if (statement.kind === "declarations") {
            for (const declaration of statement.declarations || []) {
                const typeInfo = resolveTypeInfo(declaration.type);
                if (!typeInfo) {
                    diagnostics.push(makeDiagnostic(declaration.startOffset, declaration.startOffset + String(declaration.type || "").length, `Unsupported Graph variable type '${declaration.type}' for '${declaration.name}'.`, SEVERITY.Warning));
                    continue;
                }
                if (declaration.valueText) {
                    addExpressionDiagnostics(diagnostics, declaration.valueText, declaration.valueOffset, symbols, reachableCallables, substrateBuiltinNames);
                }
                symbols.set(normalizeSymbolKey(declaration.name), {
                    name: declaration.name,
                    type: declaration.type,
                    detail: `${declaration.type} local variable`,
                    typeInfo
                });
            }
            return;
        }

        if (statement.kind === "assignment") {
            addExpressionDiagnostics(diagnostics, statement.valueText, statement.valueOffset, symbols, reachableCallables, substrateBuiltinNames);
            validateAssignmentTarget(diagnostics, statement, symbols);
            return;
        }

        if (statement.kind === "return") {
            if (statement.valueText && statement.valueText.trim()) {
                addExpressionDiagnostics(diagnostics, statement.valueText, statement.valueOffset, symbols, reachableCallables, substrateBuiltinNames);
            }
            return;
        }

        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (callExpression) {
            validateCallableArguments(diagnostics, callExpression, symbols, reachableCallables, substrateBuiltinNames, true);
            return;
        }

        addExpressionDiagnostics(diagnostics, statement.text, statement.startOffset, symbols, reachableCallables, substrateBuiltinNames);
    }
}

function isIncompleteGraphStatementText(text) {
    const clean = stripCommentsPreserveLayout(text).trim();
    return /\b(?:UE|Substrate)\s*\.\s*[A-Za-z0-9_]*$/i.test(clean);
}

function validateAssignmentTarget(diagnostics, statement, symbols) {
    const target = String(statement.target || "").trim();
    const memberMatch = new RegExp(`^(${IDENTIFIER_PATTERN})\\s*\\.\\s*(${IDENTIFIER_PATTERN})$`, "u").exec(target);
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
    if (!existing && isValidIdentifier(target)) {
        symbols.set(normalizeSymbolKey(target), { name: target, typeInfo: null });
    }
}

function addExpressionDiagnostics(diagnostics, text, baseOffset, symbols, reachableCallables, substrateBuiltinNames) {
    const clean = stripCommentsPreserveLayout(text);
    const known = new Set([...symbols.keys(), "ue", "substrate", "true", "false", "default"]);
    for (const symbol of symbols.values()) {
        if (symbol?.typeInfo?.isTexture) {
            known.add(normalizeSymbolKey(`${symbol.name}Sampler`));
        }
    }
    for (const [key] of mapEntries(reachableCallables)) {
        known.add(normalizeSymbolKey(String(key).split("::").pop()));
        known.add(normalizeSymbolKey(key));
    }

    const callPattern = new RegExp(`(?<![_\\p{L}\\p{N}])(${QUALIFIED_IDENTIFIER_PATTERN})\\s*\\(`, "gu");
    for (const match of clean.matchAll(callPattern)) {
        const callExpression = parseCallExpressionText(clean.slice(match.index), baseOffset + match.index);
        if (callExpression) {
            validateCallableArguments(diagnostics, callExpression, symbols, reachableCallables, substrateBuiltinNames, false);
        }
    }

    const ignoredRanges = collectIgnoredIdentifierRanges(clean);

    const memberPattern = new RegExp(`(?<![_\\p{L}\\p{N}])(${IDENTIFIER_PATTERN})\\s*\\.\\s*(${IDENTIFIER_PATTERN})`, "gu");
    for (const match of clean.matchAll(memberPattern)) {
        const base = normalizeSymbolKey(match[1]);
        const member = normalizeSymbolKey(match[2]);
        if (base === "ue" || base === "base") {
            continue;
        }
        if (base === "substrate") {
            const memberEndOffset = baseOffset + match.index + match[0].length;
            if (memberEndOffset >= baseOffset + clean.length && !/[;,) \t\r\n]/.test(clean[memberEndOffset - baseOffset] || "")) {
                continue;
            }
            if (!substrateBuiltinNames.has(member)) {
                diagnostics.push(makeDiagnostic(
                    baseOffset + match.index,
                    baseOffset + match.index + match[0].length,
                    `Unknown Substrate builtin '${match[2]}'.`,
                    SEVERITY.Warning));
            }
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

    const identifierPattern = new RegExp(`(?<![_\\p{L}\\p{N}])(${IDENTIFIER_PATTERN})(?![_\\p{L}\\p{N}])`, "gu");
    for (const match of clean.matchAll(identifierPattern)) {
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

function validateCallableArguments(diagnostics, callExpression, symbols, reachableCallables, substrateBuiltinNames, standalone) {
    if (!callExpression || isHlslKnownName(normalizeSymbolKey(callExpression.callee)) || normalizeSymbolKey(callExpression.callee).startsWith("ue.") || isKnownSubstrateBuiltinCall(callExpression.callee, substrateBuiltinNames) || isTypeName(callExpression.callee) || normalizeSymbolKey(callExpression.callee) === "path") {
        for (let index = 0; index < (callExpression?.arguments || []).length; index += 1) {
            const arg = callExpression.arguments[index];
            if (arg.isNamed) {
                if (shouldValidateNamedArgumentValue(callExpression.callee, arg.name, arg.valueText)) {
                    addExpressionDiagnostics(diagnostics, arg.valueText, arg.valueOffset, symbols, reachableCallables, substrateBuiltinNames);
                }
                continue;
            }
            if (shouldSkipPositionalArgumentValue(callExpression.callee, arg.valueText, index)) {
                continue;
            }
            addExpressionDiagnostics(diagnostics, arg.valueText, arg.valueOffset, symbols, reachableCallables, substrateBuiltinNames);
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
    const valueArguments = !standalone && isMaterialFunctionCallableKind(signature.kind)
        ? callExpression.arguments.filter((arg) => !isOutputSelectorArgument(arg))
        : callExpression.arguments;
    const expected = standalone ? inputs.length + outputs.length : inputs.length;
    const minExpected = standalone ? minInputs + outputs.length : minInputs;
    const received = valueArguments.length;
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
    const inputArguments = standalone ? callExpression.arguments : valueArguments;
    for (let index = 0; index < inputArgumentCount; index += 1) {
        const arg = inputArguments[index];
        if (arg && !isDefaultArgumentText(arg.valueText)) {
            addExpressionDiagnostics(diagnostics, arg.valueText, arg.valueOffset, symbols, reachableCallables, substrateBuiltinNames);
        }
    }

    if (!standalone) {
        return;
    }

    for (let index = 0; index < outputs.length; index += 1) {
        const arg = callExpression.arguments[inputArgumentCount + index];
        const expectedOutput = outputs[index];
        if (!arg || arg.isNamed || !isValidIdentifier(arg.valueText)) {
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

function isKnownSubstrateBuiltinCall(callee, substrateBuiltinNames) {
    const key = normalizeSymbolKey(callee);
    return key.startsWith("substrate.") && substrateBuiltinNames.has(key.slice("substrate.".length));
}

function getSubstrateBuiltinNameSet(services) {
    const serviceItems = callService(services, "getSubstrateBuiltinItems", null);
    const items = Array.isArray(serviceItems) && serviceItems.length ? serviceItems : SUBSTRATE_BUILTIN_ITEMS;
    return new Set(items
        .map((item) => normalizeSymbolKey(item?.name))
        .filter(Boolean));
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

function isMaterialFunctionCallableKind(kind) {
    return kind === "ShaderFunction"
        || kind === "ShaderLayer"
        || kind === "ShaderLayerBlend"
        || kind === "VirtualFunction";
}

function isOutputSelectorArgument(argument) {
    if (!argument || !argument.isNamed) {
        return false;
    }

    const key = normalizeSymbolKey(argument.name);
    return key === "output" || key === "outputname" || key === "outputindex";
}

function isHlslKnownName(key) {
    return [
        "if", "else", "for", "while", "do", "switch", "case", "return", "break", "continue",
        "const", "static", "struct"
    ].includes(key) || isFunctionBuiltinName(key);
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
            if (!isValidIdentifier(text.slice(left.start, left.end))) {
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
    const callPattern = new RegExp(`(?<![_\\p{L}\\p{N}])(${QUALIFIED_IDENTIFIER_PATTERN})\\s*\\(`, "gu");
    for (const match of text.matchAll(callPattern)) {
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
    if ((calleeKey.startsWith("ue.") || calleeKey.startsWith("substrate.")) && [
        "class",
        "outputtype",
        "resulttype",
        "output",
        "outputname",
        "source",
        "destination",
        "parameter",
        "parametername",
        "samplertype",
        "samplersource",
        "mipvaluemode",
        "gathermode",
        "description",
        "desc",
        "group",
        "category"
    ].includes(nameKey)) {
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
        return ["Properties", "Settings", "Outputs", "Graph", "Layout"];
    }
    if (kind === "ShaderFunction" || kind === "ShaderLayer" || kind === "ShaderLayerBlend") {
        return ["Properties", "Inputs", "Outputs", "Results", "Graph", "Settings", "Layout"];
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

/**
 * `code` is the compiler's DSHnnnn, on the sites that report the same rule it does.
 *
 * From `DreamShaderDiagnostic.h`: "The code is the identity. Tests, the diagnose skill, the corpus
 * expectations and the editor extensions all key off it, so it must not change once published --
 * which is precisely what frees the message text to be reworded." So a code is only attached where
 * this reports the *same rule*, not merely something that reads alike; a wrong code is worse than
 * none, because it is the half that is promised to be stable.
 *
 * Most diagnostics here have no code, and that is the expected state rather than a gap. Some are
 * this extension's own (nothing in the compiler corresponds), and the compiler's own migration is
 * partway through -- four of its nine ranges are tagged so far.
 */
function makeDiagnostic(startOffset, endOffset, message, severity = SEVERITY.Error, code = "") {
    const diagnostic = {
        startOffset: Math.max(0, startOffset || 0),
        endOffset: Math.max(Math.max(0, startOffset || 0), endOffset || startOffset || 0),
        message,
        severity
    };
    if (code) {
        diagnostic.code = code;
    }
    return diagnostic;
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
