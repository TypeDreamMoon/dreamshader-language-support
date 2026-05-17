"use strict";

const {
    DREAMSHADER_KEYWORD_COMPLETIONS,
    DREAMSHADER_TEMPLATE_COMPLETIONS
} = require("../../templates");
const {
    QUALIFIER_ITEMS,
    FUNCTION_MODIFIER_ITEMS,
    GRAPH_TYPE_ITEMS,
    HLSL_TYPE_ITEMS,
    HLSL_KEYWORD_ITEMS,
    SETTINGS_ITEMS,
    VIRTUAL_FUNCTION_OPTION_ITEMS,
    MATERIAL_OUTPUT_ITEMS,
    MATERIAL_ATTRIBUTE_MEMBER_ITEMS,
    OUTPUT_HELPER_ITEMS,
    UE_BUILTINS,
    getBundledMaterialExpressionBuiltinItems
} = require("../languageData");
const { analyzeContext } = require("./context");
const { collectSymbols, collectCallables } = require("./symbols");
const { normalizeSymbolKey, stripCommentsPreserveLayout } = require("./utils");

const HLSL_INTRINSIC_ITEMS = [
    ["abs", "abs(${1:x})", "Absolute value"],
    ["acos", "acos(${1:x})", "Arc cosine"],
    ["asin", "asin(${1:x})", "Arc sine"],
    ["atan", "atan(${1:x})", "Arc tangent"],
    ["atan2", "atan2(${1:y}, ${2:x})", "Arc tangent of y/x"],
    ["ceil", "ceil(${1:x})", "Ceiling"],
    ["clamp", "clamp(${1:x}, ${2:minValue}, ${3:maxValue})", "Clamp to range"],
    ["cos", "cos(${1:x})", "Cosine"],
    ["cross", "cross(${1:a}, ${2:b})", "Vector cross product"],
    ["ddx", "ddx(${1:x})", "Screen-space derivative X"],
    ["ddy", "ddy(${1:x})", "Screen-space derivative Y"],
    ["distance", "distance(${1:a}, ${2:b})", "Distance between values"],
    ["dot", "dot(${1:a}, ${2:b})", "Vector dot product"],
    ["exp", "exp(${1:x})", "Base-e exponent"],
    ["exp2", "exp2(${1:x})", "Base-2 exponent"],
    ["floor", "floor(${1:x})", "Floor"],
    ["frac", "frac(${1:x})", "Fractional part"],
    ["fract", "frac(${1:x})", "GLSL-style alias for frac"],
    ["fmod", "fmod(${1:x}, ${2:y})", "Floating-point remainder"],
    ["length", "length(${1:x})", "Vector length"],
    ["lerp", "lerp(${1:a}, ${2:b}, ${3:alpha})", "Linear interpolation"],
    ["mix", "lerp(${1:a}, ${2:b}, ${3:alpha})", "GLSL-style alias for lerp"],
    ["log", "log(${1:x})", "Natural logarithm"],
    ["log2", "log2(${1:x})", "Base-2 logarithm"],
    ["max", "max(${1:a}, ${2:b})", "Maximum"],
    ["min", "min(${1:a}, ${2:b})", "Minimum"],
    ["mul", "mul(${1:a}, ${2:b})", "Matrix/vector multiply"],
    ["mod", "fmod(${1:x}, ${2:y})", "GLSL-style alias for fmod"],
    ["normalize", "normalize(${1:x})", "Normalize vector"],
    ["pow", "pow(${1:x}, ${2:y})", "Power"],
    ["reflect", "reflect(${1:i}, ${2:n})", "Reflection vector"],
    ["rsqrt", "rsqrt(${1:x})", "Reciprocal square root"],
    ["saturate", "saturate(${1:x})", "Clamp to 0..1"],
    ["sin", "sin(${1:x})", "Sine"],
    ["smoothstep", "smoothstep(${1:minValue}, ${2:maxValue}, ${3:x})", "Smooth Hermite interpolation"],
    ["sqrt", "sqrt(${1:x})", "Square root"],
    ["step", "step(${1:y}, ${2:x})", "Step comparison"],
    ["tan", "tan(${1:x})", "Tangent"]
];

