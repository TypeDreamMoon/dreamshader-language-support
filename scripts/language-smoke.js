"use strict";

const assert = require("assert");
const language = require("../src/language");
const { resolveTypeInfo } = require("../src/language/types");

const source = `import "Shared/Common.dsh";

Shader(Name="Materials/M_Test", Root="Game")
{
    Properties = {
        VectorParameter BaseColor = float4(1, 1, 1, 1) [
            Group="Surface";
            SortPriority=10;
        ];
        ScalarParameter Roughness = 0.5;
    }

    Settings = {
        Domain = "S";
        ShadingModel = "D";
        BlendMode = "O";
    }

    Outputs = {
        MaterialAttributes Result;
        Base.Ba
    }

    Graph = {
        #Region "Surface"
        float3 Tint;
        Result.BaseColor = BaseColor.rgb;
        Result.
        My
        #EndRegion
    }

    Layout = {
        Comment(Name="Surface", X=-400, Y=-260, W=1200, H=700, Color=float4(0.10, 0.16, 0.22, 0.35));
        Node(Var="BaseColor", X=-240, Y=-80);
    }
}

Function MyHlsl(in float A, out float B) {
    sa
}

GraphFunction MyGraph(in float A, out float B) {
    UE.
}

ShaderFunction(Name="Functions/F_Test", Root="Game")
{
    Inputs = {
        fl
    }

    Outputs = {
        float Result;
    }

    Graph = {
        My
    }
}
`;

const codeLensTargets = language.getCodeLensTargets(source);
assert(codeLensTargets.some((target) =>
    target.startOffset === source.indexOf("Shader(Name=")
    && target.actions.includes("recompileCurrent")
    && target.actions.includes("recompileAll")
    && target.actions.includes("showBridgeDiagnostics")), "CodeLens targets should include recompile actions for Shader blocks");
const functionOnlyCodeLensTargets = language.getCodeLensTargets("Function Helper(in float A, out float B) { B = A; }");
assert.deepStrictEqual(functionOnlyCodeLensTargets.map((target) => target.actions), [["recompileAll"]], "Function-only files should expose a recompile-all CodeLens target");

const inlayHintSpecs = language.getInlayHintSpecs("Result = UE.TexCoord(0);", {
    collectReachableCallableSignatures: () => new Map(),
    getUEBuiltinItems: () => [
        { name: "TexCoord", qualifiedName: "UE.TexCoord", parameters: [{ name: "Index", type: "int", qualifier: "in" }] }
    ]
});
assert(inlayHintSpecs.some((hint) => hint.label === "Index:" && hint.kind === "Parameter"), "Inlay hint specs should expose parameter labels for callable arguments");

const thinFilmHoverSource = "Result = Substrate.ThinFilm(FilmThickness=500.0, FilmIor=1.4);";
const thinFilmHover = language.getHoverInfoSpec(thinFilmHoverSource, thinFilmHoverSource.indexOf("ThinFilm") + 2, {});
assert(thinFilmHover, "Substrate.ThinFilm hover should resolve a callable spec");
assert.strictEqual(thinFilmHover.name, "Substrate.ThinFilm", "Substrate.ThinFilm hover should expose the qualified callable name");
assert(thinFilmHover.outputs.some((output) => output.name === "Specular Color" && output.type === "float1"), "Substrate.ThinFilm hover should include Specular Color output");
assert(thinFilmHover.outputs.some((output) => output.name === "Edge Specular Color" && output.type === "float1"), "Substrate.ThinFilm hover should include Edge Specular Color output");
const thinFilmNameHover = language.getHoverInfoSpec("Substrate.ThinFilm", "Substrate.Thin".length, {});
assert(thinFilmNameHover?.outputs?.some((output) => output.name === "Specular Color"), "Substrate.ThinFilm hover should resolve on qualified callable text without a call");

const functionHoverSource = "Function Foo(in float A, out float3 Result) { Result = float3(A, A, A); }\nGraphFunction Bar() { Foo(1.0, Out); }";
const functionHover = language.getHoverInfoSpec(functionHoverSource, functionHoverSource.lastIndexOf("Foo") + 1, {});
assert(functionHover?.outputs?.some((output) => output.name === "Result" && output.type === "float3"), "Function hover should include out parameters as outputs");

const shaderFunctionHoverSource = `ShaderFunction(Name="Functions/F_Hover")
{
    Inputs = {
        float3 Color;
    }
    Outputs = {
        float3 Result;
    }
    Graph = {
        Result = Color;
    }
}
Shader(Name="Materials/M_Hover")
{
    Outputs = {
        float3 Color;
    }
    Graph = {
        Color = F_Hover(float3(1, 1, 1));
    }
}`;
const shaderFunctionHover = language.getHoverInfoSpec(shaderFunctionHoverSource, shaderFunctionHoverSource.lastIndexOf("F_Hover") + 2, {});
assert(shaderFunctionHover?.outputs?.some((output) => output.name === "Result" && output.type === "float3"), "ShaderFunction hover should include Outputs section declarations");
assert.strictEqual(language.getHoverInfoSpec("UnknownCall(1.0);", 2, {}), null, "Unknown function hover should fall back cleanly");

function completionsAt(marker, services = {}) {
    const offset = source.indexOf(marker) + marker.length;
    assert(offset >= marker.length, `marker not found: ${marker}`);
    return language.getCompletionSpecs(source, offset, services);
}

function labelsAt(marker, services = {}) {
    return completionsAt(marker, services).map((item) => item.label);
}

function findCompletion(marker, label, services = {}) {
    const item = completionsAt(marker, services).find((completion) => completion.label === label);
    assert(item, `expected completion '${label}' at marker '${marker}'`);
    return item;
}

const services = {
    collectReachableCallableSignatures: () => new Map([
        ["importedtint", [{ kind: "Function", name: "ImportedTint", localName: "ImportedTint", inputs: [], outputs: [] }]]
    ]),
    collectAvailableHeaderImports: () => ["Shared/Common.dsh", "Functions/F_PulseTint.dsf", "@typedreammoon/dream-noise/Library/Noise.dsh"],
    collectDreamShaderSettingMappings: (mappingName) => {
        const values = {
            MaterialDomain: ["Surface", "PostProcess"],
            ShadingModel: ["DefaultLit", "Substrate"],
            BlendMode: ["Opaque", "Translucent"]
        };
        return (values[mappingName] || []).map((alias) => ({ alias, name: alias, displayName: alias }));
    },
    getUEBuiltinItems: () => [
        { name: "TexCoord", qualifiedName: "UE.TexCoord", snippet: "UE.TexCoord(Index=${1:0})", memberSnippet: "TexCoord(Index=${1:0})", detail: "Texture coordinate" },
        { name: "Time", qualifiedName: "UE.Time", snippet: "UE.Time()", memberSnippet: "Time()", detail: "Time node" }
    ]
};

assert(labelsAt("        fl").includes("float"), "Inputs section should offer type completions");
assert(language.getCompletionSpecs("Sh", 2, {}).some((item) => item.label === "Shader"), "Top-level keyword completion should work while typing Sh");
const topLevelTemplateLabels = language.getCompletionSpecs("", 0, {}).map((item) => item.label);
assert(topLevelTemplateLabels.includes("Template"), "Top-level completion should include Template");
assert(topLevelTemplateLabels.includes("Template Shader"), "Top-level completion should include Template Shader");
assert(topLevelTemplateLabels.includes("Template ShaderFunction"), "Top-level completion should include Template ShaderFunction");
assert(topLevelTemplateLabels.includes("Template ShaderLayer"), "Top-level completion should include Template ShaderLayer");
assert(topLevelTemplateLabels.includes("Template ShaderLayerBlend"), "Top-level completion should include Template ShaderLayerBlend");
const importItems = language.getCompletionSpecs("import \"", "import \"".length, services);
const dsfImport = importItems.find((item) => item.label === "Functions/F_PulseTint.dsf");
assert(dsfImport, "Import completion should include .dsf function files");
assert.strictEqual(dsfImport.detail, "DreamShader function file import", ".dsf import completion should be labeled as a function file");
assert(labelsAt("        My", services).includes("MyGraph"), "Graph should offer local GraphFunction completions");
assert(labelsAt("        My", services).includes("ImportedTint"), "Graph should offer imported function completions");
const blockBodySource = "Shader(Name=\"Materials/M_BlockBody\")\n{\n    ";
assert(language.getCompletionSpecs(blockBodySource, blockBodySource.length, {}).some((item) => item.label === "Layout"), "Shader block body should offer Layout section completion");
assert(labelsAt("        #Region \"Surface\"\n        float3 Tint").includes("region"), "Graph should offer a #Region snippet");
assert(labelsAt("        Node(Var=\"Base").includes("layoutnode"), "Layout section should offer layout node snippets");
assert(labelsAt("        Node(Var=\"Base").includes("Comment"), "Layout section should offer Comment statements");
const graphSymbolLabels = labelsAt("        My", services);
assert(graphSymbolLabels.includes("BaseColor"), "Graph should offer Properties symbols");
assert(graphSymbolLabels.includes("Roughness"), "Graph should offer scalar Properties symbols");
assert(graphSymbolLabels.includes("Result"), "Graph should offer Outputs symbols");
assert(graphSymbolLabels.includes("uecurveatlas"), "Graph should offer CurveAtlasRowParameter helper snippets");
assert(graphSymbolLabels.includes("uestaticmask"), "Graph should offer StaticComponentMaskParameter helper snippets");
assert(graphSymbolLabels.includes("uetexturesample"), "Graph should offer reflected TextureSample helper snippets");
assert(labelsAt("    sa").includes("saturate"), "Function body should offer native HLSL intrinsic completions");
assert(!labelsAt("            Group=\"Surface").includes("DefaultLit"), "Metadata value completion should not leak settings values");
assert(labelsAt("            Group").includes("SortPriority"), "Metadata block should offer metadata keys");
assert(labelsAt("        Domain = \"S", services).includes("Surface"), "Settings Domain should offer domain mappings");
assert(labelsAt("        ShadingModel = \"D", services).includes("DefaultLit"), "Settings ShadingModel should offer model mappings");
assert(labelsAt("        BlendMode = \"O", services).includes("Opaque"), "Settings BlendMode should offer blend mappings");
assert(labelsAt("    UE.", services).includes("TexCoord"), "UE accessor should offer graph node members");
assert(labelsAt("        Result.").includes("BaseColor"), "MaterialAttributes member accessor should offer attributes");

