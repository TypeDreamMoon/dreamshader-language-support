"use strict";
const fs = require("fs");
const path = require("path");
const {
    DREAMSHADER_KEYWORD_COMPLETIONS,
    DREAMSHADER_TEMPLATE_COMPLETIONS
} = require("../templates");

function normalizeSymbolKey(name) {
    return String(name || "").trim().toLowerCase();
}

const LANGUAGE_ID = "dreamshaderlang";
const BRIDGE_DIAGNOSTIC_COLLECTION_NAME = "dreamshader";
const LOCAL_DIAGNOSTIC_COLLECTION_NAME = "dreamshader-local";
const DREAMSHADER_EXTENSIONS = new Set([".dsm", ".dsf", ".dsh"]);
const INDENT = "    ";
const PACKAGE_MANIFEST_NAME = "dreamshader.package.json";
const PACKAGE_LOCK_NAME = "dreamshader.lock.json";
const MATERIAL_EXPRESSION_MANIFEST_NAME = "material-expressions.json";
const SETTINGS_MANIFEST_NAME = "settings.json";
const DEFAULT_PACKAGE_INDEX_URL = "https://raw.githubusercontent.com/TypeDreamMoon/dreamshader-package-index/main/packages.json";
const BUNDLED_MATERIAL_EXPRESSION_MANIFEST_PATH = path.join(__dirname, "..", "resources", MATERIAL_EXPRESSION_MANIFEST_NAME);
const SEMANTIC_TOKEN_TYPES = [
    "namespace",
    "class",
    "function",
    "method",
    "variable",
    "parameter",
    "property",
    "type",
    "keyword",
    "modifier"
];
const SEMANTIC_TOKEN_MODIFIERS = [
    "declaration",
    "definition",
    "readonly",
    "defaultLibrary"
];

const LEGACY_SECTION_NAMES = [
    "Properties",
    "Settings",
    "Outputs",
    "Graph",
    "Layout",
    "Inputs",
    "Options"
];

const TOP_LEVEL_BLOCK_NAMES = [
    "Shader",
    "Function",
    "GraphFunction",
    "Namespace",
    "ShaderFunction",
    "ShaderLayer",
    "ShaderLayerBlend",
    "VirtualFunction"
];

const QUALIFIER_ITEMS = [
    ["in", "Function input parameter"],
    ["out", "Function output parameter"]
];

const FUNCTION_MODIFIER_ITEMS = [
    ["SelfContained", "Embed this Function and its DreamShader dependencies into generated Custom nodes instead of relying on external includes."],
    ["Inline", "Alias of `SelfContained` for DreamShader Function declarations."]
];

const GRAPH_TYPE_ITEMS = [
    ["float", "Scalar value"],
    ["float1", "Scalar value"],
    ["float2", "2-component vector"],
    ["float3", "3-component vector / color"],
    ["float4", "4-component vector"],
    ["vec2", "GLSL-style float2 alias"],
    ["vec3", "GLSL-style float3 alias"],
    ["vec4", "GLSL-style float4 alias"],
    ["half", "Scalar value"],
    ["half1", "Scalar value"],
    ["half2", "2-component vector"],
    ["half3", "3-component vector"],
    ["half4", "4-component vector"],
    ["int", "Scalar numeric alias"],
    ["int2", "2-component integer vector"],
    ["int3", "3-component integer vector"],
    ["int4", "4-component integer vector"],
    ["ivec2", "GLSL-style int2 alias"],
    ["ivec3", "GLSL-style int3 alias"],
    ["ivec4", "GLSL-style int4 alias"],
    ["uint", "Scalar numeric alias"],
    ["uint2", "2-component unsigned vector"],
    ["uint3", "3-component unsigned vector"],
    ["uint4", "4-component unsigned vector"],
    ["uvec2", "GLSL-style uint2 alias"],
    ["uvec3", "GLSL-style uint3 alias"],
    ["uvec4", "GLSL-style uint4 alias"],
    ["bool", "Scalar numeric alias"],
    ["bool2", "2-component bool vector"],
    ["bool3", "3-component bool vector"],
    ["bool4", "4-component bool vector"],
    ["bvec2", "GLSL-style bool2 alias"],
    ["bvec3", "GLSL-style bool3 alias"],
    ["bvec4", "GLSL-style bool4 alias"],
    ["Texture2D", "Texture object input"],
    ["TextureCube", "Texture cube input"],
    ["Texture2DArray", "Texture array input"],
    ["VolumeTexture", "Volume texture object input"],
    ["Texture3D", "Texture3D alias for VolumeTexture"],
    ["MaterialAttributes", "Unreal Material Attributes aggregate"],
    ["ScalarParameter", "Scalar material parameter"],
    ["VectorParameter", "Vector material parameter"],
    ["DoubleVectorParameter", "Double vector material parameter"],
    ["StaticBoolParameter", "Static bool material parameter"],
    ["StaticSwitchParameter", "Static switch material parameter"],
    ["TextureObjectParameter", "Texture object material parameter"],
    ["TextureSampleParameter2D", "Texture sample parameter"],
    ["TextureSampleParameter2DArray", "Texture array sample parameter"],
    ["TextureSampleParameterCube", "Texture cube sample parameter"],
    ["TextureSampleParameterCubeArray", "Texture cube array sample parameter"],
    ["TextureSampleParameterVolume", "Volume texture sample parameter"],
    ["TextureSampleParameterSubUV", "SubUV texture sample parameter"],
    ["RuntimeVirtualTextureSampleParameter", "Runtime virtual texture sample parameter"],
    ["SparseVolumeTextureSampleParameter", "Sparse volume texture sample parameter"],
    ["SparseVolumeTextureObjectParameter", "Sparse volume texture object parameter"],
    ["ChannelMaskParameter", "Channel mask parameter"],
    ["StaticComponentMaskParameter", "Static component mask parameter"],
    ["TextureCollectionParameter", "Texture collection parameter"],
    ["CurveAtlasRowParameter", "Curve atlas row parameter"],
    ["DynamicParameter", "Dynamic parameter expression"],
    ["FontSampleParameter", "Font sample parameter"],
    ["SpriteTextureSampler", "Sprite texture sampler parameter"],
];

const HLSL_TYPE_ITEMS = [
    ["float", "Shader helper scalar"],
    ["float2", "Shader helper 2-component vector"],
    ["float3", "Shader helper 3-component vector"],
    ["float4", "Shader helper 4-component vector"],
    ["vec2", "GLSL-style float2 alias"],
    ["vec3", "GLSL-style float3 alias"],
    ["vec4", "GLSL-style float4 alias"],
    ["half", "Shader helper half scalar"],
    ["half2", "Shader helper half2 vector"],
    ["half3", "Shader helper half3 vector"],
    ["half4", "Shader helper half4 vector"],
    ["int", "Shader helper integer"],
    ["int2", "Shader helper int2"],
    ["int3", "Shader helper int3"],
    ["int4", "Shader helper int4"],
    ["ivec2", "GLSL-style int2 alias"],
    ["ivec3", "GLSL-style int3 alias"],
    ["ivec4", "GLSL-style int4 alias"],
    ["uint", "Shader helper unsigned integer"],
    ["uint2", "Shader helper uint2"],
    ["uint3", "Shader helper uint3"],
    ["uint4", "Shader helper uint4"],
    ["uvec2", "GLSL-style uint2 alias"],
    ["uvec3", "GLSL-style uint3 alias"],
    ["uvec4", "GLSL-style uint4 alias"],
    ["bool", "Shader helper bool"],
    ["bool2", "Shader helper bool2"],
    ["bool3", "Shader helper bool3"],
    ["bool4", "Shader helper bool4"],
    ["bvec2", "GLSL-style bool2 alias"],
    ["bvec3", "GLSL-style bool3 alias"],
    ["bvec4", "GLSL-style bool4 alias"],
    ["float2x2", "Shader helper 2x2 matrix"],
    ["float3x3", "Shader helper 3x3 matrix"],
    ["float4x4", "Shader helper 4x4 matrix"],
    ["mat2", "GLSL-style float2x2 alias"],
    ["mat3", "GLSL-style float3x3 alias"],
    ["mat4", "GLSL-style float4x4 alias"],
    ["Texture2D", "Texture object"],
    ["TextureCube", "Texture cube object"],
    ["Texture2DArray", "Texture2DArray object"],
    ["VolumeTexture", "Volume texture object"],
    ["Texture3D", "Texture3D alias for VolumeTexture"],
    ["SamplerState", "Sampler state"],
    ["void", "No return value"]
];