const SETTING_MAPPING_FALLBACKS = new Map([
    ["MaterialDomain", ["Surface", "DeferredDecal", "LightFunction", "PostProcess", "UserInterface", "UI", "VirtualTexture"]],
    ["ShadingModel", [
        "DefaultLit", "Lit", "Unlit", "Subsurface", "PreintegratedSkin", "ClearCoat",
        "SubsurfaceProfile", "TwoSidedFoliage", "Hair", "Cloth", "Eye", "SingleLayerWater",
        "ThinTranslucent", "Substrate", "Strata"
    ]],
    ["BlendMode", ["Opaque", "Masked", "Cutout", "Translucent", "Transparent", "Additive", "Modulate", "AlphaComposite", "AlphaHoldout"]]
]);

const METADATA_ITEMS = [
    ["Group", "Group=\"${1:General}\"", "Material parameter group"],
    ["Category", "Category=\"${1:General}\"", "Alias of Group"],
    ["SortPriority", "SortPriority=${1:32}", "Material parameter sort priority"],
    ["Sort", "Sort=${1:32}", "Alias of SortPriority"],
    ["Description", "Description=\"${1:Description}\"", "Editor tooltip text"],
    ["Desc", "Desc=\"${1:Description}\"", "Alias of Description"],
    ["Tooltip", "Tooltip=\"${1:Description}\"", "Alias of Description"],
    ["DisplayName", "DisplayName=\"${1:Name}\"", "Editor display name"],
    ["ParameterName", "ParameterName=\"${1:Parameter}\"", "Reflected MaterialExpression parameter name"],
    ["DefaultValue", "DefaultValue=${1:0.0}", "Reflected MaterialExpression default value"],
    ["Curve", "Curve=Path(${1:Game}, \"${2:Curves/C_Color}\")", "Curve asset for CurveAtlasRowParameter"],
    ["Atlas", "Atlas=Path(${1:Game}, \"${2:Curves/CA_Atlas}\")", "Curve atlas asset for CurveAtlasRowParameter"],
    ["CurveTime", "CurveTime=${1:0.0}", "Curve time input for CurveAtlasRowParameter"],
    ["UseCustomPrimitiveData", "UseCustomPrimitiveData=${1:false}", "Use custom primitive data for a reflected parameter"],
    ["PrimitiveDataIndex", "PrimitiveDataIndex=${1:0}", "Custom primitive data slot index"],
    ["SamplerType", "SamplerType=\"${1|Color,LinearColor,Grayscale,Normal,Masks,DistanceFieldFont,Alpha,SAMPLERTYPE_Color,SAMPLERTYPE_LinearColor,SAMPLERTYPE_Grayscale,SAMPLERTYPE_Normal,SAMPLERTYPE_Masks,SAMPLERTYPE_DistanceFieldFont,SAMPLERTYPE_Alpha|}\"", "Texture sampler type"],
    ["SamplerSource", "SamplerSource=\"${1|FromTextureAsset,SharedWrap,SharedClamp,SSM_FromTextureAsset,SSM_Wrap_WorldGroupSettings,SSM_Clamp_WorldGroupSettings|}\"", "Texture sampler source"],
    ["MipValueMode", "MipValueMode=\"${1|None,MipLevel,MipBias,Derivative,TMVM_None,TMVM_MipLevel,TMVM_MipBias,TMVM_Derivative|}\"", "Texture mip value mode"],
    ["GatherMode", "GatherMode=\"${1|None,Red,Green,Blue,Alpha,TGM_None,TGM_Red,TGM_Green,TGM_Blue,TGM_Alpha|}\"", "Texture gather mode"],
    ["AutomaticViewMipBias", "AutomaticViewMipBias=${1:true}", "Apply automatic view mip bias"],
    ["AutomaticViewMipBiasValue", "AutomaticViewMipBiasValue=${1:0.0}", "Automatic view mip bias input"],
    ["Coordinates", "Coordinates=${1:UV}", "Texture sample coordinates"],
    ["MipValue", "MipValue=${1:0.0}", "Texture mip value input"],
    ["CoordinatesDX", "CoordinatesDX=${1:ddx(UV)}", "Texture derivative X input"],
    ["CoordinatesDY", "CoordinatesDY=${1:ddy(UV)}", "Texture derivative Y input"],
    ["ConstCoordinate", "ConstCoordinate=${1:0}", "Texture coordinate channel"],
    ["ConstMipValue", "ConstMipValue=${1:-1}", "Texture mip override"]
];