const baseColor = findCompletion("        Base.Ba", "BaseColor");
assert.strictEqual(baseColor.insertText, "BaseColor = $0;", "Base. member insert should not duplicate Base.");
const baseMemberStart = source.indexOf("Base.Ba") + "Base.".length;
assert.deepStrictEqual(baseColor.range, [baseMemberStart, baseMemberStart + 2], "Base. member should replace only the typed member");
assert.strictEqual(resolveTypeInfo("CurveAtlasRowParameter").componentCount, 3, "CurveAtlasRowParameter should resolve as float3-compatible");
assert.strictEqual(resolveTypeInfo("VolumeTexture").isTexture, true, "VolumeTexture should resolve as a texture type");
assert.strictEqual(resolveTypeInfo("Texture3D").isTexture, true, "Texture3D should resolve as a texture alias");

const textureMetadataSource = `Shader(Name="Materials/M_TextureMetadata")
{
    Properties = {
        TextureSampleParameter2D Albedo = Path(Game, "Textures/T_White") [
            SamplerType=SAMPLERTYPE_;
            GatherMode=TGM_;
        ];
        VolumeTexture NoiseVolume = Path(Game, "Textures/T_NoiseVolume");
        Texture3D DensityVolume = Path(Game, "Textures/T_DensityVolume");
    }
    Outputs = {
        float4 Color;
    }
    Graph = {
        Color = float4(1, 1, 1, 1);
    }
}`;
const samplerMetadataLabels = language.getCompletionSpecs(textureMetadataSource, textureMetadataSource.indexOf("SAMPLERTYPE_") + "SAMPLERTYPE_".length, {}).map((item) => item.label);
assert(samplerMetadataLabels.includes("SAMPLERTYPE_Color"), "SamplerType metadata should offer UE enum spellings");
const gatherMetadataLabels = language.getCompletionSpecs(textureMetadataSource, textureMetadataSource.indexOf("TGM_") + "TGM_".length, {}).map((item) => item.label);
assert(gatherMetadataLabels.includes("TGM_None"), "GatherMode metadata should offer UE enum spellings");
assert(!language.getDiagnostics(textureMetadataSource, "M_TextureMetadata.dsm", {}).some((diagnostic) => /Unknown type '(VolumeTexture|Texture3D)'/.test(diagnostic.message)), "VolumeTexture and Texture3D should not report unknown type diagnostics");

const manifestBackedServices = {
    collectMaterialExpressionSymbols: () => [
        { name: "TextureSampleParameter2D", className: "MaterialExpressionTextureSampleParameter2D" }
    ]
};
const reflectedClassSource = "UE.Expression(Class=\"TextureSample\")";
const reflectedClassOffset = reflectedClassSource.indexOf("TextureSample") + "TextureSample".length;
const reflectedClassLabels = language.getCompletionSpecs(reflectedClassSource, reflectedClassOffset, manifestBackedServices).map((item) => item.label);
assert(reflectedClassLabels.includes("TextureSampleParameter2D"), "Reflected MaterialExpression Class completion should use manifest symbols");
const reflectedMemberSource = `Shader(Name="Materials/M_ReflectedMember")
{
    Outputs = {
        float Value;
    }
    Graph = {
        Value = UE.
    }
}`;
const reflectedMemberOffset = reflectedMemberSource.indexOf("UE.") + "UE.".length;
const reflectedMemberCompletions = language.getCompletionSpecs(reflectedMemberSource, reflectedMemberOffset, {
    getUEBuiltinItems: () => [
        {
            name: "Abs",
            qualifiedName: "UE.Abs",
            memberSnippet: "Expression(Class=\"Abs\", OutputType=\"float1\", Input=${1:Value})",
            detail: "Reflected MaterialExpressionAbs material expression."
        }
    ]
});
const reflectedAbsCompletion = reflectedMemberCompletions.find((item) => item.label === "Abs");
assert(reflectedAbsCompletion, "UE. completion should offer reflected MaterialExpression short names");
assert.strictEqual(reflectedAbsCompletion.insertText, "Expression(Class=\"Abs\", OutputType=\"float1\", Input=${1:Value})", "Reflected UE. completion should expand to UE.Expression syntax");
const bundledReflectedCompletions = language.getCompletionSpecs(reflectedMemberSource, reflectedMemberOffset, {});
const bundledAbsCompletion = bundledReflectedCompletions.find((item) => item.label === "Abs");
assert(bundledAbsCompletion, "UE. completion should include bundled material-expressions.json entries without adapter services");
// "Abs" isn't one of the compiler's hard-coded UE.* sugar builtins, so the DreamShader compiler's
// generic reflection fallback (UE.<ClassName>(...) resolves the class from the call name itself)
// applies -- the completion should insert that shorter, equivalent form rather than the redundant
// UE.Expression(Class="Abs", ...) long form.
assert(String(bundledAbsCompletion.insertText || "").startsWith("Abs(OutputType=\"float1\""), "Bundled UE. completion should use the short UE.<Name>(...) reflection sugar when it's unambiguous");

// a manifest entry whose name collides with one of the compiler's hard-coded UE.* sugar builtins
// (Time, VertexNormalWS, StaticSwitchParameter, ...) must keep the long Expression(Class=...)
// form -- the compiler checks its sugar table by call name BEFORE falling back to generic
// reflection, so a short UE.VertexNormalWS(OutputType=...) call would hit the sugar builtin
// (which takes no OutputType) instead of the reflected MaterialExpressionVertexNormalWS class.
// "VertexNormalWS" isn't in the hard-coded UE_BUILTINS list (unlike "Time"), so this also proves
// the manifest-derived guard -- not just dedup against a hard-coded entry -- is what's keeping it safe.
const bundledVertexNormalCompletion = bundledReflectedCompletions.find((item) => item.label === "VertexNormalWS");
assert(bundledVertexNormalCompletion, "UE. completion should include the bundled reflected VertexNormalWS expression");
assert(String(bundledVertexNormalCompletion.insertText || "").startsWith("Expression(Class=\"VertexNormalWS\""), "A reflected name that collides with a compiler UE.* sugar builtin must keep the long UE.Expression(Class=...) form");

// direct unit coverage of the bundled-manifest builder itself, independent of UE_BUILTINS dedup.
const { getBundledMaterialExpressionBuiltinItems } = require("../src/languageData");
const bundledItems = getBundledMaterialExpressionBuiltinItems();
const findBundled = (name) => bundledItems.find((item) => item.name === name);
assert(String(findBundled("Arcsine")?.memberSnippet || "").startsWith("Arcsine(OutputType="), "A non-colliding reflected name should get the short UE.<Name>(...) sugar form");
assert(String(findBundled("Time")?.memberSnippet || "").startsWith("Expression(Class=\"Time\""), "A reflected name colliding with a UE.* sugar builtin (Time) should keep the long form");
assert(String(findBundled("VertexColor")?.memberSnippet || "").startsWith("Expression(Class=\"VertexColor\""), "A reflected name colliding with a UE.* sugar builtin (VertexColor) should keep the long form");

// "Expression" (the generic Class="..." reflection escape hatch) must sort behind every other
// UE.* member so a specific match like "Sine" always wins a completion race against it -- e.g.
// typing "UE.Si" and accepting the top suggestion should confidently produce the short
// "Sine(...)" sugar, never the generic "Expression(Class=\"Sine\", ...)" form.
const ueSiSource = `Shader(Name="M") {
    Outputs { float3 Color; Base.EmissiveColor = Color; }
    Graph { Color = float3(UE.Si, 0, 0); }
}`;
const ueSiOffset = ueSiSource.indexOf("UE.Si") + "UE.Si".length;
const ueSiSpecs = language.getCompletionSpecs(ueSiSource, ueSiOffset, {});
const sineSpec = ueSiSpecs.find((item) => item.label === "Sine");
const expressionSpec = ueSiSpecs.find((item) => item.label === "Expression");
assert(sineSpec, "UE.Si should offer the reflected Sine member");
assert(expressionSpec, "UE.Si should still offer the generic Expression escape hatch as a fallback");
assert.strictEqual(sineSpec.sortText, undefined, "A specific member's sortText should be untouched (defaults to its label)");
assert(typeof expressionSpec.sortText === "string" && expressionSpec.sortText > "Sine", "Expression's sortText must sort after specific members like Sine so it never wins a completion race against a more useful match");

// hover parameter types should be real (int/float/bool/string) rather than the generic "value"
// placeholder wherever the data actually supports it -- for hard-coded UE_BUILTINS entries (whose
// types are hand-authored, no manifest regen needed) and for the always-synthetic OutputType/
// Output/OutputName/OutputIndex parameters every reflected manifest entry gets.
const findParam = (parameters, name) => (parameters || []).find((parameter) => parameter.name === name);
const texCoordParams = language.getHoverInfoSpec("UE.TexCoord", "UE.TexCoord".length - 2, {})?.parameters;
assert.strictEqual(findParam(texCoordParams, "Index")?.type, "int", "UE.TexCoord's Index parameter should be typed as int, not the generic 'value' placeholder");
assert.strictEqual(findParam(texCoordParams, "UTiling")?.type, "float", "UE.TexCoord's UTiling parameter should be typed as float");
assert.strictEqual(findParam(texCoordParams, "UnMirrorU")?.type, "bool", "UE.TexCoord's UnMirrorU parameter should be typed as bool");
const arcsineHoverSource = "UE.Arcsine";
const arcsineParams = language.getHoverInfoSpec(arcsineHoverSource, arcsineHoverSource.length - 2, {})?.parameters;
assert.strictEqual(findParam(arcsineParams, "OutputType")?.type, "string", "A reflected builtin's synthetic OutputType parameter should be typed as string, not 'value'");
assert.strictEqual(findParam(arcsineParams, "OutputIndex")?.type, "int", "A reflected builtin's synthetic OutputIndex parameter should be typed as int, not 'value'");
// input-pin types come from the C++ compiler's manifest export (GetInputValueType); until that's
// regenerated, older cached manifests still carry the literal "input" placeholder for every input
// pin -- that must fall back to "value" rather than leaking the placeholder text itself as a type.
assert.strictEqual(findParam(arcsineParams, "Input")?.type, "value", "An un-regenerated manifest's literal 'input' placeholder should still fall back to 'value', not leak through as a fake type");

