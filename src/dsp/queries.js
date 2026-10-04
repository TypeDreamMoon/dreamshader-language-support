"use strict";

// Questions about a `.dsp`, answered from three sources, in this order of authority:
//
//   * the compiler's symbol index of the file (its `pipeline` section and its declarations), for what a name means and
//     where it is declared -- trusted only where a span still matches the text, since the index is as old as the last
//     compile;
//   * pass-keys.json, for the vocabulary: keys, kinds of values, injection points, formats, pass kinds;
//   * the text itself (scanner.js), for where the caret is -- which pass, which `hlsl` block, which statement -- and as
//     the fallback when the index is missing or stale.
//
// Everything here is a pure function of a context built by `createContext` and an offset into its text, so the smoke
// tests ask the same questions the editor does. Offsets in, offsets out; the providers turn them into positions.
// Nothing here may throw on a span the index got wrong: a span outside the text is a span that does not match.

const { wordAt, spanMatches } = require("../dss/queries");
const passKeys = require("./passKeys");
const { DECLARATIONS, DIRECTIVES, BUFFER_MEMBERS, BODY_NAMES, FIXED_NAMES } = require("./languageData");

const DECLARED_KINDS = new Set(["uniform", "constant", "buffer", "pass"]);

// ------------------------------------------------------------------------------------------------- the context

function computeLineStarts(text) {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === "\r") {
            if (text[index + 1] === "\n") {
                index += 1;
            }
            starts.push(index + 1);
        } else if (char === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}

/**
 * `scan` is `scanPipeline(text)`; `keys` normalized pass-keys (or null); `index` a normalized symbol index of a known
 * version (or null). `keysSource` says where `keys` came from: `project`, `bundled` or `none`.
 */
function createContext(text, scan, keys, index, keysSource = "project") {
    const source = String(text || "");
    return {
        text: source,
        scan,
        keys: keys || null,
        keysSource,
        index: index || null,
        lineStarts: computeLineStarts(source),
        lines: source.split(/\r\n|\r|\n/)
    };
}

/** The offset a 1-based index span starts at, or -1 when the text has no such line or column. */
function spanOffset(context, span) {
    if (!span) {
        return -1;
    }
    const lineStart = context.lineStarts[span.line - 1];
    const lineText = context.lines[span.line - 1];
    if (lineStart === undefined || typeof lineText !== "string" || span.column < 1 || span.column - 1 > lineText.length) {
        return -1;
    }
    return lineStart + span.column - 1;
}