const SUBSTRATE_GRAPH_ITEMS = [
    ["SubstrateSlabBSDF", "UE.SubstrateSlabBSDF(BaseColor=${1:Color}, Roughness=${2:Roughness}, Normal=${3:Normal})", "Create a Substrate slab BSDF graph node"],
    ["SubstrateSimpleClearCoat", "UE.SubstrateSimpleClearCoat(Base=${1:Base}, Coat=${2:Coat}, Weight=${3:1.0})", "Create a Substrate clear coat operator"],
    ["SubstrateHorizontalMixing", "UE.SubstrateHorizontalMixing(A=${1:A}, B=${2:B}, Alpha=${3:Alpha})", "Mix two Substrate materials horizontally"],
    ["SubstrateVerticalLayering", "UE.SubstrateVerticalLayering(Top=${1:Top}, Bottom=${2:Bottom}, Thickness=${3:1.0})", "Layer Substrate materials vertically"],
    ["SubstrateAdd", "UE.SubstrateAdd(A=${1:A}, B=${2:B})", "Add two Substrate materials"]
];

const DECLARATION_SNIPPET_ITEMS = [
    ["metadata", "[\n\tGroup=\"${1:General}\";\n\tSortPriority=${2:32};\n\tDescription=\"${3:Description}\";\n]", "DreamShader reflected parameter metadata"],
    ["opt", "opt ${1:float} ${2:Value} = ${3:0.0};", "Optional ShaderFunction / VirtualFunction input"],
    ["const", "const ${1:float} ${2:Value} = ${3:0.0};", "Const helper node"],
    ["optinput", "opt ${1:float4} ${2:Color} = ${3:float4(1.0, 1.0, 1.0, 1.0)} [\n\tDescription=\"${4:Optional input}\";\n\tSortPriority=${5:32};\n];", "Optional input declaration"],
    ["staticswitch", "StaticSwitchParameter ${1:UseDetail} = ${2:true} [\n\tGroup=\"${3:Switches}\";\n\tSortPriority=${4:32};\n\tDescription=\"${5:Use detail branch}\";\n];", "Static switch parameter"],
    ["texparam", "TextureSampleParameter2D ${1:AlbedoMap} = Path(${2:Game}, \"${3:Textures/T_White}\") [\n\tGroup=\"${4:Textures}\";\n\tSortPriority=${5:10};\n\tSamplerType=\"${6:Color}\";\n\tSamplerSource=\"${7:FromTextureAsset}\";\n];", "Texture sample parameter"],
    ["constprop", "const ${1:float} ${2:Value} = ${3:0.0};", "Const property declaration"]
];

const GRAPH_SNIPPET_ITEMS = [
    ["uepanner", "UE.Panner(\n\tCoordinate=UE.TexCoord(Index=${1:0}),\n\tTime=UE.Time(Period=${2:4.0}),\n\tSpeed=float2(${3:0.05}, ${4:0.0}))", "UE.Panner call"],
    ["ueexpr", "UE.Expression(\n\tClass=\"${1:Sine}\",\n\tOutputType=\"${2:float1}\",\n\t${3:Input}=${4:Value})", "Reflected MaterialExpression call"],
    ["uestaticmask", "UE.StaticComponentMaskParameter(\n\tOutputType=\"${1:float3}\",\n\tInput=${2:Value},\n\tParameterName=\"${3:Mask}\",\n\tDefaultR=${4:true},\n\tDefaultG=${5:true},\n\tDefaultB=${6:true},\n\tDefaultA=${7:false})", "Reflected StaticComponentMaskParameter call"],
    ["uecurveatlas", "UE.CurveAtlasRowParameter(\n\tOutputType=\"${1:float3}\",\n\tParameterName=\"${2:CurveColor}\",\n\tDefaultValue=${3:0.0},\n\tCurve=Path(${4:Game}, \"${5:Curves/C_Color}\"),\n\tAtlas=Path(${6:Game}, \"${7:Curves/CA_Atlas}\"),\n\tCurveTime=${8:0.0})", "Reflected CurveAtlasRowParameter call"],
    ["uetexturesample", "UE.Expression(\n\tClass=\"${1:TextureSample}\",\n\tOutputType=\"${2:float4}\",\n\tCoordinates=${3:UV},\n\tTexture=Path(${4:Game}, \"${5:Textures/T_Texture}\"),\n\tSamplerType=\"${6:SAMPLERTYPE_Color}\")", "Reflected TextureSample call"],
    ["collectionparam", "UE.CollectionParam(Collection=Path(${1:Game}, \"${2:MaterialParameterCollections/MPC_Global}\"), Parameter=\"${3:Value}\")", "MaterialParameterCollection read"]
];