const HLSL_KEYWORD_ITEMS = [
    ["if", "Conditional"],
    ["else", "Conditional branch"],
    ["for", "Loop"],
    ["while", "Loop"],
    ["do", "Loop"],
    ["switch", "Switch statement"],
    ["case", "Switch case"],
    ["default", "Switch default case"],
    ["return", "Return from the current function"],
    ["break", "Break the current loop or switch"],
    ["continue", "Continue the current loop"],
    ["const", "Read-only value"],
    ["static", "Static storage"],
    ["struct", "Structure declaration"]
];

// ---------------------------------------------------------------- preprocessor
//
// The eight generation-time directives, `defined`, and the six read-only `DS_` builtins. Wording is
// taken from the user documentation -- `Plugins/DreamShader/Docs/language/preprocessor.md` -- so that
// the editor and the manual say the same thing about the two questions that actually bite: how `#if`
// differs from a static switch, and that a `#define` is file-local.
//
// Every `name` carries its `#`. The completion replaces an explicit range that starts at the `#`,
// because the editor's word pattern does not: an item labelled `if`, offered on a line reading `#i`,
// would leave `##if` behind.

const PREPROCESSOR_DIRECTIVE_ITEMS = [
    {
        name: "#if",
        insertText: "#if ${1:CONDITION}\n$0\n#endif",
        detail: "Preprocessor: keep the lines that follow only when the condition is true",
        documentation: [
            "Cuts source text **at generation time**, before `import` extraction and before the declaration",
            "parser. A branch that is not taken never reaches the parser and never becomes a node.",
            "",
            "**`#if` is not a static switch.** A `StaticSwitchParameter` is a node: it lives inside",
            "`Graph = { ... }`, it selects between two *values*, and a material instance answers it. `#if` is",
            "text, so it is the only one of the two that can cut the **declaration** layer -- a `Settings`",
            "line, a whole `Outputs` block, an `import`, an entire `ShaderFunction`. One rule: `#if` is a",
            "project-wide, build-time decision; a static switch is a per-instance, artist-facing one. Do not",
            "reach for `#if` to keep a permutation count down -- that trades a permutation for a rebuild and",
            "takes the choice away from whoever is using the material.",
            "",
            "An untaken branch is **not checked at all**: never lexed, never parsed, never type-checked,",
            "never generated. It may contain anything and the compile stays green, so keep branches short",
            "and compile every define set you actually ship.",
            "",
            "Valid on any line outside a `Function` / `GraphFunction` body, `Graph` included. The keyword is",
            "matched **lowercase only** -- `#IF` is `DSH1035`, not a line that quietly does nothing.",
            "",
            "```c",
            "#if DS_ENGINE_MAJOR > 5 || (DS_ENGINE_MAJOR == 5 && DS_ENGINE_MINOR >= 7)",
            "```"
        ].join("\n")
    },
    {
        name: "#ifdef",
        insertText: "#ifdef ${1:NAME}\n$0\n#endif",
        detail: "Preprocessor: exactly `#if defined(NAME)`",
        documentation: [
            "Pure sugar. It desugars to `#if defined(NAME)` before anything else happens and behaves",
            "identically from there, including what it contributes to the build key. It exists because the",
            "spelling decision was \"match HLSL\", and a HLSL author writes it from muscle memory.",
            "",
            "Takes exactly one name; a surplus token is `DSH1042`, and a missing or malformed one `DSH1038`."
        ].join("\n")
    },
    {
        name: "#ifndef",
        insertText: "#ifndef ${1:NAME}\n$0\n#endif",
        detail: "Preprocessor: exactly `#if !defined(NAME)`",
        documentation: [
            "Pure sugar. It desugars to `#if !defined(NAME)` before anything else happens and behaves",
            "identically from there, including what it contributes to the build key.",
            "",
            "Takes exactly one name; a surplus token is `DSH1042`, and a missing or malformed one `DSH1038`."
        ].join("\n")
    },
    {
        name: "#elif",
        insertText: "#elif ${1:CONDITION}",
        detail: "Preprocessor: another branch, with its own condition",
        documentation: [
            "Same expression grammar as `#if`. Only the first branch of a chain whose condition is true is",
            "kept; the rest are cut, and their conditions are not evaluated.",
            "",
            "`#elif` with no `#if` above it is `DSH1032`, and an `#elif` after an `#else` is `DSH1033` -- the",
            "`#else` closes the chain."
        ].join("\n")
    },
    {
        name: "#else",
        insertText: "#else",
        detail: "Preprocessor: the branch taken when every condition above failed",
        documentation: [
            "Closes the chain: no `#elif` and no second `#else` may follow it (`DSH1033`). An `#else` with no",
            "`#if` above it is `DSH1032`.",
            "",
            "It takes no operand, and that check applies **whether or not the `#else` sits inside a branch",
            "that was cut** -- it belongs to the chain, not to a branch."
        ].join("\n")
    },
    {
        name: "#endif",
        insertText: "#endif",
        detail: "Preprocessor: close the innermost `#if` chain",
        documentation: [
            "Chains nest to 64 levels, counted inside skipped branches too; the 65th is `DSH1037`. Reaching",
            "end of file with a chain still open is `DSH1030`, and an `#endif` with no matching `#if` is",
            "`DSH1031`.",
            "",
            "It takes no operand -- inside a cut branch as much as outside, because it belongs to the chain",
            "rather than to a branch. The habit this catches is C's, where a long chain is labelled at the",
            "bottom:",
            "",
            "```c",
            "#endif MOONTOON_LEGACY     // DSH1042 -- MOONTOON_LEGACY is a stray token",
            "#endif // MOONTOON_LEGACY  // correct",
            "```"
        ].join("\n")
    },
    {
        name: "#define",
        insertText: "#define ${1:NAME} ${2:1}",
        detail: "Preprocessor: name a value, for this file only",
        documentation: [
            "Defines `NAME` for the remainder of **this file**. The value is everything after the name to the",
            "end of the line; it is stored as text and **never tokenized, never expanded, never evaluated**.",
            "There are no macros here -- only named values for a `#if` to test:",
            "",
            "```c",
            "#define PP_SUM  1 + 1      // the five-character string \"1 + 1\", NOT the integer 2",
            "#define PP_C    5 // five  // the integer 5 -- the trailing comment is stripped first",
            "#define PP_MARK            // empty: a marker, which reads as the integer 1",
            "```",
            "",
            "**A `#define` is file-local. This is not C.** It is not visible to a file that imports this one,",
            "and not to a file imported after it. The preprocessor runs *before* imports are extracted, which",
            "is what lets a `#if` wrap an `import` line; making `#define` behave like C's would mean",
            "preprocessing the assembled text, and then a `#if` could no longer decide which imports to pull.",
            "The two cannot both be had, and wrapping `import` won.",
            "",
            "**To define a switch centrally, use a channel built for it**: *Preprocessor Defines* in the",
            "project settings, `RegisterDreamShaderDefine()` from C++, or `-Define=NAME=VALUE` on the",
            "commandlet. A `#define` in a source file is for a local abbreviation within that file.",
            "",
            "It is the only directive with no trailing-token check, since its value runs to end of line:",
            "`#define A B C` is legal, with the value `B C`. Defining a reserved `DS_` name is `DSH1039`."
        ].join("\n")
    },
    {
        name: "#undef",
        insertText: "#undef ${1:NAME}",
        detail: "Preprocessor: remove a name, for the rest of this file",
        documentation: [
            "Undefines `NAME` for the remainder of this file. Like `#define` it is **file-local**: it does not",
            "reach a file that imports this one, and it cannot remove a define that a *later* file made.",
            "",
            "Takes exactly one name -- `#undef A B` is `DSH1042`, which `#define` is excused from but this is",
            "not. A missing or malformed name is `DSH1038`, and undefining a reserved `DS_` name `DSH1039`."
        ].join("\n")
    }
];

const PREPROCESSOR_DEFINED_ITEM = {
    name: "defined",
    insertText: "defined(${1:NAME})",
    detail: "Preprocessor: 1 when NAME is defined, 0 when it is not",
    documentation: [
        "Both `defined(NAME)` and `defined NAME` are accepted. The define's **value is not looked at** --",
        "only whether the table has the name at all.",
        "",
        "A name read through `defined()` is recorded in the build key like any other read, with the",
        "sentinel `<undef>` when the table had nothing, so defining it later still rebuilds the sources",
        "that only asked whether it existed."
    ].join("\n")
};

const PREPROCESSOR_BUILTIN_NOTE = [
    "Builtin `DS_` define. This tier is **read-only and never loses**: it outranks the project's",
    "*Preprocessor Defines*, `RegisterDreamShaderDefine()`, a define provider, and `-Define=` on the",
    "command line alike.",
    "",
    "**The `DS_` prefix is reserved as a prefix, not as a list** -- `#define` or `#undef` of any name",
    "beginning with `DS_` is `DSH1039`, whether or not DreamShader ships that name today. The test is",
    "case-sensitive, so `ds_foo` is an ordinary name.",
    "",
    "Every builtin is an **invariant of the running process**, and that is a requirement rather than a",
    "coincidence: a define is evaluated once at generation time and its effect is baked into a saved",
    "asset, so a value that could change mid-session would make the build unreproducible and the",
    "asset's recorded build key a lie."
].join("\n");