function lineAt(context, offset) {
    let low = 0;
    let high = context.lineStarts.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (context.lineStarts[middle] <= offset) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return { number: low, start: context.lineStarts[low], text: context.lines[low] || "" };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ------------------------------------------------------------------------------------------------ where am I?

/**
 * The place an offset is in: `comment`, `string`, `hlsl` (with its block, the pass that owns it and the function of the
 * file's block the caret is in), `pragma`, `buffer` (inside a buffer's argument list), `pass` (a pass body, outside its
 * block) or `top`.
 */
function locate(context, offset) {
    const { scan } = context;
    for (const comment of scan.comments) {
        if (comment.s < offset && (comment.block ? offset < comment.e : offset <= comment.e)) {
            return { kind: "comment", comment };
        }
    }
    for (const token of scan.tokens) {
        if (token.s >= offset) {
            break;
        }
        if (token.t === "str") {
            const closed = token.v.length > 1 && token.v.endsWith("\"");
            if (offset < token.e || (!closed && offset === token.e)) {
                return { kind: "string", token };
            }
        }
    }
    for (const block of scan.blocks) {
        if (block.open < offset && offset <= block.contentEnd) {
            const fn = block.functions.find((entry) => entry.bodyOpen < offset && (entry.bodyClose < 0 || offset <= entry.bodyClose)) || null;
            return { kind: "hlsl", block, pass: block.passIndex >= 0 ? scan.passes[block.passIndex] : null, fn };
        }
    }
    if (scan.pragma && scan.pragma.start <= offset && offset <= scan.pragma.end) {
        return { kind: "pragma" };
    }
    for (const buffer of scan.buffers) {
        if (buffer.argumentsOpen >= 0 && buffer.argumentsOpen < offset
            && (buffer.argumentsClose < 0 ? offset <= buffer.end : offset <= buffer.argumentsClose)) {
            return { kind: "buffer", buffer };
        }
    }
    for (const pass of scan.passes) {
        if (pass.bodyOpen >= 0 && pass.bodyOpen < offset && (pass.bodyClose < 0 || offset <= pass.bodyClose)) {
            return { kind: "pass", pass };
        }
    }
    return { kind: "top" };
}

/** The text of [from, to) with every comment blanked, so that a pattern can anchor on where a statement starts. */
function codeBetween(context, from, to) {
    let code = context.text.slice(from, to);
    for (const comment of context.scan.comments) {
        if (comment.e <= from || comment.s >= to) {
            continue;
        }
        const start = Math.max(comment.s, from) - from;
        const end = Math.min(comment.e, to) - from;
        code = code.slice(0, start) + " ".repeat(end - start) + code.slice(end);
    }
    return code;
}

/** What the statement the caret is in says up to the caret: the code after the last `;`, `{` or `}` above it. */
function statementBefore(context, floor, offset) {
    const code = codeBetween(context, floor, offset);
    let depth = 0;
    for (let index = code.length - 1; index >= 0; index -= 1) {
        const char = code[index];
        if (char === ")") {
            depth += 1;
        } else if (char === "(") {
            depth = Math.max(depth - 1, 0);
        } else if ((char === ";" || char === "{" || char === "}") && depth === 0) {
            return code.slice(index + 1).replace(/^\s+/, "");
        }
    }
    return code.replace(/^\s+/, "");
}

/** The argument of a `(...)` list the caret is in: the code after the last top-level `,`. */
function argumentBefore(context, open, offset) {
    const code = codeBetween(context, open + 1, offset);
    let depth = 0;
    for (let index = code.length - 1; index >= 0; index -= 1) {
        const char = code[index];
        if (char === ")") {
            depth += 1;
        } else if (char === "(") {
            depth = Math.max(depth - 1, 0);
        } else if (char === "," && depth === 0) {
            return code.slice(index + 1).replace(/^\s+/, "");
        }
    }
    return code.replace(/^\s+/, "");
}

function statementAt(pass, offset) {
    return pass.statements.find((statement) => statement.start <= offset && offset <= statement.end) || null;
}

// ------------------------------------------------------------------------------------------- what the file has

/** The `Key = ...;` statement of a pass, or null. */
function keyStatement(pass, name) {
    return pass.statements.find((entry) => entry.type === "key" && entry.name === name) || null;
}

function valueText(context, statement) {
    return statement ? context.text.slice(statement.valueStart, statement.valueEnd).trim() : "";
}

/** The names `Entry =` gives across the file: they are entries, so they are not shared code. */
function entryNames(context) {
    const names = new Set();
    for (const pass of context.scan.passes) {
        const entry = keyStatement(pass, "Entry");
        if (entry) {
            names.add(valueText(context, entry).replace(/^"|"$/g, ""));
        }
    }
    return names;
}

function passesNamingEntry(context, functionName) {
    return context.scan.passes.filter((pass) => {
        const entry = keyStatement(pass, "Entry");
        return Boolean(entry) && valueText(context, entry).replace(/^"|"$/g, "") === functionName;
    });
}

/** Whether a pass runs HLSL (a compute pass, or a fullscreen pass without a Material). */
function runsHlsl(pass) {
    return pass.kind === "compute" || (pass.kind === "fullscreen" && !keyStatement(pass, "Material"));
}

/**
 * The names a pass's bindings make for its HLSL, in binding order: `X`, `XSize`, `XUVRect` for the i-th `read`, `Y`,
 * `YSize` for the j-th `write`, `P` for a `param` (Docs/runtime/hlsl.md, "Names a pass makes").
 */
function bindingNames(pass) {
    const names = [];
    let reads = 0;
    let writes = 0;
    for (const statement of pass.statements) {
        if (statement.type === "read") {
            const slot = reads;
            reads += 1;
            names.push({ name: statement.name, statement, role: "texture", slot });
            names.push({ name: `${statement.name}Size`, statement, role: "size", slot });
            names.push({ name: `${statement.name}UVRect`, statement, role: "uvrect", slot });
        } else if (statement.type === "write") {
            const slot = writes;
            writes += 1;
            names.push({ name: statement.name, statement, role: "texture", slot });
            names.push({ name: `${statement.name}Size`, statement, role: "size", slot });
        } else if (statement.type === "param") {
            names.push({ name: statement.name, statement, role: "param", slot: -1 });
        }
    }
    return names;
}

/** The passes whose names an `hlsl` place can see: its own pass, or -- in an entry of the file's block -- the passes naming it. */
function passesSeenFrom(context, where) {
    if (where.pass) {
        return [where.pass];
    }
    return where.fn ? passesNamingEntry(context, where.fn.name) : [];
}

/** A name the file declares -- `{ kind, entry }` with the scanner's entry -- or null. */
function findDeclared(context, name) {
    const { scan } = context;
    const lists = [["buffer", scan.buffers], ["uniform", scan.uniforms], ["constant", scan.constants], ["pass", scan.passes]];
    for (const [kind, list] of lists) {
        const entry = list.find((candidate) => candidate.name === name);
        if (entry) {
            return { kind, entry };
        }
    }
    return null;
}

// ------------------------------------------------------------------------------------------------- completion

function item(label, kind, detail, documentation, insertText, extra = {}) {
    return { label, kind, detail: detail || "", documentation: documentation || "", insertText: insertText || "", snippet: Boolean(insertText && /\$\{?\d|\$0/.test(insertText)), ...extra };
}

function bundledNote(context) {
    return context.keysSource === "bundled"
        ? "\n\n*From the vocabulary bundled with the extension: this project has no `Saved/DreamShader/Bridge/pass-keys.json` yet. Opening the project in the Unreal editor writes it, with the project's own pass layers.*"
        : "";
}

function keyItems(context, place, used = new Set()) {
    const placeLabel = place.scope === "pipeline" ? "#pragma pipeline" : place.scope === "buffer" ? "buffer" : `${place.kind || "pass"} pass`;
    return passKeys.keysFor(context.keys, place)
        .filter((key) => !used.has(key.name))
        .map((key) => item(key.name, "property", key.required ? `${placeLabel} · required` : `${placeLabel}${key.default ? ` · default ${key.default}` : ""}`,
            passKeys.describeKey(context.keys, key, placeLabel) + bundledNote(context),
            place.scope === "pass" ? `${key.name} = $0;` : `${key.name} = $0`));
}

function bufferItems(context, { builtins = true, formatFirst = "" } = {}) {
    const items = context.scan.buffers.map((buffer) => item(buffer.name, "variable", `buffer : ${buffer.format}`, buffer.doc, "", {
        sortText: `${buffer.format === formatFirst ? "0" : "1"}${buffer.name}`
    }));
    if (builtins && context.keys) {
        for (const name of context.keys.builtinBuffers) {
            items.push(item(name, "variable", "built-in buffer", "", "", { sortText: `2${name}` }));
        }
    }
    return items;
}

function parameterItems(context) {
    const items = [];
    for (const uniform of context.scan.uniforms) {
        items.push(item(uniform.name, "variable", `uniform ${uniform.type}`, uniform.doc));
    }
    for (const constant of context.scan.constants) {
        items.push(item(constant.name, "constant", `static const ${constant.type}`, constant.doc));
    }
    if (context.keys && context.keys.weightParameter) {
        items.push(item(context.keys.weightParameter, "variable", "float", "The pipeline's weight in the view: a volume's blend weight, 1 for a global pipeline."));
    }
    return items;
}

function entryItems(context, pass) {
    const block = context.scan.hlsl;
    if (!block) {
        return [];
    }
    return block.functions.map((fn) => item(fn.name, "function", fn.numthreads ? "entry · [numthreads]" : "function of the file's hlsl block",
        `\`\`\`hlsl\n${context.text.slice(fn.start, fn.signatureEnd).replace(/\s+/g, " ")}\n\`\`\``, "", {
            // A compute pass runs a function with [numthreads]; offer those first.
            sortText: `${pass && pass.kind === "compute" && !fn.numthreads ? "1" : "0"}${fn.name}`
        }));
}

function valueItems(context, key, pass) {
    const { keys } = context;
    switch (key.value) {
        case "injection":
            return keys.injectionPoints.map((point) => item(point.name, "enum", `#${point.order} · ${point.resolution}${point.postProcess ? " · post-process" : ""}`,
                passKeys.describeInjectionPoint(point), "", { sortText: String(point.order).padStart(3, "0") }));
        case "filter":
            return keys.filterKinds.map((filter) => item(filter.name, "function", "filter", filter.detail, filter.snippet || `${filter.name}($0)`));
        case "boolParameter":
            return context.scan.uniforms.filter((uniform) => uniform.type === "bool")
                .map((uniform) => item(uniform.name, "variable", "uniform bool", uniform.doc))
                .concat([item("true", "keyword"), item("false", "keyword")]);
        case "bool":
            return [item("true", "keyword"), item("false", "keyword")];
        case "dispatch":
            return bufferItems(context, { builtins: false }).concat([item("uint3", "snippet", "uint3(x, y, z) groups", "", "uint3(${1:1}, ${2:1}, ${3:1})")]);
        case "identifier":
            return entryItems(context, pass);
        case "clear":
            return [item("None", "enum", "not cleared", "A read before every write is then an error."), item("float4", "snippet", "float4(...)", "", "float4(${1:0}, ${2:0}, ${3:0}, ${4:0})")];
        case "float4":
            return [item("float4", "snippet", "float4(...)", "", "float4(${1:1}, ${2:0}, ${3:0}, ${4:0})")];
        case "uint3":
            return [item("uint3", "snippet", "uint3(...)", "", "uint3(${1:8}, ${2:8}, ${3:1})")];
        case "int2":
            return [item("int2", "snippet", "int2(w, h)", "", "int2(${1:256}, ${2:256})")];
        default:
            return passKeys.listFor(keys, key.value).map((value) => item(value, "enum", key.name));
    }
}

/** The values of `Key = ` in a place, `valueText` being what is written after the `=` so far. */
function valueCompletions(context, place, keyName, valueTextSoFar, pass) {
    if (!context.keys) {
        return [];
    }
    const call = /([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*[^()]*$/.exec(valueTextSoFar);
    if (call) {
        if (call[1] === "Layer") {
            return context.keys.layerNames.map((name) => item(name, "enum", "pass layer", "A layer of Project Settings > DreamShader Custom Pass."));
        }
        if (call[1] === "Own") {
            return bufferItems(context, { builtins: false, formatFirst: "Depth32" });
        }
        return [];
    }
    const key = passKeys.findKey(context.keys, place, keyName);
    return key ? valueItems(context, key, pass) : [];
}

function hlslItems(context, where) {
    const items = [];
    const seen = new Set();
    const add = (entry) => {
        if (!seen.has(entry.label)) {
            seen.add(entry.label);
            items.push(entry);
        }
    };
    for (const pass of passesSeenFrom(context, where)) {
        for (const binding of bindingNames(pass)) {
            add(item(binding.name, binding.role === "param" ? "constant" : "variable", describeBindingShort(binding), describeBinding(context, pass, binding)));
        }
        if (where.pass && where.block.form === "statements") {
            for (const name of BODY_NAMES[pass.kind] || []) {
                add(item(name.name, "variable", name.type, name.doc));
            }
        }
    }
    const entries = entryNames(context);
    for (const block of [context.scan.hlsl, where.block]) {
        for (const fn of block ? block.functions : []) {
            // Nothing calls an entry: it is not in the slot of any other pass.
            if (block === context.scan.hlsl && entries.has(fn.name)) {
                continue;
            }
            add(item(fn.name, "function", block === context.scan.hlsl ? "shared code" : "function", `\`\`\`hlsl\n${context.text.slice(fn.start, fn.signatureEnd).replace(/\s+/g, " ")}\n\`\`\``));
        }
    }
    for (const name of FIXED_NAMES) {
        add(item(name.name, name.kind, name.signature || name.type, name.doc));
    }
    return items;
}

/**
 * Completion at an offset, as plain items: `{ label, kind, detail, documentation, insertText, snippet, sortText? }`.
 * `kind` is one of keyword, property, enum, variable, constant, function, snippet, type, class.
 */
function completionsAt(context, offset) {
    const where = locate(context, offset);
    const line = lineAt(context, offset);
    const linePrefix = line.text.slice(0, offset - line.start);

    if (where.kind === "comment") {
        if (where.comment.doc && /@[A-Za-z]*$/.test(linePrefix)) {
            return DIRECTIVES.map((directive) => item(directive.name, "keyword", directive.detail, directive.doc));
        }
        return [];
    }
    if (where.kind === "string") {
        return [];
    }
    if (where.kind === "hlsl") {
        return hlslItems(context, where);
    }

    if (where.kind === "pragma" || where.kind === "buffer") {
        const open = where.kind === "pragma" ? context.scan.pragma.argumentsOpen : where.buffer.argumentsOpen;
        if (open < 0 || offset <= open) {
            return [];
        }
        const place = { scope: where.kind === "pragma" ? "pipeline" : "buffer" };
        const argument = argumentBefore(context, open, offset);
        const value = /^([A-Z][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(argument);
        if (value) {
            return valueCompletions(context, place, value[1], value[2], null);
        }
        if (/^[A-Za-z_]*$/.test(argument)) {
            const written = codeBetween(context, open, where.kind === "pragma" ? context.scan.pragma.end : (where.buffer.argumentsClose < 0 ? where.buffer.end : where.buffer.argumentsClose));
            const used = new Set([...written.matchAll(/([A-Z][A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]));
            return keyItems(context, place, used);
        }
        return [];
    }

    if (where.kind === "pass") {
        const pass = where.pass;
        const before = statementBefore(context, pass.bodyOpen + 1, offset);
        let match = /^(read|write)\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_]*$/.exec(before);
        if (match) {
            return match[1] === "read" ? BUFFER_MEMBERS.map((member) => item(member.name, "property", "last frame's", member.doc)) : [];
        }
        if (/^(read|write)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*[A-Za-z_]*$/.test(before) || /^(read|write)\s+[A-Za-z_]*$/.test(before)) {
            return bufferItems(context);
        }
        if (/^param\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(before)) {
            return parameterItems(context);
        }
        if (/^param\b/.test(before)) {
            return [];
        }
        match = /^([A-Z][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(before);
        if (match) {
            return valueCompletions(context, { scope: "pass", kind: pass.kind }, match[1], match[2], pass);
        }
        if (/^[A-Za-z_]*$/.test(before)) {
            const used = new Set(pass.statements.filter((statement) => statement.type === "key" && !(statement.start <= offset && offset <= statement.end)).map((statement) => statement.name));
            const items = keyItems(context, { scope: "pass", kind: pass.kind }, used);
            const statements = context.keys ? context.keys.bindingStatements : [];
            const statementDoc = (name) => (statements.find((entry) => entry.name === name) || {}).detail || "";
            items.push(item("read", "keyword", "binding", statementDoc("read"), "read ${1:Name} = ${2:Buffer};"));
            items.push(item("write", "keyword", "binding", statementDoc("write"), "write ${1:Name} = ${2:Buffer};"));
            items.push(item("param", "keyword", "binding", statementDoc("param"), "param ${1:Name} = ${2:Value};"));
            if (!pass.hlsl && (pass.kind === "compute" || pass.kind === "fullscreen" || !pass.kind)) {
                items.push(item("hlsl", "keyword", "HLSL of the pass", "The pass's code: the statements of its entry, or whole functions.", "hlsl\n{\n\t$0\n}"));
            }
            return items;
        }
        return [];
    }

    // File scope.
    if (/^\s*#\s*[A-Za-z]*$/.test(linePrefix)) {
        return [item("pragma pipeline", "keyword", "#pragma", "The pipeline's own settings: `Order`, `Injection`, `Views`, `Requires`, `Enabled`.", "pragma pipeline(${1:Order} = ${2:0})")];
    }
    if (/^\s*buffer\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z0-9_]*$/.test(linePrefix)) {
        const formats = context.keys ? context.keys.bufferFormats : (context.index && context.index.pipeline ? context.index.pipeline.formats : []);
        return formats.map((format) => item(format, "type", "buffer format"));
    }
    if (/^\s*pass\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_]*$/.test(linePrefix)) {
        return context.keys ? context.keys.passKinds.map((kind) => item(kind.name, "class", "pass kind", kind.detail + bundledNote(context))) : [];
    }
    if (/^\s*(uniform|static\s+const)\s+[A-Za-z0-9_]*$/.test(linePrefix)) {
        const types = context.keys && context.keys.lists.parameterTypes ? context.keys.lists.parameterTypes : [];
        return types.map((type) => item(type, "type", "parameter type"));
    }
    if (/^\s*[A-Za-z_]*$/.test(linePrefix)) {
        return DECLARATIONS
            .filter((declaration) => declaration.name !== "hlsl" || !context.scan.hlsl)
            .map((declaration) => item(declaration.name, "keyword", "declaration", declaration.doc, declaration.snippet));
    }
    return [];
}

// ------------------------------------------------------------------------------------------------------ hover

function ordinalOf(slot) {
    return ["1st", "2nd", "3rd"][slot] || `${slot + 1}th`;
}

function describeBindingShort(binding) {
    const statement = binding.statement;
    if (binding.role === "param") {
        return `param ${statement.name}`;
    }
    const target = `${statement.buffer}${statement.previous ? ".Previous" : ""}`;
    if (binding.role === "size") {
        return `${statement.type} ${statement.name}: size, one over it in zw`;
    }
    if (binding.role === "uvrect") {
        return `${statement.type} ${statement.name}: UV rect of its picture`;
    }
    return `${statement.type} ${statement.name} = ${target}`;
}

/** A binding name as a pass's HLSL sees it -- the macros the compiler defines onto the slot's fixed parameters. */
function describeBinding(context, pass, binding) {
    const statement = binding.statement;
    const lines = [];
    if (binding.role === "param") {
        lines.push(`**param** \`${statement.name}\` = \`${valueText(context, statement)}\` -- of pass \`${pass.name}\``);
        lines.push("", "A component of `DP_Params[]`, computed on the CPU once per view.");
        return lines.join("\n");
    }
    const target = `${statement.buffer}${statement.previous ? ".Previous" : ""}`;
    lines.push(`**${statement.type}** \`${statement.name}\` = \`${target}\` -- the ${ordinalOf(binding.slot)} ${statement.type} of pass \`${pass.name}\``);
    if (!runsHlsl(pass)) {
        return lines.join("\n");
    }
    if (statement.type === "read") {
        lines.push("", `\`${statement.name}\` is \`DP_Input${binding.slot}\`, \`${statement.name}Size\` its size (xy, one over it in zw), \`${statement.name}UVRect\` the UV rect of its picture inside the texture.`);
    } else if (pass.kind === "compute") {
        lines.push("", `\`${statement.name}\` is \`DP_Output${binding.slot}\` (a \`RWTexture2D<float4>\`), \`${statement.name}Size\` its size.`);
    } else {
        lines.push("", `\`${statement.name}\` is the pixel shader's \`SV_Target${binding.slot}\`; \`${statement.name}Size\` its size.`);
    }
    return lines.join("\n");
}

function codeBlock(text) {
    return `\`\`\`hlsl\n${text.replace(/\s*;\s*$/, "").replace(/\s+/g, " ").trim()}\n\`\`\``;
}

function indexNote(context) {
    return context.index ? "" : "\n\n*From the text: the compiler's index of this file is not there yet -- the Unreal editor writes it when it compiles the pipeline.*";
}

/** A declared name of the file, as markdown: the text's declaration, with what the index knows about it. */
function describeDeclared(context, found) {
    const { kind, entry } = found;
    const pipeline = context.index && context.index.pipeline;
    const declaration = context.index
        ? context.index.declarations.find((candidate) => candidate.name === entry.name && candidate.kind === kind)
        : null;
    const facts = [];
    let desc = "";

    if (kind === "buffer") {
        const bound = pipeline ? pipeline.buffers.find((candidate) => candidate.name === entry.name) : null;
        facts.push(`buffer, ${entry.format || (bound && bound.format) || "?"}`);
        if (bound) {
            if (bound.size.length === 2 && (bound.size[0] > 0 || bound.size[1] > 0)) {
                facts.push(`${bound.size[0]} x ${bound.size[1]}`);
            } else if (bound.scale && bound.scale !== 1) {
                facts.push(`scale ${bound.scale}`);
            }
            if (bound.resolution) {
                facts.push(`${bound.resolution} resolution`);
            }
            if (bound.history) {
                facts.push("history: `.Previous` reads last frame's");
            }
            if (bound.export) {
                facts.push("exported to a render target");
            }
            desc = bound.desc;
        }
        return [codeBlock(context.text.slice(entry.start, entry.end)), "", `*${facts.join(" · ")}*`, "", desc || entry.doc].join("\n").trim() + indexNote(context);
    }
    if (kind === "uniform") {
        const bound = pipeline ? pipeline.uniforms.find((candidate) => candidate.name === entry.name) : null;
        facts.push("pipeline parameter");
        if (bound && bound.group) {
            facts.push(`group ${bound.group}`);
        }
        desc = (bound && bound.desc) || (declaration && declaration.doc) || "";
        return [codeBlock(context.text.slice(entry.start, entry.end)), "", `*${facts.join(" · ")}*`, "", desc || entry.doc].join("\n").trim() + indexNote(context);
    }
    if (kind === "constant") {
        return [codeBlock(context.text.slice(entry.start, entry.end)), "", "*constant, folded where it is used*", "", (declaration && declaration.doc) || entry.doc].join("\n").trim() + indexNote(context);
    }

    // A pass.
    const bound = pipeline ? pipeline.passes.find((candidate) => candidate.name === entry.name) : null;
    facts.push(`${entry.kind || "?"} pass`);
    const injection = (bound && bound.injection) || valueText(context, keyStatement(entry, "Injection"))
        || (pipeline && pipeline.injection);
    if (injection) {
        facts.push(`at ${injection}`);
    }
    if (bound && bound.material) {
        facts.push(`material \`${bound.materialObject || bound.material}\``);
    }
    if (bound && bound.shader) {
        facts.push(`shader \`${bound.shader}\``);
    }
    const entryName = (bound && bound.entry) || valueText(context, keyStatement(entry, "Entry"));
    if (entryName) {
        facts.push(`entry \`${entryName}\``);
    }
    if (entry.hlsl) {
        facts.push(entry.hlsl.form === "functions" ? "HLSL: whole functions" : "HLSL: the statements of the entry");
    }
    desc = (bound && bound.desc) || "";
    return [codeBlock(`pass ${entry.name} : ${entry.kind}`), "", `*${facts.join(" · ")}*`, "", desc || entry.doc].join("\n").trim() + indexNote(context);
}

/** A dotted value under the caret -- `PostProcess.AfterTonemap` -- or the word alone. */
function dottedWord(lineText, word) {
    let start = word.start;
    let end = word.end;
    while (start > 1 && lineText[start - 1] === "." && /[A-Za-z0-9_]/.test(lineText[start - 2])) {
        start -= 1;
        while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1])) {
            start -= 1;
        }
    }
    while (lineText[end] === "." && /[A-Za-z_]/.test(lineText[end + 1] || "")) {
        end += 1;
        while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end])) {
            end += 1;
        }
    }
    return { text: lineText.slice(start, end), start, end };
}

function hlslHover(context, where, name) {
    const bound = [];
    for (const pass of passesSeenFrom(context, where)) {
        const binding = bindingNames(pass).find((entry) => entry.name === name);
        if (binding) {
            bound.push({ pass, binding });
        }
    }
    if (bound.length === 1) {
        return describeBinding(context, bound[0].pass, bound[0].binding);
    }
    if (bound.length > 1) {
        // An entry of the file's block named by several passes: each binds the name to its own buffer.
        const lines = bound.map(({ pass, binding }) => `- \`${pass.name}\`: ${describeBindingShort(binding)}`);
        return [`\`${name}\` -- bound by each pass that names this entry:`, "", ...lines, "", describeBinding(context, bound[0].pass, bound[0].binding).split("\n").slice(1).join("\n").trim()].join("\n");
    }
    if (where.pass && where.block.form === "statements") {
        const body = (BODY_NAMES[where.pass.kind] || []).find((entry) => entry.name === name);
        if (body) {
            return `\`${body.type} ${body.name}\` -- written by the compiler around the statements of the entry\n\n${body.doc}`;
        }
    }
    const fixed = FIXED_NAMES.find((entry) => entry.name === name);
    if (fixed) {
        return `\`\`\`hlsl\n${fixed.signature || `${fixed.type} ${fixed.name}`}\n\`\`\`\n\n*DreamPass.ush*\n\n${fixed.doc}`;
    }
    for (const block of [where.block, context.scan.hlsl]) {
        const fn = block ? block.functions.find((entry) => entry.name === name) : null;
        if (fn) {
            const role = block === context.scan.hlsl
                ? (entryNames(context).has(fn.name) ? "an entry of the file's hlsl block" : "shared code of the file's hlsl block")
                : "a function of the pass's hlsl block";
            return `${codeBlock(context.text.slice(fn.start, fn.signatureEnd))}\n\n*${role}*`;
        }
    }
    return null;
}

/** Hover at an offset: `{ markdown, start, end }` or null. */
function hoverAt(context, offset) {
    const where = locate(context, offset);
    const line = lineAt(context, offset);
    const word = wordAt(line.text, offset - line.start);
    if (!word) {
        return null;
    }
    const range = { start: line.start + word.start, end: line.start + word.end };
    const answer = (markdown) => (markdown ? { markdown, ...range } : null);

    if (where.kind === "comment") {
        if (where.comment.doc && line.text[word.start - 1] === "@") {
            const directive = DIRECTIVES.find((entry) => entry.name === word.word);
            return directive ? answer(`\`/// ${directive.detail}\`\n\n${directive.doc}`) : null;
        }
        return null;
    }
    if (where.kind === "string") {
        return null;
    }
    if (where.kind === "hlsl") {
        return answer(hlslHover(context, where, word.word));
    }

    const after = line.text.slice(word.end);
    if (/^[A-Z]/.test(word.word) && /^\s*=(?!=)/.test(after) && !word.member) {
        const place = where.kind === "pragma" ? { scope: "pipeline" }
            : where.kind === "buffer" ? { scope: "buffer" }
                : where.kind === "pass" ? { scope: "pass", kind: where.pass.kind } : null;
        const key = place ? passKeys.findKey(context.keys, place, word.word) : null;
        if (key) {
            const label = place.scope === "pipeline" ? "#pragma pipeline" : place.scope === "buffer" ? "buffer" : `${place.kind || "pass"} pass`;
            return answer(passKeys.describeKey(context.keys, key, label) + bundledNote(context));
        }
    }

    if (where.kind === "pass") {
        const statement = statementAt(where.pass, range.start);
        if (statement && statement.start === range.start && (word.word === "read" || word.word === "write" || word.word === "param")) {
            const binding = context.keys ? context.keys.bindingStatements.find((entry) => entry.name === word.word) : null;
            return answer(binding ? `**${binding.name}**\n\n${binding.detail}` : null);
        }
        if (statement && statement.type !== "key" && statement.nameStart === range.start
            && (statement.type === "param" || statement.explicitName)) {
            const binding = bindingNames(where.pass).find((entry) => entry.statement === statement && entry.role !== "size" && entry.role !== "uvrect");
            if (binding) {
                return answer(describeBinding(context, where.pass, binding));
            }
        }
    }

    const header = context.scan.passes.find((pass) => pass.kindStart === range.start);
    if (header) {
        const kind = passKeys.findPassKind(context.keys, header.kind);
        if (kind) {
            const keyNames = kind.keys.map((key) => `\`${key.name}\``).join(", ");
            return answer(`**${kind.name}** -- pass kind\n\n${kind.detail}${keyNames ? `\n\n*Keys: ${keyNames}, and \`Injection\`, \`Enabled\`.*` : ""}`);
        }
    }

    if (where.kind === "pass") {
        const statement = statementAt(where.pass, range.start);
        const fn = statement && statement.type === "key" && statement.name === "Entry" && context.scan.hlsl
            ? context.scan.hlsl.functions.find((entry) => entry.name === word.word)
            : null;
        if (fn) {
            return answer(`${codeBlock(context.text.slice(fn.start, fn.signatureEnd))}

*an entry of the file's hlsl block*`);
        }
    }

    if (where.kind === "pass" || where.kind === "pragma") {
        const dotted = dottedWord(line.text, word);
        const point = passKeys.findInjectionPoint(context.keys, dotted.text) || passKeys.findInjectionPoint(context.keys, word.word);
        if (point) {
            return { markdown: passKeys.describeInjectionPoint(point), start: line.start + dotted.start, end: line.start + dotted.end };
        }
    }

    if (word.member) {
        const member = BUFFER_MEMBERS.find((entry) => entry.name === word.word);
        return member && where.kind === "pass" ? answer(`**.${member.name}**\n\n${member.doc}`) : null;
    }

    const found = findDeclared(context, word.word);
    if (found) {
        return answer(describeDeclared(context, found));
    }
    if (context.keys && context.keys.builtinBuffers.includes(word.word)) {
        return answer(`**${word.word}** -- built-in buffer\n\nNeeds no declaration. Where it can be read and written depends on the injection point.`);
    }
    if (context.keys && word.word === context.keys.weightParameter) {
        return answer(`**${word.word}**\n\nThe pipeline's weight in the view: a volume's blend weight, 1 for a global pipeline.`);
    }
    return null;
}

// ------------------------------------------------------------------------------------------------- definition

function dedupeTargets(targets) {
    const seen = new Set();
    return targets.filter((target) => {
        const key = `${target.start}:${target.end}`;
        return !seen.has(key) && seen.add(key);
    });
}

/** Where a name of the file is declared: by the index where its spans still match the text, else by the text. */
function declarationTargets(context, name) {
    const targets = [];
    if (context.index) {
        for (const declaration of context.index.declarations) {
            if (declaration.name !== name || !DECLARED_KINDS.has(declaration.kind)) {
                continue;
            }
            const start = spanOffset(context, declaration);
            if (start >= 0 && spanMatches(context.lines, declaration, name)) {
                targets.push({ start, end: start + name.length, source: "index" });
            }
        }
    }
    if (targets.length > 0) {
        return dedupeTargets(targets);
    }
    const found = findDeclared(context, name);
    return found ? [{ start: found.entry.nameStart, end: found.entry.nameEnd, source: "text" }] : [];
}

/** Where a binding of a pass is: the index's span of its statement when the statement is still there, else the text's. */
function bindingTarget(context, pass, statement) {
    const bound = context.index && context.index.pipeline
        ? context.index.pipeline.passes.find((candidate) => candidate.name === pass.name)
        : null;
    if (bound) {
        const list = statement.type === "read" ? bound.reads : statement.type === "write" ? bound.writes : bound.params;
        const entry = list.find((candidate) => (statement.type === "param" ? candidate.target : candidate.slot) === statement.name);
        const start = entry ? spanOffset(context, entry) : -1;
        if (start >= 0) {
            const rest = context.lines[entry.line - 1].slice(entry.column - 1);
            const match = new RegExp(`^${statement.type}\\s+(${escapeRegExp(statement.name)})(?![A-Za-z0-9_])`).exec(rest);
            if (match) {
                const nameStart = start + match[0].length - match[1].length;
                return { start: nameStart, end: nameStart + statement.name.length, source: "index" };
            }
        }
    }
    return { start: statement.nameStart, end: statement.nameEnd, source: "text" };
}

/** Definition at an offset: a list of `{ start, end, source }` in this file (`source` is `index` or `text`). */
function definitionAt(context, offset) {
    const where = locate(context, offset);
    if (where.kind === "comment" || where.kind === "string") {
        return [];
    }
    const line = lineAt(context, offset);
    const word = wordAt(line.text, offset - line.start);
    if (!word) {
        return [];
    }

    if (where.kind === "hlsl") {
        if (word.member) {
            return [];
        }
        const targets = [];
        for (const pass of passesSeenFrom(context, where)) {
            const binding = bindingNames(pass).find((entry) => entry.name === word.word);
            if (binding) {
                targets.push(bindingTarget(context, pass, binding.statement));
            }
        }
        if (targets.length > 0) {
            return dedupeTargets(targets);
        }
        for (const block of [where.block, context.scan.hlsl]) {
            const fn = block ? block.functions.find((entry) => entry.name === word.word) : null;
            if (fn) {
                return [{ start: fn.nameStart, end: fn.nameEnd, source: "text" }];
            }
        }
        return [];
    }

    if (where.kind === "pass") {
        const statement = statementAt(where.pass, line.start + word.start);
        if (statement && statement.type === "key" && statement.name === "Entry" && line.start + word.start >= statement.valueStart) {
            const fn = context.scan.hlsl ? context.scan.hlsl.functions.find((entry) => entry.name === word.word) : null;
            return fn ? [{ start: fn.nameStart, end: fn.nameEnd, source: "text" }] : [];
        }
        if (statement && statement.type !== "key" && statement.nameStart === line.start + word.start
            && (statement.type === "param" || statement.explicitName)) {
            return [bindingTarget(context, where.pass, statement)];
        }
    }
    if (word.member) {
        return [];
    }
    return declarationTargets(context, word.word);
}

// ---------------------------------------------------------------------------------------------------- outline

function symbol(name, detail, kind, start, end, selectionStart, selectionEnd, children = []) {
    return { name, detail, kind, start, end: Math.max(end, selectionEnd), selectionStart, selectionEnd, children };
}

function blockSymbol(context, block, detail) {
    const entries = entryNames(context);
    const children = block.functions.map((fn) => symbol(fn.name,
        block.passIndex < 0 && entries.has(fn.name) ? "entry" : (fn.numthreads ? "[numthreads]" : ""),
        "function", fn.start, fn.end, fn.nameStart, fn.nameEnd));
    return symbol("hlsl", detail, "namespace", block.keywordStart, block.end, block.keywordStart, block.keywordStart + 4, children);
}

/**
 * The outline: uniforms, constants, buffers, the file's `hlsl` block with its functions, and the passes with their
 * bindings and their own block. From the text, which is always current; the index adds what the text does not say.
 * Each symbol is `{ name, detail, kind, start, end, selectionStart, selectionEnd, children }`.
 */
function documentSymbols(context) {
    const { scan } = context;
    const pipeline = context.index && context.index.pipeline;
    const symbols = [];
    for (const uniform of scan.uniforms) {
        symbols.push(symbol(uniform.name, uniform.type, "property", uniform.start, uniform.end, uniform.nameStart, uniform.nameEnd));
    }
    for (const constant of scan.constants) {
        symbols.push(symbol(constant.name, constant.type, "constant", constant.start, constant.end, constant.nameStart, constant.nameEnd));
    }
    for (const buffer of scan.buffers) {
        const bound = pipeline ? pipeline.buffers.find((candidate) => candidate.name === buffer.name) : null;
        const detail = [buffer.format, bound && bound.export ? "exported" : "", bound && bound.history ? "history" : ""].filter(Boolean).join(" · ");
        symbols.push(symbol(buffer.name, detail, "variable", buffer.start, buffer.end, buffer.nameStart, buffer.nameEnd));
    }
    if (scan.hlsl) {
        symbols.push(blockSymbol(context, scan.hlsl, "shared code and entries"));
    }
    for (const pass of scan.passes) {
        const bound = pipeline ? pipeline.passes.find((candidate) => candidate.name === pass.name) : null;
        const children = pass.statements
            .filter((statement) => statement.type !== "key")
            .map((statement) => {
                const detail = statement.type === "param"
                    ? `param = ${valueText(context, statement)}`
                    : `${statement.type} ${statement.buffer}${statement.member ? `.${statement.member}` : ""}`;
                return symbol(statement.name, detail, "variable", statement.start, statement.end, statement.nameStart, statement.nameEnd);
            });
        if (pass.hlsl) {
            children.push(blockSymbol(context, pass.hlsl, pass.hlsl.form === "functions" ? "whole functions" : "statements of the entry"));
        }
        children.sort((left, right) => left.start - right.start);
        const detail = [pass.kind, bound && bound.injection ? bound.injection : ""].filter(Boolean).join(" · ");
        symbols.push(symbol(pass.name, detail, "function", pass.start, pass.end, pass.nameStart, pass.nameEnd, children));
    }
    return symbols.sort((left, right) => left.start - right.start);
}

module.exports = {
    computeLineStarts,
    createContext,
    spanOffset,
    locate,
    bindingNames,
    completionsAt,
    hoverAt,
    definitionAt,
    documentSymbols
};