const SWIZZLE_ITEMS = [
    "x", "y", "z", "w", "r", "g", "b", "a",
    "xy", "xyz", "xyzw", "rgb", "rgba"
].map((label) => ({ label, detail: "Vector swizzle" }));

function getCompletionSpecs(text, offset, services = {}) {
    const context = analyzeContext(text, offset);
    const specs = [];
    const add = makeAdder(specs);

    const rootPlugin = getRootPluginValueCompletionInfo(text, offset);
    if (rootPlugin) {
        addPluginNames(add, services, rootPlugin);
        return dedupe(specs);
    }

    const pathPlugin = getPathPluginValueCompletionInfo(text, offset);
    if (pathPlugin) {
        addPluginNames(add, services, pathPlugin);
        return dedupe(specs);
    }

    const materialExpressionClass = getMaterialExpressionClassValueCompletionInfo(text, offset);
    if (materialExpressionClass) {
        for (const expression of callService(services, "collectMaterialExpressionSymbols", [])) {
            add({
                label: expression.name,
                kind: "Class",
                insertText: expression.name,
                detail: expression.className || `MaterialExpression${expression.name}`,
                documentation: `Reflected Unreal material expression class \`${expression.className || expression.name}\`.`,
                range: [materialExpressionClass.replaceStartOffset, materialExpressionClass.replaceEndOffset]
            });
        }
        return dedupe(specs);
    }

    if (context.afterUEAccessor && isGraphLike(context)) {
        addUEBuiltinMembers(add, services, context);
        return dedupe(specs);
    }

    if (context.afterExpressionAccessor && context.kind.startsWith("Outputs")) {
        add({ label: "Pin", kind: "Field", insertText: "Pin[${1:0}] = $0;", detail: "Auxiliary material output node pin binding" });
        return dedupe(specs);
    }

    if (context.afterBaseAccessor && context.kind.startsWith("Outputs")) {
        const range = context.memberAccess
            ? [context.memberAccess.replaceStartOffset, context.memberAccess.replaceEndOffset]
            : undefined;
        for (const output of MATERIAL_OUTPUT_ITEMS) {
            add({
                label: output.name,
                kind: "Field",
                insertText: `${output.name} = $0;`,
                detail: output.qualifiedName,
                documentation: output.detail,
                range
            });
        }
        return dedupe(specs);
    }

    if (isMaterialAttributesMemberAccess(context, services)) {
        const range = context.memberAccess
            ? [context.memberAccess.replaceStartOffset, context.memberAccess.replaceEndOffset]
            : undefined;
        for (const member of MATERIAL_ATTRIBUTE_MEMBER_ITEMS) {
            add({
                label: member.name,
                kind: "Field",
                insertText: member.name,
                detail: `MaterialAttributes.${member.name}`,
                documentation: member.detail,
                range
            });
        }
        return dedupe(specs);
    }

    if (isSwizzleAccess(context, services)) {
        const range = context.memberAccess
            ? [context.memberAccess.replaceStartOffset, context.memberAccess.replaceEndOffset]
            : undefined;
        for (const swizzle of SWIZZLE_ITEMS) {
            add({ label: swizzle.label, kind: "Field", insertText: swizzle.label, detail: swizzle.detail, range });
        }
        return dedupe(specs);
    }

    if (isImportContext(text, offset)) {
        for (const headerPath of callService(services, "collectAvailableHeaderImports", [])) {
            const lowerPath = String(headerPath || "").toLowerCase();
            add({
                label: headerPath,
                kind: "File",
                insertText: headerPath,
                detail: headerPath.startsWith("@")
                    ? "DreamShader package import"
                    : lowerPath.endsWith(".dsf")
                        ? "DreamShader function file import"
                        : "DreamShader header import"
            });
        }
        return dedupe(specs);
    }

    if (context.kind === "TopLevel") {
        addKeywordAndTemplateItems(add);
    }

    if (context.kind === "BlockAttributes") {
        addBlockAttributeItems(add, context);
    }

    if (context.kind === "BlockBody") {
        addSectionItems(add, context);
    }

    if (context.kind === "FunctionSignature") {
        addQualifiers(add);
        addTypeItems(add, "hlsl");
    }

    if (context.kind === "FunctionBody") {
        addTypeItems(add, "hlsl");
        addHlslKeywords(add);
        addHlslIntrinsics(add);
        addReachableFunctions(add, context, services);
        addSymbols(add, context, services);
    }

    if (context.kind === "GraphFunctionBody" || context.kind === "Graph") {
        add({ label: "UE", kind: "Module", insertText: "UE.", detail: "Unreal material graph node namespace" });
        addSymbols(add, context, services);
        addReachableFunctions(add, context, services);
        addTypeItems(add, "graph");
        addHlslKeywords(add);
        addHlslIntrinsics(add);
        addSubstrateGraphItems(add, context);
        addGraphSnippets(add);
        addUEBuiltins(add, services);
    }

    if (context.kind === "Declaration" || context.kind === "OutputsDeclaration" || context.kind === "Outputs") {
        addTypeItems(add, "graph");
        addDeclarationSnippets(add, context);
    }

    if (context.kind === "Metadata") {
        addMetadata(add, context);
    }

    if (context.kind === "SettingKey") {
        addSettings(add, context);
    }

    if (context.kind === "SettingValue") {
        addSettingValues(add, context, services);
    }

    if (context.kind === "OutputsTarget") {
        addOutputTargets(add);
    }

    if (context.kind === "OutputsValue") {
        add({ label: "UE", kind: "Module", insertText: "UE.", detail: "Unreal material graph node namespace" });
        addHlslIntrinsics(add);
        addReachableFunctions(add, context, services);
        addUEBuiltins(add, services);
        addSymbols(add, context, services);
    }

    return dedupe(specs);
}