function createPreprocessorBuiltinItem(name, valueType, summary, body) {
    return {
        name,
        insertText: name,
        valueType,
        detail: `Builtin define (${valueType}) -- ${summary}`,
        documentation: [...body, "", PREPROCESSOR_BUILTIN_NOTE].join("\n")
    };
}

const PREPROCESSOR_BUILTIN_DEFINE_ITEMS = [
    createPreprocessorBuiltinItem("DS_ENGINE_MAJOR", "integer", "engine major version", [
        "The engine major version -- `5`. Taken from DreamShader's own `DREAMSHADER_UE_MAJOR`, the same",
        "macro the plugin's C++ `DREAMSHADER_UE_VERSION_AT_LEAST` guards read, not",
        "`ENGINE_MAJOR_VERSION`, so a fork that overrides it for compatibility testing gets one answer",
        "rather than two that disagree.",
        "",
        "A version gate needs both halves, or it reads `6.0` as older than `5.7`:",
        "",
        "```c",
        "#if DS_ENGINE_MAJOR > 5 || (DS_ENGINE_MAJOR == 5 && DS_ENGINE_MINOR >= 7)",
        "```"
    ]),
    createPreprocessorBuiltinItem("DS_ENGINE_MINOR", "integer", "engine minor version", [
        "The engine minor version -- `3` ... `8`, from `DREAMSHADER_UE_MINOR`.",
        "",
        "Pair it with `DS_ENGINE_MAJOR`; on its own it reads `6.0` as older than `5.7`:",
        "",
        "```c",
        "#if DS_ENGINE_MAJOR > 5 || (DS_ENGINE_MAJOR == 5 && DS_ENGINE_MINOR >= 7)",
        "```"
    ]),
    createPreprocessorBuiltinItem("DS_ENGINE_PATCH", "integer", "engine hotfix version", [
        "The engine hotfix version, from `DREAMSHADER_UE_PATCH`."
    ]),
    createPreprocessorBuiltinItem("DS_SUBSTRATE", "integer", "1 when Substrate is enabled", [
        "`1` when Substrate is enabled and `0` otherwise, read from the `r.Substrate` CVar -- which",
        "qualifies as a process invariant only because it is read-only and fixed at startup.",
        "",
        "This is the case the feature exists for. Under Substrate a material may need a different",
        "`ShadingModel`, a different `import`, and a different set of `Outputs` -- not the same names, and",
        "not even the same types. A `Substrate` value and a `vec3` are not two inputs of one switch node;",
        "they are two different materials."
    ]),
    createPreprocessorBuiltinItem("DS_PLATFORM", "string", "the ini platform name", [
        "**A string.** The *ini* platform name, for example `\"Windows\"` -- never `PlatformName()`, which",
        "folds in editor/server/client and would answer `WindowsEditor` in the editor but `Windows` during",
        "a cook, so one source would preprocess two different ways on the two sides of a cook.",
        "",
        "Compare it with `==` / `!=` and nothing else, and note the comparison is **case-sensitive**:",
        "`DS_PLATFORM == \"windows\"` is false on Windows. **A string is never coerced to a truth value** --",
        "`#if DS_PLATFORM` is `DSH1040`, and so are `!DS_PLATFORM`, `DS_PLATFORM && X`, and any comparison",
        "against a number. Silently treating a string as true is how a platform gate ends up firing",
        "everywhere, so it is refused instead."
    ]),
    createPreprocessorBuiltinItem("DS_PLUGIN_VERSION", "string", "the plugin VersionName", [
        "**A string.** The plugin descriptor's `VersionName`, for example `\"1.9.0\"`, falling back to",
        "`\"unknown\"` rather than going undefined -- otherwise `defined(DS_PLUGIN_VERSION)` could flip for",
        "a reason that has nothing to do with the source, and take a build key with it.",
        "",
        "Being a string, `DS_PLUGIN_VERSION >= \"1.9.0\"` is `DSH1040`, not a version test. Compare it with",
        "`==` / `!=` only; for a version gate use the integer engine defines."
    ])
];

const PREPROCESSOR_BUILTIN_DEFINE_NAME_SET = new Set(PREPROCESSOR_BUILTIN_DEFINE_ITEMS.map((item) => item.name));

function createSettingItem(name, detail, insertText) {
    return {
        name,
        detail,
        insertText: insertText || `${name} = "$0";`
    };
}

function createAssetSettingItem(name, detail) {
    return createSettingItem(name, detail, name + " = Path(${1:/Game/Path/To/Asset.Asset});");
}

function createMaterialOutputItem(name, detail) {
    return {
        name,
        qualifiedName: `Base.${name}`,
        detail,
        insertText: `Base.${name} = $0;`
    };
}

function createUEBuiltinItem(name, snippet, detail, parameters, example, options = {}) {
    return {
        name,
        qualifiedName: options.qualifiedName || `UE.${name}`,
        snippet,
        memberSnippet: options.memberSnippet || snippet.replace(/^UE\./, ""),
        detail,
        parameters: parameters || [],
        example: example || snippet,
        outputType: options.outputType,
        returnType: options.returnType,
        outputs: normalizeBuiltinOutputs(options.outputs),
        isSubstrateOutput: options.isSubstrateOutput
    };
}

function createSubstrateBuiltinItem(name, snippet, detail, parameters, example, options = {}) {
    return createUEBuiltinItem(name, snippet, detail, parameters, example, {
        ...options,
        qualifiedName: options.qualifiedName || `Substrate.${name}`,
        memberSnippet: options.memberSnippet || snippet.replace(/^Substrate\./, ""),
        outputType: options.outputType || (options.isSubstrateOutput === false ? undefined : "Substrate"),
        isSubstrateOutput: options.isSubstrateOutput !== false
    });
}

function normalizeBuiltinOutputs(outputs) {
    if (!Array.isArray(outputs)) {
        return undefined;
    }
    return outputs
        .map((output, index) => {
            if (!output) {
                return null;
            }
            const name = typeof output.name === "string" ? output.name.trim() : "";
            const type = typeof output.type === "string" && output.type.trim()
                ? output.type.trim()
                : typeof output.outputType === "string" && output.outputType.trim()
                    ? output.outputType.trim()
                    : "";
            return {
                index: Number.isFinite(Number(output.index)) ? Number(output.index) : index,
                name,
                type,
                outputType: type,
                componentCount: Number.isFinite(Number(output.componentCount)) ? Number(output.componentCount) : undefined
            };
        })
        .filter(Boolean);
}

let bundledMaterialExpressionBuiltinItems = null;

function getBundledMaterialExpressionBuiltinItems() {
    if (bundledMaterialExpressionBuiltinItems) {
        return bundledMaterialExpressionBuiltinItems;
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(BUNDLED_MATERIAL_EXPRESSION_MANIFEST_PATH, "utf8"));
    } catch (_error) {
        bundledMaterialExpressionBuiltinItems = [];
        return bundledMaterialExpressionBuiltinItems;
    }

    bundledMaterialExpressionBuiltinItems = Array.isArray(parsed.expressions)
        ? parsed.expressions.map(createUEBuiltinItemFromManifestExpression).filter(Boolean)
        : [];
    return bundledMaterialExpressionBuiltinItems;
}

// UE.* names the DreamShader compiler special-cases as their own dedicated builtins (see
// DreamShaderMaterialGeneratorCodeUE.cpp's `Builtins` table plus the separately-handled
// StaticSwitchParameter/CollectionParam(eter)/Expression). The compiler checks these BEFORE
// falling back to the generic `UE.<ClassName>(...)` reflection dispatch, so a manifest
// expression sharing one of these names must keep the `UE.Expression(Class="X", ...)` long
// form -- writing `UE.Time(OutputType=...)`, for example, would route into the sugar Time
// builtin (which takes a `Period` argument, not `OutputType`), not the reflected class.
const UE_SUGAR_BUILTIN_RESERVED_NAMES = new Set([
    "texcoord", "time", "panner", "worldposition", "objectpositionws", "cameravectorws",
    "vertexnormalws", "vertextangentws", "screenposition", "vertexcolor", "transformvector",
    "transformposition", "staticswitchparameter", "collectionparam", "collectionparameter",
    "expression"
]);