const reflectedExpressionDiagnostics = language.getDiagnostics(`Shader(Name="Materials/M_ReflectedExpression")
{
    Outputs = {
        float4 Result;
        Base.EmissiveColor = Result.rgb;
    }
    Graph = {
        float2 UV = UE.TexCoord(Index=0);
        Result = UE.Expression(
            Class=TextureSample,
            OutputType=float4,
            Coordinates=UV,
            Texture=Path(Engine, "EditorMaterials/Anchor"),
            SamplerType=SAMPLERTYPE_Color,
            SamplerSource=SSM_FromTextureAsset,
            MipValueMode=TMVM_None,
            GatherMode=TGM_None,
            AutomaticViewMipBias=true
        );
    }
}`, "M_ReflectedExpression.dsm", {});
assert(!reflectedExpressionDiagnostics.some((diagnostic) => /Identifier '(TextureSample|SAMPLERTYPE_Color|SSM_FromTextureAsset|TMVM_None|TGM_None|Engine)'/.test(diagnostic.message)), "Reflected UE.Expression metadata should not warn on known bare metadata values");

const functionLabels = labelsAt("    sa");
assert(!functionLabels.includes("UE"), "Function body should not offer UE graph namespace");

const graphFunctionLabels = labelsAt("    UE.", services);
assert(graphFunctionLabels.includes("Time"), "GraphFunction UE. accessor should offer UE members");
assert(labelsAt("    sa").includes("mix"), "Function body should offer GLSL-style mix alias");
assert(labelsAt("    sa").includes("fract"), "Function body should offer GLSL-style fract alias");
assert(labelsAt("    sa").includes("mod"), "Function body should offer GLSL-style mod alias");
assert(labelsAt("    sa").includes("Texture2DSample"), "Function body should offer Unreal texture sample helpers");
const textureSampleCompletion = findCompletion("    sa", "Texture2DSample");
assert(/Texture2DSample/.test(textureSampleCompletion.insertText), "Texture2DSample completion should insert the helper call");
const mixCompletion = findCompletion("    sa", "mix");
assert(/^mix\(/.test(mixCompletion.insertText), "mix completion should keep the GLSL alias spelling");
assert(language.findFunctionBuiltin("Texture2DSample"), "Function builtin metadata should expose Texture2DSample");

const semanticSource = `ShaderFunction(Name="Mat_Test/FuncTest", Root="Game")
{
    Inputs = {
        float3 Color;
        opt float3 Tint = float3(1.0, 1.0, 1.0);
        opt float Strength = 1.0;
    }

    Outputs = {
        float3 Result;
    }
    Graph = {
        Result = mix(lerp(Color, Tint, saturate(Strength)), Color, 0.5);
    }
}

Function __Lerp(in float3 a, in float3 b, in float alpha, out float3 res)
{
    const float t = saturate(alpha);
    if (t > 0.0) {
        res = lerp(a, b, t);
    }
}

Function __Sample(in Texture2D texture, in float2 uv, out float3 color)
{
    color = Texture2DSample(texture, textureSampler, uv).rgb;
}`;
const semanticTokens = language.getSemanticTokens(semanticSource)
    .map((token) => ({ ...token, text: semanticSource.slice(token.offset, token.offset + token.length) }));
assert(semanticTokens.some((token) => token.text === "opt" && token.type === "modifier"), "Optional declarations should mark opt as a modifier");
assert(semanticTokens.some((token) => token.text === "float3" && token.type === "type"), "Optional declarations should mark the actual value type as type");
assert(!semanticTokens.some((token) => /^opt\s+fl/.test(token.text) && token.type === "type"), "Optional declaration type tokens should not include the opt modifier");
assert(semanticTokens.some((token) => token.text === "in" && token.type === "modifier"), "Function parameter qualifiers should be semantic modifiers");
assert(semanticTokens.some((token) => token.text === "lerp" && token.type === "function" && token.modifiers.includes("defaultLibrary")), "HLSL intrinsics should be highlighted as default library functions");
assert(semanticTokens.some((token) => token.text === "saturate" && token.type === "function" && token.modifiers.includes("defaultLibrary")), "HLSL intrinsics inside Graph should be highlighted as default library functions");
assert(semanticTokens.some((token) => token.text === "mix" && token.type === "function" && token.modifiers.includes("defaultLibrary")), "GLSL aliases should be highlighted as default library functions");
assert(semanticTokens.some((token) => token.text === "Texture2DSample" && token.type === "function" && token.modifiers.includes("defaultLibrary")), "Texture sample helpers should be highlighted as default library functions");
assert(semanticTokens.some((token) => token.text === "if" && token.type === "keyword"), "Function bodies should mark HLSL control keywords");
assert(semanticTokens.some((token) => token.text === "const" && token.type === "modifier"), "Function bodies should mark HLSL modifiers");
assert(semanticTokens.some((token) => token.text === "a" && token.type === "parameter"), "Function bodies should mark parameter references");
assert(semanticTokens.some((token) => token.text === "t" && token.type === "variable"), "Function bodies should mark local variable references");
assert(semanticTokens.some((token) => token.text === "Result" && token.type === "variable"), "Graph bodies should mark output variable references");
assert(semanticTokens.some((token) => token.text === "rgb" && token.type === "property"), "Function bodies should mark member field access");

const builtinFunctionDiagnostics = language.getDiagnostics(`Function SampleTex(in Texture2D texture, in float2 uv, out float3 color)
{
    color = Texture2DSample(texture, textureSampler, uv).rgb;
    color = mix(color, float3(1, 1, 1), 0.5);
}`, "SampleTex.dsh", {});
assert(!builtinFunctionDiagnostics.some((diagnostic) => /Identifier '(Texture2DSample|textureSampler|mix)'/.test(diagnostic.message)), "Function builtins should not report undeclared identifier diagnostics");

const diagnostics = language.getDiagnostics(source, "M_Test.dsm", services);
assert(!diagnostics.some((diagnostic) => /Unclosed/.test(diagnostic.message)), "Valid braces should not report unclosed delimiters");
assert(!diagnostics.some((diagnostic) => /Layout|#Region|#EndRegion|Identifier 'Region'/.test(diagnostic.message)), "Valid Layout and Graph region directives should not report diagnostics");
const layoutSection = language.parseDocument(source).blocks[0].sections.find((section) => section.name === "Layout");
assert(layoutSection && layoutSection.entries.some((entry) => entry.kind === "layout" && entry.layoutKind === "Node"), "Parser should expose Layout Node entries");
const layoutSymbols = language.getDocumentSymbols(source)[0].children.find((symbol) => symbol.name === "Layout")?.children || [];
assert(layoutSymbols.some((symbol) => symbol.name === "Node: BaseColor"), "Document symbols should include Layout nodes");
const badLayoutDiagnostics = language.getDiagnostics(`Shader(Name="Materials/M_BadLayout")
{
    Outputs = {
        float3 Color;
        Base.BaseColor = Color;
    }
    Graph = {
        Color = float3(1, 1, 1);
    }
    Layout = {
        Node(Var="Color", X=left, Y=0);
        Group(Name="Bad", X=0, Y=0);
    }
}`, "M_BadLayout.dsm", {});
assert(badLayoutDiagnostics.some((diagnostic) => /Layout argument 'X' must be an integer/.test(diagnostic.message)), "Layout diagnostics should validate integer coordinates");
assert(badLayoutDiagnostics.some((diagnostic) => /Unknown Layout statement 'Group'/.test(diagnostic.message)), "Layout diagnostics should reject unknown statements");
const badRegionDiagnostics = language.getDiagnostics(`Shader(Name="Materials/M_BadRegion")
{
    Outputs = {
        float3 Color;
        Base.BaseColor = Color;
    }
    Graph = {
        #Region "Open"
        Color = float3(1, 1, 1);
    }
}`, "M_BadRegion.dsm", {});
assert(badRegionDiagnostics.some((diagnostic) => /missing #EndRegion/.test(diagnostic.message)), "Graph region diagnostics should catch unclosed regions");

const dsfSource = `ShaderFunction(Name="Functions/F_PulseTint")
{
    Inputs = {
        vec3 Color;
        vec3 Tint;
        float Pulse;
        opt float Strength = 1.0;
    }

    Outputs = {
        vec3 OutColor;
        float OutMask;
    }

    Graph = {
        OutMask = saturate(Pulse * Strength);
        OutColor = Color * Tint * OutMask;
    }
}`;
const dsfDiagnostics = language.getDiagnostics(dsfSource, "F_PulseTint.dsf", { resolveImportPath: () => "ok" });
assert(!dsfDiagnostics.some((diagnostic) => /should declare|may not declare/.test(diagnostic.message)), ".dsf files should accept ShaderFunction declarations");
const layerDsfDiagnostics = language.getDiagnostics(`ShaderLayer(Name="Layers/ML_Test")
{
    Inputs = {
        MaterialAttributes MaterialAttributes;
    }

    Outputs = {
        MaterialAttributes MaterialAttributes;
    }

    Graph = {
        MaterialAttributes = MaterialAttributes;
    }
}`, "ML_Test.dsf", {});
assert(!layerDsfDiagnostics.some((diagnostic) => /should declare|may not declare/.test(diagnostic.message)), ".dsf files should accept ShaderLayer declarations");
const layerBlendDsfDiagnostics = language.getDiagnostics(`ShaderLayerBlend(Name="Layers/LB_Test")
{
    Inputs = {
        MaterialAttributes Base;
        MaterialAttributes Layer;
    }

    Outputs = {
        MaterialAttributes MaterialAttributes;
    }

    Graph = {
        MaterialAttributes = Layer;
    }
}`, "LB_Test.dsf", {});
assert(!layerBlendDsfDiagnostics.some((diagnostic) => /should declare|may not declare/.test(diagnostic.message)), ".dsf files should accept ShaderLayerBlend declarations");
const badDsfDiagnostics = language.getDiagnostics(`Shader(Name="Materials/M_Bad")
{
    Outputs = {
        float3 Color;
        Base.BaseColor = Color;
    }
    Graph = {
        Color = float3(1, 1, 1);
    }
}`, "Bad.dsf", {});
assert(badDsfDiagnostics.some((diagnostic) => /may not declare Shader/.test(diagnostic.message)), ".dsf files should reject material Shader blocks");

const importWithoutSemicolon = `import "@typedreammoon/dreamshader-texture/Library/Texture.dsh"

Shader(Name="Mat_Test/Test_Base", Root="Game")
{
    Properties = {
        Texture2D Tex [
            Group = 
        ];
    }
    Outputs = {
        float3 Color;
        Base.BaseColor = Color;
    }
    Graph = {
        Color = float3(1, 1, 1);
    }
}`;
assert.strictEqual(language.parseDocument(importWithoutSemicolon).blocks[0]?.kind, "Shader", "Import without semicolon should not consume the following Shader block");
assert(!language.getDiagnostics(importWithoutSemicolon, "Test_Base.dsm", { resolveImportPath: () => "ok" }).some((diagnostic) => /should declare a top-level Shader/.test(diagnostic.message)), "Import without semicolon should not trigger missing top-level block diagnostics");
const metadataOffset = importWithoutSemicolon.indexOf("            Group = ") + "            Group = ".length;
assert(language.getCompletionSpecs(importWithoutSemicolon, metadataOffset, {}).some((item) => item.label === "Surface"), "Metadata Group value should offer group name completions");

const brokenShaderEdit = `import "@typedreammoon/dreamshader-texture/Library/Texture.dsh"

Shader(Name="Mat_Test/Test_Base", Root="Game"
{
    Outputs = {
        float3 Color;
        float Rough;
        float Metal;
        Base.BaseColor = Color;
        Base.Roughness = Rough;
        Base.Metallic = Metal;
        MaterialAttributes 
    }
}`;
const brokenBaseOffset = brokenShaderEdit.indexOf("        Base.BaseColor") + "        Base.".length;
const brokenBaseLabels = language.getCompletionSpecs(brokenShaderEdit, brokenBaseOffset, {}).map((item) => item.label);
assert(brokenBaseLabels.includes("BaseColor"), "Outputs Base. completion should survive an incomplete Shader header");
assert(!brokenBaseLabels.includes("FunctionTemplate"), "Outputs Base. completion should not fall back to top-level templates");
const brokenOutputTypeOffset = brokenShaderEdit.indexOf("        MaterialAttributes ") + "        MaterialAttributes ".length;
const brokenOutputTypeLabels = language.getCompletionSpecs(brokenShaderEdit, brokenOutputTypeOffset, {}).map((item) => item.label);
assert(brokenOutputTypeLabels.includes("float"), "Outputs declarations should offer scalar types while editing incomplete syntax");
assert(brokenOutputTypeLabels.includes("MaterialAttributes"), "Outputs declarations should offer MaterialAttributes while editing incomplete syntax");
assert(!brokenOutputTypeLabels.includes("FunctionTemplate"), "Outputs declaration completions should not fall back to top-level templates");

const brokenGraphEdit = `import "@typedreammoon/dreamshader-texture/Library/Texture.dsh"

Shader(Name="Mat_Test/Test_Base", Root="Game"
{
    Properties = {
        VectorParameter BaseColor = float4(0.8, 0.8, 0.8, 1.0);
        ScalarParameter Metallic = 0.0;
        Texture2D Tex;
    }

    Outputs = {
        float3 Color;
        float Metal;
    }

    Graph = {
        Me
    }
}`;
const brokenGraphOffset = brokenGraphEdit.indexOf("        Me") + "        Me".length;
const brokenGraphLabels = language.getCompletionSpecs(brokenGraphEdit, brokenGraphOffset, {}).map((item) => item.label);
assert(brokenGraphLabels.includes("BaseColor"), "Graph should offer Properties symbols while editing an incomplete Shader header");
assert(brokenGraphLabels.includes("Tex"), "Graph should offer texture Properties symbols while editing an incomplete Shader header");
assert(brokenGraphLabels.includes("Color"), "Graph should offer Outputs symbols while editing an incomplete Shader header");
assert(brokenGraphLabels.includes("Metal"), "Graph should offer scalar Outputs symbols while editing an incomplete Shader header");

const sourcePluginSyntax = `ShaderFunction(Name="Functions/F_SourceCompat", Root="Game")
{
    Properties = {
        const Texture2D PreviewTex = Path(Game, "Textures/T_White");
    }
    Inputs = {
        opt Texture2D BaseColorTex = PreviewTex;
    }
    Results = {
        float3 Result;
    }
    Settings = {
        Description = "Source compatible";
    }
    Graph = {
        float2 uv = UE.TexCoord(Index=0);
        float2 size = UE.Expression(Class="ViewSize", OutputType="float2");
        float wave = UE.Expression(Class=Sine, OutputType=float1, Input=UE.Time());
        Result = mix(float3(0, 0, 0), float3(1, 1, 1), fract(mod(wave, 1.0)));
    }
}

VirtualFunction(Name="ExternalCompat")
{
    Settings = {
        Asset = Path(Engine, Functions/Engine_MaterialFunctions02/Fresnel_Function);
    }
    Properties = {
        opt float Strength = 1.0;
    }
    Results = {
        float Result;
    }
}`;
const sourcePluginDiagnostics = language.getDiagnostics(sourcePluginSyntax, "SourceCompat.dsm", { resolveImportPath: () => "ok" });
assert(!sourcePluginDiagnostics.some((diagnostic) => /Identifier '(Index|Class|ViewSize|OutputType|Sine|Input|Game|Engine|Functions)'/.test(diagnostic.message)), "Source plugin syntax should not warn on named args or Path roots");
assert(!sourcePluginDiagnostics.some((diagnostic) => /does not support a Results|does not support a Settings|does not support a Properties/.test(diagnostic.message)), "Source plugin section aliases should be accepted");

const layerDiagnostics = language.getDiagnostics(`ShaderLayerBlend(Name="Layers/LB_Bad")
{
    Inputs = {
        MaterialAttributes Base;
        float Alpha;
    }
    Outputs = {
        float Result;
    }
}`, "LB_Bad.dsm", {});
assert(layerDiagnostics.some((diagnostic) => /exactly one MaterialAttributes output/.test(diagnostic.message)), "ShaderLayerBlend should require one MaterialAttributes output");
assert(layerDiagnostics.some((diagnostic) => /at least two MaterialAttributes inputs/.test(diagnostic.message)), "ShaderLayerBlend should require two MaterialAttributes inputs");

const virtualDiagnostics = language.getDiagnostics(`VirtualFunction(Name="External")
{
    Options = {
        Description = "Missing asset";
    }
    Inputs = {
        float Value;
    }
}`, "External.dsm", {});
assert(virtualDiagnostics.some((diagnostic) => /Options must include Asset/.test(diagnostic.message)), "VirtualFunction should require Options.Asset");
assert(virtualDiagnostics.some((diagnostic) => /Outputs section/.test(diagnostic.message)), "VirtualFunction should require Outputs");

const unicodeVirtualSource = `VirtualFunction(Name="海森_不透明蒙版")
{
    Options = {
        Asset = Path(Game, "鸣潮牛逼/海森_不透明蒙版");
    }
    Inputs = {
        opt float2 可不连_输入统一UV控件 = float2(0, 0) [
            SortPriority=1;
        ];
    }
    Outputs = {
        float 输出不透明蒙版;
    }
}
Shader(Name="Materials/M_UnicodeVirtual")
{
    Outputs = {
        float OpacityMask;
        Base.OpacityMask = OpacityMask;
    }
    Graph = {
        float Node1 = 海森_不透明蒙版(default);
        float Node2 = 海森_不透明蒙版(default, OutputIndex=0);
        OpacityMask = Node1 + Node2;
    }
}`;
const unicodeVirtualDiagnostics = language.getDiagnostics(unicodeVirtualSource, "M_UnicodeVirtual.dsm", {});
assert(!unicodeVirtualDiagnostics.some((diagnostic) => /Identifier '(海森_不透明蒙版|可不连_输入统一UV控件|输出不透明蒙版|鸣潮牛逼)'/.test(diagnostic.message)), "Unicode VirtualFunction identifiers and asset paths should be accepted");
assert(!unicodeVirtualDiagnostics.some((diagnostic) => /Unknown|expects|Inputs statement|OutputIndex/.test(diagnostic.message)), "Unicode VirtualFunction calls with OutputIndex should not warn");

const callDiagnostics = language.getDiagnostics(`Shader(Name="Materials/M_Call")
{
    Outputs = {
        float Result;
        Base.Roughness = Result;
    }
    Graph = {
        MyGraph(1.0);
    }
}
GraphFunction MyGraph(in float A, out float B) {
    B = A;
}`, "M_Call.dsm", {});
assert(callDiagnostics.some((diagnostic) => /expects 2 arguments/.test(diagnostic.message)), "GraphFunction statement calls should validate out arguments");

const dsfIndexed = language.buildDocumentIndex({
    fileName: "Materials/M_UsesFunction.dsm",
    text: `import "Functions/F_PulseTint.dsf";
Shader(Name="Materials/M_UsesFunction")
{
    Properties = {
        VectorParameter BaseColor = float4(1, 1, 1, 1);
        VectorParameter Tint = float4(0.2, 0.6, 1.0, 1.0);
    }
    Outputs = {
        vec3 Color;
        float Mask;
        Base.EmissiveColor = Color;
    }
    Graph = {
        F_PulseTint(BaseColor.rgb, Tint.rgb, 1.0, Color, Mask);
    }
}`,
    resolveImportPath: (specifier) => specifier === "Functions/F_PulseTint.dsf" ? "Functions/F_PulseTint.dsf" : "",
    readFileText: () => dsfSource
});
assert(dsfIndexed.callables.has("f_pulsetint"), "Document index should collect ShaderFunction callables from imported .dsf files");
const dsfCallDiagnostics = language.getDiagnostics(`import "Functions/F_PulseTint.dsf";
Shader(Name="Materials/M_UsesFunction")
{
    Properties = {
        VectorParameter BaseColor = float4(1, 1, 1, 1);
        VectorParameter Tint = float4(0.2, 0.6, 1.0, 1.0);
    }
    Outputs = {
        vec3 Color;
        float Mask;
        Base.EmissiveColor = Color;
    }
    Graph = {
        F_PulseTint(BaseColor.rgb, Tint.rgb, 1.0, Color, Mask);
    }
}`, "M_UsesFunction.dsm", {
    resolveImportPath: () => "Functions/F_PulseTint.dsf",
    collectReachableCallableSignatures: () => dsfIndexed.callables
});
assert(!dsfCallDiagnostics.some((diagnostic) => /expects|out argument|not declared/.test(diagnostic.message)), "Standalone ShaderFunction calls should allow inputs followed by multiple output variables and optional tail inputs");

const substrateSource = `Shader(Name="Materials/M_Substrate")
{
    Settings = {
        ShadingModel = "Substrate";
    }
    Outputs = {
        Substrate Surface;
        Base.FrontMaterial = Surface;
    }
    Graph = {
        Substrate.
    }
}`;
const substrateOffset = substrateSource.indexOf("        Substrate.") + "        Substrate.".length;
const substrateLabels = language.getCompletionSpecs(substrateSource, substrateOffset, {}).map((item) => item.label);
assert(substrateLabels.includes("Slab") && substrateLabels.includes("VerticalLayer"), "Substrate namespace should offer current Substrate.* graph helpers");
const substratePartialSource = substrateSource.replace("        Substrate.", "        Substrate.Sl");
const substratePartialOffset = substratePartialSource.indexOf("        Substrate.Sl") + "        Substrate.Sl".length;
const substratePartialCompletion = language.getCompletionSpecs(substratePartialSource, substratePartialOffset, {}).find((item) => item.label === "Slab");
assert(substratePartialCompletion, "Substrate partial member access should offer matching builtins");
assert.deepStrictEqual(substratePartialCompletion.range, [substratePartialOffset - 2, substratePartialOffset], "Substrate partial member completion should replace only the typed member prefix");
const substrateVerticalLayerCompletion = language.getCompletionSpecs(substrateSource, substrateOffset, {}).find((item) => item.label === "VerticalLayer");
assert(substrateVerticalLayerCompletion, "Substrate member completion should offer VerticalLayer");
assert(!/^Substrate\./.test(String(substrateVerticalLayerCompletion.insertText || "")), "Substrate member completion should not insert a duplicate namespace prefix");
const incompleteSubstrateDiagnostics = language.getDiagnostics(substratePartialSource, "M_SubstratePartial.dsm", {});
assert(!incompleteSubstrateDiagnostics.some((diagnostic) => /Unknown Substrate builtin|missing a trailing/.test(diagnostic.message)), "Incomplete Substrate member access should not warn while typing");
const substrateManifestServices = {
    getSubstrateBuiltinItems: () => [{
        name: "TestSurface",
        qualifiedName: "Substrate.TestSurface",
        snippet: "Substrate.TestSurface(Color=${1:Color})",
        memberSnippet: "TestSurface(Color=${1:Color})",
        detail: "Manifest-backed test Substrate node",
        parameters: [{ qualifier: "in", type: "value", name: "Color" }]
    }]
};
const substrateManifestLabels = language.getCompletionSpecs(substrateSource, substrateOffset, substrateManifestServices).map((item) => item.label);
assert(substrateManifestLabels.includes("TestSurface"), "Substrate completions should include manifest-backed builtins");
assert(!language.getDiagnostics(`Shader(Name="Materials/M_SubstrateManifest")
{
    Settings = {
        ShadingModel = "Substrate";
    }
    Outputs = {
        Substrate Surface;
        Base.FrontMaterial = Surface;
    }
    Graph = {
        Surface = Substrate.TestSurface(Color=float3(1, 0, 0));
    }
}`, "M_SubstrateManifest.dsm", substrateManifestServices).some((diagnostic) => /Unknown Substrate builtin 'TestSurface'/.test(diagnostic.message)), "Substrate diagnostics should accept manifest-backed builtins");
assert(labelsAt("        Base.").includes("FrontMaterial"), "Base output completion should include FrontMaterial");
assert(!language.getDiagnostics(`Shader(Name="Materials/M_Substrate")
{
    Settings = {
        ShadingModel = "Substrate";
    }
    Outputs = {
        Substrate Surface;
        Base.FrontMaterial = Surface;
    }
    Graph = {
        Surface = Substrate.Unlit(EmissiveColor=float3(0.1, 0.6, 1.0));
    }
}`, "M_Substrate.dsm", {}).some((diagnostic) => /Identifier 'Substrate'|Unknown Substrate|FrontMaterial|should bind/.test(diagnostic.message)), "Substrate.FrontMaterial shaders should not report stale Substrate diagnostics");

const formatted = language.formatDocument(`Shader(Name="Materials/M")
{
Properties={ 
float Value;
}
}`);
assert(/    Properties = \{/.test(formatted), "Formatter should indent sections");

// three-or-more levels of nested braces (e.g. nested Group scopes) must not collapse indentation
// when several closing lines stack up in a row.
const deepNested = language.formatDocument(`Shader(Name="M") {
Properties {
Group("Surface") {
Group("SS") {
ScalarParameter Test = 0.5;
}
ScalarParameter Rough = 0.2;
}
}
}`);
const deepNestedLines = deepNested.split("\n").map((line) => line.replace(/\s+$/, ""));
assert.deepStrictEqual(deepNestedLines, [
    // The formatter spaces out the attribute assignment; the compiler's ParseAttributes calls
    // SkipIgnored around both sides, and the plugin's own corpus carries each spelling.
    "Shader(Name = \"M\") {",
    "    Properties {",
    "        Group(\"Surface\") {",
    "            Group(\"SS\") {",
    "                ScalarParameter Test = 0.5;",
    "            }",
    "            ScalarParameter Rough = 0.2;",
    "        }",
    "    }",
    "}"
], "Formatter should not lose an indent level when 3+ nested blocks close in a row");

const templateSource = `Template ShaderFunction(Name="Templates/T_Tint", Root="Game")
{
    Inputs = {
        float3 Color;
    }

    Outputs = {
        float3 Result;
    }

    Graph = {
        Result = Color;
    }
}`;
const templateAst = language.parseDocument(templateSource);
assert.strictEqual(templateAst.blocks[0]?.kind, "ShaderFunction", "Template ShaderFunction should parse as the inner block kind");
assert.strictEqual(templateAst.blocks[0]?.template, true, "Template blocks should preserve template metadata");
assert(templateAst.blocks[0]?.sections.some((section) => section.name === "Graph"), "Template ShaderFunction should parse inner sections");
assert(language.getCompletionSpecs(templateSource, templateSource.indexOf("        Result = Color") + "        Result = Color".length, {}).some((item) => item.label === "Color"), "Template Graph should use normal Graph completions");
const templateTokens = language.getSemanticTokens(templateSource)
    .map((token) => ({ ...token, text: templateSource.slice(token.offset, token.offset + token.length) }));
assert(templateTokens.some((token) => token.text === "Template" && token.type === "keyword"), "Template keyword should receive semantic tokens");
assert(templateTokens.some((token) => token.text === "ShaderFunction" && token.type === "keyword"), "Template inner block keyword should receive semantic tokens");
const formattedTemplate = language.formatDocument(`Template   ShaderLayerBlend(Name="Templates/T")
{
Inputs={
MaterialAttributes Base;
MaterialAttributes Layer;
}
}`);
assert(/Template ShaderLayerBlend/.test(formattedTemplate), "Formatter should normalize Template block headers");
assert(/    Inputs = \{/.test(formattedTemplate), "Formatter should indent Template inner sections");

const indexed = language.buildDocumentIndex({
    fileName: "Root.dsm",
    text: `import "A.dsh";\nFunction A(in float X, out float Y) { B(X, Y); }`,
    resolveImportPath: () => "A.dsh",
    readFileText: () => `Function B(in float X, out float Y) { A(X, Y); }`
});
assert(indexed.callables.has("a") && indexed.callables.has("b"), "Document index should collect imported callables");
assert(indexed.cycles.length > 0, "Document index should detect function cycles across imports");

// --- DreamShaderLang 1.5 syntax ---------------------------------------------------------
const v15Source = `Shader(Name="M_V15") {
    Properties {
        Group("Surface") {
            ScalarParameter Rough = 0.5 [Slider(0, 1)];
            TextureSampleParameter2D Albedo = "/Game/Tex/T_White";
        }
        ScalarParameter Loose = 2.0;
    }
    Outputs {
        Base.BaseColor = Tint;
        Base.Roughness = R;
    }
    Graph {
        float l = Luma(float3(1, 0, 0));
        float3 Tint = Albedo * l;
        float R = Rough + Loose;
    }
}

Function float Luma(in vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}`;
const v15Ast = language.parseDocument(v15Source);
const v15Props = v15Ast.blocks[0].sections.find((section) => section.name === "Properties");
const v15Decls = v15Props.entries.filter((entry) => entry.kind === "declaration");
assert.deepStrictEqual(v15Decls.map((entry) => entry.name), ["Rough", "Albedo", "Loose"], "Group scope should flatten its declarations in source order");
assert.strictEqual(v15Decls[0].metadata?.group, "Surface", "Group scope should stamp the group name onto contained parameters");
assert.strictEqual(v15Decls[1].metadata?.group, "Surface", "All parameters in a Group share its name");
assert.strictEqual(v15Decls[2].metadata?.group, undefined, "Loose parameters outside a Group are not stamped");
const lumaBlock = v15Ast.blocks.find((block) => block.name === "Luma");
assert.strictEqual(lumaBlock.returnType, "float", "Return-type functions should record their return type");
const v15Callables = language.collectCallables(v15Ast);
assert(v15Callables.get("luma")[0].outputs.some((output) => output.type === "float"), "Return-type function exposes its return type as an output");
assert.strictEqual(language.getDiagnostics(v15Source, "M_V15.dsm").length, 0, "Valid 1.5 syntax should produce no diagnostics");

// nested Group("Outer") { Group("Inner") { ... } } composes into "Outer|Inner"
const nestedGroupSource = `Shader(Name="M_NestedGroup") {
    Properties {
        Group("Surface") {
            Group("SS") {
                ScalarParameter Test = 0.5 [Slider(0, 1)];
            }
            ScalarParameter Rough = 0.2;
        }
        Group("Manual|Literal") {
            ScalarParameter Explicit = 1.0;
        }
    }
    Outputs { vec3 Color; Base.EmissiveColor = Color; }
    Graph { Color = vec3(Rough, Rough, Rough); }
}`;
const nestedGroupProps = language.parseDocument(nestedGroupSource).blocks[0].sections.find((section) => section.name === "Properties");
const nestedGroupDecls = nestedGroupProps.entries.filter((entry) => entry.kind === "declaration");
const findDecl = (name) => nestedGroupDecls.find((entry) => entry.name === name);
assert.strictEqual(findDecl("Test").metadata?.group, "Surface|SS", "Group(\"SS\") nested inside Group(\"Surface\") should compose to 'Surface|SS'");
assert.strictEqual(findDecl("Rough").metadata?.group, "Surface", "A direct child of Group(\"Surface\") keeps just 'Surface', not the nested sibling's path");
assert.strictEqual(findDecl("Explicit").metadata?.group, "Manual|Literal", "A single Group(\"A|B\") literal name should pass through unchanged");
assert.strictEqual(language.getDiagnostics(nestedGroupSource, "M_NestedGroup.dsm").length, 0, "Nested Group scopes should produce no diagnostics");

// optional '=' on a section keeps its body symbols
const noEqSource = `Shader(Name="M_NoEq") {
    Properties { ScalarParameter A = 1.0; }
    Graph { Base.BaseColor = float3(A, A, A); }
}`;
const noEqProps = language.parseDocument(noEqSource).blocks[0].sections.find((section) => section.name === "Properties");
assert(noEqProps && noEqProps.entries.some((entry) => entry.name === "A"), "Sections without '=' should still be parsed and keep their symbols");

// 1.5 completions: Slider metadata and propgroup declaration sugar
const metaDoc = `Shader(Name="M") {\n    Properties {\n        ScalarParameter A = 1.0 [];\n    }\n}`;
const metaLabels = language.getCompletionSpecs(metaDoc, metaDoc.indexOf("[]") + 1, {}).map((item) => item.label);
assert(metaLabels.includes("Slider"), "Metadata completion should offer the Slider shorthand");
const propDoc = `Shader(Name="M") {\n    Properties {\n        \n    }\n}`;
const propLabels = language.getCompletionSpecs(propDoc, propDoc.indexOf("        \n") + 8, {}).map((item) => item.label);
assert(propLabels.includes("propgroup"), "Properties completion should offer the propgroup scope snippet");
assert(propLabels.includes("Group"), "Properties completion should offer a 'Group' completion for the Group(\"Name\") { } block, not just the 'propgroup' snippet alias");

// --- 1.6 correctness fixes: Graph/function control-flow (if/for/while) ----------------------
const ctrlClean = (label, src) => {
    const diags = language.getDiagnostics(src, "ctrl.dsm", services);
    assert.strictEqual(diags.length, 0, `${label} should produce no diagnostics, got: ${diags.map((d) => d.message).join(" | ")}`);
};
// if/else block needs no trailing ';' and branch-local declarations resolve
ctrlClean("if/else with branch local", `Shader(Name="X") {
    Properties { float Mask = 0.6; }
    Outputs { vec3 Color; Base.EmissiveColor = Color; }
    Graph {
        if (Mask > 0.5) { float3 Tint = float3(1, 0, 0); Color = Tint; } else { Color = float3(0, 0, 0); }
    }
}`);
// a statement after an if-block must not be absorbed / mis-typed
ctrlClean("statement after if-block", `Shader(Name="X") {
    Outputs { vec3 Color; Base.EmissiveColor = Color; }
    Graph {
        if (1.0 > 0.5) { Color = vec3(1, 0, 0); }
        float later = 2.0;
        Color = vec3(later, later, later);
    }
}`);
// branch-local variable is offered as a completion inside the branch
const branchDoc = `Shader(Name="M") { Properties { float Mask = 0.6; } Outputs { vec3 Color; Base.EmissiveColor = Color; } Graph { if (Mask > 0.5) { float tone = 0.2; ` ;
const branchLabels = language.getCompletionSpecs(branchDoc, branchDoc.length, services).map((item) => item.label);
assert(branchLabels.includes("tone"), "A variable declared inside an if-branch should be offered as a completion within the branch");
// swizzle members on a branch-local vector
const swizzleDoc = `Shader(Name="M") { Outputs { vec3 Color; Base.EmissiveColor = Color; } Graph { if (1 > 0) { float3 local = float3(1, 1, 1); Color = local.`;
const swizzleLabels = language.getCompletionSpecs(swizzleDoc, swizzleDoc.length, services).map((item) => item.label);
assert(swizzleLabels.includes("rgb") && swizzleLabels.includes("x"), "Swizzle members should be offered for a vector local declared inside a branch");
// for-loop body local and loop variable in a Function body
const forDoc = `Function Foo(in float A, out float B) { for (int i = 0; i < 4; i++) { float acc = A; `;
const forLabels = language.getCompletionSpecs(forDoc, forDoc.length, services).map((item) => item.label);
assert(forLabels.includes("acc") && forLabels.includes("i"), "for-loop body local and loop variable should be offered in a Function body");

// --- 1.6 correctness fixes: return-value function outline + no __return leak -----------------
const fnDoc = `Function float Luma(in vec3 c) { return dot(c, vec3(0.3, 0.6, 0.1)); }`;
const fnAst = language.parseDocument(fnDoc);
const lumaCallable = language.collectCallables(fnAst).get("luma")[0];
assert(lumaCallable.outputs.some((output) => output.isReturn && output.type === "float" && !output.name), "A return-type function's implicit output should be nameless and flagged isReturn (no __return leak)");
const lumaSymbol = language.getDocumentSymbols(fnDoc)[0];
const childNames = (lumaSymbol.children || []).map((child) => child.name);
assert(childNames.includes("c"), "Function parameters should appear as document-symbol children");
assert(!JSON.stringify(lumaSymbol).includes("__return"), "Document symbols must not leak the internal __return name");

// --- 1.6.2: extensionless imports resolve to .dsh (mirrors the plugin's NormalizeImportSpecifier)
const { normalizeImportSpecifier } = require("../src/project/imports");
assert.strictEqual(normalizeImportSpecifier("ColorLib"), "ColorLib.dsh", "A bare import specifier should get a .dsh extension");
assert.strictEqual(normalizeImportSpecifier("Shared/Common"), "Shared/Common.dsh", "A subpath import without extension should get .dsh");
assert.strictEqual(normalizeImportSpecifier("./ColorLib"), "ColorLib.dsh", "A leading ./ should be stripped and .dsh appended");
assert.strictEqual(normalizeImportSpecifier("ColorLib.dsh"), "ColorLib.dsh", "An explicit .dsh import should be left unchanged");
assert.strictEqual(normalizeImportSpecifier("Functions/F_Tint.dsf"), "Functions/F_Tint.dsf", "An explicit .dsf import should be left unchanged");

// --- 1.7.0: color picker support for float3(...)/float4(...)/vec3(...)/vec4(...) literals -------
const colorSource = `Shader(Name="M") {
    Properties {
        VectorParameter BaseColor = float4(0.8, 0.3, 0.1, 1.0);
    }
    Outputs {
        vec3 Tint;
        Base.EmissiveColor = Tint;
    }
    Graph {
        // float4(1, 0, 0, 1) inside a comment must not be picked up
        vec3 Tint = vec3(1, 0, 0);
        float3 Splat = float3(0.5);
        float4 Dynamic = float4(A, B, C, D);
    }
}`;
const colorRanges = language.getDocumentColorRanges(colorSource);
const findColorRange = (needle) => colorRanges.find((entry) => colorSource.slice(entry.startOffset, entry.endOffset) === needle);

const baseColorRange = findColorRange('float4(0.8, 0.3, 0.1, 1.0)');
assert(baseColorRange, "A float4(...) literal with all-numeric arguments should get a color range");
assert.deepStrictEqual(baseColorRange.color, { red: 0.8, green: 0.3, blue: 0.1, alpha: 1 }, "float4(...) color components should map directly to red/green/blue/alpha");

const tintRange = findColorRange("vec3(1, 0, 0)");
assert(tintRange, "vec3(...) (the GLSL alias) should also get a color range");
assert.strictEqual(tintRange.color.alpha, 1, "A 3-component constructor should report alpha=1 (no alpha channel to read)");

const splatRange = findColorRange("float3(0.5)");
assert(splatRange, "The scalar-splat form float3(0.5) should get a color range");
assert.deepStrictEqual(splatRange.color, { red: 0.5, green: 0.5, blue: 0.5, alpha: 1 }, "A splat constructor should report the same value for every component");

assert(!findColorRange("float4(A, B, C, D)"), "A constructor with non-literal (identifier) arguments should not get a color range -- there's no concrete color to show or safely rewrite");
assert(!colorRanges.some((entry) => colorSource.slice(Math.max(0, entry.startOffset - 40), entry.endOffset).includes("must not be picked up")), "A color-shaped literal inside a comment must not be picked up");
assert.strictEqual(colorRanges.length, 3, "Only the three genuinely all-literal constructors should produce color ranges");

assert.strictEqual(language.formatColorPresentation("float4", 4, { red: 0.8, green: 0.3, blue: 0.1, alpha: 1 }), "float4(0.8, 0.3, 0.1, 1.0)", "Editing a color back should preserve the original constructor spelling and format each component cleanly");
assert.strictEqual(language.formatColorPresentation("vec3", 3, { red: 1, green: 0, blue: 0, alpha: 0.5 }), "vec3(1.0, 0.0, 0.0)", "A 3-component constructor's presentation should drop the alpha component entirely");
assert.strictEqual(language.formatColorPresentation("float4", 4, { red: 1 / 3, green: 0, blue: 0, alpha: 1 }), "float4(0.333, 0.0, 0.0, 1.0)", "Component values should round to 3 decimal places");

// --- 1.9.x: preprocessor directives (#if / #ifdef / #ifndef / #elif / #else / #endif / #define /
//     #undef) -----------------------------------------------------------------------------------
//
// One example per DSHnnnn, the two codes this side deliberately does not emit, and -- first,
// because it is the one that would do real damage -- the gate that keeps a `Function` body opaque.
const preprocessorDiagnosticsFor = (src, fileName = "M_Preprocessor.dsm") =>
    language.getDiagnostics(src, fileName, {}).filter((diagnostic) => /^DSH10(3\d|4[0-2])$/.test(diagnostic.code || ""));
const preprocessorCodesFor = (src, fileName) => preprocessorDiagnosticsFor(src, fileName).map((diagnostic) => diagnostic.code);
const preprocessorMessagesFor = (src, fileName) => preprocessorDiagnosticsFor(src, fileName).map((diagnostic) => diagnostic.message);

// THE REGRESSION GATE. `MF_MoonToonTranslucencyShadow.dsf`'s real shape, the `#include` form six
// more files in the tree use, and a `GraphFunction` body for the third. These directives address
// HLSL's preprocessor, with the shader compiler's defines, and DreamShader never sees them -- so a
// pass that descended into a body would put a red squiggle on nine shipped files every day.
const opaqueHlslBodySource = `Function MoonToonBlendModeSwitch(
	in float3 Opaque,
	in float3 Masked,
	in float3 Translucent,
	out float3 Result)
{
#if MATERIALBLENDING_SOLID
	Result = Opaque;
#elif MATERIALBLENDING_MASKED
	Result = Masked;
#elif MATERIALBLENDING_TRANSLUCENT
	Result = Translucent;
#else
	Result = 0;
#endif
}

Function DreamWindSample(in float3 P, out float3 W)
{
	#include "/Plugin/DreamDynamicWorld/Shared/DreamWindShared.h"
	W = P;
}

GraphFunction ToonEyeHighlight(in float2 UV, out float3 Highlight)
{
#if PIXELSHADER
	Highlight = float3(UV, 0);
#else
	Highlight = float3(0, 0, 0);
#endif
}`;
assert.deepStrictEqual(preprocessorCodesFor(opaqueHlslBodySource, "MF_Opaque.dsf"), [], "HLSL directives inside a Function / GraphFunction body must produce no preprocessor diagnostic at all");
assert.deepStrictEqual(preprocessorCodesFor(`Function F(out float B)
{
#if PIXELSHADER
	B = 1;
}`, "MF_Unbalanced.dsf"), [], "An unpaired HLSL #if inside a body is not recognized, not paired and not counted -- so it cannot leave a chain open");
assert.deepStrictEqual(preprocessorCodesFor(`#if DS_SUBSTRATE
Function ApplyShading(in float3 C, out float3 R) { R = C; }
#else
Function ApplyShading(in float3 C, out float3 R) { R = C * 0.5; }
#endif`, "MF_Wrapped.dsf"), [], "A #if wrapping whole Function blocks sits outside every body, so it is a directive and must pair cleanly");

// `#Region` / `#EndRegion` are the parser's, matched case-insensitively -- so lowercase `#region`
// is legal today and must not become DSH1035.
assert.deepStrictEqual(preprocessorCodesFor(`Shader(Name="Materials/M_Region")
{
    Outputs = {
        float3 Color;
        Base.BaseColor = Color;
    }
    Graph = {
        #Region "upper"
        Color = float3(1, 1, 1);
        #EndRegion
        #region "lower"
        Color = Color * 0.5;
        #endregion
    }
}`), [], "#Region / #EndRegion pass through in any case, lowercase included");

// The documented Substrate example: the reason the feature exists, and well-formed throughout.
assert.deepStrictEqual(preprocessorCodesFor(`Shader(Name="Materials/M_Foo", Root="Game")
{
    Settings = {
        Domain = "Surface";
#if !DS_SUBSTRATE
        ShadingModel = "DefaultLit";
#endif
    }

    Outputs = {
#if DS_SUBSTRATE
        Substrate Surface;
        Base.FrontMaterial = Surface;
#else
        vec3 BaseColor;
        Base.BaseColor = BaseColor;
#endif
    }
}`), [], "The documented Substrate example must produce no preprocessor diagnostics");

// Chain shape: DSH1030 - DSH1033.
assert.deepStrictEqual(preprocessorCodesFor("#if DS_SUBSTRATE\n"), ["DSH1030"], "DSH1030: the file ends with a #if still open");
assert(/2 conditional block\(s\) still open/.test(preprocessorMessagesFor("#if 1\n#if 2\n")[0]), "DSH1030 points at the innermost #if and says how many are open");
assert.deepStrictEqual(preprocessorCodesFor("#endif\n"), ["DSH1031"], "DSH1031: #endif with no matching #if");
assert.deepStrictEqual(preprocessorCodesFor("#else\n"), ["DSH1032"], "DSH1032: #else with no matching #if");
assert.deepStrictEqual(preprocessorCodesFor("#elif 1\n"), ["DSH1032"], "DSH1032: #elif with no matching #if");
assert.deepStrictEqual(preprocessorCodesFor("#if 1\n#else\n#elif 2\n#endif\n"), ["DSH1033"], "DSH1033: #elif after the #else that closed the chain");
assert.deepStrictEqual(preprocessorCodesFor("#if 1\n#else\n#else\n#endif\n"), ["DSH1033"], "DSH1033: a second #else");
assert(/after the '#else' on line 2/.test(preprocessorMessagesFor("#if 1\n#else\n#else\n#endif\n")[0]), "DSH1033 names the line of the #else that closed the chain");
assert.deepStrictEqual(preprocessorCodesFor("#if 1\n#if 2\n#else\n#endif\n#elif 3\n#else\n#endif\n"), [], "Nested chains pair independently");

// DSH1034 against DSH1042: did the expression finish? The two tables below are the plugin's own
// worked examples, and they are the whole of the rule.
for (const [text, why] of [
    ["#if (1", "the parenthesis never closes"],
    ["#if 1 &&", "&& has no right operand"],
    ["#if &&1", "&& is not a valid operand"],
    ["#if 1 &&)", ") is not a valid operand, so the expression stops unfinished there"],
    ["#if 0xZZ", "a malformed literal arrives whole and fails as one bad literal"],
    ["#if A & B", "a lone & is not in the grammar -- there are no bitwise operators"],
    ["#if \"unterminated", "an unterminated string literal"],
    ["#if defined(", "'defined' with no name"]
]) {
    assert.deepStrictEqual(preprocessorCodesFor(`${text}\n#endif\n`), ["DSH1034"], `DSH1034: ${why}`);
}
for (const [text, why] of [
    ["#if 1 2\n#endif\n", "1 is already a complete expression"],
    ["#if 1)\n#endif\n", "the ) is surplus"],
    ["#if (1))\n#endif\n", "likewise, one level in"],
    ["#ifdef A B\n#endif\n", "A is a valid name; B is surplus"],
    ["#undef A B\n", "same, and #undef has no value to hide behind"],
    ["#if 1\n#else junk\n#endif\n", "#else takes no operand at all"],
    ["#if 1\n#endif MOONTOON_LEGACY\n", "labelling a long chain is C's habit, not this language's"]
]) {
    assert.deepStrictEqual(preprocessorCodesFor(text), ["DSH1042"], `DSH1042: ${why}`);
}
assert(/expected '\)' but found the end of the condition/.test(preprocessorMessagesFor("#if (1\n#endif\n")[0]), "DSH1034 describes the end of the condition rather than an empty token");
assert(/is already complete before 'B'/.test(preprocessorMessagesFor("#ifdef A B\n#endif\n")[0]), "DSH1042 names the surplus token");

// DSH1035, and the three suggestions it picks between.
assert.deepStrictEqual(preprocessorCodesFor(`#include "Shared/Common.dsh"\n`), ["DSH1035"], "DSH1035: #include at the declaration level");
assert(/use import "\.\.\." instead/.test(preprocessorMessagesFor(`#include "Shared/Common.dsh"\n`)[0]), "DSH1035 answers #include with the DreamShaderLang spelling, not a near-miss keyword");
assert.deepStrictEqual(preprocessorCodesFor("#IF FOO\n"), ["DSH1035"], "DSH1035: a mis-cased directive is reported, not quietly ignored");
assert(/Preprocessor directives are lowercase: write '#if'/.test(preprocessorMessagesFor("#IF FOO\n")[0]), "A distance-zero match is a case diagnosis, not a 'did you mean'");
assert(/Did you mean '#endif'\?/.test(preprocessorMessagesFor("#if 1\n#endfi\n")[0]), "A near miss gets the nearest keyword");
assert(/A '#' line must be #if/.test(preprocessorMessagesFor("#zzz\n")[0]), "Something resembling nothing gets the general rule");
assert.deepStrictEqual(preprocessorCodesFor("#if FOO\n#endfi\n"), ["DSH1035", "DSH1030"], "A typo'd #endfi is an unknown directive AND leaves the chain open -- both are true, and the second is the damage the first would have done silently");

// DSH1036 and DSH1038 split on missing-operand against unusable-name.
assert.deepStrictEqual(preprocessorCodesFor("#if\n#endif\n"), ["DSH1036"], "DSH1036: #if with no expression");
assert.deepStrictEqual(preprocessorCodesFor("#if // nothing but a comment\n#endif\n"), ["DSH1036"], "The trailing comment is stripped before the condition is read");
assert.deepStrictEqual(preprocessorCodesFor("#ifdef\n#endif\n"), ["DSH1036"], "DSH1036: #ifdef with no name");
assert.deepStrictEqual(preprocessorCodesFor("#if 1\n#elif\n#endif\n"), ["DSH1036"], "DSH1036: #elif with no expression");
assert.deepStrictEqual(preprocessorCodesFor("#define 1BAD 1\n"), ["DSH1038"], "DSH1038: a name may not start with a digit");
assert.deepStrictEqual(preprocessorCodesFor("#define\n"), ["DSH1038"], "DSH1038 covers a missing #define name too -- DSH1036 is reserved for the #if family");
assert.deepStrictEqual(preprocessorCodesFor("#undef\n"), ["DSH1038"], "DSH1038: #undef with no name");
assert.deepStrictEqual(preprocessorCodesFor("#define FOO(x) x\n"), ["DSH1038"], "There are no function-like macros, so FOO(x) fails as a name rather than defining FOO");
assert.deepStrictEqual(preprocessorCodesFor("#ifdef 9LIVES\n#endif\n"), ["DSH1038"], "DSH1038: an #ifdef name is validated like any other");

// DSH1037: sixty-four levels are legal, the sixty-fifth is not, and it complains once.
assert.deepStrictEqual(preprocessorCodesFor(`${"#if 1\n".repeat(64)}${"#endif\n".repeat(64)}`), [], "64 levels of nesting are legal");
assert.deepStrictEqual(preprocessorCodesFor(`${"#if 1\n".repeat(65)}${"#endif\n".repeat(65)}`), ["DSH1037"], "DSH1037: the 65th #if is the one that fails, and it fails exactly once");

// DSH1039: the DS_ prefix is reserved, as a prefix, case-sensitively -- and only against writes.
assert.deepStrictEqual(preprocessorCodesFor("#define DS_FOO 1\n"), ["DSH1039"], "DSH1039: defining a reserved name");
assert.deepStrictEqual(preprocessorCodesFor("#undef DS_SUBSTRATE\n"), ["DSH1039"], "DSH1039: undefining one is refused for the same reason");
assert.deepStrictEqual(preprocessorCodesFor("#define ds_foo 1\n"), [], "The prefix test is case-sensitive: ds_foo cannot collide with a builtin, so it is an ordinary name");
assert.deepStrictEqual(preprocessorCodesFor("#ifdef DS_SUBSTRATE\n#endif\n"), [], "Reading a reserved name is fine -- only defining or undefining one is refused");

// Shapes that are legal and easy to break.
assert.deepStrictEqual(preprocessorCodesFor("#define PP_SUM 1 + 1\n#define PP_NOTE two words\n#define PP_MARK\n"), [], "#define takes its value to the end of the line, so `B C` is a value and never a trailing token");
assert.deepStrictEqual(preprocessorCodesFor("#if 1\n#endif // MOONTOON_LEGACY\n"), [], "A trailing // comment is allowed after any directive");
assert.deepStrictEqual(preprocessorCodesFor(`#if DS_HOST == "http://build"\n#endif\n`), [], "The comment strip is quote-aware, so a // inside a string literal does not end the directive early");
assert.deepStrictEqual(preprocessorCodesFor("#  if defined(FOO)\n#  endif\n"), [], "Whitespace after the # is allowed");
assert.deepStrictEqual(preprocessorCodesFor("#if(FOO)\n#endif\n"), [], "#if(A) is a directive: the keyword run ends where an identifier character stops");
assert.deepStrictEqual(preprocessorCodesFor("// #if FOO\n"), [], "A line starting with // is an ordinary comment, so commenting a directive out works exactly as it looks");
assert.deepStrictEqual(preprocessorCodesFor("#if defined(FOO) || defined BAR\n#endif\n"), [], "Both spellings of defined parse");
assert.deepStrictEqual(preprocessorCodesFor("#if !!FOO\n#endif\n"), [], "Repeated unary prefixes are accepted, as they are in the plugin");
assert.deepStrictEqual(preprocessorCodesFor("#if DS_ENGINE_MAJOR > 5 || (DS_ENGINE_MAJOR == 5 && DS_ENGINE_MINOR >= 7)\n#endif\n"), [], "The documented engine-version gate parses");

// DSH1040 (a string where a number was required) and DSH1041 (division or modulo by zero) are the
// two codes this side does not and cannot emit: both need the expression EVALUATED against a define
// table that exists only inside the running editor. The three lines below are the plugin's own
// examples for them, and they must stay silent here. If one ever starts reporting, someone has
// added an evaluator without a table to evaluate against, and it is guessing.
assert.deepStrictEqual(preprocessorCodesFor("#if DS_PLATFORM\n#endif\n"), [], "DSH1040 is the plugin's alone: a bare string condition needs the define table to notice");
assert.deepStrictEqual(preprocessorCodesFor(`#if "x" == 1\n#endif\n`), [], "DSH1040 is the plugin's alone: a string against a number is well-FORMED, and only evaluation says otherwise");
assert.deepStrictEqual(preprocessorCodesFor("#if 1 / 0\n#endif\n"), [], "DSH1041 is the plugin's alone: division by zero is a value question, not a syntax one");

// And the reason staying silent about those two is not enough on its own. The condition check runs
// the shared parser with evaluation TURNED OFF (`checkConditionSyntax`), rather than evaluating
// against an empty table and discarding whatever DSH1040 / DSH1041 comes back. The difference is
// only visible when a value complaint sits in FRONT of a real syntax error: an evaluating parse
// stops at the first one it meets, so the syntax error below it is never reached and never
// reported. `DS_PLATFORM == "Windows"` is the documented string idiom and every identifier reads as
// 0 without a table, so both shapes below are one plausible typo away from an author.
assert.deepStrictEqual(preprocessorCodesFor(`#if DS_PLATFORM == "Windows" || (\n#endif\n`), ["DSH1034"],
    "A string comparison in front of a broken parenthesis must not swallow the DSH1034");
assert.deepStrictEqual(preprocessorCodesFor("#if 1 / 0 2\n#endif\n"), ["DSH1042"],
    "A literal division by zero in front of a surplus token must not swallow the DSH1042");

// Both arms of a #if are parsed and indexed here (there is no define table to choose between them),
// so the duplicate-declaration rules have to ask whether the preprocessor could ever emit two
// declarations TOGETHER. One `Function` per branch is what `preprocessor.md` documents as the only
// way to pick between two HLSL bodies at generation time, so calling it an error would make the
// feature unusable in exactly the case it was built for.
const duplicateMessagesFor = (src, fileName = "M_Preprocessor.dsm") =>
    language.getDiagnostics(src, fileName, {})
        .filter((diagnostic) => /declared more than once|Only one top-level Shader block/.test(diagnostic.message))
        .map((diagnostic) => diagnostic.message);
assert.deepStrictEqual(duplicateMessagesFor(`#if DS_SUBSTRATE
Function ApplyShading(in float3 C, out float3 R) { R = C; }
#else
Function ApplyShading(in float3 C, out float3 R) { R = C * 0.5; }
#endif`, "MF_Branches.dsf"), [], "Two declarations in different branches of one chain are never both emitted, so they are not duplicates");
assert.strictEqual(duplicateMessagesFor(`Function ApplyShading(in float3 C, out float3 R) { R = C; }
Function ApplyShading(in float3 C, out float3 R) { R = C * 0.5; }`, "MF_Duplicate.dsf").length, 2, "Two unconditional declarations are still duplicates -- the branch test must not swallow the real rule");
assert.strictEqual(duplicateMessagesFor(`#if DS_SUBSTRATE
Function ApplyShading(in float3 C, out float3 R) { R = C; }
Function ApplyShading(in float3 C, out float3 R) { R = C * 0.5; }
#endif`, "MF_SameBranch.dsf").length, 2, "Two declarations in the SAME branch are emitted together, so they are duplicates");
assert.deepStrictEqual(duplicateMessagesFor(`#if DS_SUBSTRATE
Shader(Name="Materials/M_A") { Outputs = { vec3 C; Base.BaseColor = C; } Graph = { C = vec3(1, 1, 1); } }
#else
Shader(Name="Materials/M_A") { Outputs = { vec3 C; Base.BaseColor = C; } Graph = { C = vec3(0, 0, 0); } }
#endif`), [], "Two Shader blocks in different branches are not two top-level Shader blocks");
assert.strictEqual(duplicateMessagesFor(`Shader(Name="Materials/M_A") { Outputs = { vec3 C; Base.BaseColor = C; } Graph = { C = vec3(1, 1, 1); } }
Shader(Name="Materials/M_B") { Outputs = { vec3 D; Base.BaseColor = D; } Graph = { D = vec3(0, 0, 0); } }`).length, 1, "Two unconditional Shader blocks are still DSH3030");

console.log("language smoke tests passed");