function makeAdder(specs) {
    return (spec) => {
        if (!spec || !spec.label) {
            return;
        }
        specs.push(spec);
    };
}

function addKeywordAndTemplateItems(add) {
    for (const item of DREAMSHADER_KEYWORD_COMPLETIONS) {
        add({ label: item.label, kind: "Keyword", insertText: item.insertText, detail: item.detail });
    }
    for (const item of DREAMSHADER_TEMPLATE_COMPLETIONS) {
        add({ label: item.label, kind: "Snippet", insertText: item.snippet, detail: item.detail });
    }
}

function addBlockAttributeItems(add, context) {
    const kind = context.block?.kind;
    if (kind === "Namespace" || kind === "VirtualFunction") {
        add({ label: "Name", kind: "Property", insertText: "Name=\"${1:MyFunction}\"", detail: `Required ${kind} name` });
        return;
    }
    add({ label: "Name", kind: "Property", insertText: "Name=\"${1:Materials/MyMaterial}\"", detail: "Generated asset path relative to Root" });
    add({ label: "Root", kind: "Property", insertText: "Root=\"${1:Game}\"", detail: "Generated asset root" });
}

function addSectionItems(add, context) {
    const allowed = allowedSectionsForBlock(context.block?.kind);
    for (const section of allowed) {
        add({ label: section, kind: "Property", insertText: `${section} = {\n\t$0\n}`, detail: `${context.block.kind} ${section} section` });
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
        return ["Options", "Settings", "Inputs", "Outputs", "Results"];
    }
    return [];
}

function addQualifiers(add) {
    for (const [name, detail] of QUALIFIER_ITEMS) {
        add({ label: name, kind: "Keyword", insertText: name, detail });
    }
    for (const [name, detail] of FUNCTION_MODIFIER_ITEMS) {
        add({ label: name, kind: "Keyword", insertText: name, detail });
    }
}

function addTypeItems(add, mode) {
    const items = mode === "hlsl" ? HLSL_TYPE_ITEMS : GRAPH_TYPE_ITEMS;
    for (const [name, detail] of items) {
        add({ label: name, kind: "TypeParameter", insertText: name, detail });
    }
}

function addHlslKeywords(add) {
    for (const [name, detail] of HLSL_KEYWORD_ITEMS) {
        add({ label: name, kind: "Keyword", insertText: name, detail });
    }
}

function addHlslIntrinsics(add) {
    for (const [name, snippet, detail] of HLSL_INTRINSIC_ITEMS) {
        add({ label: name, kind: "Function", insertText: snippet, detail: `HLSL ${detail}` });
    }
}

function addGraphSnippets(add) {
    for (const [label, insertText, detail] of GRAPH_SNIPPET_ITEMS) {
        add({ label, kind: "Snippet", insertText, detail });
    }
}

function addSubstrateGraphItems(add, context) {
    if (!blockUsesSubstrate(context.block)) {
        return;
    }
    for (const [label, insertText, detail] of SUBSTRATE_GRAPH_ITEMS) {
        add({ label, kind: "Function", insertText, detail });
    }
}