function createUEBuiltinItemFromManifestExpression(expression) {
    const name = String(expression?.name || "").trim();
    if (!name) {
        return null;
    }

    const outputType = typeof expression.defaultOutputType === "string" && expression.defaultOutputType.trim()
        ? expression.defaultOutputType.trim()
        : inferOutputTypeFromManifestOutputs(expression.outputs);
    const preferredProperties = (Array.isArray(expression.properties) ? expression.properties : [])
        .filter(isPreferredManifestCompletionProperty)
        .slice(0, 4);
    // The short `UE.<Name>(...)` form is sugar the compiler resolves via reflection using the
    // call's own member name as the MaterialExpression class -- so it's shorter than (and
    // equivalent to) `UE.Expression(Class="<Name>", ...)`, except for names reserved above.
    const isShortFormSafe = !UE_SUGAR_BUILTIN_RESERVED_NAMES.has(name.toLowerCase());
    const snippetParts = isShortFormSafe
        ? [`OutputType="${outputType}"`]
        : [`Class="${name}"`, `OutputType="${outputType}"`];
    preferredProperties.forEach((property, index) => {
        snippetParts.push(`${property.name}=\${${index + 1}:${getManifestPropertyPlaceholder(property)}}`);
    });

    const className = typeof expression.className === "string" && expression.className.trim()
        ? expression.className.trim()
        : `MaterialExpression${name}`;
    const parameters = [
        { qualifier: "in", type: "string", name: "OutputType" },
        { qualifier: "in", type: "string", name: "Output" },
        { qualifier: "in", type: "string", name: "OutputName" },
        { qualifier: "in", type: "int", name: "OutputIndex" },
        ...(Array.isArray(expression.properties) ? expression.properties : []).map((property) => ({
            qualifier: "in",
            // Older cached manifests still use the literal placeholder "input" for every input pin
            // (before the compiler learned to report the pin's real GetInputValueType); treat that
            // the same as "no type" rather than showing the placeholder text itself as if it were real.
            type: (property.type && property.type !== "input") ? property.type : "value",
            name: property.name
        }))
    ];

    return createUEBuiltinItem(
        name,
        isShortFormSafe ? `UE.${name}(${snippetParts.join(", ")})` : `UE.Expression(${snippetParts.join(", ")})`,
        `Reflected ${className} material expression.`,
        parameters,
        isShortFormSafe ? `UE.${name}(OutputType="${outputType}")` : `UE.Expression(Class="${name}", OutputType="${outputType}")`,
        {
            outputType,
            returnType: outputType,
            outputs: expression.outputs
        }
    );
}

function inferOutputTypeFromManifestOutputs(outputs) {
    const firstOutput = Array.isArray(outputs) ? outputs[0] : null;
    if (firstOutput && typeof firstOutput.outputType === "string" && firstOutput.outputType.trim()) {
        return firstOutput.outputType.trim();
    }

    const components = firstOutput && Number.isFinite(Number(firstOutput.componentCount))
        ? Number(firstOutput.componentCount)
        : 1;
    return `float${Math.max(1, Math.min(4, components || 1))}`;
}

function isPreferredManifestCompletionProperty(property) {
    if (!property || typeof property.name !== "string" || !property.name.trim()) {
        return false;
    }

    const key = normalizeSymbolKey(property.name);
    return ![
        "class",
        "outputtype",
        "resulttype",
        "output",
        "outputname",
        "outputindex",
        "desc",
        "description",
        "materialexpressioneditorx",
        "materialexpressioneditory",
        "sortpriority"
    ].includes(key);
}

function getManifestPropertyPlaceholder(property) {
    const type = normalizeSymbolKey(property?.type || "");
    if (property?.isInput) {
        return "Value";
    }
    if (type === "bool") {
        return "true";
    }
    if (type === "name" || type === "string" || type.includes("enum")) {
        return "\"Value\"";
    }
    if (type.includes("texture") || type.includes("object")) {
        return "Path(Game, \"Textures/MyTexture\")";
    }
    return "0";
}

