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
    res = lerp(a, b, alpha);
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
        MaterialAttributes Result;
        Base.MaterialAttributes = Result;
    }
    Graph = {
        Sub
    }
}`;
const substrateOffset = substrateSource.indexOf("        Sub") + "        Sub".length;
assert(language.getCompletionSpecs(substrateSource, substrateOffset, {}).some((item) => item.label === "SubstrateSlabBSDF"), "Substrate shaders should offer Substrate graph helpers");

const formatted = language.formatDocument(`Shader(Name="Materials/M")
{
Properties={ 
float Value;
}
}`);
assert(/    Properties = \{/.test(formatted), "Formatter should indent sections");

const indexed = language.buildDocumentIndex({
    fileName: "Root.dsm",
    text: `import "A.dsh";\nFunction A(in float X, out float Y) { B(X, Y); }`,
    resolveImportPath: () => "A.dsh",
    readFileText: () => `Function B(in float X, out float Y) { A(X, Y); }`
});
assert(indexed.callables.has("a") && indexed.callables.has("b"), "Document index should collect imported callables");
assert(indexed.cycles.length > 0, "Document index should detect function cycles across imports");

console.log("language smoke tests passed");