function blockUsesSubstrate(block) {
    const settings = (block?.sections || []).find((section) => section.name === "Settings");
    return (settings?.entries || []).some((entry) =>
        entry.kind === "assignment"
        && normalizeSymbolKey(entry.name) === "shadingmodel"
        && ["substrate", "strata"].includes(normalizeSymbolKey(String(entry.value || "").replace(/^"|"$/g, ""))));
}

function addDeclarationSnippets(add, context) {
    for (const [label, insertText, detail] of DECLARATION_SNIPPET_ITEMS) {
        if (label === "opt" && context.section?.name !== "Inputs") {
            continue;
        }
        if (label === "const" && context.section?.name !== "Properties") {
            continue;
        }
        add({ label, kind: label === "metadata" ? "Snippet" : "Keyword", insertText, detail });
    }
}

function addMetadata(add, context) {
    const assignmentRange = getMetadataValueRange(context);
    if (assignmentRange) {
        addMetadataValueItems(add, context.metadata.key, assignmentRange);
        return;
    }
    for (const [label, insertText, detail] of METADATA_ITEMS) {
        add({ label, kind: "Property", insertText, detail });
    }
}

function addMetadataValueItems(add, key, range) {
    const normalized = normalizeSymbolKey(key);
    const values = normalized === "group"
        || normalized === "category"
        ? ["Surface", "Textures", "Layer", "UV", "Switches", "Advanced"]
        : normalized === "description" || normalized === "desc" || normalized === "tooltip" || normalized === "displayname" || normalized === "parametername"
            ? []
        : normalized === "samplertype"
        ? ["Color", "LinearColor", "Grayscale", "Normal", "Masks", "Alpha", "SAMPLERTYPE_Color", "SAMPLERTYPE_LinearColor", "SAMPLERTYPE_Grayscale", "SAMPLERTYPE_Normal", "SAMPLERTYPE_Masks", "SAMPLERTYPE_Alpha"]
        : normalized === "samplersource"
            ? ["FromTextureAsset", "SharedWrap", "SharedClamp", "SSM_FromTextureAsset", "SSM_Wrap_WorldGroupSettings", "SSM_Clamp_WorldGroupSettings"]
        : normalized === "mipvaluemode"
            ? ["None", "MipLevel", "MipBias", "Derivative", "TMVM_None", "TMVM_MipLevel", "TMVM_MipBias", "TMVM_Derivative"]
        : normalized === "gathermode"
            ? ["None", "Red", "Green", "Blue", "Alpha", "TGM_None", "TGM_Red", "TGM_Green", "TGM_Blue", "TGM_Alpha"]
        : normalized === "automaticviewmipbias" || normalized === "usecustomprimitivedata"
            ? ["true", "false"]
        : [];
    for (const value of values) {
        add({ label: value, kind: "EnumMember", insertText: value, range });
    }
}

function getMetadataValueRange(context) {
    if (!context.metadata?.inValue) {
        return null;
    }
    const prefix = context.text.slice(context.metadata.openOffset + 1, context.offset);
    const quoteIndex = Math.max(prefix.lastIndexOf("\""), prefix.lastIndexOf("'"));
    if (quoteIndex >= 0) {
        return [context.metadata.openOffset + 1 + quoteIndex + 1, context.offset];
    }
    const match = /([A-Za-z0-9_]*)$/.exec(prefix);
    const typed = match ? match[1] : "";
    return [context.offset - typed.length, context.offset];
}

function addSettings(add, context) {
    const items = context.section?.name === "Options" ? VIRTUAL_FUNCTION_OPTION_ITEMS : SETTINGS_ITEMS;
    for (const setting of items) {
        add({ label: setting.name, kind: "Property", insertText: setting.insertText, detail: setting.detail });
    }
}

function addSettingValues(add, context, services) {
    const settingName = context.setting?.name || "";
    const mappingName = getSettingMappingNameForKey(settingName);
    if (!mappingName) {
        if (isBooleanSetting(settingName)) {
            add({ label: "true", kind: "Value", insertText: "true" });
            add({ label: "false", kind: "Value", insertText: "false" });
        }
        return;
    }
    const valueInfo = getSettingValueCompletionInfo(context);
    for (const mapping of collectSettingMappings(services, mappingName)) {
        const insertText = valueInfo.isQuoted ? mapping.alias : `"${mapping.alias}"`;
        add({
            label: mapping.alias,
            kind: "EnumMember",
            insertText,
            detail: mapping.displayName || mapping.name || mappingName,
            documentation: mapping.name ? `Maps to Unreal enum \`${mapping.name}\`.` : "",
            range: [valueInfo.replaceStartOffset, valueInfo.replaceEndOffset]
        });
    }
}