const SETTINGS_ITEMS = [
    createSettingItem("MaterialDomain", "Material domain such as Surface or PostProcess"),
    createSettingItem("Domain", "Alias of MaterialDomain"),
    createSettingItem("ShadingModel", "Shading model such as DefaultLit"),
    createSettingItem("BlendMode", "Blend mode such as Opaque or Translucent"),
    createSettingItem("RenderType", "Alias of BlendMode"),
    createSettingItem("TranslucencyLightingMode", "Translucency lighting mode such as TLM_Surface, Surface ForwardShading, or Volumetric Directional"),
    createSettingItem("LightingMode", "Alias of TranslucencyLightingMode"),
    createSettingItem("TwoSided", "Render both sides of the mesh"),
    createSettingItem("Wireframe", "Enable wireframe rendering"),
    createSettingItem("DitheredLODTransition", "Enable dithered LOD transition"),
    createSettingItem("DitherOpacityMask", "Enable dithered opacity mask"),
    createSettingItem("AllowNegativeEmissiveColor", "Allow negative emissive values"),
    createSettingItem("CastDynamicShadowAsMasked", "Treat translucent material as masked for shadow casting"),
    createSettingItem("ResponsiveAA", "Enable responsive anti-aliasing"),
    createSettingItem("ScreenSpaceReflections", "Enable screen space reflections"),
    createSettingItem("ContactShadows", "Enable contact shadows"),
    createSettingItem("DisableDepthTest", "Disable depth testing"),
    createSettingItem("OutputTranslucentVelocity", "Write translucent velocity"),
    createSettingItem("TangentSpaceNormal", "Use tangent-space normal input"),
    createSettingItem("FullyRough", "Mark material as fully rough"),
    createSettingItem("IsSky", "Mark material as sky"),
    createSettingItem("ThinSurface", "Enable thin surface mode"),
    createSettingItem("HasPixelAnimation", "Mark material as animated at pixel level"),
    createSettingItem("OpacityMaskClipValue", "Set opacity mask clip value"),
    createSettingItem("NumCustomizedUVs", "Set the number of customized UV channels"),
    createSettingItem("TranslucencyPass", "Translucency pass such as BeforeDOF or AfterDOF"),
    createSettingItem("BlendableLocation", "Post-process blendable location such as Scene Color Before Bloom"),
    createSettingItem("BlendablePriority", "Post-process blendable priority"),
    createSettingItem("IsBlendable", "Whether the post-process material should blend with others"),
    createSettingItem("OutputAlpha", "Whether the post-process material outputs alpha"),
    createSettingItem("UserSceneTexture", "Name of the user scene texture output"),
    createSettingItem("UserTextureDivisor", "User scene texture divisor, for example (X=2,Y=2)"),
    createSettingItem("ResolutionRelativeToInput", "Reference user scene texture input name"),
    createSettingItem("DisablePreExposureScale", "Disable pre-exposure scaling for post-process materials"),
    createSettingItem("EnableStencilTest", "Enable stencil testing for post-process materials"),
    createSettingItem("StencilCompare", "Stencil comparison mode such as Always or Equal"),
    createSettingItem("StencilRefValue", "Stencil reference value"),
    createSettingItem("RefractionMethod", "Refraction method such as Pixel Normal Offset or Index Of Refraction"),
    createSettingItem("RefractionMode", "Alias of RefractionMethod"),
    createSettingItem("RefractionCoverageMode", "Refraction coverage mode for Substrate"),
    createSettingItem("RefractionDepthBias", "Refraction depth bias"),
    createSettingItem("MaxWorldPositionOffsetDisplacement", "Maximum allowed world position offset displacement"),
    createSettingItem("AlwaysEvaluateWorldPositionOffset", "Force World Position Offset evaluation even when primitives disable it"),
    createSettingItem("FloatPrecisionMode", "Mobile float precision mode"),
    createSettingItem("UseLightmapDirectionality", "Use lightmap directionality on mobile"),
    createSettingItem("UseAlphaToCoverage", "Use alpha-to-coverage for masked mobile materials"),
    createSettingItem("MobileSeparateTranslucency", "Alias of EnableMobileSeparateTranslucency"),
    createSettingItem("EnableMobileSeparateTranslucency", "Enable mobile separate translucency"),
    createSettingItem("ApplyFogging", "Apply fogging to translucent materials"),
    createSettingItem("ApplyCloudFogging", "Apply cloud fogging to translucent materials"),
    createSettingItem("ComputeFogPerPixel", "Compute fog per pixel for translucent materials"),
    createSettingItem("AllowFrontLayerTranslucency", "Allow front layer translucency"),
    createSettingItem("AllowLocalLightShadow", "Allow translucent materials to receive local light shadows"),
    createSettingItem("LocalLightShadowQuality", "Quality of local light shadows received by translucent materials"),
    createSettingItem("DirectionalLightShadowQuality", "Quality of directional light shadows received by translucent materials"),
    createSettingItem("TranslucencyDirectionalLightingIntensity", "Directional lighting intensity for translucent materials"),
    createSettingItem("TranslucentShadowDensityScale", "Translucent shadow density scale"),
    createSettingItem("TranslucentSelfShadowDensityScale", "Translucent self-shadow density scale"),
    createSettingItem("TranslucentSelfShadowSecondDensityScale", "Second translucent self-shadow density scale"),
    createSettingItem("TranslucentSelfShadowSecondOpacity", "Second translucent self-shadow opacity"),
    createSettingItem("TranslucentBackscatteringExponent", "Translucent backscattering exponent"),
    createSettingItem("TranslucentMultipleScatteringExtinction", "Translucent multiple scattering extinction color"),
    createSettingItem("TranslucentShadowStartOffset", "Translucent shadow start offset"),
    createSettingItem("EnableTessellation", "Enable Nanite displacement tessellation"),
    createSettingItem("EnableDisplacementFade", "Enable Nanite displacement fade"),
    createSettingItem("NaniteOverrideMaterial.bEnableOverride", "Enable the Nanite override material"),
    createAssetSettingItem("NaniteOverrideMaterial.OverrideMaterialEditor", "Nanite override material asset"),
    createSettingItem("DisplacementScaling", "Nanite displacement scaling struct literal"),
    createSettingItem("DisplacementFadeRange", "Nanite displacement fade range struct literal"),
    createSettingItem("ForwardRenderUsePreintegratedGFForSimpleIBL", "Use preintegrated GF for simple IBL in forward shading"),
    createSettingItem("UseHQForwardReflections", "Enable high quality forward reflections"),
    createSettingItem("ForwardBlendsSkyLightCubemaps", "Blend skylight cubemaps in forward shading"),
    createSettingItem("UsePlanarForwardReflections", "Enable planar reflections in forward shading"),
    createAssetSettingItem("PhysMaterial", "Physical material asset reference"),
    createAssetSettingItem("PhysMaterialMask", "Physical material mask asset reference"),
    createAssetSettingItem("PhysicalMaterialMap[0]", "Physical material mask slot 0 asset reference"),
    createAssetSettingItem("PhysicalMaterialMap[1]", "Physical material mask slot 1 asset reference"),
    createAssetSettingItem("PhysicalMaterialMap[2]", "Physical material mask slot 2 asset reference"),
    createAssetSettingItem("PhysicalMaterialMap[3]", "Physical material mask slot 3 asset reference"),
    createSettingItem("UsedWithSkeletalMesh", "Compile usage for skeletal meshes"),
    createSettingItem("UsedWithEditorCompositing", "Compile usage for editor compositing"),
    createSettingItem("UsedWithParticleSprites", "Compile usage for particle sprites"),
    createSettingItem("UsedWithBeamTrails", "Compile usage for beam trails"),
    createSettingItem("UsedWithMeshParticles", "Compile usage for mesh particles"),
    createSettingItem("UsedWithNiagaraSprites", "Compile usage for Niagara sprites"),
    createSettingItem("UsedWithNiagaraRibbons", "Compile usage for Niagara ribbons"),
    createSettingItem("UsedWithNiagaraMeshParticles", "Compile usage for Niagara mesh particles"),
    createSettingItem("UsedWithGeometryCache", "Compile usage for geometry cache"),
    createSettingItem("UsedWithStaticLighting", "Compile usage for static lighting"),
    createSettingItem("UsedWithMorphTargets", "Compile usage for morph targets"),
    createSettingItem("UsedWithSplineMeshes", "Compile usage for spline meshes"),
    createSettingItem("UsedWithInstancedStaticMeshes", "Compile usage for instanced static meshes"),
    createSettingItem("UsedWithGeometryCollections", "Compile usage for geometry collections"),
    createSettingItem("UsedWithClothing", "Compile usage for clothing"),
    createSettingItem("UsedWithWater", "Compile usage for water"),
    createSettingItem("UsedWithHairStrands", "Compile usage for hair strands"),
    createSettingItem("UsedWithLidarPointCloud", "Compile usage for LiDAR point clouds"),
    createSettingItem("UsedWithVirtualHeightfieldMesh", "Compile usage for virtual heightfield meshes"),
    createSettingItem("UsedWithNanite", "Compile usage for Nanite meshes"),
    createSettingItem("UsedWithVoxels", "Compile usage for voxel meshes"),
    createSettingItem("UsedWithVolumetricCloud", "Compile usage for volumetric clouds"),
    createSettingItem("UsedWithHeterogeneousVolumes", "Compile usage for heterogeneous volumes"),
    createSettingItem("AutomaticallySetUsageInEditor", "Automatically set usage flags in the editor"),
    createSettingItem("LightmassSettings.EmissiveBoost", "Lightmass emissive boost"),
    createSettingItem("LightmassSettings.DiffuseBoost", "Lightmass diffuse boost"),
    createSettingItem("LightmassSettings.ExportResolutionScale", "Lightmass export resolution scale"),
    createSettingItem("LightmassSettings.CastShadowAsMasked", "Lightmass cast-shadow-as-masked flag"),
    createSettingItem("Lightmass.EmissiveBoost", "Alias of LightmassSettings.EmissiveBoost"),
    createSettingItem("Lightmass.DiffuseBoost", "Alias of LightmassSettings.DiffuseBoost"),
    createSettingItem("Lightmass.ExportResolutionScale", "Alias of LightmassSettings.ExportResolutionScale"),
    createSettingItem("Lightmass.CastShadowAsMasked", "Alias of LightmassSettings.CastShadowAsMasked"),
    createSettingItem("SubstrateRoughnessTracking", "Enable Substrate roughness tracking"),
    createSettingItem("ForceCompatibleWithLightFunctionAtlas", "Compatible with the light function atlas"),
    createSettingItem("RelaxRuntimeVirtualTextureRestrictions", "Relax runtime virtual texture output restrictions"),
    createSettingItem("PixelDepthOffsetMode", "Pixel depth offset mode such as Legacy or Along Camera Vector"),
    createAssetSettingItem("SubsurfaceProfile", "Subsurface profile asset reference"),
    createSettingItem("Description", "Description text for a ShaderFunction material function asset"),
    createSettingItem("ExposeToLibrary", "Expose a ShaderFunction to the Unreal material function library"),
    createSettingItem("UserExposedCaption", "Custom node caption shown for a ShaderFunction"),
    createSettingItem("LibraryCategories", "Comma-separated categories for a ShaderFunction")
];

const VIRTUAL_FUNCTION_OPTION_ITEMS = [
    createSettingItem("Asset", "Existing MaterialFunction asset reference for a VirtualFunction", "Asset = Path(Plugins.${1:PluginName}, ${2:MaterialFunctions/MyFunction});"),
    createSettingItem("Description", "Optional note for generated VirtualFunction declarations")
];

const MATERIAL_OUTPUT_ITEMS = [
    createMaterialOutputItem("MaterialAttributes", "Full Material Attributes output"),
    createMaterialOutputItem("Attributes", "Alias of MaterialAttributes"),
    createMaterialOutputItem("FrontMaterial", "Substrate front material output"),
    createMaterialOutputItem("BaseColor", "Material base color output"),
    createMaterialOutputItem("EmissiveColor", "Material emissive output"),
    createMaterialOutputItem("Emissive", "Alias of EmissiveColor"),
    createMaterialOutputItem("Opacity", "Material opacity output"),
    createMaterialOutputItem("OpacityMask", "Material opacity mask output"),
    createMaterialOutputItem("Metallic", "Material metallic output"),
    createMaterialOutputItem("Specular", "Material specular output"),
    createMaterialOutputItem("Roughness", "Material roughness output"),
    createMaterialOutputItem("Normal", "Material normal output"),
    createMaterialOutputItem("AmbientOcclusion", "Material ambient occlusion output"),
    createMaterialOutputItem("AO", "Alias of AmbientOcclusion"),
    createMaterialOutputItem("Refraction", "Material refraction output"),
    createMaterialOutputItem("WorldPositionOffset", "World position offset output"),
    createMaterialOutputItem("WPO", "Alias of WorldPositionOffset"),
    createMaterialOutputItem("PixelDepthOffset", "Pixel depth offset output"),
    createMaterialOutputItem("PDO", "Alias of PixelDepthOffset"),
    createMaterialOutputItem("SubsurfaceColor", "Subsurface color output"),
    createMaterialOutputItem("ClearCoat", "Clear coat output"),
    createMaterialOutputItem("ClearCoatRoughness", "Clear coat roughness output"),
    createMaterialOutputItem("CustomData0", "Material custom data 0 output"),
    createMaterialOutputItem("CustomData1", "Material custom data 1 output"),
    createMaterialOutputItem("DiffuseColor", "Material diffuse color output"),
    createMaterialOutputItem("SpecularColor", "Material specular color output"),
    createMaterialOutputItem("SurfaceThickness", "Material surface thickness output"),
    createMaterialOutputItem("Displacement", "Material displacement output"),
    createMaterialOutputItem("CustomizedUV0", "Customized UV 0 output"),
    createMaterialOutputItem("CustomizedUV1", "Customized UV 1 output"),
    createMaterialOutputItem("CustomizedUV2", "Customized UV 2 output"),
    createMaterialOutputItem("CustomizedUV3", "Customized UV 3 output"),
    createMaterialOutputItem("CustomizedUV4", "Customized UV 4 output"),
    createMaterialOutputItem("CustomizedUV5", "Customized UV 5 output"),
    createMaterialOutputItem("CustomizedUV6", "Customized UV 6 output"),
    createMaterialOutputItem("CustomizedUV7", "Customized UV 7 output"),
    createMaterialOutputItem("CustomizedUVs0", "Alias of CustomizedUV0"),
    createMaterialOutputItem("CustomizedUVs1", "Alias of CustomizedUV1"),
    createMaterialOutputItem("CustomizedUVs2", "Alias of CustomizedUV2"),
    createMaterialOutputItem("CustomizedUVs3", "Alias of CustomizedUV3"),
    createMaterialOutputItem("CustomizedUVs4", "Alias of CustomizedUV4"),
    createMaterialOutputItem("CustomizedUVs5", "Alias of CustomizedUV5"),
    createMaterialOutputItem("CustomizedUVs6", "Alias of CustomizedUV6"),
    createMaterialOutputItem("CustomizedUVs7", "Alias of CustomizedUV7"),
    createMaterialOutputItem("MooaEncodedAttribute0", "Mooa encoded attribute 0 output"),
    createMaterialOutputItem("MooaEncodedAttribute1", "Mooa encoded attribute 1 output"),
    createMaterialOutputItem("MooaEncodedAttribute2", "Mooa encoded attribute 2 output"),
    createMaterialOutputItem("MooaEncodedAttribute3", "Mooa encoded attribute 3 output"),
    createMaterialOutputItem("MooaEncodedAttribute4", "Mooa encoded attribute 4 output"),
    createMaterialOutputItem("Anisotropy", "Anisotropy output"),
    createMaterialOutputItem("Tangent", "Tangent output")
];

