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
assert(String(bundledAbsCompletion.insertText || "").startsWith("Expression(Class=\"Abs\""), "Bundled UE. completion should expand to UE.Expression syntax");

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
const v15Source = `Shader("M_V15") {
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

// optional '=' on a section keeps its body symbols
const noEqSource = `Shader("M_NoEq") {
    Properties { ScalarParameter A = 1.0; }
    Graph { Base.BaseColor = float3(A, A, A); }
}`;
const noEqProps = language.parseDocument(noEqSource).blocks[0].sections.find((section) => section.name === "Properties");
assert(noEqProps && noEqProps.entries.some((entry) => entry.name === "A"), "Sections without '=' should still be parsed and keep their symbols");

// 1.5 completions: Slider metadata and propgroup declaration sugar
const metaDoc = `Shader("M") {\n    Properties {\n        ScalarParameter A = 1.0 [];\n    }\n}`;
const metaLabels = language.getCompletionSpecs(metaDoc, metaDoc.indexOf("[]") + 1, {}).map((item) => item.label);
assert(metaLabels.includes("Slider"), "Metadata completion should offer the Slider shorthand");
const propDoc = `Shader("M") {\n    Properties {\n        \n    }\n}`;
const propLabels = language.getCompletionSpecs(propDoc, propDoc.indexOf("        \n") + 8, {}).map((item) => item.label);
assert(propLabels.includes("propgroup"), "Properties completion should offer the propgroup scope snippet");

console.log("language smoke tests passed");