function addOutputTargets(add) {
    add({ label: "Base", kind: "Module", insertText: "Base.", detail: "Root material output namespace" });
    for (const helper of OUTPUT_HELPER_ITEMS) {
        add({ label: helper.name, kind: "Snippet", insertText: helper.snippet, detail: helper.detail });
    }
}

function addUEBuiltins(add, services) {
    for (const builtin of getUEBuiltins(services)) {
        add({ label: builtin.qualifiedName || `UE.${builtin.name}`, kind: "Function", insertText: builtin.snippet || builtin.qualifiedName, detail: builtin.detail });
    }
}

function addUEBuiltinMembers(add, services) {
    for (const builtin of getUEBuiltins(services)) {
        add({ label: builtin.name, kind: "Function", insertText: builtin.memberSnippet || builtin.snippet || builtin.name, detail: builtin.detail });
    }
}

function getUEBuiltins(services) {
    const items = callService(services, "getUEBuiltinItems", null);
    const baseItems = Array.isArray(items) ? items : UE_BUILTINS;
    const merged = [...baseItems];
    const seen = new Set(merged.flatMap((item) => [
        normalizeSymbolKey(item.name),
        normalizeSymbolKey(item.qualifiedName)
    ]));

    for (const item of getBundledMaterialExpressionBuiltinItems()) {
        const key = normalizeSymbolKey(item.name);
        const qualifiedKey = normalizeSymbolKey(item.qualifiedName);
        if (!key || seen.has(key) || seen.has(qualifiedKey)) {
            continue;
        }

        merged.push(item);
        seen.add(key);
        seen.add(qualifiedKey);
    }

    return merged;
}

function addReachableFunctions(add, context, services) {
    const namespaceMatch = context.linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_]*$/);
    const namespacePrefix = namespaceMatch ? `${namespaceMatch[1]}::` : "";
    const callables = mergeCallables(collectCallables(context.ast), callService(services, "collectReachableCallableSignatures", new Map()));
    const seen = new Set();

    for (const [key, entries] of mapEntries(callables)) {
        const entry = entries[0];
        if (!entry) {
            continue;
        }
        const name = namespacePrefix ? String(entry.name || key) : getCallableShortName(entry.localName || entry.name || key);
        if (namespacePrefix && !String(entry.name || "").startsWith(namespacePrefix)) {
            continue;
        }
        const normalized = normalizeSymbolKey(name);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        add({
            label: name,
            kind: "Function",
            insertText: name,
            detail: getCallableDetail(entry)
        });
    }
}

function addSymbols(add, context, services) {
    const symbols = collectSymbols(context.ast, context, callService(services, "collectReachableCallableSignatures", new Map()));
    for (const symbol of symbols.values()) {
        add({ label: symbol.name, kind: "Variable", insertText: symbol.name, detail: symbol.detail });
    }
}

function isMaterialAttributesMemberAccess(context) {
    if (!context.memberAccess || !isExpressionLike(context)) {
        return false;
    }
    const base = normalizeSymbolKey(context.memberAccess.baseName);
    const symbols = collectSymbols(context.ast, context);
    return Boolean(symbols.get(base)?.typeInfo?.isMaterialAttributes);
}

function isSwizzleAccess(context) {
    if (!context.memberAccess || !isExpressionLike(context)) {
        return false;
    }
    const base = normalizeSymbolKey(context.memberAccess.baseName);
    const symbols = collectSymbols(context.ast, context);
    const info = symbols.get(base)?.typeInfo;
    return Boolean(info && info.componentCount && !info.isMaterialAttributes);
}

function isGraphLike(context) {
    return context.kind === "Graph" || context.kind === "GraphFunctionBody" || context.kind.startsWith("Outputs");
}

function isExpressionLike(context) {
    return isGraphLike(context) || context.kind === "FunctionBody";
}

function getSettingValueCompletionInfo(context) {
    const valueStart = context.setting?.valueOffset ?? context.offset;
    const valuePrefix = context.text.slice(valueStart, context.offset);
    const quoteIndex = Math.max(valuePrefix.lastIndexOf("\""), valuePrefix.lastIndexOf("'"));
    if (quoteIndex >= 0) {
        return {
            isQuoted: true,
            replaceStartOffset: valueStart + quoteIndex + 1,
            replaceEndOffset: context.offset
        };
    }
    const match = /([A-Za-z0-9_]*)$/.exec(valuePrefix);
    const typed = match ? match[1] : "";
    return {
        isQuoted: false,
        replaceStartOffset: context.offset - typed.length,
        replaceEndOffset: context.offset
    };
}