const MATERIAL_OUTPUT_NAME_SET = new Set(MATERIAL_OUTPUT_ITEMS.map((item) => String(item.name || "").trim().toLowerCase()));
const MATERIAL_ATTRIBUTE_MEMBER_ITEMS = MATERIAL_OUTPUT_ITEMS.filter((item) => !["materialattributes", "frontmaterial"].includes(normalizeSymbolKey(item.name)));
const MATERIAL_ATTRIBUTE_MEMBER_NAME_SET = new Set(MATERIAL_ATTRIBUTE_MEMBER_ITEMS.map((item) => String(item.name || "").trim().toLowerCase()));

const SUBSTRATE_BUILTIN_ITEMS = [
    createSubstrateBuiltinItem("Unlit", "Substrate.Unlit(EmissiveColor=${1:Color})", "Creates a Substrate unlit BSDF.", [
        { qualifier: "in", type: "value", name: "EmissiveColor" }
    ], "Substrate.Unlit(EmissiveColor=Color)"),
    createSubstrateBuiltinItem("SimpleClearCoat", "Substrate.SimpleClearCoat(Base=${1:Base}, Coat=${2:Coat}, Weight=${3:1.0})", "Creates a Substrate simple clear coat BSDF.", [
        { qualifier: "in", type: "Substrate", name: "Base" },
        { qualifier: "in", type: "Substrate", name: "Coat" },
        { qualifier: "in", type: "value", name: "Weight" }
    ], "Substrate.SimpleClearCoat(Base=Base, Coat=Coat, Weight=1.0)"),
    createSubstrateBuiltinItem("HorizontalMixing", "Substrate.HorizontalMixing(A=${1:A}, B=${2:B}, Alpha=${3:Alpha})", "Alias of Substrate.HorizontalMix.", [
        { qualifier: "in", type: "Substrate", name: "A" },
        { qualifier: "in", type: "Substrate", name: "B" },
        { qualifier: "in", type: "value", name: "Alpha" }
    ], "Substrate.HorizontalMixing(A=A, B=B, Alpha=Alpha)"),
    createSubstrateBuiltinItem("Slab", "Substrate.Slab(DiffuseAlbedo=${1:Color}, F0=${2:float3(0.04, 0.04, 0.04)}, Roughness=${3:0.45})", "Creates a Substrate slab BSDF.", [
        { qualifier: "in", type: "value", name: "DiffuseAlbedo" },
        { qualifier: "in", type: "value", name: "F0" },
        { qualifier: "in", type: "value", name: "Roughness" },
        { qualifier: "in", type: "value", name: "Normal" }
    ], "Substrate.Slab(DiffuseAlbedo=Color, F0=float3(0.04, 0.04, 0.04), Roughness=0.45)"),
    createSubstrateBuiltinItem("ShadingModels", "Substrate.ShadingModels()", "Creates a Substrate shading-model node.", [], "Substrate.ShadingModels()"),
    createSubstrateBuiltinItem("VolumetricFogCloud", "Substrate.VolumetricFogCloud()", "Creates a Substrate volumetric fog/cloud BSDF.", [], "Substrate.VolumetricFogCloud()"),
    createSubstrateBuiltinItem("Hair", "Substrate.Hair()", "Creates a Substrate hair BSDF.", [], "Substrate.Hair()"),
    createSubstrateBuiltinItem("Eye", "Substrate.Eye()", "Creates a Substrate eye BSDF.", [], "Substrate.Eye()"),
    createSubstrateBuiltinItem("SingleLayerWater", "Substrate.SingleLayerWater()", "Creates a Substrate single-layer water BSDF.", [], "Substrate.SingleLayerWater()"),
    createSubstrateBuiltinItem("LightFunction", "Substrate.LightFunction()", "Creates a Substrate light function material.", [], "Substrate.LightFunction()"),
    createSubstrateBuiltinItem("PostProcess", "Substrate.PostProcess()", "Creates a Substrate post-process material.", [], "Substrate.PostProcess()"),
    createSubstrateBuiltinItem("UI", "Substrate.UI()", "Creates a Substrate UI material.", [], "Substrate.UI()"),
    createSubstrateBuiltinItem("ConvertMaterialAttributes", "Substrate.ConvertMaterialAttributes(Attributes=${1:Attrs})", "Converts MaterialAttributes to a Substrate material.", [
        { qualifier: "in", type: "MaterialAttributes", name: "Attributes" }
    ], "Substrate.ConvertMaterialAttributes(Attributes=Attrs)"),
    createSubstrateBuiltinItem("ConvertToDecal", "Substrate.ConvertToDecal(Material=${1:Surface})", "Converts a Substrate material to decal output.", [
        { qualifier: "in", type: "Substrate", name: "Material" }
    ], "Substrate.ConvertToDecal(Material=Surface)"),
    createSubstrateBuiltinItem("HorizontalMix", "Substrate.HorizontalMix(A=${1:A}, B=${2:B}, Alpha=${3:Alpha})", "Horizontally mixes two Substrate materials.", [
        { qualifier: "in", type: "Substrate", name: "A" },
        { qualifier: "in", type: "Substrate", name: "B" },
        { qualifier: "in", type: "value", name: "Alpha" }
    ], "Substrate.HorizontalMix(A=A, B=B, Alpha=Alpha)"),
    createSubstrateBuiltinItem("VerticalLayer", "Substrate.VerticalLayer(Top=${1:Top}, Base=${2:Base}, Thickness=${3:0.01})", "Layers one Substrate material over another.", [
        { qualifier: "in", type: "Substrate", name: "Top" },
        { qualifier: "in", type: "Substrate", name: "Base" },
        { qualifier: "in", type: "value", name: "Thickness" }
    ], "Substrate.VerticalLayer(Top=TopLayer, Base=BaseLayer, Thickness=0.01)"),
    createSubstrateBuiltinItem("VerticalLayering", "Substrate.VerticalLayering(Top=${1:Top}, Base=${2:Base}, Thickness=${3:0.01})", "Alias of Substrate.VerticalLayer.", [
        { qualifier: "in", type: "Substrate", name: "Top" },
        { qualifier: "in", type: "Substrate", name: "Base" },
        { qualifier: "in", type: "value", name: "Thickness" }
    ], "Substrate.VerticalLayering(Top=TopLayer, Base=BaseLayer, Thickness=0.01)"),
    createSubstrateBuiltinItem("Add", "Substrate.Add(A=${1:A}, B=${2:B})", "Adds two Substrate materials.", [
        { qualifier: "in", type: "Substrate", name: "A" },
        { qualifier: "in", type: "Substrate", name: "B" }
    ], "Substrate.Add(A=A, B=B)"),
    createSubstrateBuiltinItem("Weight", "Substrate.Weight(A=${1:Surface}, Weight=${2:1.0})", "Weights a Substrate material.", [
        { qualifier: "in", type: "Substrate", name: "A" },
        { qualifier: "in", type: "value", name: "Weight" }
    ], "Substrate.Weight(A=Surface, Weight=1.0)"),
    createSubstrateBuiltinItem("Select", "Substrate.Select(A=${1:A}, B=${2:B}, Alpha=${3:Alpha})", "Selects between Substrate materials.", [
        { qualifier: "in", type: "Substrate", name: "A" },
        { qualifier: "in", type: "Substrate", name: "B" },
        { qualifier: "in", type: "value", name: "Alpha" }
    ], "Substrate.Select(A=A, B=B, Alpha=Alpha)"),
    createSubstrateBuiltinItem("TransmittanceToMFP", "Substrate.TransmittanceToMFP(TransmittanceColor=${1:Color}, Thickness=${2:1.0})", "Converts transmittance to mean free path values.", [
        { qualifier: "in", type: "value", name: "TransmittanceColor" },
        { qualifier: "in", type: "value", name: "Thickness" }
    ], "Substrate.TransmittanceToMFP(TransmittanceColor=Color, Thickness=1.0)"),
    createSubstrateBuiltinItem("MetalnessToDiffuseAlbedoF0", "Substrate.MetalnessToDiffuseAlbedoF0(BaseColor=${1:Color}, Metallic=${2:Metallic})", "Converts metalness workflow values to diffuse albedo and F0.", [
        { qualifier: "in", type: "value", name: "BaseColor" },
        { qualifier: "in", type: "value", name: "Metallic" }
    ], "Substrate.MetalnessToDiffuseAlbedoF0(BaseColor=Color, Metallic=Metallic)"),
    createSubstrateBuiltinItem("HazinessToSecondaryRoughness", "Substrate.HazinessToSecondaryRoughness(Haziness=${1:0.0}, BaseRoughness=${2:Roughness})", "Converts haziness to secondary roughness.", [
        { qualifier: "in", type: "value", name: "Haziness" },
        { qualifier: "in", type: "value", name: "BaseRoughness" }
    ], "Substrate.HazinessToSecondaryRoughness(Haziness=0.0, BaseRoughness=Roughness)"),
    createSubstrateBuiltinItem("ThinFilm", "Substrate.ThinFilm(FilmThickness=${1:500.0}, FilmIor=${2:1.4})", "Creates Substrate thin-film interference helper output.", [
        { qualifier: "in", type: "value", name: "FilmThickness" },
        { qualifier: "in", type: "value", name: "FilmIor" }
    ], "Substrate.ThinFilm(FilmThickness=500.0, FilmIor=1.4)", {
        outputType: "float1",
        isSubstrateOutput: false,
        outputs: [
            { index: 0, name: "Specular Color", outputType: "float1", componentCount: 1 },
            { index: 1, name: "Edge Specular Color", outputType: "float1", componentCount: 1 }
        ]
    })
];

const OUTPUT_HELPER_ITEMS = [
    {
        name: "Base",
        snippet: "Base.$0",
        detail: "Root material output namespace. Material properties must be assigned through Base.*."
    },
    {
        name: "Expression(...).Pin[n]",
        snippet: "Expression(Class=\"${1:ThinTranslucentMaterialOutput}\").Pin[${2:0}] = $0;",
        detail: "Binds a value to an auxiliary material output node pin."
    },
    {
        name: "ThinTranslucentMaterialOutput",
        snippet: "Expression(Class=\"ThinTranslucentMaterialOutput\").Pin[${1:0}] = $0;",
        detail: "Creates a ThinTranslucentMaterialOutput binding in Outputs."
    },
    {
        name: "TangentOutput",
        snippet: "Expression(Class=\"TangentOutput\").Pin[${1:0}] = $0;",
        detail: "Creates a TangentOutput binding in Outputs."
    }
];

const UE_BUILTINS = [
    createUEBuiltinItem(
        "TexCoord",
        "UE.TexCoord(Index=${1:0})",
        "Creates a TextureCoordinate material expression.",
        [
            { qualifier: "in", type: "int", name: "Index" },
            { qualifier: "in", type: "float", name: "UTiling" },
            { qualifier: "in", type: "float", name: "VTiling" },
            { qualifier: "in", type: "bool", name: "UnMirrorU" },
            { qualifier: "in", type: "bool", name: "UnMirrorV" }
        ],
        "UE.TexCoord(Index=0)"
    ),
    createUEBuiltinItem(
        "Time",
        "UE.Time(Period=${1:4.0})",
        "Creates a Time material expression.",
        [
            { qualifier: "in", type: "float", name: "Period" },
            { qualifier: "in", type: "bool", name: "IgnorePause" }
        ],
        "UE.Time(Period=4.0)"
    ),
    createUEBuiltinItem(
        "Panner",
        "UE.Panner(Coordinate=${1:UV}, Time=${2:UE.Time()}, Speed=${3:float2(0.1, 0.0)})",
        "Creates a Panner material expression.",
        [
            { qualifier: "in", type: "float2", name: "Coordinate" },
            { qualifier: "in", type: "float", name: "Time" },
            { qualifier: "in", type: "float2", name: "Speed" },
            { qualifier: "in", type: "float", name: "SpeedX" },
            { qualifier: "in", type: "float", name: "SpeedY" },
            { qualifier: "in", type: "bool", name: "FractionalPart" }
        ],
        "UE.Panner(Coordinate=UV, Time=UE.Time(), Speed=float2(0.1, 0.0))"
    ),
    createUEBuiltinItem("WorldPosition", "UE.WorldPosition()", "Creates a WorldPosition material expression.", [], "UE.WorldPosition()"),
    createUEBuiltinItem("ObjectPositionWS", "UE.ObjectPositionWS()", "Creates an ObjectPositionWS material expression.", [], "UE.ObjectPositionWS()"),
    createUEBuiltinItem("CameraVectorWS", "UE.CameraVectorWS()", "Creates a CameraVectorWS material expression.", [], "UE.CameraVectorWS()"),
    createUEBuiltinItem("ScreenPosition", "UE.ScreenPosition()", "Creates a ScreenPosition material expression.", [], "UE.ScreenPosition()"),
    createUEBuiltinItem("VertexColor", "UE.VertexColor()", "Creates a VertexColor material expression.", [], "UE.VertexColor()"),
    createUEBuiltinItem(
        "TransformVector",
        "UE.TransformVector(Input=${1:NormalTS}, Source=\"${2:Tangent}\", Destination=\"${3:World}\")",
        "Creates a TransformVector material expression.",
        [
            { qualifier: "in", type: "float3", name: "Input" },
            { qualifier: "in", type: "string", name: "Source" },
            { qualifier: "in", type: "string", name: "Destination" }
        ],
        "UE.TransformVector(Input=NormalTS, Source=\"Tangent\", Destination=\"World\")"
    ),
    createUEBuiltinItem(
        "TransformPosition",
        "UE.TransformPosition(Input=${1:WorldPos}, Source=\"${2:Local}\", Destination=\"${3:World}\")",
        "Creates a TransformPosition material expression.",
        [
            { qualifier: "in", type: "float3", name: "Input" },
            { qualifier: "in", type: "string", name: "Source" },
            { qualifier: "in", type: "string", name: "Destination" },
            { qualifier: "in", type: "float3", name: "PeriodicWorldTileSize" },
            { qualifier: "in", type: "float", name: "FirstPersonInterpolationAlpha" }
        ],
        "UE.TransformPosition(Input=WorldPos, Source=\"Local\", Destination=\"World\")"
    ),
    createUEBuiltinItem(
        "Expression",
        "UE.Expression(Class=\"${1:Sine}\", OutputType=\"${2:float1}\", Input=${3:UE.Time()})",
        "Creates any reflected MaterialExpression class.",
        [
            { qualifier: "in", type: "string", name: "Class" },
            { qualifier: "in", type: "string", name: "OutputType" },
            { qualifier: "in", type: "string", name: "ResultType" },
            { qualifier: "in", type: "string", name: "Output" },
            { qualifier: "in", type: "string", name: "OutputName" },
            { qualifier: "in", type: "int", name: "OutputIndex" },
            // Input/A/B are generic expression-wire slots whose real type depends on which Class is
            // chosen -- there's no single fixed type to show for this generic escape hatch (unlike a
            // specific reflected node's own hover, which can name its actual pin type).
            { qualifier: "in", type: "value", name: "Input" },
            { qualifier: "in", type: "value", name: "A" },
            { qualifier: "in", type: "value", name: "B" },
            { qualifier: "in", type: "value", name: "True" },
            { qualifier: "in", type: "value", name: "False" },
            { qualifier: "in", type: "string", name: "ParameterName" },
            { qualifier: "in", type: "float", name: "DefaultValue" },
            { qualifier: "in", type: "bool", name: "DefaultR" },
            { qualifier: "in", type: "bool", name: "DefaultG" },
            { qualifier: "in", type: "bool", name: "DefaultB" },
            { qualifier: "in", type: "bool", name: "DefaultA" },
            { qualifier: "in", type: "Path", name: "Texture" },
            { qualifier: "in", type: "Path", name: "TextureObject" },
            { qualifier: "in", type: "Path", name: "Curve" },
            { qualifier: "in", type: "Path", name: "Atlas" },
            { qualifier: "in", type: "float", name: "CurveTime" },
            { qualifier: "in", type: "float2", name: "Coordinates" },
            { qualifier: "in", type: "float", name: "MipValue" },
            { qualifier: "in", type: "float2", name: "CoordinatesDX" },
            { qualifier: "in", type: "float2", name: "CoordinatesDY" },
            { qualifier: "in", type: "float", name: "AutomaticViewMipBiasValue" },
            { qualifier: "in", type: "string", name: "SamplerType" },
            { qualifier: "in", type: "string", name: "SamplerSource" },
            { qualifier: "in", type: "string", name: "MipValueMode" },
            { qualifier: "in", type: "string", name: "GatherMode" },
            { qualifier: "in", type: "bool", name: "AutomaticViewMipBias" },
            { qualifier: "in", type: "int", name: "ConstCoordinate" },
            { qualifier: "in", type: "int", name: "ConstMipValue" },
            { qualifier: "in", type: "bool", name: "UseCustomPrimitiveData" },
            { qualifier: "in", type: "int", name: "PrimitiveDataIndex" },
            { qualifier: "in", type: "bool", name: "DynamicBranch" },
            { qualifier: "in", type: "string", name: "Code" },
            { qualifier: "in", type: "string", name: "Description" },
            { qualifier: "in", type: "string", name: "Desc" },
            { qualifier: "in", type: "string", name: "Group" },
            { qualifier: "in", type: "int", name: "SortPriority" }
        ],
        "UE.Expression(Class=\"Sine\", OutputType=\"float1\", Input=UE.Time())"
    ),
    createUEBuiltinItem(
        "CollectionParam",
        "UE.CollectionParam(Collection=Path(${1:Game}, ${2:MaterialParameterCollections/MPC_Global}), Parameter=\"${3:Value}\")",
        "Reads a scalar or vector from a MaterialParameterCollection.",
        [
            { qualifier: "in", type: "Path", name: "Collection" },
            { qualifier: "in", type: "string", name: "Parameter" },
            { qualifier: "in", type: "string", name: "Group" },
            { qualifier: "in", type: "int", name: "SortPriority" },
            { qualifier: "in", type: "string", name: "Description" }
        ],
        "UE.CollectionParam(Collection=Path(Game, MaterialParameterCollections/MPC_Global), Parameter=\"Value\")"
    ),
    createUEBuiltinItem(
        "StaticSwitchParameter",
        "UE.StaticSwitchParameter(Name=\"${1:UseDetail}\", Default=${2:true}, True=${3:Detail}, False=${4:Base})",
        "Creates an inline StaticSwitchParameter with True and False branches.",
        [
            { qualifier: "in", type: "string", name: "Name" },
            { qualifier: "in", type: "string", name: "ParameterName" },
            { qualifier: "in", type: "bool", name: "Default" },
            { qualifier: "in", type: "bool", name: "DefaultValue" },
            // True/False are the branch-value wires -- whatever type flows through both sides.
            { qualifier: "in", type: "value", name: "True" },
            { qualifier: "in", type: "value", name: "False" },
            { qualifier: "in", type: "bool", name: "DynamicBranch" },
            { qualifier: "in", type: "string", name: "Group" },
            { qualifier: "in", type: "int", name: "SortPriority" },
            { qualifier: "in", type: "string", name: "Description" }
        ],
        "UE.StaticSwitchParameter(Name=\"UseDetail\", Default=true, True=Detail, False=Base)"
    ),
    createUEBuiltinItem(
        "StaticComponentMaskParameter",
        "UE.StaticComponentMaskParameter(OutputType=\"${1:float3}\", Input=${2:Value}, ParameterName=\"${3:Mask}\", DefaultR=${4:true}, DefaultG=${5:true}, DefaultB=${6:true}, DefaultA=${7:false})",
        "Creates a reflected StaticComponentMaskParameter node.",
        [
            { qualifier: "in", type: "string", name: "OutputType" },
            // Input is the vector being masked -- its component count follows OutputType, not a fixed type.
            { qualifier: "in", type: "value", name: "Input" },
            { qualifier: "in", type: "string", name: "ParameterName" },
            { qualifier: "in", type: "bool", name: "DefaultR" },
            { qualifier: "in", type: "bool", name: "DefaultG" },
            { qualifier: "in", type: "bool", name: "DefaultB" },
            { qualifier: "in", type: "bool", name: "DefaultA" },
            { qualifier: "in", type: "string", name: "Group" },
            { qualifier: "in", type: "int", name: "SortPriority" },
            { qualifier: "in", type: "string", name: "Description" }
        ],
        "UE.StaticComponentMaskParameter(OutputType=\"float3\", Input=Value, ParameterName=\"Mask\", DefaultR=true, DefaultG=true, DefaultB=true, DefaultA=false)"
    ),
    createUEBuiltinItem(
        "CurveAtlasRowParameter",
        "UE.CurveAtlasRowParameter(OutputType=\"${1:float3}\", ParameterName=\"${2:CurveColor}\", DefaultValue=${3:0.0}, Curve=Path(${4:Game}, \"${5:Curves/C_Color}\"), Atlas=Path(${6:Game}, \"${7:Curves/CA_Atlas}\"), CurveTime=${8:0.0})",
        "Creates a reflected CurveAtlasRowParameter node. Its primary output is a 3-component color.",
        [
            { qualifier: "in", type: "string", name: "OutputType" },
            { qualifier: "in", type: "string", name: "ParameterName" },
            { qualifier: "in", type: "float", name: "DefaultValue" },
            { qualifier: "in", type: "Path", name: "Curve" },
            { qualifier: "in", type: "Path", name: "Atlas" },
            { qualifier: "in", type: "float", name: "CurveTime" },
            { qualifier: "in", type: "bool", name: "UseCustomPrimitiveData" },
            { qualifier: "in", type: "int", name: "PrimitiveDataIndex" },
            { qualifier: "in", type: "string", name: "Group" },
            { qualifier: "in", type: "int", name: "SortPriority" },
            { qualifier: "in", type: "string", name: "Description" },
            { qualifier: "in", type: "string", name: "Desc" }
        ],
        "UE.CurveAtlasRowParameter(OutputType=\"float3\", ParameterName=\"CurveColor\", DefaultValue=0.0)"
    )
];