function getSettingMappingNameForKey(settingName) {
    switch (normalizeSymbolKey(settingName)) {
        case "shadingmodel":
            return "ShadingModel";
        case "blendmode":
        case "rendertype":
            return "BlendMode";
        case "materialdomain":
        case "domain":
            return "MaterialDomain";
        default:
            return "";
    }
}

function collectSettingMappings(services, mappingName) {
    const serviceValues = callService(services, "collectDreamShaderSettingMappings", null, mappingName);
    const values = Array.isArray(serviceValues) && serviceValues.length > 0
        ? serviceValues
        : (SETTING_MAPPING_FALLBACKS.get(mappingName) || []).map((alias) => ({ alias, name: alias, displayName: alias }));
    return values.filter((mapping) => mapping && mapping.alias);
}

function isBooleanSetting(settingName) {
    return /^(twoSided|wireframe|dither|allow|cast|responsive|screen|contact|disable|output|tangent|fully|is|thin|has|enable|used|automatic|apply|compute|use|force|relax)/i.test(settingName);
}

function getCallableShortName(name) {
    return String(name || "").split(/[\\/]/).pop().split("::").pop();
}

function getCallableDetail(entry) {
    if (!entry) {
        return "DreamShader callable";
    }
    if (entry.kind === "GraphFunction") {
        return "DreamShader GraphFunction";
    }
    if (entry.kind === "Function") {
        return "DreamShader Function";
    }
    return `DreamShader ${entry.kind || "callable"}`;
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

function addPluginNames(add, services, valueInfo) {
    for (const pluginName of callService(services, "collectProjectContentPluginNames", [])) {
        add({
            label: pluginName,
            kind: "Module",
            insertText: pluginName,
            detail: "Project content plugin",
            range: [valueInfo.replaceStartOffset, valueInfo.replaceEndOffset]
        });
    }
}

function isImportContext(text, offset) {
    const prefix = stripCommentsPreserveLayout(text.slice(0, offset));
    const lineStart = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")) + 1;
    return /^\s*import\s+"[^"]*$/.test(prefix.slice(lineStart));
}

function getRootPluginValueCompletionInfo(text, offset) {
    const prefix = stripCommentsPreserveLayout(text.slice(0, offset));
    const match = /\bRoot\s*=\s*"(?:Plugins?|Plugin)\.([A-Za-z0-9_]*)$/i.exec(prefix);
    if (!match) {
        return null;
    }
    const typedPluginName = match[1] || "";
    return {
        replaceStartOffset: offset - typedPluginName.length,
        replaceEndOffset: offset
    };
}

function getPathPluginValueCompletionInfo(text, offset) {
    const prefix = stripCommentsPreserveLayout(text.slice(0, offset));
    const match = /Path\s*\(\s*(?:Plugins?|Plugin)\.([A-Za-z0-9_]*)$/i.exec(prefix);
    if (!match) {
        return null;
    }
    const typedPluginName = match[1] || "";
    return {
        replaceStartOffset: offset - typedPluginName.length,
        replaceEndOffset: offset
    };
}

function getMaterialExpressionClassValueCompletionInfo(text, offset) {
    const prefix = stripCommentsPreserveLayout(text.slice(0, offset));
    const lineStart = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r")) + 1;
    const match = /(?:UE\.[A-Za-z_][A-Za-z0-9_]*|Expression)\s*\([^()\r\n]*\bClass\s*=\s*"([^"]*)$/i.exec(prefix.slice(lineStart));
    if (!match) {
        return null;
    }
    const typedClassName = match[1] || "";
    return {
        replaceStartOffset: offset - typedClassName.length,
        replaceEndOffset: offset
    };
}

function dedupe(specs) {
    const seen = new Set();
    const result = [];
    for (const spec of specs) {
        const key = `${spec.label}:${spec.kind}:${Array.isArray(spec.range) ? spec.range.join("-") : ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(spec);
    }
    return result;
}

module.exports = {
    getCompletionSpecs,
    HLSL_INTRINSIC_ITEMS,
    SETTING_MAPPING_FALLBACKS,
    METADATA_ITEMS
};