module.exports = {
    DREAMSHADER_KEYWORD_COMPLETIONS,
    DREAMSHADER_TEMPLATE_COMPLETIONS,
    LANGUAGE_ID,
    BRIDGE_DIAGNOSTIC_COLLECTION_NAME,
    LOCAL_DIAGNOSTIC_COLLECTION_NAME,
    DREAMSHADER_EXTENSIONS,
    INDENT,
    PACKAGE_MANIFEST_NAME,
    PACKAGE_LOCK_NAME,
    MATERIAL_EXPRESSION_MANIFEST_NAME,
    SETTINGS_MANIFEST_NAME,
    DEFAULT_PACKAGE_INDEX_URL,
    SEMANTIC_TOKEN_TYPES,
    SEMANTIC_TOKEN_MODIFIERS,
    LEGACY_SECTION_NAMES,
    TOP_LEVEL_BLOCK_NAMES,
    QUALIFIER_ITEMS,
    FUNCTION_MODIFIER_ITEMS,
    GRAPH_TYPE_ITEMS,
    HLSL_TYPE_ITEMS,
    HLSL_KEYWORD_ITEMS,
    PREPROCESSOR_DIRECTIVE_ITEMS,
    PREPROCESSOR_DEFINED_ITEM,
    PREPROCESSOR_BUILTIN_DEFINE_ITEMS,
    PREPROCESSOR_BUILTIN_DEFINE_NAME_SET,
    SETTINGS_ITEMS,
    VIRTUAL_FUNCTION_OPTION_ITEMS,
    MATERIAL_OUTPUT_ITEMS,
    MATERIAL_OUTPUT_NAME_SET,
    MATERIAL_ATTRIBUTE_MEMBER_ITEMS,
    MATERIAL_ATTRIBUTE_MEMBER_NAME_SET,
    SUBSTRATE_BUILTIN_ITEMS,
    OUTPUT_HELPER_ITEMS,
    UE_BUILTINS,
    createUEBuiltinItemFromManifestExpression,
    getBundledMaterialExpressionBuiltinItems
};
