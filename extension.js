"use strict";

const fs = require("fs");
const https = require("https");
const childProcess = require("child_process");
const path = require("path");
const vscode = require("vscode");

const LANGUAGE_ID = "dreamshaderlang";
const BRIDGE_DIAGNOSTIC_COLLECTION_NAME = "dreamshader";
const LOCAL_DIAGNOSTIC_COLLECTION_NAME = "dreamshader-local";
const DREAMSHADER_EXTENSIONS = new Set([".dsm", ".dsh"]);
const INDENT = "    ";
const PACKAGE_MANIFEST_NAME = "dreamshader.package.json";
const PACKAGE_LOCK_NAME = "dreamshader.lock.json";
const DEFAULT_PACKAGE_INDEX_URL = "https://raw.githubusercontent.com/TypeDreamMoon/dreamshader-package-index/main/packages.json";

const LEGACY_SECTION_NAMES = [
    "Properties",
    "Settings",
    "Outputs",
    "Graph",
    "Inputs"
];

const TOP_LEVEL_BLOCK_NAMES = [
    "Shader",
    "Function",
    "Namespace",
    "ShaderFunction"
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

function createSettingItem(name, detail, insertText) {
    return {
        name,
        detail,
        insertText: insertText || `${name} = "$0";`
    };
}

function createAssetSettingItem(name, detail) {
    return createSettingItem(name, detail, name + ' = Path("${1:/Game/Path/To/Asset.Asset}");');
}

function createMaterialOutputItem(name, detail) {
    return {
        name,
        qualifiedName: `Base.${name}`,
        detail,
        insertText: `Base.${name} = $0;`
    };
}

function createUEBuiltinItem(name, snippet, detail, parameters, example) {
    return {
        name,
        qualifiedName: `UE.${name}`,
        snippet,
        memberSnippet: snippet.replace(/^UE\./, ""),
        detail,
        parameters: parameters || [],
        example: example || snippet
    };
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

const MATERIAL_OUTPUT_ITEMS = [
    createMaterialOutputItem("BaseColor", "Material base color output"),
    createMaterialOutputItem("EmissiveColor", "Material emissive output"),
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
    createMaterialOutputItem("Anisotropy", "Anisotropy output"),
    createMaterialOutputItem("Tangent", "Tangent output")
];

const MATERIAL_OUTPUT_NAME_SET = new Set(MATERIAL_OUTPUT_ITEMS.map((item) => String(item.name || "").trim().toLowerCase()));

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
            { qualifier: "in", type: "value", name: "Index" },
            { qualifier: "in", type: "value", name: "UTiling" },
            { qualifier: "in", type: "value", name: "VTiling" },
            { qualifier: "in", type: "value", name: "UnMirrorU" },
            { qualifier: "in", type: "value", name: "UnMirrorV" }
        ],
        "UE.TexCoord(Index=0)"
    ),
    createUEBuiltinItem(
        "Time",
        "UE.Time(Period=${1:4.0})",
        "Creates a Time material expression.",
        [
            { qualifier: "in", type: "value", name: "Period" },
            { qualifier: "in", type: "value", name: "IgnorePause" }
        ],
        "UE.Time(Period=4.0)"
    ),
    createUEBuiltinItem(
        "Panner",
        "UE.Panner(Coordinate=${1:UV}, Time=${2:UE.Time()}, Speed=${3:float2(0.1, 0.0)})",
        "Creates a Panner material expression.",
        [
            { qualifier: "in", type: "value", name: "Coordinate" },
            { qualifier: "in", type: "value", name: "Time" },
            { qualifier: "in", type: "value", name: "Speed" },
            { qualifier: "in", type: "value", name: "SpeedX" },
            { qualifier: "in", type: "value", name: "SpeedY" },
            { qualifier: "in", type: "value", name: "FractionalPart" }
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
            { qualifier: "in", type: "value", name: "Input" },
            { qualifier: "in", type: "value", name: "Source" },
            { qualifier: "in", type: "value", name: "Destination" }
        ],
        "UE.TransformVector(Input=NormalTS, Source=\"Tangent\", Destination=\"World\")"
    ),
    createUEBuiltinItem(
        "TransformPosition",
        "UE.TransformPosition(Input=${1:WorldPos}, Source=\"${2:Local}\", Destination=\"${3:World}\")",
        "Creates a TransformPosition material expression.",
        [
            { qualifier: "in", type: "value", name: "Input" },
            { qualifier: "in", type: "value", name: "Source" },
            { qualifier: "in", type: "value", name: "Destination" },
            { qualifier: "in", type: "value", name: "PeriodicWorldTileSize" },
            { qualifier: "in", type: "value", name: "FirstPersonInterpolationAlpha" }
        ],
        "UE.TransformPosition(Input=WorldPos, Source=\"Local\", Destination=\"World\")"
    ),
    createUEBuiltinItem(
        "Expression",
        "UE.Expression(Class=\"${1:Sine}\", OutputType=\"${2:float1}\", Input=${3:UE.Time()})",
        "Creates any reflected MaterialExpression class.",
        [
            { qualifier: "in", type: "value", name: "Class" },
            { qualifier: "in", type: "value", name: "OutputType" },
            { qualifier: "in", type: "value", name: "Output" },
            { qualifier: "in", type: "value", name: "OutputIndex" }
        ],
        "UE.Expression(Class=\"Sine\", OutputType=\"float1\", Input=UE.Time())"
    )
];

const DREAMSHADER_HELPER_ITEMS = [
    ["Path", "Path(${1:Game}, \"${2:/Textures/MyTexture}\")", "Resolves a Game or Engine asset path for texture defaults and Settings object references."],
    ["Path", "Path(\"${1:/Game/Textures/MyTexture.DefaultTexture}\")", "Resolves a fully qualified Unreal object path for texture defaults and Settings object references."]
];

const HOVER_DOCS = new Map([
    ["shader", "Top-level DreamShader material declaration. DreamShader material implementation files use `.dsm`."],
    ["function", "Reusable shared function block. Define with `Function Name(in float Value, out vec3 Result) { ... }` and call with explicit out variables like `Name(Value, Result);`."],
    ["selfcontained", "Function modifier that embeds the Function and its DreamShader dependency closure directly into generated Custom nodes. Use `Function SelfContained Name(...) { ... }`."],
    ["inline", "Alias of `SelfContained` in DreamShader Function declarations."],
    ["namespace", "Groups shared Function blocks. Define with `Namespace(Name=\"Texture\") { ... }` and call with `Texture::Sample(...)`."],
    ["import", "Imports a DreamShader header. Use `import \"Common/MyHeader.dsh\";` or a package import such as `import \"@typedreammoon/dream-noise/Library/Noise.dsh\";`."],
    ["package", "DreamShader package installed under `DShader/Packages` from a GitHub repository with `dreamshader.package.json`."],
    ["shaderfunction", "Top-level DreamShader MaterialFunction asset declaration."],
    ["root", "Optional Shader or ShaderFunction asset root. Use `Root=\"Game\"` for `/Game` or `Root=\"Plugin.PluginName\"` for a content plugin root."],
    ["properties", "Declares user inputs or UE-generated property nodes."],
    ["settings", "Declares Unreal material or ShaderFunction settings."],
    ["outputs", "Declares shader outputs or ShaderFunction result pins. Material properties should use `Base.BaseColor = ...`, while auxiliary output nodes use `Expression(...).Pin[n] = ...`."],
    ["graph", "Inside `Shader` or `ShaderFunction`, `Graph` is DreamShader graph code. It supports basic `if` / `else`; put loops and complex flow logic inside `Function` blocks."],
    ["code", "`Code` is kept for Function helper code only. Use `Graph = { ... }` inside `Shader` or `ShaderFunction`."],
    ["inputs", "ShaderFunction input pin list."],
    ["outputtype", "Required for generic `UE.Expression(...)` or reflected `UE.ClassName(...)` calls."],
    ["resulttype", "Alias of `OutputType` for generic MaterialExpression calls."],
    ["class", "Explicit MaterialExpression class selector."],
    ["output", "Selects a named output from a multi-output expression or ShaderFunction call."],
    ["outputname", "Alias of `Output`."],
    ["outputindex", "Selects an output by zero-based output index."],
    ["base", "Material output root namespace used in Shader Outputs bindings, for example `Base.BaseColor = ...`."],
    ["pin", "Selects an auxiliary material output node pin by zero-based index, for example `Expression(Class=\"ThinTranslucentMaterialOutput\").Pin[0] = ...`."] ,
    ["path", "Resolves a texture or object asset path. Use `Path(Game, \"/Textures/MyTexture\")` or `Path(\"/Game/Folder/Asset.Asset\")`."],
    ["in", "Function input parameter qualifier."],
    ["out", "Function output parameter qualifier. Callers pass a target variable explicitly, for example `ApplyTint(Color, Tint, Result)`."]
]);

const BLOCK_SECTION_RULES = new Map([
    ["Shader", new Set(["Properties", "Settings", "Outputs", "Graph"])],
    ["ShaderFunction", new Set(["Inputs", "Outputs", "Settings", "Graph"])]
]);

const SCALAR_TYPE_NAMES = new Set([
    "float",
    "float1",
    "half",
    "half1",
    "int",
    "uint",
    "bool"
]);

const VECTOR_TYPE_COMPONENTS = new Map([
    ["float2", 2],
    ["float3", 3],
    ["float4", 4],
    ["half2", 2],
    ["half3", 3],
    ["half4", 4],
    ["vec2", 2],
    ["vec3", 3],
    ["vec4", 4],
    ["int2", 2],
    ["int3", 3],
    ["int4", 4],
    ["uint2", 2],
    ["uint3", 3],
    ["uint4", 4],
    ["bool2", 2],
    ["bool3", 3],
    ["bool4", 4],
    ["ivec2", 2],
    ["ivec3", 3],
    ["ivec4", 4],
    ["uvec2", 2],
    ["uvec3", 3],
    ["uvec4", 4],
    ["bvec2", 2],
    ["bvec3", 3],
    ["bvec4", 4]
]);

const TEXTURE_TYPE_NAMES = new Set([
    "texture2d",
    "texturecube",
    "texture2darray",
    "samplerstate"
]);

const TYPE_LIKE_NAMES = new Set([
    ...SCALAR_TYPE_NAMES,
    ...VECTOR_TYPE_COMPONENTS.keys(),
    ...TEXTURE_TYPE_NAMES,
    "materialattributes",
    "void"
]);

const IGNORED_IDENTIFIER_NAMES = new Set([
    "true",
    "false",
    "in",
    "out"
]);

function activate(context) {
    const bridgeDiagnostics = vscode.languages.createDiagnosticCollection(BRIDGE_DIAGNOSTIC_COLLECTION_NAME);
    const localDiagnostics = vscode.languages.createDiagnosticCollection(LOCAL_DIAGNOSTIC_COLLECTION_NAME);
    const bridgeDiagnosticsState = createEmptyBridgeDiagnosticsState();
    const bridgeDiagnosticsTreeProvider = createBridgeDiagnosticsTreeProvider(bridgeDiagnosticsState);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    const codeLensChangeEmitter = new vscode.EventEmitter();
    const refreshEditorUi = () => {
        updateDreamShaderStatusBar(statusBar, bridgeDiagnosticsState);
        codeLensChangeEmitter.fire();
        bridgeDiagnosticsTreeProvider.refresh();
    };

    context.subscriptions.push(
        bridgeDiagnostics,
        localDiagnostics,
        statusBar,
        codeLensChangeEmitter,
        bridgeDiagnosticsTreeProvider,
        vscode.window.createTreeView("dreamshader.bridgeDiagnostics", {
            treeDataProvider: bridgeDiagnosticsTreeProvider,
            showCollapseAll: true
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider({ language: LANGUAGE_ID }, createCompletionProvider(), ".", "\"", "/"),
        vscode.languages.registerHoverProvider({ language: LANGUAGE_ID }, createHoverProvider()),
        vscode.languages.registerSignatureHelpProvider({ language: LANGUAGE_ID }, createSignatureHelpProvider(), "(", ","),
        vscode.languages.registerDocumentSymbolProvider({ language: LANGUAGE_ID }, createDocumentSymbolProvider()),
        vscode.languages.registerDefinitionProvider({ language: LANGUAGE_ID }, createDefinitionProvider()),
        vscode.languages.registerReferenceProvider({ language: LANGUAGE_ID }, createReferenceProvider()),
        vscode.languages.registerDocumentFormattingEditProvider({ language: LANGUAGE_ID }, createFormattingProvider()),
        vscode.languages.registerCodeLensProvider({ language: LANGUAGE_ID }, createCodeLensProvider(codeLensChangeEmitter))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("dreamshader.showBridgeDiagnostics", async () => {
            await refreshBridgeInfrastructure();
            refreshEditorUi();
            await vscode.commands.executeCommand("dreamshader.bridgeDiagnostics.focus");
        }),
        vscode.commands.registerCommand("dreamshader.recompileCurrent", async (targetUri) => {
            await requestRecompile("file", targetUri);
        }),
        vscode.commands.registerCommand("dreamshader.recompileAll", async () => {
            await requestRecompile("all");
        }),
        vscode.commands.registerCommand("dreamshader.refreshBridgeDiagnostics", async () => {
            await refreshBridgeInfrastructure();
            refreshEditorUi();
        }),
        vscode.commands.registerCommand("dreamshader.cleanGeneratedShaders", async () => {
            await requestCleanGeneratedShaders();
        }),
        vscode.commands.registerCommand("dreamshader.openBridgeDiagnosticLocation", async (diagnosticEntry) => {
            await openBridgeDiagnosticLocation(diagnosticEntry);
        }),
        vscode.commands.registerCommand("dreamshader.installPackageFromGitHub", async () => {
            await installPackageFromGitHubCommand();
        }),
        vscode.commands.registerCommand("dreamshader.browsePackages", async () => {
            await browsePackagesCommand();
        }),
        vscode.commands.registerCommand("dreamshader.updatePackages", async () => {
            await updatePackagesCommand();
        }),
        vscode.commands.registerCommand("dreamshader.removePackage", async () => {
            await removePackageCommand();
        }),
        vscode.commands.registerCommand("dreamshader.packageUninstall", async () => {
            await removePackageCommand();
        }),
        vscode.commands.registerCommand("dreamshader.openPackagesFolder", async () => {
            await openPackagesFolderCommand();
        }),
        vscode.commands.registerCommand("dreamshader.addPackageStoreIndex", async () => {
            await addPackageStoreIndexCommand();
        }),
        vscode.commands.registerCommand("dreamshader.removePackageStoreIndex", async () => {
            await removePackageStoreIndexCommand();
        }),
        vscode.commands.registerCommand("dreamshader.createPackage", async () => {
            await createPackageCommand();
        }),
        vscode.commands.registerCommand("dreamshader.createMaterial", async () => {
            await createDreamShaderTemplateCommand("material");
        }),
        vscode.commands.registerCommand("dreamshader.createHeader", async () => {
            await createDreamShaderTemplateCommand("header");
        }),
        vscode.commands.registerCommand("dreamshader.createTextureSample", async () => {
            await createDreamShaderTemplateCommand("texture");
        }),
        vscode.commands.registerCommand("dreamshader.createNoiseMaterial", async () => {
            await createDreamShaderTemplateCommand("noise");
        })
    );

    const bridgeWatcherState = {
        rootsKey: "",
        watchers: []
    };
    const handleBridgeDiagnosticsChanged = () => {
        void refreshBridgeDiagnostics(bridgeDiagnostics, bridgeDiagnosticsState).then(() => {
            refreshEditorUi();
        });
    };
    const refreshBridgeInfrastructure = async () => {
        updateBridgeDiagnosticWatchers(bridgeWatcherState, handleBridgeDiagnosticsChanged);
        await refreshBridgeDiagnostics(bridgeDiagnostics, bridgeDiagnosticsState);
    };
    context.subscriptions.push({
        dispose() {
            for (const watcher of bridgeWatcherState.watchers) {
                watcher.dispose();
            }
            bridgeWatcherState.watchers = [];
            bridgeWatcherState.rootsKey = "";
        }
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void refreshBridgeInfrastructure();
            refreshAllLocalDiagnostics(localDiagnostics);
            refreshEditorUi();
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            refreshLocalDiagnosticsForDocument(document, localDiagnostics);
            void refreshBridgeInfrastructure();
            refreshEditorUi();
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            refreshLocalDiagnosticsForDocument(event.document, localDiagnostics);
            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === event.document) {
                refreshEditorUi();
            } else if (isDreamShaderDocument(event.document)) {
                codeLensChangeEmitter.fire();
            }
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            localDiagnostics.delete(document.uri);
            void refreshBridgeInfrastructure();
            refreshEditorUi();
        }),
        vscode.window.onDidChangeActiveTextEditor(() => {
            void refreshBridgeInfrastructure();
            refreshEditorUi();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("dreamshader")) {
                return;
            }

            void refreshBridgeInfrastructure();
            refreshAllLocalDiagnostics(localDiagnostics);
            refreshEditorUi();
        })
    );

    void refreshBridgeInfrastructure();
    refreshAllLocalDiagnostics(localDiagnostics);
    refreshEditorUi();
}

function deactivate() {}

function updateDreamShaderStatusBar(statusBar, bridgeDiagnosticsState) {
    const enabled = vscode.workspace.getConfiguration("dreamshader").get("showStatusBar", true);
    const activeDocument = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    if (!enabled || !activeDocument || !isDreamShaderDocument(activeDocument)) {
        statusBar.hide();
        return;
    }

    const projectRoot = findProjectRoot(activeDocument.uri.fsPath);
    const projectLabel = projectRoot ? path.basename(projectRoot) : "Project";
    const summary = getBridgeDiagnosticsSummaryForProject(bridgeDiagnosticsState, projectRoot);
    const summaryText = summary.total > 0 ? ` ${formatBridgeDiagnosticCountSummary(summary)}` : " Bridge clean";
    statusBar.command = {
        command: "dreamshader.showBridgeDiagnostics",
        title: "Show DreamShader Bridge Panel"
    };
    statusBar.text = summary.total > 0
        ? `$(warning) DreamShader ${projectLabel}:${summaryText}`
        : `$(check) DreamShader ${projectLabel}`;
    statusBar.tooltip = new vscode.MarkdownString([
        "**DreamShaderLang**",
        "",
        `Project: \`${projectRoot || "Not detected"}\``,
        `File: \`${path.basename(activeDocument.fileName)}\``,
        `Bridge: ${summary.total > 0 ? formatBridgeDiagnosticCountSummary(summary) : "No active bridge diagnostics"}`,
        "",
        "Click to open the DreamShader Bridge panel."
    ].join("\n"));
    statusBar.show();
}

function createCodeLensProvider(changeEmitter) {
    return {
        onDidChangeCodeLenses: changeEmitter.event,
        provideCodeLenses(document) {
            if (!isDreamShaderDocument(document) || !vscode.workspace.getConfiguration("dreamshader").get("enableCodeLens", true)) {
                return [];
            }

            const text = document.getText();
            const lenses = [];
            const topLevelBlocks = [
                ...parseNamedLegacyBlocks(text, "Shader"),
                ...parseNamedLegacyBlocks(text, "ShaderFunction")
            ].sort((left, right) => left.startOffset - right.startOffset);

            for (const block of topLevelBlocks) {
                const position = document.positionAt(block.startOffset);
                const range = new vscode.Range(position, position);
                lenses.push(new vscode.CodeLens(range, {
                    title: "$(play) Recompile Current",
                    command: "dreamshader.recompileCurrent",
                    arguments: [document.uri]
                }));
                lenses.push(new vscode.CodeLens(range, {
                    title: "$(refresh) Recompile All",
                    command: "dreamshader.recompileAll"
                }));
                lenses.push(new vscode.CodeLens(range, {
                    title: "$(pulse) Bridge",
                    command: "dreamshader.showBridgeDiagnostics"
                }));
            }

            if (topLevelBlocks.length === 0) {
                const definitions = parseFunctionDefinitionsFromText(text).filter((definition) => definition.kind === "Function");
                if (definitions.length > 0) {
                    const position = document.positionAt(definitions[0].startOffset);
                    const range = new vscode.Range(position, position);
                    lenses.push(new vscode.CodeLens(range, {
                        title: "$(refresh) Recompile All",
                        command: "dreamshader.recompileAll"
                    }));
                }
            }

            return lenses;
        }
    };
}

function createCompletionProvider() {
    return {
        provideCompletionItems(document, position) {
            const context = analyzeDocument(document, position);
            const items = [];

            if (context.afterUEAccessor && context.inGraphLikeContext) {
                for (const builtin of UE_BUILTINS) {
                    const item = new vscode.CompletionItem(builtin.name, vscode.CompletionItemKind.Function);
                    item.insertText = new vscode.SnippetString(builtin.memberSnippet);
                    item.detail = builtin.detail;
                    items.push(item);
                }
                return items;
            }

            if (context.afterOutputExpressionAccessor) {
                const item = new vscode.CompletionItem("Pin", vscode.CompletionItemKind.Field);
                item.insertText = new vscode.SnippetString("Pin[${1:0}] = $0;");
                item.detail = "Auxiliary material output node pin binding";
                items.push(item);
                return items;
            }

            addKeywordItems(items, context);
            addTopLevelAttributeItems(items, context);
            addImportItems(items, context);
            addTypeItems(items, context);
            addQualifierItems(items, context);
            addHlslKeywordItems(items, context);
            addSettingItems(items, context);
            addOutputItems(items, context);
            addBuiltinItems(items, context);
            addHelperItems(items, context);
            addReachableFunctionItems(items, document, context);
            addDeclaredIdentifierItems(items, context);

            return items;
        }
    };
}

function createHoverProvider() {
    return {
        provideHover(document, position) {
            const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
            if (!range) {
                return undefined;
            }

            const word = document.getText(range);
            const normalized = word.toLowerCase();
            if (HOVER_DOCS.has(normalized)) {
                return new vscode.Hover(new vscode.MarkdownString(HOVER_DOCS.get(normalized)));
            }

            const setting = SETTINGS_ITEMS.find((item) => item.name.toLowerCase() === normalized);
            if (setting) {
                return new vscode.Hover(new vscode.MarkdownString(`\`${setting.name}\`\n\n${setting.detail}`));
            }

            const output = MATERIAL_OUTPUT_ITEMS.find((item) => item.name.toLowerCase() === normalized);
            if (output) {
                return new vscode.Hover(new vscode.MarkdownString(`\`${output.qualifiedName}\`\n\n${output.detail}`));
            }

            const builtin = UE_BUILTINS.find((item) => item.name.toLowerCase() === normalized);
            if (builtin) {
                return new vscode.Hover(new vscode.MarkdownString(`\`${builtin.qualifiedName}\`\n\n${builtin.detail}\n\nExample: \`${builtin.example}\``));
            }

            const context = analyzeDocument(document, position);
            const visibleEntry = collectVisibleIdentifierEntries(context)
                .find((entry) => normalizeSymbolKey(entry.name) === normalized);
            if (visibleEntry) {
                return new vscode.Hover(new vscode.MarkdownString(`\`${visibleEntry.name}\`\n\n${visibleEntry.detail}`));
            }

            const qualifiedIdentifier = getQualifiedIdentifierAtPosition(document, position);
            const definitions = collectReachableFunctionDefinitions(document);
            const matchingDefinitions = getDefinitionsForName(definitions, qualifiedIdentifier ? qualifiedIdentifier.text : word);
            if (matchingDefinitions) {
                const firstDefinition = matchingDefinitions[0];
                return new vscode.Hover(new vscode.MarkdownString(`DreamShaderLang function \`${firstDefinition.name}\`\n\nDefined in \`${path.basename(firstDefinition.fsPath)}\``));
            }

            return undefined;
        }
    };
}

function createSignatureHelpProvider() {
    return {
        provideSignatureHelp(document, position) {
            const callContext = getActiveCallContext(document, position);
            if (!callContext) {
                return undefined;
            }

            const signatures = getCallableSignatureHelpEntries(document, callContext.callee);
            if (signatures.length === 0) {
                return undefined;
            }

            const help = new vscode.SignatureHelp();
            help.signatures = signatures.map((signature) => buildSignatureInformation(signature));
            help.activeSignature = 0;
            help.activeParameter = Math.max(0, Math.min(callContext.activeParameter, help.signatures[0].parameters.length - 1));
            return help;
        }
    };
}

function createDocumentSymbolProvider() {
    return {
        provideDocumentSymbols(document) {
            const text = document.getText();
            const symbols = [];

            for (const block of parseTopLevelBlocks(text)) {
                const start = document.positionAt(block.startOffset);
                const end = document.positionAt(block.endOffset);
                const range = new vscode.Range(start, end);
                let kind = vscode.SymbolKind.Module;
                if (block.kind === "Shader") {
                    kind = vscode.SymbolKind.Object;
                } else if (block.kind === "Function") {
                    kind = vscode.SymbolKind.Function;
                } else if (block.kind === "Namespace") {
                    kind = vscode.SymbolKind.Namespace;
                }
                symbols.push(new vscode.DocumentSymbol(block.name, "", kind, range, range));
            }

            return symbols;
        }
    };
}

function createDefinitionProvider() {
    return {
        provideDefinition(document, position) {
            const importLocation = getImportDefinitionLocation(document, position);
            if (importLocation) {
                return importLocation;
            }

            const qualifiedIdentifier = getQualifiedIdentifierAtPosition(document, position);
            if (!qualifiedIdentifier) {
                return undefined;
            }

            const definitions = collectReachableFunctionDefinitions(document);
            const matchingDefinitions = getDefinitionsForName(definitions, qualifiedIdentifier.text);
            if (!matchingDefinitions) {
                return undefined;
            }

            return matchingDefinitions.map((definition) => {
                const uri = vscode.Uri.file(definition.fsPath);
                const rangeLength = definition.nameRangeLength || definition.name.length;
                const targetRange = new vscode.Range(definition.position.line, definition.position.character, definition.position.line, definition.position.character + rangeLength);
                return new vscode.Location(uri, targetRange);
            });
        }
    };
}

function createReferenceProvider() {
    return {
        async provideReferences(document, position) {
            const qualifiedIdentifier = getQualifiedIdentifierAtPosition(document, position);
            if (!qualifiedIdentifier) {
                return undefined;
            }

            const targetText = qualifiedIdentifier.text;
            const definitions = collectReachableFunctionDefinitions(document);
            const matchingDefinitions = getDefinitionsForName(definitions, targetText);
            const searchNames = new Set([targetText]);
            let uris = [document.uri];

            if (matchingDefinitions) {
                for (const definition of matchingDefinitions) {
                    searchNames.add(definition.name);
                    if (definition.localName) {
                        searchNames.add(definition.localName);
                    }
                }

                uris = await vscode.workspace.findFiles("**/*.{dsm,dsh}", "**/{node_modules,.git}/**", 2000);
                if (!uris.some((uri) => normalizeFsPath(uri.fsPath) === normalizeFsPath(document.uri.fsPath))) {
                    uris.push(document.uri);
                }
            }

            const locations = [];
            for (const uri of uris) {
                let text = "";
                if (normalizeFsPath(uri.fsPath) === normalizeFsPath(document.uri.fsPath)) {
                    text = document.getText();
                } else {
                    try {
                        text = fs.readFileSync(uri.fsPath, "utf8");
                    } catch (_error) {
                        continue;
                    }
                }

                locations.push(...findReferenceLocations(uri, text, searchNames));
            }

            return locations;
        }
    };
}

function getQualifiedIdentifierAtPosition(document, position) {
    const lineText = document.lineAt(position.line).text;
    const regex = /[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*/g;
    for (const match of lineText.matchAll(regex)) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
            return {
                text: match[0],
                range: new vscode.Range(position.line, start, position.line, end)
            };
        }
    }
    return null;
}

function getDefinitionsForName(definitions, name) {
    if (!name) {
        return undefined;
    }
    if (definitions.has(name)) {
        return definitions.get(name);
    }
    const normalized = name.toLowerCase();
    for (const [key, entries] of definitions.entries()) {
        if (key.toLowerCase() === normalized || entries.some((entry) => String(entry.localName || "").toLowerCase() === normalized)) {
            return entries;
        }
    }
    return undefined;
}

function getActiveCallContext(document, position) {
    const offset = document.offsetAt(position);
    const textBeforeCursor = stripCommentsPreserveLayout(document.getText().slice(0, offset));
    let depth = 0;

    for (let index = textBeforeCursor.length - 1; index >= 0; index -= 1) {
        const char = textBeforeCursor[index];
        if (char === ")") {
            depth += 1;
            continue;
        }
        if (char !== "(") {
            continue;
        }
        if (depth > 0) {
            depth -= 1;
            continue;
        }

        const callee = readQualifiedIdentifierBefore(textBeforeCursor, index);
        if (!callee) {
            return null;
        }

        return {
            callee: callee.name,
            openParenOffset: index,
            activeParameter: countTopLevelCommas(textBeforeCursor.slice(index + 1))
        };
    }

    return null;
}

function readQualifiedIdentifierBefore(text, endIndex) {
    const before = text.slice(0, endIndex).trimEnd();
    const match = before.match(/[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*$/);
    if (!match) {
        return null;
    }
    return {
        name: match[0],
        start: before.length - match[0].length,
        end: before.length
    };
}

function countTopLevelCommas(text) {
    let count = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
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
        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }
        if (char === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }
        if (char === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            count += 1;
        }
    }

    return count;
}

function getCallableSignatureHelpEntries(document, callee) {
    const normalized = normalizeSymbolKey(callee);
    const callableSignatures = collectReachableCallableSignatures(document);
    const signatures = callableSignatures.get(normalized) || [];
    if (signatures.length > 0) {
        return signatures;
    }

    const ueBuiltin = UE_BUILTINS.find((item) => normalizeSymbolKey(item.qualifiedName) === normalized || normalizeSymbolKey(item.name) === normalized);
    if (ueBuiltin) {
        return [{
            kind: "UE",
            name: ueBuiltin.qualifiedName,
            inputs: ueBuiltin.parameters,
            outputs: [],
            detail: ueBuiltin.detail
        }];
    }

    if (isConstructorName(callee)) {
        return [{
            kind: "Constructor",
            name: callee,
            inputs: [{ qualifier: "in", type: "...", name: "components" }],
            outputs: [],
            detail: "Constructs a scalar or vector value."
        }];
    }

    return [];
}

function buildSignatureInformation(signature) {
    const parameters = [...(signature.inputs || []), ...(signature.outputs || [])];
    const parameterLabels = parameters.map((parameter) => {
        const qualifier = parameter.qualifier || ((signature.outputs || []).includes(parameter) ? "out" : "in");
        return `${qualifier} ${parameter.type || "value"} ${parameter.name || "value"}`.trim();
    });
    const label = `${signature.name}(${parameterLabels.join(", ")})`;
    const info = new vscode.SignatureInformation(label, new vscode.MarkdownString(signature.detail || `${signature.kind || "DreamShader"} callable`));
    info.parameters = parameterLabels.map((parameterLabel) => new vscode.ParameterInformation(parameterLabel));
    return info;
}

function findReferenceLocations(uri, text, searchNames) {
    const locations = [];
    const sortedNames = Array.from(searchNames)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    for (const name of sortedNames) {
        let index = 0;
        while (index < text.length) {
            const foundIndex = text.indexOf(name, index);
            if (foundIndex === -1) {
                break;
            }

            const before = text[foundIndex - 1];
            const after = text[foundIndex + name.length];
            if (isReferenceBoundary(before) && isReferenceBoundary(after)) {
                const start = offsetToPosition(text, foundIndex);
                const end = offsetToPosition(text, foundIndex + name.length);
                locations.push(new vscode.Location(uri, new vscode.Range(start.line, start.character, end.line, end.character)));
            }
            index = foundIndex + Math.max(1, name.length);
        }
    }

    return dedupeLocations(locations);
}

function isReferenceBoundary(char) {
    return !char || !/[A-Za-z0-9_]/.test(char);
}

function dedupeLocations(locations) {
    const seen = new Set();
    const result = [];
    for (const location of locations) {
        const key = `${normalizeFsPath(location.uri.fsPath)}:${location.range.start.line}:${location.range.start.character}:${location.range.end.character}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(location);
    }
    return result;
}

function createFormattingProvider() {
    return {
        provideDocumentFormattingEdits(document) {
            const originalText = document.getText();
            const formattedText = formatDreamShaderDocument(originalText);
            if (formattedText === originalText) {
                return [];
            }

            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(originalText.length));
            return [vscode.TextEdit.replace(fullRange, formattedText)];
        }
    };
}

function addKeywordItems(items, context) {
    const keywordEntries = [
        ["Shader", "Shader(Name=\"Materials/${1:MyMaterial}\", Root=\"${2:Game}\")\n{\n    $0\n}"],
        ["Function", "Function ${1:MyFunction}(in ${2:vec2} ${3:uv}, out ${4:vec4} ${5:result}) {\n    ${5:result} = ${4:vec4}(0.0, 0.0, 0.0, 1.0);\n}"],
        ["Function SelfContained", "Function SelfContained ${1:MyFunction}(in ${2:vec2} ${3:uv}, out ${4:vec4} ${5:result}) {\n    ${5:result} = ${4:vec4}(0.0, 0.0, 0.0, 1.0);\n}"],
        ["Namespace", "Namespace(Name=\"${1:Common}\")\n{\n    Function ${2:MyFunction}(in ${3:vec3} ${4:input}, out ${5:vec3} ${6:result}) {\n        ${6:result} = ${4:input};\n    }\n}"],
        ["import", "import \"${1:Shared/Common.dsh}\";"],
        ["ShaderFunction", "ShaderFunction(Name=\"Functions/${1:MyFunction}\", Root=\"${2:Game}\")\n{\n    Inputs = {\n        $3\n    }\n\n    Outputs = {\n        $4\n    }\n\n    Graph = {\n        $0\n    }\n}"]
    ];

    if (context.inTopLevelAttributeList || context.inFunctionBody || context.inFunctionSignature || context.currentSection) {
        return;
    }

    if (!context.currentLegacyBlock) {
        for (const [label, snippet] of keywordEntries) {
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
            item.insertText = new vscode.SnippetString(snippet);
            items.push(item);
        }
        return;
    }

    const allowedSections = BLOCK_SECTION_RULES.get(context.currentLegacyBlock.kind);
    if (!allowedSections) {
        return;
    }

    for (const sectionName of LEGACY_SECTION_NAMES) {
        if (!allowedSections.has(sectionName)) {
            continue;
        }

        const item = new vscode.CompletionItem(sectionName, vscode.CompletionItemKind.Module);
        item.insertText = new vscode.SnippetString(`${sectionName} = {\n    $0\n}`);
        items.push(item);
    }
}

function addTopLevelAttributeItems(items, context) {
    if (!context.inTopLevelAttributeList) {
        return;
    }

    const attributes = context.topLevelAttributeKind === "Namespace"
        ? [
            ["Name", "Name=\"${1:Common}\"", "Required Namespace name."]
        ]
        : [
            ["Name", "Name=\"${1:Materials/MyMaterial}\"", "Required generated asset path relative to Root."],
            ["Root", "Root=\"${1:Game}\"", "Optional generated asset root. Use Game or Plugin.PluginName."]
        ];

    for (const [name, snippet, detail] of attributes) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = detail;
        items.push(item);
    }
}

function addImportItems(items, context) {
    if (!context.inImportLine) {
        return;
    }

    for (const headerPath of collectAvailableHeaderImports(context.document)) {
        const item = new vscode.CompletionItem(headerPath, vscode.CompletionItemKind.File);
        item.insertText = new vscode.SnippetString(`"${headerPath}"`);
        item.detail = headerPath.startsWith("@") ? "DreamShader package header import" : "DreamShader header import";
        items.push(item);
    }
}

function addTypeItems(items, context) {
    const typeItems = context.inRawHlslContext || context.inFunctionSignature ? HLSL_TYPE_ITEMS : GRAPH_TYPE_ITEMS;
    for (const [name, detail] of typeItems) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.TypeParameter);
        item.detail = detail;
        items.push(item);
    }
}

function addQualifierItems(items, context) {
    if (!context.inFunctionSignature) {
        return;
    }

    for (const [name, detail] of QUALIFIER_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.detail = detail;
        items.push(item);
    }
}

function addHlslKeywordItems(items, context) {
    if (!context.inRawHlslContext && !context.inFunctionSignature) {
        return;
    }

    for (const [name, detail] of HLSL_KEYWORD_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.detail = detail;
        items.push(item);
    }
}

function addSettingItems(items, context) {
    if (!context.inSettings) {
        return;
    }

    for (const setting of SETTINGS_ITEMS) {
        const item = new vscode.CompletionItem(setting.name, vscode.CompletionItemKind.Property);
        item.insertText = new vscode.SnippetString(setting.insertText);
        item.detail = setting.detail;
        items.push(item);
    }
}

function addOutputItems(items, context) {
    if (!context.inMaterialOutputs) {
        return;
    }

    for (const helper of OUTPUT_HELPER_ITEMS) {
        const item = new vscode.CompletionItem(helper.name, vscode.CompletionItemKind.Module);
        item.insertText = new vscode.SnippetString(helper.snippet);
        item.detail = helper.detail;
        items.push(item);
    }

    for (const output of MATERIAL_OUTPUT_ITEMS) {
        const item = new vscode.CompletionItem(output.qualifiedName, vscode.CompletionItemKind.Field);
        item.insertText = new vscode.SnippetString(output.insertText);
        item.detail = output.detail;
        items.push(item);
    }
}

function addBuiltinItems(items, context) {
    if (!context.inGraphLikeContext) {
        return;
    }

    const ueRoot = new vscode.CompletionItem("UE", vscode.CompletionItemKind.Module);
    ueRoot.insertText = new vscode.SnippetString("UE.$0");
    ueRoot.detail = "DreamShader UE material expression namespace";
    items.push(ueRoot);

    for (const builtin of UE_BUILTINS) {
        const item = new vscode.CompletionItem(builtin.qualifiedName, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(builtin.snippet);
        item.detail = builtin.detail;
        items.push(item);
    }
}

function addHelperItems(items, context) {
    if (context.currentSection !== "Properties") {
        return;
    }

    for (const [name, snippet, detail] of DREAMSHADER_HELPER_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = detail;
        items.push(item);
    }
}

function addReachableFunctionItems(items, document, context) {
    const definitions = collectReachableFunctionDefinitions(document);
    const namespaceMatch = context?.linePrefix?.match(/([A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_]*$/);
    const namespacePrefix = namespaceMatch ? `${namespaceMatch[1]}::` : "";

    for (const [name, entries] of definitions.entries()) {
        if (namespacePrefix && !name.startsWith(namespacePrefix)) {
            continue;
        }

        const entry = entries[0];
        const localName = namespacePrefix ? (entry.localName || name.slice(namespacePrefix.length)) : name;
        const item = new vscode.CompletionItem(localName, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(localName);
        item.detail = entry.sourceKind === "imported" ? "Imported DreamShader function" : "DreamShader function";
        if (namespacePrefix) {
            item.documentation = new vscode.MarkdownString(`Namespace function \`${name}\``);
        }
        items.push(item);
    }
}
function addDeclaredIdentifierItems(items, context) {
    for (const entry of collectVisibleIdentifierEntries(context)) {
        const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Variable);
        item.detail = entry.detail;
        items.push(item);
    }
}

function analyzeDocument(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const prefix = text.slice(0, offset);
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const topLevelBlocks = parseTopLevelBlocks(text);
    const currentLegacyBlock = findEnclosingTopLevelBlock(topLevelBlocks, offset, new Set(["Shader", "ShaderFunction"]));
    const currentSectionInfo = currentLegacyBlock ? findEnclosingLegacySection(text, currentLegacyBlock, offset) : null;
    const currentBlock = currentLegacyBlock ? currentLegacyBlock.kind : "";
    const currentSection = currentSectionInfo ? currentSectionInfo.name : "";
    const currentFunction = findInnermostFunctionDefinition(text, offset);
    const topLevelAttributeKind = getTopLevelAttributeKindAtOffset(text, offset);
    const inFunctionSignature = Boolean(currentFunction && offset > currentFunction.paramOpenOffset && offset < currentFunction.paramCloseOffset);
    const inFunctionBody = Boolean(currentFunction && offset > currentFunction.bodyOpenOffset && offset < currentFunction.bodyCloseOffset);
    const inRawHlslContext = inFunctionBody;
    const inGraphCode = currentSection === "Graph";
    const inImportLine = /^\s*import\b/i.test(linePrefix.trimStart());

    return {
        document,
        text,
        offset,
        currentBlock,
        currentSection,
        currentFunction,
        currentLegacyBlock,
        currentSectionInfo,
        topLevelAttributeKind,
        linePrefix,
        inFunctionSignature,
        inFunctionBody,
        inRawHlslContext,
        inGraphCode,
        inSettings: currentSection === "Settings",
        inProperties: currentSection === "Properties" || currentSection === "Inputs",
        inOutputs: currentSection === "Outputs",
        inMaterialOutputs: currentSection === "Outputs" && currentBlock === "Shader",
        inGraphLikeContext: inGraphCode || currentSection === "Properties",
        inTopLevelAttributeList: Boolean(topLevelAttributeKind),
        inImportLine,
        afterUEAccessor: /UE\.\w*$/.test(linePrefix),
        afterOutputExpressionAccessor: currentSection === "Outputs" && currentBlock === "Shader" && /Expression\s*\([^)]*\)\.\w*$/.test(linePrefix)
    };
}

function getTopLevelAttributeKindAtOffset(text, offset) {
    const prefix = text.slice(0, offset);
    const matches = Array.from(prefix.matchAll(/\b(ShaderFunction|Shader|Namespace)\s*\(/g));
    if (matches.length === 0) {
        return "";
    }

    const match = matches[matches.length - 1];
    const tail = text.slice(match.index + match[0].length, offset);
    if (tail.includes(")") || tail.includes("{")) {
        return "";
    }

    return match[1];
}

function findCurrentLegacyTopLevelBlock(prefix) {
    const blockRegex = /\b(?:Shader|ShaderFunction)\s*\(/g;
    let current = "";
    for (const match of prefix.matchAll(blockRegex)) {
        const blockName = match[0].match(/[A-Za-z_][A-Za-z0-9_]*/);
        if (blockName) {
            current = blockName[0];
        }
    }
    return current;
}

function findCurrentLegacySection(prefix) {
    const sectionRegex = /\b(Properties|Settings|Outputs|Graph|Inputs)\s*=\s*\{/g;
    let current = "";
    for (const match of prefix.matchAll(sectionRegex)) {
        current = match[1];
    }
    return current;
}

function parseTopLevelBlocks(text) {
    const blocks = [];

    blocks.push(...parseNamedLegacyBlocks(text, "Shader"));

    for (const namespaceBlock of parseNamespaceBlocks(text)) {
        blocks.push(namespaceBlock);
    }

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        blocks.push({
            kind: definition.kind,
            name: definition.name,
            startOffset: definition.startOffset,
            endOffset: definition.bodyCloseOffset + 1
        });
    }

    blocks.push(...parseNamedLegacyBlocks(text, "ShaderFunction"));

    return blocks.filter(Boolean).sort((a, b) => a.startOffset - b.startOffset);
}

function parseNamespaceBlocks(text) {
    const blocks = [];
    for (const match of text.matchAll(/\bNamespace\s*\(\s*Name\s*=\s*"([^"]+)"/g)) {
        const block = makeSimpleBlock("Namespace", match[1], match.index, text, "{", "}");
        if (block) {
            blocks.push(block);
        }
    }
    return blocks;
}

function findEnclosingNamespaceBlock(namespaceBlocks, offset) {
    return namespaceBlocks
        .filter((block) => typeof block.bodyOpenOffset === "number"
            && typeof block.bodyCloseOffset === "number"
            && offset > block.bodyOpenOffset
            && offset < block.bodyCloseOffset)
        .sort((a, b) => (a.bodyCloseOffset - a.bodyOpenOffset) - (b.bodyCloseOffset - b.bodyOpenOffset))[0];
}

function makeSimpleBlock(kind, name, startOffset, text, openChar, closeChar) {
    if (typeof startOffset !== "number") {
        return undefined;
    }

    const braceIndex = text.indexOf(openChar, startOffset);
    if (braceIndex === -1) {
        return undefined;
    }

    const closeIndex = findMatchingDelimiter(text, braceIndex, openChar, closeChar);
    return {
        kind,
        name,
        startOffset,
        bodyOpenOffset: braceIndex,
        bodyCloseOffset: closeIndex,
        endOffset: closeIndex === -1 ? braceIndex + 1 : closeIndex + 1
    };
}

function findEnclosingTopLevelBlock(blocks, offset, allowedKinds) {
    return blocks
        .filter((block) => {
            if (allowedKinds && !allowedKinds.has(block.kind)) {
                return false;
            }

            return typeof block.startOffset === "number"
                && typeof block.endOffset === "number"
                && offset >= block.startOffset
                && offset <= block.endOffset;
        })
        .sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))[0];
}

function findEnclosingLegacySection(text, block, offset) {
    return parseLegacySections(text, block)
        .filter((section) => typeof section.bodyOpenOffset === "number"
            && typeof section.bodyCloseOffset === "number"
            && section.bodyCloseOffset >= section.bodyOpenOffset
            && offset >= section.bodyOpenOffset
            && offset <= section.bodyCloseOffset + 1)
        .sort((a, b) => (a.bodyCloseOffset - a.bodyOpenOffset) - (b.bodyCloseOffset - b.bodyOpenOffset))[0];
}

function parseFunctionDefinitionsFromText(text) {
    const definitions = [];
    const namespaceBlocks = parseNamespaceBlocks(text);
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
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

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (!matchKeywordAt(text, index, "Function")) {
            continue;
        }

        let cursor = index + "Function".length;
        cursor = skipWhitespace(text, cursor);
        if (!isIdentifierStart(text[cursor])) {
            continue;
        }

        let selfContained = false;
        let nameStart = cursor;
        let localName = "";
        while (true) {
            const tokenStart = cursor;
            cursor += 1;
            while (cursor < text.length && isIdentifierPart(text[cursor])) {
                cursor += 1;
            }

            const token = text.slice(tokenStart, cursor);
            const normalizedToken = token.toLowerCase();
            if (normalizedToken === "selfcontained" || normalizedToken === "inline") {
                selfContained = true;
                cursor = skipWhitespace(text, cursor);
                if (!isIdentifierStart(text[cursor])) {
                    localName = "";
                    break;
                }
                nameStart = cursor;
                continue;
            }

            nameStart = tokenStart;
            localName = token;
            break;
        }

        if (!localName) {
            continue;
        }

        cursor = skipWhitespace(text, cursor);
        if (text[cursor] !== "(") {
            continue;
        }

        const paramOpenOffset = cursor;
        const paramCloseOffset = findMatchingDelimiter(text, cursor, "(", ")");
        if (paramCloseOffset === -1) {
            continue;
        }

        cursor = skipWhitespace(text, paramCloseOffset + 1);
        if (text[cursor] !== "{") {
            continue;
        }

        const bodyCloseOffset = findMatchingDelimiter(text, cursor, "{", "}");
        if (bodyCloseOffset === -1) {
            continue;
        }

        const namespaceBlock = findEnclosingNamespaceBlock(namespaceBlocks, index);
        const namespaceName = namespaceBlock ? namespaceBlock.name : "";
        const name = namespaceName ? `${namespaceName}::${localName}` : localName;

        definitions.push({
            kind: "Function",
            name,
            localName,
            namespaceName,
            selfContained,
            nameRangeLength: localName.length,
            startOffset: index,
            nameOffset: nameStart,
            paramOpenOffset,
            paramCloseOffset,
            bodyOpenOffset: cursor,
            bodyCloseOffset
        });

        index = bodyCloseOffset;
    }

    return definitions;
}
function findInnermostFunctionDefinition(text, offset) {
    const definitions = parseFunctionDefinitionsFromText(text)
        .filter((definition) => definition.kind === "Function" && offset >= definition.startOffset && offset <= definition.bodyCloseOffset)
        .sort((a, b) => (a.bodyCloseOffset - a.startOffset) - (b.bodyCloseOffset - b.startOffset));
    return definitions[0];
}

function parseImportStatements(text) {
    const imports = [];
    const lineRegex = /^\s*import\s+["']([^"']+)["']\s*;/gm;
    for (const match of text.matchAll(lineRegex)) {
        imports.push({
            path: match[1],
            startOffset: match.index,
            endOffset: match.index + match[0].length,
            pathOffset: match.index + match[0].indexOf(match[1])
        });
    }
    return imports;
}

function parseNamedLegacyBlocks(text, kind) {
    if (kind !== "Shader" && kind !== "ShaderFunction") {
        return [];
    }

    const blocks = [];
    const regex = new RegExp(`\\b${kind}\\s*\\(`, "g");
    for (const match of text.matchAll(regex)) {
        const openIndex = text.indexOf("(", match.index);
        const closeIndex = findMatchingDelimiter(text, openIndex, "(", ")");
        const attributeText = closeIndex === -1 ? text.slice(openIndex + 1) : text.slice(openIndex + 1, closeIndex);
        const name = extractStringAttribute(attributeText, "Name");
        if (!name) {
            continue;
        }

        const block = makeSimpleBlock(kind, name, match.index, text, "{", "}");
        if (block) {
            blocks.push(block);
        }
    }
    return blocks;
}

function extractStringAttribute(attributeText, attributeName) {
    const regex = new RegExp(`\\b${attributeName}\\s*=\\s*"([^"]*)"`, "i");
    const match = regex.exec(attributeText);
    return match ? match[1] : "";
}

function skipTrivia(text, index, endIndex = text.length) {
    let cursor = index;
    while (cursor < endIndex) {
        const char = text[cursor];
        const next = cursor + 1 < endIndex ? text[cursor + 1] : "\0";
        if (/\s/.test(char)) {
            cursor += 1;
            continue;
        }
        if (char === "/" && next === "/") {
            cursor += 2;
            while (cursor < endIndex && text[cursor] !== "\n") {
                cursor += 1;
            }
            continue;
        }
        if (char === "/" && next === "*") {
            cursor += 2;
            while (cursor + 1 < endIndex && !(text[cursor] === "*" && text[cursor + 1] === "/")) {
                cursor += 1;
            }
            cursor = Math.min(endIndex, cursor + 2);
            continue;
        }
        break;
    }
    return cursor;
}

function parseLegacySections(text, block) {
    const sections = [];
    if (typeof block.bodyOpenOffset !== "number" || typeof block.bodyCloseOffset !== "number" || block.bodyCloseOffset < 0) {
        return sections;
    }

    let cursor = block.bodyOpenOffset + 1;
    while (cursor < block.bodyCloseOffset) {
        cursor = skipTrivia(text, cursor, block.bodyCloseOffset);
        if (cursor >= block.bodyCloseOffset || !isIdentifierStart(text[cursor])) {
            cursor += 1;
            continue;
        }

        const nameStart = cursor;
        cursor += 1;
        while (cursor < block.bodyCloseOffset && isIdentifierPart(text[cursor])) {
            cursor += 1;
        }
        const name = text.slice(nameStart, cursor);

        cursor = skipWhitespace(text, cursor);
        if (text[cursor] !== "=") {
            continue;
        }

        cursor = skipWhitespace(text, cursor + 1);
        if (text[cursor] !== "{") {
            continue;
        }

        const bodyOpenOffset = cursor;
        const bodyCloseOffset = findMatchingDelimiter(text, bodyOpenOffset, "{", "}");
        if (bodyCloseOffset === -1) {
            sections.push({
                name,
                nameOffset: nameStart,
                bodyOpenOffset,
                bodyCloseOffset: -1,
                bodyText: text.slice(bodyOpenOffset + 1, block.bodyCloseOffset)
            });
            break;
        }

        sections.push({
            name,
            nameOffset: nameStart,
            bodyOpenOffset,
            bodyCloseOffset,
            bodyText: text.slice(bodyOpenOffset + 1, bodyCloseOffset)
        });

        cursor = bodyCloseOffset + 1;
    }

    return sections;
}

function splitTopLevelDelimitedWithOffsets(text, baseOffset, delimiter) {
    const normalizedText = stripCommentsPreserveLayout(text);
    const segments = [];
    let startIndex = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < normalizedText.length; index += 1) {
        const char = normalizedText[index];
        const next = index + 1 < normalizedText.length ? normalizedText[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
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

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }
        if (char === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (char === delimiter && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            const raw = normalizedText.slice(startIndex, index);
            const trimmedStartDelta = raw.search(/\S|$/);
            const trimmedEndDelta = raw.length - raw.trimEnd().length;
            const trimmed = raw.trim();
            if (trimmed) {
                segments.push({
                    text: trimmed,
                    startOffset: baseOffset + startIndex + trimmedStartDelta,
                    endOffset: baseOffset + index - trimmedEndDelta
                });
            }
            startIndex = index + 1;
        }
    }

    const trailingRaw = normalizedText.slice(startIndex);
    const trimmedStartDelta = trailingRaw.search(/\S|$/);
    const trimmedEndDelta = trailingRaw.length - trailingRaw.trimEnd().length;
    const trailing = trailingRaw.trim();
    if (trailing) {
        segments.push({
            text: trailing,
            startOffset: baseOffset + startIndex + trimmedStartDelta,
            endOffset: baseOffset + normalizedText.length - trimmedEndDelta,
            terminated: false
        });
    }

    return segments;
}

function stripCommentsPreserveLayout(text) {
    let result = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
                result += "\n";
            } else if (char === "\r") {
                result += "\r";
            } else {
                result += " ";
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                result += "  ";
                inBlockComment = false;
                index += 1;
                continue;
            }

            if (char === "\n" || char === "\r") {
                result += char;
            } else {
                result += " ";
            }
            continue;
        }

        if (inString) {
            result += char;
            if (char === "\\") {
                if (index + 1 < text.length) {
                    result += text[index + 1];
                    index += 1;
                }
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            result += char;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            result += "  ";
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            result += "  ";
            index += 1;
            continue;
        }

        result += char;
    }

    return result;
}

function splitStatementsWithOffsets(text, baseOffset) {
    return splitTopLevelDelimitedWithOffsets(text, baseOffset, ";").map((segment) => ({
        ...segment,
        terminated: segment.terminated !== false
    }));
}

function findGraphIfStatementEnd(text, ifIndex) {
    if (!matchKeywordAt(text, ifIndex, "if")) {
        return -1;
    }

    let cursor = skipWhitespace(text, ifIndex + 2);
    if (text[cursor] !== "(") {
        return -1;
    }

    const conditionClose = findMatchingDelimiter(text, cursor, "(", ")");
    if (conditionClose === -1) {
        return -1;
    }

    cursor = skipWhitespace(text, conditionClose + 1);
    if (text[cursor] !== "{") {
        return -1;
    }

    const bodyClose = findMatchingDelimiter(text, cursor, "{", "}");
    if (bodyClose === -1) {
        return -1;
    }

    cursor = skipWhitespace(text, bodyClose + 1);
    if (!matchKeywordAt(text, cursor, "else")) {
        return bodyClose + 1;
    }

    cursor = skipWhitespace(text, cursor + 4);
    if (matchKeywordAt(text, cursor, "if")) {
        return findGraphIfStatementEnd(text, cursor);
    }

    if (text[cursor] !== "{") {
        return -1;
    }

    const elseClose = findMatchingDelimiter(text, cursor, "{", "}");
    return elseClose === -1 ? -1 : elseClose + 1;
}

function splitGraphStatementsWithOffsets(text, baseOffset) {
    const normalizedText = stripCommentsPreserveLayout(text);
    const statements = [];
    let startIndex = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;

    const pushStatement = (endIndex, terminated) => {
        const raw = normalizedText.slice(startIndex, endIndex);
        const trimmedStartDelta = raw.search(/\S|$/);
        const trimmedEndDelta = raw.length - raw.trimEnd().length;
        const trimmed = raw.trim();
        if (trimmed) {
            statements.push({
                text: trimmed,
                startOffset: baseOffset + startIndex + trimmedStartDelta,
                endOffset: baseOffset + endIndex - trimmedEndDelta,
                terminated
            });
        }
    };

    for (let index = 0; index < normalizedText.length; index += 1) {
        const char = normalizedText[index];

        if (inString) {
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

        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && matchKeywordAt(normalizedText, index, "if")) {
            const ifEndIndex = findGraphIfStatementEnd(normalizedText, index);
            if (ifEndIndex !== -1) {
                pushStatement(ifEndIndex, true);
                startIndex = ifEndIndex;
                index = ifEndIndex - 1;
                continue;
            }
        }

        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }
        if (char === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (char === ";" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            pushStatement(index, true);
            startIndex = index + 1;
        }
    }

    const trailingRaw = normalizedText.slice(startIndex);
    if (trailingRaw.trim()) {
        const trimmedStartDelta = trailingRaw.search(/\S|$/);
        const trimmedEndDelta = trailingRaw.length - trailingRaw.trimEnd().length;
        statements.push({
            text: trailingRaw.trim(),
            startOffset: baseOffset + startIndex + trimmedStartDelta,
            endOffset: baseOffset + normalizedText.length - trimmedEndDelta,
            terminated: false
        });
    }

    return statements;
}

function splitTopLevelAssignment(text) {
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
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

        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }
        if (char === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            return {
                left: text.slice(0, index).trim(),
                right: text.slice(index + 1).trim(),
                equalsIndex: index
            };
        }
    }

    return null;
}

function splitDeclarationTypeAndName(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!match) {
        return null;
    }

    return {
        type: match[1].trim(),
        name: match[2].trim()
    };
}

function parseCodeDeclarationEntries(text, baseOffset) {
    const segments = splitTopLevelDelimitedWithOffsets(text, baseOffset, ",");
    if (segments.length === 0) {
        return [];
    }

    const firstAssignment = splitTopLevelAssignment(segments[0].text);
    const firstDeclaration = splitDeclarationTypeAndName(firstAssignment ? firstAssignment.left : segments[0].text);
    if (!firstDeclaration) {
        return [];
    }

    const entries = [{
        type: firstDeclaration.type,
        name: firstDeclaration.name,
        valueText: firstAssignment ? firstAssignment.right : "",
        valueOffset: firstAssignment ? segments[0].startOffset + segments[0].text.indexOf(firstAssignment.right) : -1,
        startOffset: segments[0].startOffset,
        endOffset: segments[0].endOffset
    }];

    for (let index = 1; index < segments.length; index += 1) {
        const segment = segments[index];
        const assignment = splitTopLevelAssignment(segment.text);
        const nameText = assignment ? assignment.left.trim() : segment.text.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nameText)) {
            return [];
        }

        entries.push({
            type: firstDeclaration.type,
            name: nameText,
            valueText: assignment ? assignment.right : "",
            valueOffset: assignment ? segment.startOffset + segment.text.indexOf(assignment.right) : -1,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset
        });
    }

    return entries;
}

function normalizeSymbolKey(name) {
    return String(name || "").trim().toLowerCase();
}

function resolveTypeInfo(typeText) {
    const normalized = String(typeText || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!normalized) {
        return null;
    }

    if (SCALAR_TYPE_NAMES.has(normalized)) {
        return { type: normalized, componentCount: 1, isTexture: false };
    }

    if (VECTOR_TYPE_COMPONENTS.has(normalized)) {
        return { type: normalized, componentCount: VECTOR_TYPE_COMPONENTS.get(normalized), isTexture: false };
    }

    if (TEXTURE_TYPE_NAMES.has(normalized)) {
        return { type: normalized, componentCount: 0, isTexture: true };
    }

    if (normalized === "materialattributes") {
        return { type: normalized, componentCount: 0, isTexture: false };
    }

    return null;
}

function isTypeLikeName(name) {
    return TYPE_LIKE_NAMES.has(String(name || "").trim().toLowerCase());
}

function parseFunctionSignatureParameters(definition, text) {
    const parameterText = text.slice(definition.paramOpenOffset + 1, definition.paramCloseOffset);
    const segments = splitTopLevelDelimitedWithOffsets(parameterText, definition.paramOpenOffset + 1, ",");
    const inputs = [];
    const outputs = [];

    for (const segment of segments) {
        const parts = segment.text.split(/\s+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 3) {
            continue;
        }

        let qualifier = "in";
        let typeText = parts[0];
        let name = parts[1];
        if (parts.length === 3) {
            qualifier = parts[0].toLowerCase();
            typeText = parts[1];
            name = parts[2];
        }

        const entry = {
            qualifier,
            type: typeText,
            name
        };

        if (qualifier === "out") {
            outputs.push(entry);
        } else {
            inputs.push(entry);
        }
    }

    return { inputs, outputs };
}

function parseTypedDeclarationsFromSection(section, allowBindings = false) {
    const declarations = [];
    const bindings = [];
    const statements = splitStatementsWithOffsets(section.bodyText, section.bodyOpenOffset + 1);

    for (const statement of statements) {
        const assignment = splitTopLevelAssignment(statement.text);
        if (assignment) {
            const declaration = splitDeclarationTypeAndName(assignment.left);
            if (declaration) {
                declarations.push({
                    ...statement,
                    kind: "declaration",
                    type: declaration.type,
                    name: declaration.name,
                    valueText: assignment.right
                });
                continue;
            }

            if (allowBindings) {
                bindings.push({
                    ...statement,
                    kind: "binding",
                    target: assignment.left,
                    valueText: assignment.right
                });
                continue;
            }
        }

        const declaration = splitDeclarationTypeAndName(statement.text);
        if (declaration) {
            declarations.push({
                ...statement,
                kind: "declaration",
                type: declaration.type,
                name: declaration.name,
                valueText: ""
            });
            continue;
        }

        declarations.push({
            ...statement,
            kind: "invalid"
        });
    }

    return { declarations, bindings, statements };
}

function parseOutputBindingTarget(text) {
    const trimmed = String(text || "").trim();
    const materialMatch = trimmed.match(/^Base\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)$/);
    if (materialMatch) {
        const propertyName = materialMatch[1];
        if (!MATERIAL_OUTPUT_NAME_SET.has(normalizeSymbolKey(propertyName))) {
            return {
                kind: "invalid",
                message: `Unknown material output 'Base.${propertyName}'.`
            };
        }

        return {
            kind: "material",
            propertyName
        };
    }

    const pinMatch = trimmed.match(/^(.*)\.\s*Pin\s*\[\s*(\d+)\s*\]$/);
    if (pinMatch) {
        const callText = pinMatch[1].trim();
        const callExpression = parseCallExpressionText(callText, 0);
        if (!callExpression || normalizeSymbolKey(callExpression.callee) !== "expression") {
            return {
                kind: "invalid",
                message: "Auxiliary output nodes must use Expression(...).Pin[n]."
            };
        }

        const classArgument = callExpression.arguments.find((argument) => argument.isNamed && normalizeSymbolKey(argument.name) === "class");
        if (!classArgument || !classArgument.valueText.trim()) {
            return {
                kind: "invalid",
                message: "Output node bindings must specify Expression(Class=\"...\").Pin[n]."
            };
        }

        return {
            kind: "outputNode",
            pinIndex: Number(pinMatch[2]),
            callExpression
        };
    }

    return {
        kind: "invalid",
        message: "Material Outputs bindings must target Base.<Property> or Expression(...).Pin[n]."
    };
}

function addCallableSignature(map, signature) {
    const key = normalizeSymbolKey(signature.name);
    if (!key) {
        return;
    }
    if (!map.has(key)) {
        map.set(key, []);
    }
    map.get(key).push(signature);
}

function collectReachableCallableSignatures(document) {
    const results = new Map();
    const visited = new Set();
    collectReachableCallableSignaturesFromFile(document.fileName, document.getText(), results, visited);
    return results;
}

function collectReachableCallableSignaturesFromFile(fsPath, text, results, visited) {
    const normalizedPath = normalizeFsPath(fsPath);
    if (visited.has(normalizedPath)) {
        return;
    }
    visited.add(normalizedPath);

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (definition.kind !== "Function") {
            continue;
        }

        const parameters = parseFunctionSignatureParameters(definition, text);
        addCallableSignature(results, {
            kind: "Function",
            name: definition.name,
            inputs: parameters.inputs,
            outputs: parameters.outputs,
            detail: definition.selfContained ? "SelfContained DreamShader Function" : "DreamShader Function",
            fsPath: normalizedPath,
            nameOffset: definition.nameOffset
        });
    }


    for (const block of parseNamedLegacyBlocks(text, "ShaderFunction")) {
        const sectionMap = new Map(parseLegacySections(text, block).map((section) => [section.name, section]));
        const inputs = sectionMap.has("Inputs") ? parseTypedDeclarationsFromSection(sectionMap.get("Inputs")).declarations.filter((entry) => entry.kind === "declaration") : [];
        const outputs = sectionMap.has("Outputs") ? parseTypedDeclarationsFromSection(sectionMap.get("Outputs")).declarations.filter((entry) => entry.kind === "declaration") : [];
        addCallableSignature(results, {
            kind: "ShaderFunction",
            name: block.name,
            inputs: inputs.map((entry) => ({ type: entry.type, name: entry.name })),
            outputs: outputs.map((entry) => ({ type: entry.type, name: entry.name })),
            fsPath: normalizedPath,
            nameOffset: block.startOffset
        });
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(normalizedPath, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            continue;
        }

        try {
            const importedText = fs.readFileSync(resolvedPath, "utf8");
            collectReachableCallableSignaturesFromFile(resolvedPath, importedText, results, visited);
        } catch (_error) {
            // Ignore unreadable imports here; diagnostics handle reporting separately.
        }
    }
}

function collectReachableFunctionDefinitions(document) {
    const results = [];
    const visited = new Set();
    collectReachableFunctionDefinitionsFromFile(document.fileName, document.getText(), results, visited);
    return results;
}

function collectReachableFunctionDefinitionsFromFile(fsPath, text, results, visited) {
    const normalizedPath = normalizeFsPath(fsPath);
    if (visited.has(normalizedPath)) {
        return;
    }
    visited.add(normalizedPath);

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (definition.kind !== "Function") {
            continue;
        }

        results.push({
            ...definition,
            fsPath: normalizedPath,
            bodyText: definition.bodyOpenOffset >= 0 && definition.bodyCloseOffset >= definition.bodyOpenOffset
                ? text.slice(definition.bodyOpenOffset + 1, definition.bodyCloseOffset)
                : ""
        });
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(normalizedPath, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            continue;
        }

        try {
            const importedText = fs.readFileSync(resolvedPath, "utf8");
            collectReachableFunctionDefinitionsFromFile(resolvedPath, importedText, results, visited);
        } catch (_error) {
            // Ignore unreadable imports here; diagnostics handle reporting separately.
        }
    }
}

function collectDreamShaderFunctionCallNames(text) {
    const names = [];
    const seen = new Set();
    let index = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < text.length) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            index += 1;
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 2;
            } else {
                if (char === "\"") {
                    inString = false;
                }
                index += 1;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 2;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 2;
            continue;
        }

        const identifier = readQualifiedIdentifier(text, index);
        if (!identifier) {
            index += 1;
            continue;
        }

        const afterIdentifier = skipWhitespace(text, identifier.end);
        if (text[afterIdentifier] === "(") {
            const normalizedName = normalizeSymbolKey(identifier.name);
            if (!normalizedName.startsWith("ue.") && !isConstructorName(identifier.name) && !seen.has(normalizedName)) {
                seen.add(normalizedName);
                names.push(identifier.name);
            }
            index = afterIdentifier + 1;
            continue;
        }

        index = identifier.end;
    }

    return names;
}

function computeFunctionCycleDiagnostics(document, text) {
    const diagnostics = [];
    const currentPath = normalizeFsPath(document.fileName);
    const definitions = collectReachableFunctionDefinitions(document);
    if (definitions.length === 0) {
        return diagnostics;
    }

    const definitionsByName = new Map();
    for (const definition of definitions) {
        const key = normalizeSymbolKey(definition.name);
        if (!definitionsByName.has(key)) {
            definitionsByName.set(key, []);
        }
        definitionsByName.get(key).push(definition);
    }

    const dependencies = new Map();
    for (const definition of definitions) {
        const localDependencies = [];
        const seenDependencies = new Set();
        for (const callName of collectDreamShaderFunctionCallNames(definition.bodyText)) {
            const matches = definitionsByName.get(normalizeSymbolKey(callName)) || [];
            for (const match of matches) {
                const dependencyKey = `${match.fsPath}:${match.nameOffset}`;
                if (!seenDependencies.has(dependencyKey)) {
                    seenDependencies.add(dependencyKey);
                    localDependencies.push(match);
                }
            }
        }
        dependencies.set(definition, localDependencies);
    }

    const visitState = new Map();
    const visitStack = [];
    const emittedDiagnostics = new Set();

    const emitCycleDiagnostic = (cycle) => {
        if (!Array.isArray(cycle) || cycle.length === 0) {
            return;
        }

        const uniqueCycle = cycle.slice(0, -1);
        const cyclePath = cycle.map((entry) => entry.name).join(" -> ");
        const hasSelfContained = uniqueCycle.some((entry) => entry.selfContained);
        const message = hasSelfContained
            ? `SelfContained DreamShader Function cycle detected: ${cyclePath}. HLSL Custom nodes cannot compile recursive DreamShader functions.`
            : `DreamShader Function cycle detected: ${cyclePath}. HLSL cannot compile recursive DreamShader functions.`;

        let emittedInCurrentDocument = false;
        for (const definition of uniqueCycle) {
            if (definition.fsPath !== currentPath) {
                continue;
            }

            emittedInCurrentDocument = true;
            const diagnosticKey = `${definition.fsPath}:${definition.nameOffset}:${message}`;
            if (emittedDiagnostics.has(diagnosticKey)) {
                continue;
            }
            emittedDiagnostics.add(diagnosticKey);
            diagnostics.push(makeFunctionDiagnostic(document, definition, message));
        }

        if (emittedInCurrentDocument) {
            return;
        }

        const diagnosticKey = `import:${message}`;
        if (emittedDiagnostics.has(diagnosticKey)) {
            return;
        }
        emittedDiagnostics.add(diagnosticKey);

        const importStatements = parseImportStatements(text);
        if (importStatements.length > 0) {
            const importStatement = importStatements[0];
            diagnostics.push(makeOffsetDiagnostic(
                document,
                importStatement.startOffset,
                importStatement.endOffset,
                `Imported ${message}`));
        } else {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 1),
                `Imported ${message}`,
                vscode.DiagnosticSeverity.Error));
        }
    };

    const visit = (definition) => {
        const state = visitState.get(definition) || "unvisited";
        if (state === "visited") {
            return;
        }

        if (state === "visiting") {
            const cycleStart = visitStack.findIndex((entry) => entry === definition);
            if (cycleStart >= 0) {
                emitCycleDiagnostic([...visitStack.slice(cycleStart), definition]);
            }
            return;
        }

        visitState.set(definition, "visiting");
        visitStack.push(definition);

        for (const dependency of dependencies.get(definition) || []) {
            visit(dependency);
        }

        visitStack.pop();
        visitState.set(definition, "visited");
    };

    for (const definition of definitions) {
        visit(definition);
    }

    return diagnostics;
}

function collectReachableFunctionDefinitions(document) {
    const results = new Map();
    const visited = new Set();
    collectReachableFunctionDefinitionsFromFile(document.fileName, document.getText(), true, results, visited);
    return results;
}

function collectReachableFunctionDefinitionsFromFile(fsPath, text, isRoot, results, visited) {
    const normalizedPath = normalizeFsPath(fsPath);
    if (visited.has(normalizedPath)) {
        return;
    }
    visited.add(normalizedPath);

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        const location = {
            name: definition.name,
            localName: definition.localName || definition.name,
            nameRangeLength: definition.nameRangeLength || definition.name.length,
            fsPath: normalizedPath,
            position: offsetToPosition(text, definition.nameOffset),
            sourceKind: isRoot ? "local" : "imported"
        };

        if (!results.has(definition.name)) {
            results.set(definition.name, []);
        }
        results.get(definition.name).push(location);
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(normalizedPath, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            continue;
        }

        try {
            const importedText = fs.readFileSync(resolvedPath, "utf8");
            collectReachableFunctionDefinitionsFromFile(resolvedPath, importedText, false, results, visited);
        } catch (_error) {
            // Ignore unreadable imports here; diagnostics handle reporting.
        }
    }
}

function collectAvailableHeaderImports(document) {
    const root = findProjectRoot(document.fileName);
    const headers = new Set();
    const candidateRoots = [];

    if (root) {
        candidateRoots.push({ rootDirectory: path.join(root, "DShader"), skipTopLevelPackages: true });
        candidateRoots.push({ rootDirectory: getPackagesDirectory(root), skipTopLevelPackages: false });
        candidateRoots.push({ rootDirectory: path.join(root, "Plugins", "DreamShader", "Library"), skipTopLevelPackages: false });
    }

    for (const candidateRoot of candidateRoots) {
        if (!fs.existsSync(candidateRoot.rootDirectory)) {
            continue;
        }

        collectHeaderFiles(candidateRoot.rootDirectory, candidateRoot.rootDirectory, headers, candidateRoot);
    }

    return Array.from(headers).sort();
}

function collectHeaderFiles(rootDirectory, currentDirectory, outHeaders, options = {}) {
    let entries = [];
    try {
        entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch (_error) {
        return;
    }

    for (const entry of entries) {
        const absolutePath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
            if (options.skipTopLevelPackages && normalizeFsPath(currentDirectory) === normalizeFsPath(rootDirectory) && entry.name.toLowerCase() === "packages") {
                continue;
            }
            collectHeaderFiles(rootDirectory, absolutePath, outHeaders, options);
            continue;
        }

        if (path.extname(entry.name).toLowerCase() !== ".dsh") {
            continue;
        }

        outHeaders.add(normalizeFsPath(path.relative(rootDirectory, absolutePath)));
    }
}

function collectVisibleIdentifierEntries(context) {
    const entries = new Map();
    const { text, offset, currentFunction, currentLegacyBlock, currentSectionInfo } = context;

    if (context.inFunctionBody && currentFunction) {
        const parameters = parseFunctionSignatureParameters(currentFunction, text);
        for (const parameter of [...parameters.inputs, ...parameters.outputs]) {
            addVisibleIdentifierEntry(entries, parameter.name, `${parameter.type} Function ${parameter.qualifier} parameter`);
        }

        addLocalDeclarationEntries(entries, text, currentFunction.bodyOpenOffset + 1, offset, "Function local variable");
        return Array.from(entries.values());
    }

    if (!currentLegacyBlock || !currentSectionInfo) {
        return [];
    }

    const sectionMap = new Map(parseLegacySections(text, currentLegacyBlock).map((section) => [section.name, section]));
    const primaryDeclarationSectionName = currentLegacyBlock.kind === "Shader"
        ? "Properties"
        : "Inputs";
    const secondaryDeclarationSectionName = "Outputs";

    if (currentSectionInfo.name === primaryDeclarationSectionName || currentSectionInfo.name === secondaryDeclarationSectionName) {
        if (currentSectionInfo.name === secondaryDeclarationSectionName) {
            addSectionDeclarationEntries(
                entries,
                sectionMap.get(primaryDeclarationSectionName),
                Number.POSITIVE_INFINITY,
                describeSectionSymbol(currentLegacyBlock.kind, primaryDeclarationSectionName)
            );
        }

        addSectionDeclarationEntries(
            entries,
            currentSectionInfo,
            offset,
            describeSectionSymbol(currentLegacyBlock.kind, currentSectionInfo.name)
        );
        return Array.from(entries.values());
    }

    if (currentSectionInfo.name === "Graph") {
        addSectionDeclarationEntries(
            entries,
            sectionMap.get(primaryDeclarationSectionName),
            Number.POSITIVE_INFINITY,
            describeSectionSymbol(currentLegacyBlock.kind, primaryDeclarationSectionName)
        );
        addSectionDeclarationEntries(
            entries,
            sectionMap.get(secondaryDeclarationSectionName),
            Number.POSITIVE_INFINITY,
            describeSectionSymbol(currentLegacyBlock.kind, secondaryDeclarationSectionName)
        );

        const reachableCallables = collectReachableCallableSignatures(context.document);
        addGraphCodeEntries(entries, currentSectionInfo, offset, reachableCallables);
    }

    return Array.from(entries.values());
}

function addVisibleIdentifierEntry(entries, name, detail) {
    const normalized = normalizeSymbolKey(name);
    if (!normalized || entries.has(normalized)) {
        return;
    }

    entries.set(normalized, { name, detail });
}

function describeSectionSymbol(blockKind, sectionName) {
    const sectionLabelMap = new Map([
        ["Properties", "property"],
        ["Inputs", "input"],
        ["Outputs", "output"],
        ["Results", "result"]
    ]);

    return `${blockKind} ${sectionLabelMap.get(sectionName) || sectionName.toLowerCase()}`;
}

function addSectionDeclarationEntries(entries, section, cutoffOffset, detailLabel) {
    if (!section) {
        return;
    }

    const allowBindings = section.name === "Outputs";
    const parsed = parseTypedDeclarationsFromSection(section, allowBindings);
    for (const declaration of parsed.declarations) {
        if (declaration.kind !== "declaration" || declaration.startOffset >= cutoffOffset) {
            continue;
        }

        addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} ${detailLabel}`);
    }
}

function addLocalDeclarationEntries(entries, text, startOffset, cutoffOffset, detailLabel) {
    if (cutoffOffset <= startOffset) {
        return;
    }

    const visibleText = text.slice(startOffset, cutoffOffset);
    const statements = splitStatementsWithOffsets(visibleText, startOffset);
    for (const statement of statements) {
        const declarations = parseCodeDeclarationEntries(statement.text, statement.startOffset);
        if (declarations.length === 0) {
            continue;
        }

        for (const declaration of declarations) {
            if (declaration.startOffset >= cutoffOffset) {
                continue;
            }

            addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} ${detailLabel}`);
        }
    }
}

function addGraphCodeEntries(entries, codeSection, cutoffOffset, reachableCallables) {
    if (!codeSection || cutoffOffset <= codeSection.bodyOpenOffset + 1) {
        return;
    }

    const visibleText = codeSection.bodyText.slice(0, Math.max(0, cutoffOffset - (codeSection.bodyOpenOffset + 1)));
    const statements = splitGraphStatementsWithOffsets(visibleText, codeSection.bodyOpenOffset + 1);
    for (const statement of statements) {
        const declarations = parseCodeDeclarationEntries(statement.text, statement.startOffset);
        if (declarations.length > 0) {
            for (const declaration of declarations) {
                if (declaration.startOffset >= cutoffOffset) {
                    continue;
                }

                addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} Graph local variable`);
            }
            continue;
        }

        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (!callExpression) {
            continue;
        }

        const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
        const signature = signatures.find((entry) => entry.kind === "Function");
        if (!signature) {
            continue;
        }

        for (let index = 0; index < signature.outputs.length; index += 1) {
            const argument = callExpression.arguments[signature.inputs.length + index];
            if (!argument || argument.isNamed || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument.valueText)) {
                continue;
            }

            addVisibleIdentifierEntry(entries, argument.valueText, `${signature.outputs[index].type} Graph out variable`);
        }
    }
}

function getImportDefinitionLocation(document, position) {
    const offset = document.offsetAt(position);
    for (const importStatement of parseImportStatements(document.getText())) {
        if (offset < importStatement.pathOffset || offset > importStatement.pathOffset + importStatement.path.length) {
            continue;
        }

        const resolvedPath = resolveImportPath(document.fileName, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            return undefined;
        }

        return new vscode.Location(vscode.Uri.file(resolvedPath), new vscode.Position(0, 0));
    }

    return undefined;
}

function refreshAllLocalDiagnostics(collection) {
    for (const document of vscode.workspace.textDocuments) {
        refreshLocalDiagnosticsForDocument(document, collection);
    }
}

function refreshLocalDiagnosticsForDocument(document, collection) {
    if (!isDreamShaderDocument(document)) {
        return;
    }

    const diagnostics = computeLocalDiagnostics(document);
    collection.set(document.uri, diagnostics);
}

function computeLocalDiagnostics(document) {
    const diagnostics = [];
    const text = document.getText();
    const extension = path.extname(document.fileName).toLowerCase();
    const reachableCallables = collectReachableCallableSignatures(document);

    if (extension === ".dsm" && !/\bShader\s*\(/.test(text) && !/\bShaderFunction\s*\(/.test(text)) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            "DreamShader implementation (.dsm) should declare a top-level Shader(Name=\"...\") or ShaderFunction(Name=\"...\") block.",
            vscode.DiagnosticSeverity.Warning));
    }

    if (extension === ".dsh" && (/\bShader\s*\(/.test(text) || /\bShaderFunction\s*\(/.test(text))) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            "DreamShader header (.dsh) may only contain import statements, Function blocks, and Namespace blocks.",
            vscode.DiagnosticSeverity.Error));
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(document.fileName, importStatement.path);
        if (resolvedPath && fs.existsSync(resolvedPath)) {
            continue;
        }

        const start = document.positionAt(importStatement.pathOffset);
        const end = document.positionAt(importStatement.pathOffset + importStatement.path.length);
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(start, end),
            `DreamShader import '${importStatement.path}' could not be resolved.`,
            vscode.DiagnosticSeverity.Error));
    }

    const seenFunctions = new Map();
    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (!seenFunctions.has(definition.name)) {
            seenFunctions.set(definition.name, []);
        }
        seenFunctions.get(definition.name).push(definition);
    }

    for (const [name, definitions] of seenFunctions.entries()) {
        if (definitions.length < 2) {
            continue;
        }

        for (const definition of definitions) {
            const start = document.positionAt(definition.nameOffset);
            const end = new vscode.Position(start.line, start.character + (definition.nameRangeLength || definition.localName?.length || name.length));
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(start, end),
                `DreamShader function '${name}' is declared more than once in this file.`,
                vscode.DiagnosticSeverity.Error));
        }
    }

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (definition.kind !== "Function") {
            continue;
        }

        diagnostics.push(...computeFunctionSignatureDiagnostics(document, text, definition));
    }

    diagnostics.push(...computeFunctionCycleDiagnostics(document, text));
    diagnostics.push(...computeDetailedBlockDiagnostics(document, text, reachableCallables));
    diagnostics.push(...computeBraceDiagnostics(document, text));
    return diagnostics;
}

function computeFunctionSignatureDiagnostics(document, text, definition) {
    const diagnostics = [];
    const parameterText = text.slice(definition.paramOpenOffset + 1, definition.paramCloseOffset);
    const parameters = splitTopLevelParameters(parameterText);
    let sawOutParameter = false;

    for (const parameter of parameters) {
        const trimmed = parameter.trim();
        if (!trimmed) {
            continue;
        }

        const parts = trimmed.split(/\s+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 3) {
            diagnostics.push(makeFunctionDiagnostic(
                document,
                definition,
                `Function '${definition.name}' has an invalid parameter declaration '${trimmed}'.`));
            continue;
        }

        let qualifier = "in";
        if (parts.length === 3) {
            qualifier = parts[0].toLowerCase();
        }

        if (!["in", "out"].includes(qualifier)) {
            diagnostics.push(makeFunctionDiagnostic(
                document,
                definition,
                `Function '${definition.name}' parameter '${trimmed}' uses unsupported qualifier '${parts[0]}'. Supported qualifiers are in and out.`));
            continue;
        }

        if (qualifier === "out") {
            sawOutParameter = true;
        }
    }

    if (!sawOutParameter) {
        diagnostics.push(makeFunctionDiagnostic(
            document,
            definition,
            `Function '${definition.name}' must declare at least one out parameter.`));
    }

    return diagnostics;
}

function makeFunctionDiagnostic(document, definition, message) {
    const start = document.positionAt(definition.nameOffset);
    const end = new vscode.Position(start.line, start.character + (definition.nameRangeLength || definition.localName?.length || definition.name.length));
    return new vscode.Diagnostic(new vscode.Range(start, end), message, vscode.DiagnosticSeverity.Error);
}

function computeDetailedBlockDiagnostics(document, text, reachableCallables) {
    const diagnostics = [];
    const blocks = [
        ...parseNamedLegacyBlocks(text, "Shader"),
        ...parseNamedLegacyBlocks(text, "ShaderFunction")
    ].sort((a, b) => a.startOffset - b.startOffset);

    for (const block of blocks) {
        diagnostics.push(...analyzeLegacyBlockDiagnostics(document, block, text, reachableCallables));
    }

    return diagnostics;
}

function analyzeLegacyBlockDiagnostics(document, block, text, reachableCallables) {
    const diagnostics = [];
    const sections = parseLegacySections(text, block);
    const allowedSections = BLOCK_SECTION_RULES.get(block.kind) || new Set();
    const seenSections = new Map();

    for (const section of sections) {
        if (!allowedSections.has(section.name)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                section.nameOffset,
                section.nameOffset + section.name.length,
                `${block.kind} block '${block.name}' does not support section '${section.name}'.`));
            continue;
        }

        if (!seenSections.has(section.name)) {
            seenSections.set(section.name, []);
        }
        seenSections.get(section.name).push(section);
    }

    for (const [sectionName, entries] of seenSections.entries()) {
        if (entries.length < 2) {
            continue;
        }

        for (const entry of entries) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                entry.nameOffset,
                entry.nameOffset + sectionName.length,
                `${block.kind} block '${block.name}' declares section '${sectionName}' more than once.`));
        }
    }

    const symbols = new Map();

    if (block.kind === "Shader") {
        const propertiesSection = seenSections.get("Properties")?.[0];
        const outputsSection = seenSections.get("Outputs")?.[0];
        if (propertiesSection) {
            diagnostics.push(...validateDeclarationSection(document, propertiesSection, symbols, "Properties", false, reachableCallables));
        }
        if (outputsSection) {
            diagnostics.push(...validateDeclarationSection(document, outputsSection, symbols, "Outputs", true, reachableCallables));
        }
    } else if (block.kind === "ShaderFunction") {
        const inputsSection = seenSections.get("Inputs")?.[0];
        const outputsSection = seenSections.get("Outputs")?.[0];
        if (inputsSection) {
            diagnostics.push(...validateDeclarationSection(document, inputsSection, symbols, "Inputs", false, reachableCallables));
        }
        if (outputsSection) {
            diagnostics.push(...validateDeclarationSection(document, outputsSection, symbols, "Outputs", false, reachableCallables));
        }

    }

    const settingsSection = seenSections.get("Settings")?.[0];
    if (settingsSection) {
        diagnostics.push(...validateSettingsSection(document, settingsSection));
    }

    const codeSection = seenSections.get("Graph")?.[0];
    if (codeSection) {
        diagnostics.push(...analyzeCodeSection(document, codeSection, symbols, reachableCallables));
    }

    return diagnostics;
}

function validateDeclarationSection(document, section, symbols, sectionLabel, allowBindings, reachableCallables = new Map()) {
    const diagnostics = [];
    const parsed = parseTypedDeclarationsFromSection(section, allowBindings);
    const localNames = new Map();

    for (const statement of parsed.statements) {
        if (!statement.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                `${sectionLabel} statement is missing a trailing ';'.`));
        }
    }

    for (const declaration of parsed.declarations) {
        if (declaration.kind === "invalid") {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                declaration.startOffset,
                declaration.endOffset,
                `Invalid ${sectionLabel} statement '${declaration.text}'.`));
            continue;
        }

        const resolvedType = resolveTypeInfo(declaration.type);
        if (!resolvedType && !/^UE\./i.test(declaration.type)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                declaration.startOffset,
                declaration.endOffset,
                `Unsupported ${sectionLabel} type '${declaration.type}'.`));
            continue;
        }

        if (resolvedType?.isTexture && declaration.valueText) {
            const valueOffset = declaration.startOffset + declaration.text.indexOf(declaration.valueText);
            const texturePathResult = parseTexturePathReferenceText(declaration.valueText);
            if (texturePathResult.error) {
                diagnostics.push(makeOffsetDiagnostic(
                    document,
                    valueOffset,
                    valueOffset + declaration.valueText.length,
                    texturePathResult.error));
            }
        }

        const nameKey = normalizeSymbolKey(declaration.name);
        if (localNames.has(nameKey)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                declaration.startOffset,
                declaration.endOffset,
                `${sectionLabel} variable '${declaration.name}' is declared more than once.`));
            continue;
        }

        localNames.set(nameKey, declaration.name);
        if (symbols) {
            symbols.set(nameKey, {
                name: declaration.name,
                typeInfo: resolvedType
            });
        }
    }

    for (const binding of parsed.bindings) {
        if (!binding.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                binding.startOffset,
                binding.endOffset,
                `${sectionLabel} binding is missing a trailing ';'.`));
        }

        if (!binding.target || !binding.valueText) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                binding.startOffset,
                binding.endOffset,
                `Invalid ${sectionLabel} binding '${binding.text}'.`));
            continue;
        }

        if (allowBindings && sectionLabel === "Outputs") {
            const targetInfo = parseOutputBindingTarget(binding.target);
            if (!targetInfo || targetInfo.kind === "invalid") {
                diagnostics.push(makeOffsetDiagnostic(
                    document,
                    binding.startOffset,
                    binding.startOffset + binding.target.length,
                    targetInfo?.message || `Invalid ${sectionLabel} binding target '${binding.target}'.`));
                continue;
            }
        }

        const valueOffset = binding.startOffset + binding.text.indexOf(binding.valueText);
        diagnostics.push(...analyzeExpressionText(document, binding.valueText, valueOffset, symbols || new Map(), reachableCallables, "value"));
    }

    return diagnostics;
}

function validateSettingsSection(document, section) {
    const diagnostics = [];
    const statements = splitStatementsWithOffsets(section.bodyText, section.bodyOpenOffset + 1);
    for (const statement of statements) {
        if (!statement.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                "Settings statement is missing a trailing ';'."));
        }

        const assignment = splitTopLevelAssignment(statement.text);
        if (!assignment || !assignment.left || !assignment.right) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                `Invalid Settings statement '${statement.text}'.`));
        }
    }
    return diagnostics;
}

function analyzeCodeSection(document, section, symbols, reachableCallables) {
    return analyzeGraphStatements(document, section.bodyText, section.bodyOpenOffset + 1, symbols, reachableCallables);
}

function isGraphIfStatementText(text) {
    const leadingWhitespace = text.search(/\S/);
    return leadingWhitespace >= 0 && matchKeywordAt(text, leadingWhitespace, "if");
}

function trimTextWithOffset(text, baseOffset) {
    const leading = text.search(/\S|$/);
    const trailing = text.length - text.trimEnd().length;
    return {
        text: text.trim(),
        offset: baseOffset + leading,
        endOffset: baseOffset + text.length - trailing
    };
}

function parseGraphIfStatementText(text, baseOffset) {
    let cursor = skipWhitespace(text, 0);
    if (!matchKeywordAt(text, cursor, "if")) {
        return null;
    }

    cursor = skipWhitespace(text, cursor + 2);
    if (text[cursor] !== "(") {
        return { error: "Graph if statement is missing a condition block.", startOffset: baseOffset + cursor, endOffset: baseOffset + Math.min(text.length, cursor + 1) };
    }

    const conditionOpen = cursor;
    const conditionClose = findMatchingDelimiter(text, conditionOpen, "(", ")");
    if (conditionClose === -1) {
        return { error: "Graph if statement has an unterminated condition block.", startOffset: baseOffset + conditionOpen, endOffset: baseOffset + text.length };
    }

    const condition = trimTextWithOffset(text.slice(conditionOpen + 1, conditionClose), baseOffset + conditionOpen + 1);
    cursor = skipWhitespace(text, conditionClose + 1);
    if (text[cursor] !== "{") {
        return { error: "Graph if statement is missing a '{ ... }' body.", startOffset: baseOffset + cursor, endOffset: baseOffset + Math.min(text.length, cursor + 1) };
    }

    const thenOpen = cursor;
    const thenClose = findMatchingDelimiter(text, thenOpen, "{", "}");
    if (thenClose === -1) {
        return { error: "Graph if statement has an unterminated body block.", startOffset: baseOffset + thenOpen, endOffset: baseOffset + text.length };
    }

    const parsed = {
        conditionText: condition.text,
        conditionOffset: condition.offset,
        thenText: text.slice(thenOpen + 1, thenClose),
        thenOffset: baseOffset + thenOpen + 1,
        elseText: "",
        elseOffset: -1
    };

    cursor = skipWhitespace(text, thenClose + 1);
    if (matchKeywordAt(text, cursor, "else")) {
        cursor = skipWhitespace(text, cursor + 4);
        if (matchKeywordAt(text, cursor, "if")) {
            parsed.elseText = text.slice(cursor);
            parsed.elseOffset = baseOffset + cursor;
            return parsed;
        }

        if (text[cursor] !== "{") {
            return { error: "Graph else statement is missing a '{ ... }' body.", startOffset: baseOffset + cursor, endOffset: baseOffset + Math.min(text.length, cursor + 1) };
        }

        const elseOpen = cursor;
        const elseClose = findMatchingDelimiter(text, elseOpen, "{", "}");
        if (elseClose === -1) {
            return { error: "Graph else statement has an unterminated body block.", startOffset: baseOffset + elseOpen, endOffset: baseOffset + text.length };
        }

        parsed.elseText = text.slice(elseOpen + 1, elseClose);
        parsed.elseOffset = baseOffset + elseOpen + 1;
        cursor = skipWhitespace(text, elseClose + 1);
    }

    if (text.slice(cursor).trim()) {
        return { error: `Unexpected text after Graph if statement: '${text.slice(cursor).trim()}'.`, startOffset: baseOffset + cursor, endOffset: baseOffset + text.length };
    }

    return parsed;
}

function analyzeGraphIfStatement(document, statement, symbols, reachableCallables) {
    const diagnostics = [];
    const parsed = parseGraphIfStatementText(statement.text, statement.startOffset);
    if (!parsed || parsed.error) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            parsed?.startOffset ?? statement.startOffset,
            parsed?.endOffset ?? statement.endOffset,
            parsed?.error || `Invalid Graph if statement '${statement.text}'.`));
        return diagnostics;
    }

    if (!parsed.conditionText) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            statement.startOffset,
            statement.endOffset,
            "Graph if condition is empty."));
    } else {
        diagnostics.push(...analyzeExpressionText(document, parsed.conditionText, parsed.conditionOffset, symbols, reachableCallables, "value"));
    }

    const thenSymbols = new Map(symbols);
    diagnostics.push(...analyzeGraphStatements(document, parsed.thenText, parsed.thenOffset, thenSymbols, reachableCallables));

    const elseSymbols = new Map(symbols);
    if (parsed.elseText) {
        diagnostics.push(...analyzeGraphStatements(document, parsed.elseText, parsed.elseOffset, elseSymbols, reachableCallables));
    }

    for (const [key, value] of thenSymbols.entries()) {
        if (!symbols.has(key)) {
            symbols.set(key, value);
        }
    }
    for (const [key, value] of elseSymbols.entries()) {
        if (!symbols.has(key)) {
            symbols.set(key, value);
        }
    }

    return diagnostics;
}

function analyzeGraphStatements(document, bodyText, baseOffset, symbols, reachableCallables) {
    const diagnostics = [];
    const statements = splitGraphStatementsWithOffsets(bodyText, baseOffset);

    for (const statement of statements) {
        if (isGraphIfStatementText(statement.text)) {
            diagnostics.push(...analyzeGraphIfStatement(document, statement, symbols, reachableCallables));
            continue;
        }

        if (!statement.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                "Graph statement is missing a trailing ';'."));
        }

        const declarations = parseCodeDeclarationEntries(statement.text, statement.startOffset);
        if (declarations.length > 0) {
            for (const declaration of declarations) {
                const resolvedType = resolveTypeInfo(declaration.type);
                if (!resolvedType) {
                    diagnostics.push(makeOffsetDiagnostic(
                        document,
                        declaration.startOffset,
                        declaration.endOffset,
                        `Unsupported Graph variable type '${declaration.type}' for '${declaration.name}'.`));
                    continue;
                }

                if (declaration.valueText) {
                    diagnostics.push(...analyzeExpressionText(document, declaration.valueText, declaration.valueOffset, symbols, reachableCallables, "value"));
                }

                symbols.set(normalizeSymbolKey(declaration.name), {
                    name: declaration.name,
                    typeInfo: resolvedType
                });
            }
            continue;
        }

        const assignment = splitTopLevelAssignment(statement.text);
        if (assignment) {
            const rightOffset = statement.startOffset + statement.text.indexOf(assignment.right);
            diagnostics.push(...analyzeExpressionText(document, assignment.right, rightOffset, symbols, reachableCallables, "value"));

            symbols.set(normalizeSymbolKey(assignment.left), {
                name: assignment.left,
                typeInfo: symbols.get(normalizeSymbolKey(assignment.left))?.typeInfo || null
            });
            continue;
        }

        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (!callExpression) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                `Graph statement '${statement.text}' must use assignment syntax, if/else syntax, or a standalone Function call.`));
            continue;
        }

        diagnostics.push(...analyzeStandaloneFunctionCall(document, callExpression, symbols, reachableCallables));
    }

    return diagnostics;
}

function analyzeStandaloneFunctionCall(document, callExpression, symbols, reachableCallables) {
    const diagnostics = [];
    const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
    const signature = signatures.find((entry) => entry.kind === "Function");

    if (!signature) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.calleeOffset + callExpression.callee.length,
            `Standalone Graph call '${callExpression.callee}(...)' is unsupported. Only DreamShader Function calls may use statement syntax.`));
        return diagnostics;
    }

    const expectedArgumentCount = signature.inputs.length + signature.outputs.length;
    if (callExpression.arguments.length !== expectedArgumentCount) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.endOffset,
            `DreamShader Function '${signature.name}' expects ${expectedArgumentCount} arguments (${signature.inputs.length} inputs, ${signature.outputs.length} out targets) but got ${callExpression.arguments.length}.`));
        return diagnostics;
    }

    for (let index = 0; index < signature.inputs.length; index += 1) {
        const argument = callExpression.arguments[index];
        diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
    }

    for (let index = 0; index < signature.outputs.length; index += 1) {
        const argument = callExpression.arguments[signature.inputs.length + index];
        const expectedOutput = signature.outputs[index];
        if (argument.isNamed) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                argument.startOffset,
                argument.endOffset,
                `DreamShader Function '${signature.name}' out argument '${expectedOutput.name}' must be passed positionally as a plain variable name.`));
            continue;
        }

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument.valueText)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                argument.startOffset,
                argument.endOffset,
                `DreamShader Function '${signature.name}' out argument '${expectedOutput.name}' must be a plain variable name.`));
            continue;
        }

        const resolvedType = resolveTypeInfo(expectedOutput.type);
        const existing = symbols.get(normalizeSymbolKey(argument.valueText));
        if (existing && existing.typeInfo && resolvedType && !areTypeInfosCompatible(existing.typeInfo, resolvedType)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                argument.startOffset,
                argument.endOffset,
                `Out variable '${argument.valueText}' does not match Function result type '${expectedOutput.type}'.`));
            continue;
        }

        symbols.set(normalizeSymbolKey(argument.valueText), {
            name: argument.valueText,
            typeInfo: resolvedType
        });
    }

    return diagnostics;
}

function analyzeExpressionText(document, text, baseOffset, symbols, reachableCallables, mode) {
    const diagnostics = [];
    let index = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < text.length) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            index += 1;
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 2;
            } else {
                if (char === "\"") {
                    inString = false;
                }
                index += 1;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 2;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 2;
            continue;
        }

        if (!isIdentifierStart(char)) {
            index += 1;
            continue;
        }

        const identifier = readQualifiedIdentifier(text, index);
        if (!identifier) {
            index += 1;
            continue;
        }

        const afterIdentifier = skipWhitespace(text, identifier.end);
        if (text[afterIdentifier] === "(") {
            const callText = text.slice(identifier.start, Math.min(text.length, findMatchingDelimiter(text, afterIdentifier, "(", ")") + 1));
            const callExpression = parseCallExpressionText(callText, baseOffset + identifier.start);
            if (!callExpression) {
                diagnostics.push(makeOffsetDiagnostic(
                    document,
                    baseOffset + identifier.start,
                    baseOffset + identifier.end,
                    `Invalid function call syntax near '${identifier.name}'.`));
                index = afterIdentifier + 1;
                continue;
            }

            diagnostics.push(...analyzeCallExpression(document, callExpression, symbols, reachableCallables, mode));
            index = identifier.start + callText.length;
            continue;
        }

        const baseName = identifier.name.split(".")[0];
        const normalizedBaseName = normalizeSymbolKey(baseName);
        if (baseName !== "UE" && !IGNORED_IDENTIFIER_NAMES.has(normalizedBaseName) && !isTypeLikeName(baseName) && !symbols.has(normalizedBaseName)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                baseOffset + identifier.start,
                baseOffset + identifier.start + baseName.length,
                `Unknown identifier '${baseName}'.`));
        }

        index = identifier.end;
    }

    return diagnostics;
}

function analyzeCallExpression(document, callExpression, symbols, reachableCallables, mode) {
    const diagnostics = [];

    for (const argument of callExpression.arguments) {
        if (argument.isNamed) {
            diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
        }
    }

    if (/^UE\./.test(callExpression.callee) || isConstructorName(callExpression.callee)) {
        for (const argument of callExpression.arguments) {
            if (!argument.isNamed) {
                diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
            }
        }
        return diagnostics;
    }

    const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
    if (signatures.length === 0) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.calleeOffset + callExpression.callee.length,
            `Unknown function '${callExpression.callee}'.`));
        return diagnostics;
    }

    const signature = signatures[0];
    if (signature.kind === "Function" && mode === "value") {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.endOffset,
            `DreamShader Function '${signature.name}' cannot be used as a value expression. Call it as '${signature.name}(..., OutVar);'.`));
        return diagnostics;
    }

    for (const argument of callExpression.arguments) {
        if (!argument.isNamed) {
            diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
        }
    }

    if (signature.kind === "ShaderFunction") {
        const positionalArguments = callExpression.arguments.filter((argument) => !argument.isNamed);
        if (positionalArguments.length > signature.inputs.length) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                callExpression.calleeOffset,
                callExpression.endOffset,
                `ShaderFunction '${signature.name}' has too many positional arguments.`));
        }
    }

    return diagnostics;
}

function parseTexturePathReferenceText(text) {
    const callExpression = parseCallExpressionText(text, 0);
    if (!callExpression || normalizeSymbolKey(callExpression.callee) !== "path") {
        return {
            error: "Texture defaults must use Path(Game|Engine, \"/Folder/Asset\") or Path(\"/Game/Folder/Asset\")."
        };
    }

    if (callExpression.arguments.some((argument) => argument.isNamed)) {
        return {
            error: "Texture Path(...) does not support named arguments."
        };
    }

    if (callExpression.arguments.length !== 1 && callExpression.arguments.length !== 2) {
        return {
            error: "Texture Path(...) expects either 1 argument (absolute asset path) or 2 arguments (Game|Engine, asset path)."
        };
    }

    if (callExpression.arguments.length === 1) {
        const assetPath = readTexturePathArgumentText(callExpression.arguments[0].valueText);
        if (!assetPath || !/^\/(?:Game|Engine)\//i.test(assetPath)) {
            return {
                error: "Single-argument Path(...) must use an absolute /Game/... or /Engine/... asset path."
            };
        }

        return { error: "" };
    }

    const rootText = callExpression.arguments[0].valueText.trim();
    if (!/^(Game|Engine)$/i.test(rootText)) {
        return {
            error: `Unsupported texture Path root '${rootText}'. Use Game or Engine.`
        };
    }

    const assetPath = readTexturePathArgumentText(callExpression.arguments[1].valueText);
    if (!assetPath) {
        return {
            error: "Texture Path(...) requires a non-empty asset path."
        };
    }

    return { error: "" };
}

function readTexturePathArgumentText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return "";
    }

    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}

function parseCallExpressionText(text, baseOffset) {
    const trimmed = text.trim();
    const leadingWhitespace = text.search(/\S|$/);
    const identifier = readQualifiedIdentifier(trimmed, 0);
    if (!identifier) {
        return null;
    }

    const openParenOffset = skipWhitespace(trimmed, identifier.end);
    if (trimmed[openParenOffset] !== "(") {
        return null;
    }

    const closeParenOffset = findMatchingDelimiter(trimmed, openParenOffset, "(", ")");
    if (closeParenOffset === -1) {
        return null;
    }

    if (trimmed.slice(closeParenOffset + 1).trim().length !== 0) {
        return null;
    }

    const argsText = trimmed.slice(openParenOffset + 1, closeParenOffset);
    const argumentsList = splitTopLevelDelimitedWithOffsets(argsText, baseOffset + leadingWhitespace + openParenOffset + 1, ",").map((segment) => {
        const assignment = splitTopLevelAssignment(segment.text);
        if (assignment && /^[A-Za-z_][A-Za-z0-9_]*$/.test(assignment.left)) {
            const valueOffset = segment.startOffset + segment.text.indexOf(assignment.right);
            return {
                isNamed: true,
                name: assignment.left,
                valueText: assignment.right,
                valueOffset,
                startOffset: segment.startOffset,
                endOffset: segment.endOffset
            };
        }

        return {
            isNamed: false,
            name: "",
            valueText: segment.text,
            valueOffset: segment.startOffset,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset
        };
    });

    return {
        callee: identifier.name,
        calleeOffset: baseOffset + leadingWhitespace + identifier.start,
        arguments: argumentsList,
        endOffset: baseOffset + leadingWhitespace + closeParenOffset + 1
    };
}

function readQualifiedIdentifier(text, index) {
    if (!isIdentifierStart(text[index])) {
        return null;
    }

    let cursor = index + 1;
    while (cursor < text.length && isIdentifierPart(text[cursor])) {
        cursor += 1;
    }

    while (cursor < text.length) {
        if (text[cursor] === "." && isIdentifierStart(text[cursor + 1])) {
            cursor += 2;
        } else if (text[cursor] === ":" && text[cursor + 1] === ":" && isIdentifierStart(text[cursor + 2])) {
            cursor += 3;
        } else {
            break;
        }

        while (cursor < text.length && isIdentifierPart(text[cursor])) {
            cursor += 1;
        }
    }

    return {
        name: text.slice(index, cursor),
        start: index,
        end: cursor
    };
}

function isConstructorName(name) {
    const normalized = normalizeSymbolKey(name);
    return SCALAR_TYPE_NAMES.has(normalized)
        || VECTOR_TYPE_COMPONENTS.has(normalized)
        || normalized === "float2x2"
        || normalized === "float3x3"
        || normalized === "float4x4"
        || normalized === "mat2"
        || normalized === "mat3"
        || normalized === "mat4";
}

function areTypeInfosCompatible(left, right) {
    if (!left || !right) {
        return true;
    }

    return left.isTexture === right.isTexture && left.componentCount === right.componentCount;
}

function makeOffsetDiagnostic(document, startOffset, endOffset, message, severity = vscode.DiagnosticSeverity.Error) {
    const start = document.positionAt(Math.max(0, startOffset));
    const safeEndOffset = Math.max(startOffset + 1, endOffset);
    const end = document.positionAt(safeEndOffset);
    return new vscode.Diagnostic(new vscode.Range(start, end), message, severity);
}

function computeBraceDiagnostics(document, text) {
    const diagnostics = [];
    const stack = [];
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
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

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === "{") {
            stack.push(index);
            continue;
        }

        if (char === "}") {
            if (stack.length === 0) {
                const position = document.positionAt(index);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(position, new vscode.Position(position.line, position.character + 1)),
                    "Unexpected closing brace.",
                    vscode.DiagnosticSeverity.Error));
            } else {
                stack.pop();
            }
        }
    }

    for (const openIndex of stack) {
        const position = document.positionAt(openIndex);
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(position, new vscode.Position(position.line, position.character + 1)),
            "Unclosed opening brace.",
            vscode.DiagnosticSeverity.Error));
    }

    return diagnostics;
}

async function installPackageFromGitHubCommand() {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const repositorySpecifier = await vscode.window.showInputBox({
        title: "Install DreamShader Package",
        prompt: "GitHub repository URL or owner/repo, for example TypeDreamMoon/dream-noise.",
        placeHolder: "TypeDreamMoon/dream-noise"
    });

    if (!repositorySpecifier) {
        return;
    }

    try {
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Installing DreamShader package",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: repositorySpecifier });
            return installPackageFromRepository(projectRoot, repositorySpecifier, { askBeforeReplace: true });
        });

        vscode.window.showInformationMessage(`Installed DreamShader package ${result.name}@${result.version}.`);
    } catch (error) {
        vscode.window.showErrorMessage(`DreamShader package install failed: ${formatError(error)}`);
    }
}

async function browsePackagesCommand() {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        "dreamshaderPackageStore",
        "DreamShader Package Store",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        });

    panel.webview.html = renderPackageStoreHtml(panel.webview, {
        entries: [],
        installed: collectInstalledPackages(projectRoot),
        sources: getPackageIndexSources(),
        loading: true,
        status: "Loading package store..."
    });

    panel.webview.onDidReceiveMessage(async (message) => {
        await handlePackageStoreWebviewMessage(panel, projectRoot, message);
    });

    await refreshPackageStorePanel(panel, projectRoot);
}

async function updatePackagesCommand() {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const installed = collectInstalledPackages(projectRoot).filter((entry) => entry.repository);
    if (installed.length === 0) {
        vscode.window.showInformationMessage("No installed DreamShader packages with repository metadata were found.");
        return;
    }

    const confirmation = await vscode.window.showQuickPick([
        { label: "$(cloud-download) Update all packages", description: `${installed.length} package(s)`, value: "update" },
        { label: "$(circle-slash) Cancel", value: "cancel" }
    ], {
        title: "Update DreamShader Packages",
        placeHolder: `${installed.length} package(s) will be reinstalled from their Git repositories.`
    });

    if (!confirmation || confirmation.value !== "update") {
        return;
    }

    const failures = [];
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Updating DreamShader packages",
        cancellable: false
    }, async (progress) => {
        for (const entry of installed) {
            progress.report({ message: entry.name });
            try {
                await installPackageFromRepository(projectRoot, entry.repository, { forceReplace: true });
            } catch (error) {
                failures.push(`${entry.name}: ${formatError(error)}`);
            }
        }
    });

    if (failures.length > 0) {
        vscode.window.showWarningMessage(`DreamShader updated with ${failures.length} failure(s). Check the output log for details.`);
        const channel = vscode.window.createOutputChannel("DreamShader Packages");
        channel.appendLine("DreamShader package update failures:");
        for (const failure of failures) {
            channel.appendLine(`- ${failure}`);
        }
        channel.show();
        return;
    }

    vscode.window.showInformationMessage(`Updated ${installed.length} DreamShader package(s).`);
}

async function removePackageCommand() {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const installed = collectInstalledPackages(projectRoot);
    if (installed.length === 0) {
        vscode.window.showInformationMessage("No installed DreamShader packages were found.");
        return;
    }

    const picked = await vscode.window.showQuickPick(installed.map((entry) => ({
        label: `$(package) ${entry.name}`,
        description: entry.version || "",
        detail: entry.description || entry.repository || "",
        entry
    })), {
        title: "Remove DreamShader Package",
        placeHolder: "Select an installed package to remove"
    });

    if (!picked) {
        return;
    }

    const confirmation = await vscode.window.showQuickPick([
        { label: "$(trash) Remove package", description: picked.entry.name, value: "remove" },
        { label: "$(circle-slash) Cancel", value: "cancel" }
    ], {
        title: `Remove ${picked.entry.name}?`,
        placeHolder: "This deletes the package folder under DShader/Packages."
    });

    if (!confirmation || confirmation.value !== "remove") {
        return;
    }

    try {
        const targetDirectory = resolveInstalledPackageDirectory(projectRoot, picked.entry);
        if (fs.existsSync(targetDirectory)) {
            fs.rmSync(targetDirectory, { recursive: true, force: true });
        }

        const lock = readPackageLock(projectRoot);
        delete lock.packages[picked.entry.name];
        writePackageLock(projectRoot, lock);
        vscode.window.showInformationMessage(`Removed DreamShader package ${picked.entry.name}.`);
    } catch (error) {
        vscode.window.showErrorMessage(`DreamShader package remove failed: ${formatError(error)}`);
    }
}

async function openPackagesFolderCommand() {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const packagesDirectory = getPackagesDirectory(projectRoot);
    fs.mkdirSync(packagesDirectory, { recursive: true });
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(packagesDirectory));
}

async function addPackageStoreIndexCommand() {
    const source = await vscode.window.showInputBox({
        title: "Add DreamShader Package Store Source",
        prompt: "Enter a packages.json URL or local file path.",
        placeHolder: DEFAULT_PACKAGE_INDEX_URL
    });

    if (!source) {
        return;
    }

    await addPackageIndexSource(source);
    vscode.window.showInformationMessage("DreamShader package store source added.");
}

async function removePackageStoreIndexCommand() {
    const sources = getPackageIndexSources();
    if (sources.length === 0) {
        vscode.window.showInformationMessage("No DreamShader package store sources are configured.");
        return;
    }

    const picked = await vscode.window.showQuickPick(sources.map((source) => ({
        label: "$(link) Package index source",
        description: source,
        source
    })), {
        title: "Remove DreamShader Package Store Source",
        placeHolder: "Select an index source to remove"
    });

    if (!picked) {
        return;
    }

    await removePackageIndexSource(picked.source);
    vscode.window.showInformationMessage("DreamShader package store source removed.");
}

async function createDreamShaderTemplateCommand(kind) {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const template = getDreamShaderTemplateSpec(kind);
    if (!template) {
        return;
    }

    const relativePathInput = await vscode.window.showInputBox({
        title: template.title,
        prompt: template.prompt,
        placeHolder: template.placeHolder,
        validateInput: (value) => {
            const normalized = normalizeTemplateRelativePath(value, template.extension);
            if (!normalized) {
                return "A file name is required.";
            }
            return isSafeRelativePath(normalized) ? undefined : "Use a relative path inside DShader without '..'.";
        }
    });
    if (!relativePathInput) {
        return;
    }

    const relativePath = normalizeTemplateRelativePath(relativePathInput, template.extension);
    const targetPath = path.resolve(projectRoot, "DShader", relativePath);
    const dshaderRoot = path.resolve(projectRoot, "DShader");
    const relativeToRoot = path.relative(dshaderRoot, targetPath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        vscode.window.showErrorMessage("DreamShader template path must stay inside DShader.");
        return;
    }

    if (fs.existsSync(targetPath)) {
        const replace = await vscode.window.showQuickPick([
            { label: "$(replace) Replace existing file", description: path.basename(targetPath), value: "replace" },
            { label: "$(circle-slash) Cancel", value: "cancel" }
        ], {
            title: `DreamShader file already exists`,
            placeHolder: targetPath
        });
        if (!replace || replace.value !== "replace") {
            return;
        }
    }

    const templateText = buildDreamShaderTemplate(kind, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, templateText, "utf8");
    await vscode.window.showTextDocument(vscode.Uri.file(targetPath));
    vscode.window.showInformationMessage(`Created ${path.basename(targetPath)}.`);
}

function getDreamShaderTemplateSpec(kind) {
    const specs = {
        material: {
            title: "Create DreamShader Material",
            prompt: "Relative .dsm path under DShader.",
            placeHolder: "Materials/M_NewMaterial.dsm",
            extension: ".dsm"
        },
        header: {
            title: "Create DreamShader Header",
            prompt: "Relative .dsh path under DShader.",
            placeHolder: "Shared/Common.dsh",
            extension: ".dsh"
        },
        texture: {
            title: "Create DreamShader Texture Sample",
            prompt: "Relative .dsm path under DShader.",
            placeHolder: "Materials/M_TextureSample.dsm",
            extension: ".dsm"
        },
        noise: {
            title: "Create DreamShader Noise Material",
            prompt: "Relative .dsm path under DShader.",
            placeHolder: "Materials/M_Noise.dsm",
            extension: ".dsm"
        }
    };

    return specs[kind];
}

function normalizeTemplateRelativePath(value, extension) {
    let result = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!result) {
        return "";
    }
    if (path.extname(result).toLowerCase() !== extension) {
        result += extension;
    }
    return normalizeFsPath(result);
}

function isSafeRelativePath(relativePath) {
    return Boolean(relativePath)
        && !path.isAbsolute(relativePath)
        && !relativePath.split(/[\\/]+/).includes("..");
}

function getTemplateSymbolName(relativePath, fallback) {
    const baseName = path.basename(relativePath, path.extname(relativePath)).replace(/[^A-Za-z0-9_]/g, "");
    if (!baseName || /^[0-9]/.test(baseName)) {
        return fallback;
    }
    return baseName;
}

function getTemplateShaderAssetPath(relativePath) {
    const withoutExtension = normalizeFsPath(relativePath).replace(/\.(dsm|dsh)$/i, "");
    return withoutExtension.includes("/")
        ? withoutExtension
        : `Materials/${withoutExtension}`;
}

function buildDreamShaderTemplate(kind, relativePath) {
    const symbolName = getTemplateSymbolName(relativePath, "DreamShaderExample");
    const shaderName = getTemplateShaderAssetPath(relativePath);
    if (kind === "header") {
        return `Namespace(Name="${symbolName}")
{
    Function Identity(in vec3 input, out vec3 result) {
        result = input;
    }

    Function ApplyTint(in vec3 color, in vec3 tint, out vec3 result) {
        result = color * tint;
    }
}
`;
    }

    if (kind === "texture") {
        return `import "Builtin/Texture.dsh";

Shader(Name="${shaderName}")
{
    Properties = {
        Texture2D InTexture = Path(Engine, "/EngineResources/DefaultTexture");
        vec3 InTint = vec3(1.0, 1.0, 1.0);
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "DefaultLit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Color;
        Base.BaseColor = Color;
    }

    Graph = {
        vec2 uv = UE.TexCoord(Index=0);
        vec3 sampledColor;
        Texture::Sample2DRGB(InTexture, uv, sampledColor);
        Color = sampledColor * InTint;
    }
}
`;
    }

    if (kind === "noise") {
        return `import "Builtin/Noise.dsh";

Shader(Name="${shaderName}")
{
    Properties = {
        float Scale = 8.0;
        vec3 LowColor = vec3(0.05, 0.08, 0.12);
        vec3 HighColor = vec3(0.8, 0.95, 1.0);
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "Unlit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Color;
        Base.EmissiveColor = Color;
    }

    Graph = {
        vec2 uv = UE.TexCoord(Index=0) * Scale;
        float noiseValue;
        Noise::FBM2D(uv, 5.0, noiseValue);
        Color = lerp(LowColor, HighColor, saturate(noiseValue));
    }
}
`;
    }

    return `Shader(Name="${shaderName}")
{
    Properties = {
        vec3 InColor = vec3(1.0, 0.45, 0.2);
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "Unlit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Color;
        Base.EmissiveColor = Color;
    }

    Graph = {
        Color = InColor;
    }
}
`;
}

async function createPackageCommand() {
    const projectRoot = findProjectRootForPackageCommand();
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const packageNameInput = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Package Name",
        prompt: "Use 'name' or '@scope/name'.",
        placeHolder: "@typedreammoon/my-shader-pack",
        validateInput: (value) => {
            const normalized = normalizePackageName(value);
            if (!normalized) {
                return "Package name is required.";
            }
            return isValidPackageName(normalized) ? undefined : "Use 'name' or '@scope/name' with letters, numbers, '.', '_' or '-'.";
        }
    });
    if (!packageNameInput) {
        return;
    }

    const packageName = normalizePackageName(packageNameInput);
    const defaultDisplayName = packageNameToDisplayName(packageName);
    const displayName = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Display Name",
        prompt: "Human-readable package name.",
        value: defaultDisplayName
    });
    if (displayName === undefined) {
        return;
    }

    const description = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Description",
        prompt: "Short package description.",
        value: `Reusable DreamShaderLang functions for ${displayName || defaultDisplayName}.`
    });
    if (description === undefined) {
        return;
    }

    const namespaceName = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Namespace",
        prompt: "Default Namespace(Name=\"...\") used by the generated entry header.",
        value: packageNameToNamespace(packageName),
        validateInput: (value) => isValidIdentifier(value) ? undefined : "Namespace must be a valid identifier."
    });
    if (!namespaceName) {
        return;
    }

    const author = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Author",
        prompt: "Package author.",
        value: "TypeDreamMoon"
    });
    if (author === undefined) {
        return;
    }

    const repository = await vscode.window.showInputBox({
        title: "Create DreamShader Package - Repository",
        prompt: "Optional GitHub repository URL. You can leave this empty for a local draft package.",
        placeHolder: `https://github.com/TypeDreamMoon/${packageName.split("/").pop()}`
    });
    if (repository === undefined) {
        return;
    }

    const targetPick = await vscode.window.showQuickPick([
        {
            label: "$(folder-library) Create in current project DShader/Packages",
            description: "Recommended",
            target: "project"
        },
        {
            label: "$(folder-opened) Choose another parent folder",
            description: "Creates the package folder under the selected parent folder",
            target: "custom"
        }
    ], {
        title: "Create DreamShader Package - Target Folder"
    });
    if (!targetPick) {
        return;
    }

    let targetDirectory = "";
    let isProjectPackage = false;
    if (targetPick.target === "project") {
        targetDirectory = getPackageInstallDirectory(projectRoot, packageName);
        isProjectPackage = true;
    } else {
        const folders = await vscode.window.showOpenDialog({
            title: "Select Package Parent Folder",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        });
        if (!folders || folders.length === 0) {
            return;
        }
        targetDirectory = path.join(folders[0].fsPath, ...packageName.split("/"));
    }

    const examplePick = await vscode.window.showQuickPick([
        { label: "$(file-code) Create example material", description: "Recommended", picked: true, value: true },
        { label: "$(circle-slash) No example material", value: false }
    ], {
        title: "Create DreamShader Package - Examples"
    });
    if (!examplePick) {
        return;
    }

    if (fs.existsSync(targetDirectory)) {
        const replace = await vscode.window.showQuickPick([
            { label: "$(replace) Replace existing folder", description: path.basename(targetDirectory), value: "replace" },
            { label: "$(circle-slash) Cancel", value: "cancel" }
        ], {
            title: `Package folder already exists`,
            placeHolder: targetDirectory
        });
        if (!replace || replace.value !== "replace") {
            return;
        }
        fs.rmSync(targetDirectory, { recursive: true, force: true });
    }

    const manifest = {
        name: packageName,
        version: "0.1.0",
        displayName: displayName || defaultDisplayName,
        description: description || "",
        author: author || "",
        repository: repository || "",
        license: "MIT",
        dreamshader: {
            language: "DreamShaderLang",
            version: ">=1.0.0",
            entry: `Library/${namespaceName}.dsh`
        },
        keywords: ["dreamshader", "dreamshader-package"]
    };

    createPackageScaffold(targetDirectory, manifest, namespaceName, Boolean(examplePick.value));

    if (isProjectPackage) {
        const lock = readPackageLock(projectRoot);
        lock.packages[packageName] = {
            name: packageName,
            version: manifest.version,
            displayName: manifest.displayName,
            description: manifest.description,
            repository: manifest.repository,
            resolved: "local",
            commit: "local",
            installedAtUtc: new Date().toISOString(),
            installPath: normalizeFsPath(path.relative(projectRoot, targetDirectory)),
            entry: manifest.dreamshader.entry
        };
        writePackageLock(projectRoot, lock);
    }

    const entryHeader = path.join(targetDirectory, manifest.dreamshader.entry);
    await vscode.window.showTextDocument(vscode.Uri.file(entryHeader));
    vscode.window.showInformationMessage(`Created DreamShader package ${packageName}.`);
}

function createPackageScaffold(targetDirectory, manifest, namespaceName, includeExample) {
    const libraryDirectory = path.join(targetDirectory, "Library");
    const examplesDirectory = path.join(targetDirectory, "Examples");
    fs.mkdirSync(libraryDirectory, { recursive: true });
    if (includeExample) {
        fs.mkdirSync(examplesDirectory, { recursive: true });
    }

    fs.writeFileSync(path.join(targetDirectory, PACKAGE_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(targetDirectory, "README.md"), buildPackageReadme(manifest, namespaceName), "utf8");
    fs.writeFileSync(path.join(targetDirectory, "LICENSE"), buildPackageLicense(manifest.author || "DreamShader Package Author"), "utf8");
    fs.writeFileSync(path.join(libraryDirectory, `${namespaceName}.dsh`), buildPackageEntryHeader(namespaceName), "utf8");

    if (includeExample) {
        fs.writeFileSync(
            path.join(examplesDirectory, `M_${namespaceName}Preview.dsm`),
            buildPackageExampleMaterial(manifest, namespaceName),
            "utf8");
    }
}

function buildPackageReadme(manifest, namespaceName) {
    return `# ${manifest.displayName || manifest.name}

${manifest.description || "Reusable DreamShaderLang functions."}

## Install

\`\`\`text
DreamShaderLang: Install Package from GitHub
${manifest.repository || manifest.name}
\`\`\`

## Import

\`\`\`c
import "${manifest.name}/${manifest.dreamshader.entry}";
\`\`\`

## Example

\`\`\`c
Graph = {
    float3 color = float3(1.0, 0.5, 0.25);
    float3 result;
    ${namespaceName}::Identity(color, result);
}
\`\`\`
`;
}

function buildPackageLicense(author) {
    return `MIT License

Copyright (c) 2026 ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function buildPackageEntryHeader(namespaceName) {
    return `Namespace(Name="${namespaceName}")
{
    Function Identity(in vec3 input, out vec3 result) {
        result = input;
    }

    Function Lerp(in vec3 a, in vec3 b, in float alpha, out vec3 result) {
        result = lerp(a, b, saturate(alpha));
    }
}
`;
}

function buildPackageExampleMaterial(manifest, namespaceName) {
    return `import "${manifest.name}/${manifest.dreamshader.entry}";

Shader(Name="DreamShaderExamples/M_${namespaceName}Preview")
{
    Properties = {
        vec3 InColor = vec3(1.0, 0.45, 0.2);
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "Unlit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Res;
        Base.EmissiveColor = Res;
    }

    Graph = {
        ${namespaceName}::Identity(InColor, Res);
    }
}
`;
}

function packageNameToDisplayName(packageName) {
    const baseName = normalizePackageName(packageName).split("/").pop() || "dreamshader-package";
    return baseName
        .replace(/^dreamshader[-_]/i, "")
        .split(/[-_.]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function packageNameToNamespace(packageName) {
    const displayName = packageNameToDisplayName(packageName);
    const namespaceName = displayName.replace(/[^A-Za-z0-9_]/g, "");
    if (!namespaceName || /^[0-9]/.test(namespaceName)) {
        return "DreamPackage";
    }
    return namespaceName;
}

async function refreshPackageStorePanel(panel, projectRoot, status = "") {
    try {
        const entries = await loadPackageStoreEntries();
        panel.webview.html = renderPackageStoreHtml(panel.webview, {
            entries,
            installed: collectInstalledPackages(projectRoot),
            sources: getPackageIndexSources(),
            loading: false,
            status
        });
    } catch (error) {
        panel.webview.html = renderPackageStoreHtml(panel.webview, {
            entries: [],
            installed: collectInstalledPackages(projectRoot),
            sources: getPackageIndexSources(),
            loading: false,
            status: `Failed to load package store: ${formatError(error)}`
        });
    }
}

async function handlePackageStoreWebviewMessage(panel, projectRoot, message) {
    if (!message || typeof message.command !== "string") {
        return;
    }

    switch (message.command) {
        case "refresh":
            panel.webview.postMessage({ type: "status", text: "Refreshing package store..." });
            await refreshPackageStorePanel(panel, projectRoot);
            return;
        case "install":
            if (!message.repository) {
                return;
            }
            await installPackageFromStorePanel(panel, projectRoot, message.repository);
            return;
        case "addSource":
            if (!message.source) {
                return;
            }
            await addPackageIndexSource(message.source);
            await refreshPackageStorePanel(panel, projectRoot, "Package source added.");
            return;
        case "removeSource":
            if (!message.source) {
                return;
            }
            await removePackageIndexSource(message.source);
            await refreshPackageStorePanel(panel, projectRoot, "Package source removed.");
            return;
        case "openRepository":
            if (message.repository) {
                await vscode.env.openExternal(vscode.Uri.parse(normalizeRepositoryWebUrl(message.repository)));
            }
            return;
        case "openSettings":
            await vscode.commands.executeCommand("workbench.action.openSettings", "dreamshader.packageStoreIndexUrls");
            return;
        case "createPackage":
            await createPackageCommand();
            await refreshPackageStorePanel(panel, projectRoot, "Package scaffold created.");
            return;
        default:
            return;
    }
}

async function installPackageFromStorePanel(panel, projectRoot, packageSource) {
    try {
        panel.webview.postMessage({ type: "status", text: `Installing ${getRepositoryDisplayName(packageSource)}...` });
        const result = await installPackageFromRepository(projectRoot, packageSource, { askBeforeReplace: true });
        await refreshPackageStorePanel(panel, projectRoot, `Installed ${result.name}@${result.version}.`);
        vscode.window.showInformationMessage(`Installed DreamShader package ${result.name}@${result.version}.`);
    } catch (error) {
        const message = `DreamShader package install failed: ${formatError(error)}`;
        panel.webview.postMessage({ type: "status", text: message, isError: true });
        vscode.window.showErrorMessage(message);
    }
}

function renderPackageStoreHtml(webview, state) {
    const nonce = createNonce();
    const safeState = JSON.stringify({
        entries: state.entries || [],
        installed: (state.installed || []).map((entry) => ({
            name: entry.name,
            version: entry.version || "",
            repository: entry.repository || ""
        })),
        sources: state.sources || [],
        loading: Boolean(state.loading),
        status: state.status || ""
    }).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DreamShader Package Store</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --muted: var(--vscode-descriptionForeground);
            --panel: var(--vscode-sideBar-background);
            --border: var(--vscode-panel-border);
            --button: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --input: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --focus: var(--vscode-focusBorder);
            --badge: var(--vscode-badge-background);
            --badge-fg: var(--vscode-badge-foreground);
            --list-hover: var(--vscode-list-hoverBackground);
            --success: var(--vscode-testing-iconPassed);
            --warning: var(--vscode-editorWarning-foreground);
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: var(--bg);
            color: var(--fg);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            line-height: 1.45;
        }
        .shell {
            min-height: 100vh;
            display: grid;
            grid-template-columns: 320px minmax(0, 1fr);
        }
        aside {
            border-right: 1px solid var(--border);
            background: var(--panel);
            padding: 18px;
        }
        main {
            padding: 20px 24px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }
        .brand-mark {
            display: grid;
            place-items: center;
            width: 32px;
            height: 32px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--input);
            color: var(--fg);
            font-weight: 700;
        }
        h1 {
            margin: 0;
            font-size: 20px;
            letter-spacing: 0;
        }
        h2 {
            margin: 24px 0 10px;
            font-size: 13px;
            text-transform: uppercase;
            color: var(--muted);
            letter-spacing: 0;
        }
        .subtitle {
            color: var(--muted);
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin: 16px 0 4px;
        }
        .stat {
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--input);
            padding: 9px;
            min-width: 0;
        }
        .stat strong {
            display: block;
            font-size: 18px;
            line-height: 1.1;
        }
        .stat span {
            color: var(--muted);
            font-size: 11px;
        }
        .toolbar {
            display: flex;
            gap: 10px;
            align-items: center;
            margin: 0 0 16px;
            padding: 10px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: color-mix(in srgb, var(--panel) 70%, var(--bg));
        }
        .search {
            flex: 1;
            min-width: 240px;
            min-height: 34px;
            padding: 8px 10px;
            color: var(--input-fg);
            background: var(--input);
            border: 1px solid var(--border);
            border-radius: 4px;
            outline: none;
        }
        .search:focus { border-color: var(--focus); }
        button {
            border: 1px solid transparent;
            color: var(--button-fg);
            background: var(--button);
            min-height: 32px;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 4px;
            font: inherit;
            white-space: nowrap;
        }
        button:hover { background: var(--button-hover); }
        button:focus-visible {
            outline: 1px solid var(--focus);
            outline-offset: 2px;
        }
        button:disabled {
            opacity: 0.55;
            cursor: default;
        }
        button.secondary {
            color: var(--fg);
            background: transparent;
            border: 1px solid var(--border);
        }
        button.secondary:hover {
            background: var(--list-hover);
        }
        .source-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: center;
            padding: 8px;
            border: 1px solid var(--border);
            border-radius: 6px;
            margin-bottom: 8px;
            background: color-mix(in srgb, var(--input) 70%, transparent);
        }
        .source-url {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--muted);
            font-size: 12px;
        }
        .source-form {
            display: grid;
            gap: 8px;
            margin-top: 12px;
        }
        .source-input {
            width: 100%;
            padding: 8px 9px;
            color: var(--input-fg);
            background: var(--input);
            border: 1px solid var(--border);
            border-radius: 4px;
            outline: none;
        }
        .source-input:focus { border-color: var(--focus); }
        .cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 14px;
        }
        .card {
            border: 1px solid var(--border);
            background: color-mix(in srgb, var(--panel) 72%, var(--bg));
            padding: 16px;
            border-radius: 6px;
            min-height: 188px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            transition: border-color 120ms ease, background 120ms ease;
        }
        .card:hover {
            border-color: color-mix(in srgb, var(--focus) 70%, var(--border));
            background: color-mix(in srgb, var(--panel) 58%, var(--bg));
        }
        .card-title {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: flex-start;
        }
        .name {
            font-weight: 700;
            font-size: 15px;
            overflow-wrap: anywhere;
        }
        .pkg {
            color: var(--muted);
            font-size: 12px;
            overflow-wrap: anywhere;
        }
        .desc {
            color: var(--fg);
            opacity: 0.9;
            line-height: 1.45;
            flex: 1;
        }
        .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .tag, .badge {
            padding: 2px 7px;
            border-radius: 999px;
            font-size: 11px;
        }
        .tag {
            border: 1px solid var(--border);
            color: var(--muted);
        }
        .badge {
            color: var(--badge-fg);
            background: var(--badge);
            white-space: nowrap;
        }
        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 2px;
        }
        .actions button {
            flex: 1 1 112px;
        }
        .status {
            margin: 0 0 14px;
            color: var(--muted);
            min-height: 20px;
        }
        .status.error { color: var(--vscode-errorForeground); }
        .empty {
            padding: 34px;
            border: 1px dashed var(--border);
            border-radius: 6px;
            color: var(--muted);
            text-align: center;
        }
        code {
            color: var(--vscode-textPreformat-foreground);
        }
        @media (max-width: 820px) {
            .shell { grid-template-columns: 1fr; }
            aside { border-right: 0; border-bottom: 1px solid var(--border); }
            .toolbar { flex-direction: column; align-items: stretch; }
            .stats { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="shell">
        <aside>
            <div class="brand">
                <div class="brand-mark">DS</div>
                <h1>Package Store</h1>
            </div>
            <div class="subtitle">Browse GitHub-hosted DreamShader packages, install shared <code>.dsh</code> libraries, and manage package index sources.</div>
            <div class="stats">
                <div class="stat"><strong>${(state.entries || []).length}</strong><span>Packages</span></div>
                <div class="stat"><strong>${(state.installed || []).length}</strong><span>Installed</span></div>
                <div class="stat"><strong>${(state.sources || []).length}</strong><span>Sources</span></div>
            </div>

            <h2>Index Sources</h2>
            <div id="sources"></div>
            <div class="source-form">
                <input id="sourceInput" class="source-input" placeholder="packages.json URL or local path" />
                <button id="addSource">Add Source</button>
                <button id="settings" class="secondary">Open Settings</button>
            </div>

            <h2>Discovery</h2>
            <div class="subtitle">The store merges configured indexes with GitHub repositories tagged <code>dreamshader-package</code>.</div>
            <div class="source-form">
                <button id="createPackage" class="secondary">Create Package Step by Step</button>
            </div>
        </aside>
        <main>
            <div class="toolbar">
                <input id="search" class="search" placeholder="Search packages, tags, repositories..." />
                <button id="refresh">Refresh</button>
            </div>
            <div id="status" class="status"></div>
            <div id="cards" class="cards"></div>
        </main>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const state = ${safeState};
        const installedNames = new Set(state.installed.map((entry) => (entry.name || "").toLowerCase()));

        const sourceRoot = document.getElementById("sources");
        const cardsRoot = document.getElementById("cards");
        const statusRoot = document.getElementById("status");
        const searchInput = document.getElementById("search");
        const sourceInput = document.getElementById("sourceInput");

        function escapeHtml(value) {
            const replacements = new Map([
                ["&", "&amp;"],
                ["<", "&lt;"],
                [">", "&gt;"],
                ['"', "&quot;"],
                ["'", "&#39;"]
            ]);
            return String(value || "").replace(/[&<>"']/g, (char) => replacements.get(char));
        }

        function renderSources() {
            sourceRoot.innerHTML = "";
            if (!state.sources.length) {
                sourceRoot.innerHTML = '<div class="subtitle">No index sources configured.</div>';
                return;
            }
            for (const source of state.sources) {
                const row = document.createElement("div");
                row.className = "source-row";
                row.innerHTML = '<div class="source-url" title="' + escapeHtml(source) + '">' + escapeHtml(source) + '</div><button class="secondary" data-remove-source="' + escapeHtml(source) + '">Remove</button>';
                sourceRoot.appendChild(row);
            }
        }

        function renderCards() {
            const query = searchInput.value.trim().toLowerCase();
            const entries = state.entries.filter((entry) => {
                const haystack = [entry.name, entry.displayName, entry.description, entry.repository, entry.source, entry.sourceUrl, ...(entry.tags || [])].join(" ").toLowerCase();
                return !query || haystack.includes(query);
            });

            cardsRoot.innerHTML = "";
            if (state.loading) {
                cardsRoot.innerHTML = '<div class="empty">Loading package store...</div>';
                return;
            }
            if (!entries.length) {
                cardsRoot.innerHTML = '<div class="empty">No packages found. Try another search or add an index source.</div>';
                return;
            }

            for (const entry of entries) {
                const installed = installedNames.has(String(entry.name || "").toLowerCase());
                const tags = (entry.tags || []).slice(0, 8).map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>').join("");
                const card = document.createElement("article");
                card.className = "card";
                card.innerHTML = [
                    '<div class="card-title">',
                    '<div><div class="name">' + escapeHtml(entry.displayName || entry.name || "Unnamed Package") + '</div><div class="pkg">' + escapeHtml(entry.name || "") + '</div></div>',
                    installed ? '<span class="badge">Installed</span>' : '<span class="badge">' + escapeHtml(entry.source || "index") + '</span>',
                    '</div>',
                    '<div class="desc">' + escapeHtml(entry.description || "No description provided.") + '</div>',
                    '<div class="tags">' + tags + '</div>',
                    '<div class="pkg">' + escapeHtml(entry.localPath || entry.repository || "") + '</div>',
                    '<div class="actions">',
                    '<button data-install="' + escapeHtml(entry.installSource || entry.localPath || entry.repository || "") + '">' + (installed ? "Reinstall" : "Install") + '</button>',
                    entry.repository ? '<button class="secondary" data-repo="' + escapeHtml(entry.repository || "") + '">Repository</button>' : '',
                    '</div>'
                ].join("");
                cardsRoot.appendChild(card);
            }
        }

        function setStatus(text, isError) {
            statusRoot.textContent = text || state.status || "";
            statusRoot.className = isError ? "status error" : "status";
        }

        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!target || !target.dataset) {
                return;
            }
            if (target.dataset.install) {
                setStatus("Installing " + target.dataset.install + "...");
                vscode.postMessage({ command: "install", repository: target.dataset.install });
            } else if (target.dataset.repo) {
                vscode.postMessage({ command: "openRepository", repository: target.dataset.repo });
            } else if (target.dataset.removeSource) {
                vscode.postMessage({ command: "removeSource", source: target.dataset.removeSource });
            }
        });

        document.getElementById("refresh").addEventListener("click", () => {
            setStatus("Refreshing package store...");
            vscode.postMessage({ command: "refresh" });
        });
        document.getElementById("addSource").addEventListener("click", () => {
            const value = sourceInput.value.trim();
            if (!value) {
                setStatus("Enter an index source first.", true);
                return;
            }
            setStatus("Adding package source...");
            vscode.postMessage({ command: "addSource", source: value });
        });
        document.getElementById("settings").addEventListener("click", () => {
            vscode.postMessage({ command: "openSettings" });
        });
        document.getElementById("createPackage").addEventListener("click", () => {
            vscode.postMessage({ command: "createPackage" });
        });
        searchInput.addEventListener("input", renderCards);
        window.addEventListener("message", (event) => {
            const message = event.data;
            if (message && message.type === "status") {
                setStatus(message.text, message.isError);
            }
        });

        renderSources();
        renderCards();
        setStatus(state.status || (state.entries.length ? state.entries.length + " package(s) loaded." : ""));
    </script>
</body>
</html>`;
}

async function installPackageFromRepository(projectRoot, repositorySpecifier, options = {}) {
    const localSourceDirectory = resolveExistingLocalPackageDirectory(repositorySpecifier);
    if (localSourceDirectory) {
        return installPackageFromLocalDirectory(projectRoot, localSourceDirectory, options);
    }

    const repository = normalizeRepositorySpecifier(repositorySpecifier);
    const installRoot = path.join(projectRoot, "Saved", "DreamShader", "PackageInstall", `${Date.now()}-${Math.floor(Math.random() * 100000)}`);
    const checkoutDirectory = path.join(installRoot, "source");
    fs.mkdirSync(installRoot, { recursive: true });

    try {
        await runGit(["clone", "--depth", "1", repository, checkoutDirectory], projectRoot);

        const manifest = readPackageManifest(checkoutDirectory);
        const commit = (await runGit(["-C", checkoutDirectory, "rev-parse", "HEAD"], projectRoot)).stdout.trim();
        const resolvedRepository = getPackageRepository(manifest) || repository;
        const installDirectory = getPackageInstallDirectory(projectRoot, manifest.name);

        if (fs.existsSync(installDirectory) && !options.forceReplace) {
            if (options.askBeforeReplace) {
                const choice = await vscode.window.showQuickPick([
                    { label: "$(replace) Replace existing package", description: manifest.name, value: "replace" },
                    { label: "$(circle-slash) Cancel", value: "cancel" }
                ], {
                    title: `Package ${manifest.name} is already installed`,
                    placeHolder: installDirectory
                });
                if (!choice || choice.value !== "replace") {
                    throw new Error("Install cancelled.");
                }
            } else {
                throw new Error(`Package '${manifest.name}' is already installed.`);
            }
        }

        fs.mkdirSync(path.dirname(installDirectory), { recursive: true });
        fs.rmSync(installDirectory, { recursive: true, force: true });
        fs.cpSync(checkoutDirectory, installDirectory, { recursive: true });
        fs.rmSync(path.join(installDirectory, ".git"), { recursive: true, force: true });

        const lock = readPackageLock(projectRoot);
        lock.packages[manifest.name] = {
            name: manifest.name,
            version: manifest.version || "0.0.0",
            displayName: manifest.displayName || manifest.name,
            description: manifest.description || "",
            repository: resolvedRepository,
            resolved: repository,
            commit,
            installedAtUtc: new Date().toISOString(),
            installPath: normalizeFsPath(path.relative(projectRoot, installDirectory)),
            entry: manifest.dreamshader && typeof manifest.dreamshader.entry === "string" ? manifest.dreamshader.entry : ""
        };
        writePackageLock(projectRoot, lock);

        return lock.packages[manifest.name];
    } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
    }
}

async function installPackageFromLocalDirectory(projectRoot, sourceDirectory, options = {}) {
    const normalizedSourceDirectory = normalizeFsPath(path.resolve(sourceDirectory));
    const manifest = readPackageManifest(normalizedSourceDirectory);
    const installDirectory = getPackageInstallDirectory(projectRoot, manifest.name);
    const normalizedInstallDirectory = normalizeFsPath(path.resolve(installDirectory));

    if (normalizedInstallDirectory.toLowerCase() === normalizedSourceDirectory.toLowerCase()) {
        const lock = readPackageLock(projectRoot);
        lock.packages[manifest.name] = buildPackageLockEntry(projectRoot, installDirectory, manifest, "local", normalizedSourceDirectory, "local");
        writePackageLock(projectRoot, lock);
        return lock.packages[manifest.name];
    }

    if (fs.existsSync(installDirectory) && !options.forceReplace) {
        if (options.askBeforeReplace) {
            const choice = await vscode.window.showQuickPick([
                { label: "$(replace) Replace existing package", description: manifest.name, value: "replace" },
                { label: "$(circle-slash) Cancel", value: "cancel" }
            ], {
                title: `Package ${manifest.name} is already installed`,
                placeHolder: installDirectory
            });
            if (!choice || choice.value !== "replace") {
                throw new Error("Install cancelled.");
            }
        } else {
            throw new Error(`Package '${manifest.name}' is already installed.`);
        }
    }

    fs.mkdirSync(path.dirname(installDirectory), { recursive: true });
    fs.rmSync(installDirectory, { recursive: true, force: true });
    fs.cpSync(normalizedSourceDirectory, installDirectory, { recursive: true });
    fs.rmSync(path.join(installDirectory, ".git"), { recursive: true, force: true });

    const lock = readPackageLock(projectRoot);
    lock.packages[manifest.name] = buildPackageLockEntry(projectRoot, installDirectory, manifest, "local", normalizedSourceDirectory, "local");
    writePackageLock(projectRoot, lock);
    return lock.packages[manifest.name];
}

function buildPackageLockEntry(projectRoot, installDirectory, manifest, resolvedRepository, resolvedSource, commit) {
    return {
        name: manifest.name,
        version: manifest.version || "0.0.0",
        displayName: manifest.displayName || manifest.name,
        description: manifest.description || "",
        repository: getPackageRepository(manifest) || resolvedRepository || "",
        resolved: resolvedSource,
        commit,
        installedAtUtc: new Date().toISOString(),
        installPath: normalizeFsPath(path.relative(projectRoot, installDirectory)),
        entry: manifest.dreamshader && typeof manifest.dreamshader.entry === "string" ? manifest.dreamshader.entry : ""
    };
}

function readPackageManifest(packageDirectory) {
    const manifestPath = path.join(packageDirectory, PACKAGE_MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Repository is not a DreamShader package. Missing ${PACKAGE_MANIFEST_NAME}.`);
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
        throw new Error(`Invalid ${PACKAGE_MANIFEST_NAME}: ${formatError(error)}`);
    }

    if (!manifest || typeof manifest.name !== "string" || !manifest.name.trim()) {
        throw new Error(`${PACKAGE_MANIFEST_NAME} must declare a non-empty string field 'name'.`);
    }

    manifest.name = normalizePackageName(manifest.name);
    if (!isValidPackageName(manifest.name)) {
        throw new Error(`Invalid DreamShader package name '${manifest.name}'. Use 'name' or '@scope/name'.`);
    }

    if (manifest.version !== undefined && typeof manifest.version !== "string") {
        throw new Error(`${PACKAGE_MANIFEST_NAME} field 'version' must be a string.`);
    }

    return manifest;
}

async function loadPackageStoreEntries() {
    const entriesByRepository = new Map();
    const addEntry = (entry, source) => {
        if (!entry) {
            return;
        }

        const repository = getPackageRepository(entry);
        const localPath = getPackageLocalPath(entry);
        if (!repository && !localPath) {
            return;
        }

        let normalizedRepository = "";
        if (repository) {
            try {
                normalizedRepository = normalizeRepositorySpecifier(repository);
            } catch (_error) {
                if (!localPath) {
                    return;
                }
            }
        }

        const installSource = localPath || normalizedRepository;
        const key = (entry.name || installSource).toLowerCase();
        if (entriesByRepository.has(key)) {
            return;
        }

        entriesByRepository.set(key, {
            name: typeof entry.name === "string" ? entry.name : getRepositoryDisplayName(installSource),
            displayName: typeof entry.displayName === "string" ? entry.displayName : "",
            description: typeof entry.description === "string" ? entry.description : "",
            repository: normalizedRepository,
            localPath,
            installSource,
            tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
            source: source === "github" ? "GitHub" : "Index",
            sourceUrl: source
        });
    };

    for (const entry of await loadConfiguredPackageIndexEntries()) {
        addEntry(entry, "index");
    }

    for (const entry of await loadGitHubTopicPackageEntries()) {
        addEntry(entry, "github");
    }

    return Array.from(entriesByRepository.values()).sort((a, b) => {
        const left = (a.displayName || a.name || "").toLowerCase();
        const right = (b.displayName || b.name || "").toLowerCase();
        return left.localeCompare(right);
    });
}

async function loadConfiguredPackageIndexEntries() {
    const entries = [];
    for (const source of getPackageIndexSources()) {
        try {
            const parsed = await readJsonFromUrlOrFile(source);
            const sourceEntries = Array.isArray(parsed)
                ? parsed
                : parsed && Array.isArray(parsed.packages)
                    ? parsed.packages
                    : [];

            for (const entry of sourceEntries) {
                if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                    entries.push({ ...entry, source, localPath: resolvePackageEntryLocalPath(entry, source) });
                }
            }
        } catch (_error) {
            // Keep the store usable even if one source is down.
        }
    }

    return entries;
}

function getPackageIndexSources() {
    const configuration = vscode.workspace.getConfiguration("dreamshader");
    const configuredSources = configuration.get("packageStoreIndexUrls", []);
    const sourceInspection = configuration.inspect("packageStoreIndexUrls");
    const hasExplicitSourceList = Boolean(sourceInspection && (
        Array.isArray(sourceInspection.globalValue)
        || Array.isArray(sourceInspection.workspaceValue)
        || Array.isArray(sourceInspection.workspaceFolderValue)));
    const legacyInspection = configuration.inspect("packageStoreIndexUrl");
    const legacySource = legacyInspection
        ? (legacyInspection.workspaceFolderValue || legacyInspection.workspaceValue || legacyInspection.globalValue || "")
        : "";
    const sources = [];

    if (Array.isArray(configuredSources)) {
        for (const source of configuredSources) {
            addUniquePackageSource(sources, source);
        }
    }

    addUniquePackageSource(sources, legacySource);

    if (sources.length === 0 && !hasExplicitSourceList) {
        sources.push(DEFAULT_PACKAGE_INDEX_URL);
    }

    return sources;
}

async function addPackageIndexSource(source) {
    const sources = getPackageIndexSources();
    addUniquePackageSource(sources, source);
    await vscode.workspace.getConfiguration("dreamshader").update("packageStoreIndexUrls", sources, vscode.ConfigurationTarget.Global);
}

async function removePackageIndexSource(source) {
    const normalizedSource = normalizePackageSource(source);
    const sources = getPackageIndexSources().filter((entry) => normalizePackageSource(entry).toLowerCase() !== normalizedSource.toLowerCase());
    await vscode.workspace.getConfiguration("dreamshader").update("packageStoreIndexUrls", sources, vscode.ConfigurationTarget.Global);
}

function addUniquePackageSource(sources, source) {
    const normalized = normalizePackageSource(source);
    if (!normalized) {
        return;
    }

    if (!sources.some((entry) => normalizePackageSource(entry).toLowerCase() === normalized.toLowerCase())) {
        sources.push(normalized);
    }
}

function normalizePackageSource(source) {
    return String(source || "").trim();
}

async function loadGitHubTopicPackageEntries() {
    const enabled = vscode.workspace.getConfiguration("dreamshader").get("enableGitHubPackageSearch", true);
    if (!enabled) {
        return [];
    }

    try {
        const response = await fetchJson("https://api.github.com/search/repositories?q=topic:dreamshader-package&sort=stars&order=desc&per_page=50");
        if (!response || !Array.isArray(response.items)) {
            return [];
        }

        return response.items.map((repo) => ({
            name: repo.full_name,
            displayName: repo.name,
            description: repo.description || "",
            repository: repo.clone_url || repo.html_url,
            tags: Array.isArray(repo.topics) ? repo.topics : []
        }));
    } catch (_error) {
        return [];
    }
}

function collectInstalledPackages(projectRoot) {
    const entries = new Map();
    const lock = readPackageLock(projectRoot);
    for (const [name, entry] of Object.entries(lock.packages)) {
        entries.set(name, { ...entry, name });
    }

    const packagesDirectory = getPackagesDirectory(projectRoot);
    for (const manifestPath of findPackageManifestFiles(packagesDirectory, 4)) {
        try {
            const manifest = readPackageManifest(path.dirname(manifestPath));
            const existing = entries.get(manifest.name) || {};
            entries.set(manifest.name, {
                ...existing,
                name: manifest.name,
                version: manifest.version || existing.version || "0.0.0",
                displayName: manifest.displayName || existing.displayName || manifest.name,
                description: manifest.description || existing.description || "",
                repository: getPackageRepository(manifest) || existing.repository || "",
                installPath: normalizeFsPath(path.relative(projectRoot, path.dirname(manifestPath)))
            });
        } catch (_error) {
            // Ignore malformed packages in the list view; diagnostics happen at import time.
        }
    }

    return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findPackageManifestFiles(rootDirectory, maxDepth) {
    const results = [];
    if (!fs.existsSync(rootDirectory) || maxDepth < 0) {
        return results;
    }

    let entries = [];
    try {
        entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
    } catch (_error) {
        return results;
    }

    for (const entry of entries) {
        const absolutePath = path.join(rootDirectory, entry.name);
        if (entry.isFile() && entry.name === PACKAGE_MANIFEST_NAME) {
            results.push(absolutePath);
            continue;
        }

        if (entry.isDirectory() && maxDepth > 0) {
            results.push(...findPackageManifestFiles(absolutePath, maxDepth - 1));
        }
    }

    return results;
}

function readPackageLock(projectRoot) {
    const lockPath = getPackageLockPath(projectRoot);
    if (!fs.existsSync(lockPath)) {
        return { version: 1, packages: {} };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (!parsed || typeof parsed !== "object") {
            return { version: 1, packages: {} };
        }

        if (!parsed.packages || typeof parsed.packages !== "object" || Array.isArray(parsed.packages)) {
            parsed.packages = {};
        }

        parsed.version = 1;
        return parsed;
    } catch (_error) {
        return { version: 1, packages: {} };
    }
}

function writePackageLock(projectRoot, lock) {
    const lockPath = getPackageLockPath(projectRoot);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const normalizedLock = {
        version: 1,
        packages: lock && lock.packages && typeof lock.packages === "object" ? lock.packages : {}
    };
    fs.writeFileSync(lockPath, `${JSON.stringify(normalizedLock, null, 2)}\n`, "utf8");
}

function findProjectRootForPackageCommand() {
    const document = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    return findProjectRoot(document ? document.uri.fsPath : "");
}

function getPackagesDirectory(projectRoot) {
    return path.join(projectRoot, "DShader", "Packages");
}

function getPackageLockPath(projectRoot) {
    return path.join(projectRoot, "DShader", PACKAGE_LOCK_NAME);
}

function getPackageInstallDirectory(projectRoot, packageName) {
    const packagesDirectory = path.resolve(getPackagesDirectory(projectRoot));
    const installDirectory = path.resolve(packagesDirectory, ...normalizePackageName(packageName).split("/"));
    const relative = path.relative(packagesDirectory, installDirectory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Package '${packageName}' resolves outside DShader/Packages.`);
    }
    return installDirectory;
}

function resolveInstalledPackageDirectory(projectRoot, entry) {
    if (!entry || !projectRoot) {
        throw new Error("Installed package entry is invalid.");
    }

    const normalizedProjectRoot = path.resolve(projectRoot);
    const recordedInstallPath = typeof entry.installPath === "string" ? entry.installPath.trim() : "";
    if (recordedInstallPath) {
        const resolvedFromLock = path.resolve(normalizedProjectRoot, recordedInstallPath);
        const relativeToProject = path.relative(normalizedProjectRoot, resolvedFromLock);
        if (!relativeToProject.startsWith("..") && !path.isAbsolute(relativeToProject)) {
            return resolvedFromLock;
        }
    }

    return getPackageInstallDirectory(projectRoot, entry.name);
}

function normalizePackageName(packageName) {
    return String(packageName || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function isValidPackageName(packageName) {
    return /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(packageName) && !packageName.includes("..");
}

function isValidIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || "").trim());
}

function getPackageRepository(entry) {
    if (!entry) {
        return "";
    }

    if (typeof entry.repository === "string") {
        return entry.repository;
    }

    if (entry.repository && typeof entry.repository.url === "string") {
        return entry.repository.url;
    }

    if (typeof entry.github === "string") {
        return entry.github;
    }

    return "";
}

function getPackageLocalPath(entry) {
    if (!entry) {
        return "";
    }

    if (typeof entry.localPath === "string" && entry.localPath.trim()) {
        return normalizeFsPath(entry.localPath.trim());
    }

    if (typeof entry.path === "string" && entry.path.trim()) {
        return normalizeFsPath(entry.path.trim());
    }

    return "";
}

function resolvePackageEntryLocalPath(entry, source) {
    const rawPath = getPackageLocalPath(entry);
    if (!rawPath) {
        return "";
    }

    const directPath = rawPath.startsWith("file://")
        ? vscode.Uri.parse(rawPath).fsPath
        : rawPath;
    if (path.isAbsolute(directPath)) {
        return fs.existsSync(directPath) ? normalizeFsPath(path.resolve(directPath)) : "";
    }

    const sourceFilePath = getLocalIndexSourceFilePath(source);
    if (sourceFilePath) {
        const resolvedPath = path.resolve(path.dirname(sourceFilePath), directPath);
        return fs.existsSync(resolvedPath) ? normalizeFsPath(resolvedPath) : "";
    }

    return "";
}

function getLocalIndexSourceFilePath(source) {
    const text = String(source || "").trim();
    if (!text || /^https?:\/\//i.test(text)) {
        return "";
    }

    if (text.startsWith("file://")) {
        return vscode.Uri.parse(text).fsPath;
    }

    return path.resolve(text);
}

function resolveExistingLocalPackageDirectory(source) {
    const text = String(source || "").trim();
    if (!text || /^https?:\/\//i.test(text) || /^git@/i.test(text) || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
        return "";
    }

    const candidate = text.startsWith("file://")
        ? vscode.Uri.parse(text).fsPath
        : text;
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) {
        return "";
    }

    const stat = fs.statSync(resolved);
    const directory = stat.isFile() && path.basename(resolved) === PACKAGE_MANIFEST_NAME
        ? path.dirname(resolved)
        : resolved;

    if (!fs.existsSync(path.join(directory, PACKAGE_MANIFEST_NAME))) {
        return "";
    }

    return directory;
}

function normalizeRepositorySpecifier(repositorySpecifier) {
    const value = String(repositorySpecifier || "").trim().replace(/^git\+/i, "");
    if (!value) {
        throw new Error("Repository is empty.");
    }

    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\.git\/?$/i.test(value)) {
        return value.replace(/\/$/, "");
    }

    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
        return `https://github.com/${value}.git`;
    }

    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(value)) {
        return `${value.replace(/\/$/, "")}.git`;
    }

    if (/^https?:\/\//i.test(value) || /^git@/i.test(value)) {
        return value;
    }

    throw new Error(`Unsupported repository specifier '${value}'. Use a GitHub URL or owner/repo.`);
}

function getRepositoryDisplayName(repository) {
    const text = String(repository || "").replace(/\.git$/i, "").replace(/\/$/, "");
    const match = text.match(/github\.com[:/]([^/]+\/[^/]+)$/i);
    if (match) {
        return match[1];
    }
    return path.basename(text) || text;
}

function runGit(args, cwd) {
    return new Promise((resolve, reject) => {
        childProcess.execFile("git", args, { cwd, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error((stderr || stdout || error.message).trim()));
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

async function readJsonFromUrlOrFile(source) {
    const text = String(source || "").trim();
    if (!text) {
        throw new Error("Empty package index URL.");
    }

    if (/^https?:\/\//i.test(text)) {
        return fetchJson(text);
    }

    const filePath = text.startsWith("file://") ? vscode.Uri.parse(text).fsPath : text;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "DreamShaderLang-VSCode"
            }
        }, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                fetchJson(response.headers.location).then(resolve, reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }

            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                body += chunk;
            });
            response.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

function normalizeRepositoryWebUrl(repository) {
    const text = String(repository || "").trim().replace(/^git\+/i, "").replace(/\.git$/i, "");
    const sshMatch = text.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
    if (sshMatch) {
        return `https://github.com/${sshMatch[1]}`;
    }
    return text;
}

function createNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let index = 0; index < 32; index += 1) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}

function formatError(error) {
    return error && error.message ? error.message : String(error);
}

async function requestRecompile(scope, targetUri) {
    let document = undefined;
    if (targetUri instanceof vscode.Uri) {
        document = vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === targetUri.toString()) || await vscode.workspace.openTextDocument(targetUri);
    } else {
        document = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    }

    const projectRoot = findProjectRoot(document ? document.uri.fsPath : "");
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    if (scope === "file") {
        if (!document || !isDreamShaderDocument(document)) {
            vscode.window.showWarningMessage("DreamShader recompile needs an active .dsm or .dsh document.");
            return;
        }

        if (document.isDirty) {
            await document.save();
        }
    }

    const effectiveScope = scope === "file" && document && path.extname(document.fileName).toLowerCase() === ".dsh"
        ? "all"
        : scope;

    const requestDirectory = path.join(projectRoot, "Saved", "DreamShader", "Bridge", "Requests");
    fs.mkdirSync(requestDirectory, { recursive: true });

    const payload = {
        action: "recompile",
        scope: effectiveScope
    };

    if (effectiveScope === "file" && document) {
        payload.sourceFile = normalizeFsPath(document.fileName);
    }

    const requestPath = path.join(requestDirectory, `request-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(payload, null, 2), "utf8");

    if (effectiveScope === "all") {
        vscode.window.setStatusBarMessage("DreamShader requested a full Unreal recompile.", 2500);
    } else {
        vscode.window.setStatusBarMessage(`DreamShader requested Unreal to recompile ${path.basename(document.fileName)}.`, 2500);
    }
}

async function requestCleanGeneratedShaders() {
    const document = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    const projectRoot = findProjectRoot(document ? document.uri.fsPath : "");
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    const requestDirectory = path.join(projectRoot, "Saved", "DreamShader", "Bridge", "Requests");
    fs.mkdirSync(requestDirectory, { recursive: true });

    const payload = {
        action: "cleanGeneratedShaders"
    };

    const requestPath = path.join(requestDirectory, `request-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(payload, null, 2), "utf8");

    vscode.window.setStatusBarMessage("DreamShader requested generated shader cleanup and a full Unreal recompile.", 3000);
}

function createEmptyBridgeDiagnosticsState() {
    return {
        updatedAtUtc: "",
        diagnosticsFileCount: 0,
        hasAnyBridgeFile: false,
        totals: createBridgeDiagnosticCounts(),
        projectEntries: [],
        metaEntries: []
    };
}

function createBridgeDiagnosticCounts() {
    return {
        error: 0,
        warning: 0,
        information: 0,
        hint: 0,
        total: 0
    };
}

function resetBridgeDiagnosticsState(state) {
    if (!state) {
        return;
    }

    state.updatedAtUtc = "";
    state.diagnosticsFileCount = 0;
    state.hasAnyBridgeFile = false;
    state.totals = createBridgeDiagnosticCounts();
    state.projectEntries = [];
    state.metaEntries = [];
}

function normalizeBridgeDiagnosticSeverity(severity) {
    if (typeof severity !== "string") {
        return "error";
    }

    switch (severity.trim().toLowerCase()) {
        case "warning":
            return "warning";
        case "information":
        case "info":
            return "information";
        case "hint":
            return "hint";
        default:
            return "error";
    }
}

function addBridgeDiagnosticCount(counts, severity) {
    if (!counts) {
        return;
    }

    const key = normalizeBridgeDiagnosticSeverity(severity);
    counts[key] = (counts[key] || 0) + 1;
    counts.total = (counts.total || 0) + 1;
}

function getBridgeDiagnosticSeverityWeight(severity) {
    switch (normalizeBridgeDiagnosticSeverity(severity)) {
        case "error":
            return 0;
        case "warning":
            return 1;
        case "information":
            return 2;
        case "hint":
            return 3;
        default:
            return 4;
    }
}

function formatBridgeDiagnosticCountSummary(counts) {
    if (!counts || !counts.total) {
        return "0 issues";
    }

    const parts = [];
    if (counts.error) {
        parts.push(`${counts.error} error${counts.error === 1 ? "" : "s"}`);
    }
    if (counts.warning) {
        parts.push(`${counts.warning} warning${counts.warning === 1 ? "" : "s"}`);
    }
    if (counts.information) {
        parts.push(`${counts.information} info`);
    }
    if (counts.hint) {
        parts.push(`${counts.hint} hint${counts.hint === 1 ? "" : "s"}`);
    }
    return parts.join(", ");
}

function getBridgeDiagnosticThemeIcon(severity) {
    switch (normalizeBridgeDiagnosticSeverity(severity)) {
        case "warning":
            return new vscode.ThemeIcon("warning");
        case "information":
            return new vscode.ThemeIcon("info");
        case "hint":
            return new vscode.ThemeIcon("lightbulb");
        default:
            return new vscode.ThemeIcon("error");
    }
}

function getBridgeDiagnosticSummaryThemeIcon(counts) {
    if (!counts || !counts.total) {
        return new vscode.ThemeIcon("check");
    }
    if (counts.error) {
        return new vscode.ThemeIcon("error");
    }
    if (counts.warning) {
        return new vscode.ThemeIcon("warning");
    }
    if (counts.information) {
        return new vscode.ThemeIcon("info");
    }
    return new vscode.ThemeIcon("lightbulb");
}

function getBridgeDiagnosticsSummaryForProject(state, projectRoot) {
    if (state && projectRoot) {
        const normalizedProjectRoot = normalizeFsPath(projectRoot);
        const matchingProject = (state.projectEntries || []).find((entry) => entry.projectRoot === normalizedProjectRoot);
        if (matchingProject) {
            return matchingProject.counts;
        }
    }

    return state && state.totals ? state.totals : createBridgeDiagnosticCounts();
}

function createBridgeDiagnosticsTreeProvider(state) {
    const changeEmitter = new vscode.EventEmitter();
    return {
        onDidChangeTreeData: changeEmitter.event,
        refresh() {
            changeEmitter.fire();
        },
        getTreeItem(element) {
            return buildBridgeDiagnosticsTreeItem(element);
        },
        getChildren(element) {
            if (!element) {
                const rootEntries = [
                    ...(state.metaEntries || []),
                    ...(state.projectEntries || [])
                ];
                return rootEntries.length > 0 ? rootEntries : [createBridgeDiagnosticsPlaceholder(state)];
            }

            if (element.type === "project") {
                return element.fileEntries || [];
            }

            if (element.type === "file") {
                return element.diagnosticEntries || [];
            }

            return [];
        },
        dispose() {
            changeEmitter.dispose();
        }
    };
}

function createBridgeDiagnosticsPlaceholder(state) {
    return {
        type: "placeholder",
        label: state && state.hasAnyBridgeFile ? "Bridge is clean" : "Waiting for Unreal bridge diagnostics",
        description: state && state.hasAnyBridgeFile ? "No active issues" : "No diagnostics file detected yet",
        tooltip: state && state.hasAnyBridgeFile
            ? "DreamShader bridge diagnostics are currently clean."
            : "Compile a DreamShader material in Unreal to populate Saved/DreamShader/Bridge/diagnostics.json."
    };
}

function buildBridgeDiagnosticsTreeItem(element) {
    if (!element) {
        return new vscode.TreeItem("Bridge Diagnostics");
    }

    switch (element.type) {
        case "project": {
            const collapsibleState = (element.fileEntries || []).length <= 1
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
            const item = new vscode.TreeItem(element.label, collapsibleState);
            item.iconPath = getBridgeDiagnosticSummaryThemeIcon(element.counts);
            item.contextValue = "dreamshaderBridgeProject";
            item.description = formatBridgeDiagnosticCountSummary(element.counts);
            item.tooltip = new vscode.MarkdownString([
                `**${element.label}**`,
                "",
                `Project Root: \`${element.projectRoot || "Unknown"}\``,
                `Diagnostics File: \`${element.diagnosticsFilePath}\``,
                `Issues: ${formatBridgeDiagnosticCountSummary(element.counts)}`,
                element.updatedAtUtc ? `Updated: \`${element.updatedAtUtc}\`` : ""
            ].filter(Boolean).join("\n"));
            return item;
        }
        case "file": {
            const collapsibleState = (element.diagnosticEntries || []).length <= 3
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
            const item = new vscode.TreeItem(element.label, collapsibleState);
            item.resourceUri = vscode.Uri.file(element.filePath);
            item.iconPath = getBridgeDiagnosticSummaryThemeIcon(element.counts);
            item.contextValue = "dreamshaderBridgeFile";
            item.description = element.relativeDirectory
                ? `${element.relativeDirectory} • ${formatBridgeDiagnosticCountSummary(element.counts)}`
                : formatBridgeDiagnosticCountSummary(element.counts);
            item.tooltip = new vscode.MarkdownString([
                `**${element.label}**`,
                "",
                `Path: \`${element.filePath}\``,
                `Project: \`${element.projectLabel}\``,
                `Issues: ${formatBridgeDiagnosticCountSummary(element.counts)}`
            ].join("\n"));
            item.command = {
                command: "dreamshader.openBridgeDiagnosticLocation",
                title: "Open DreamShader Source",
                arguments: [{
                    filePath: element.filePath,
                    line: element.primaryLine,
                    column: element.primaryColumn
                }]
            };
            return item;
        }
        case "diagnostic": {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = getBridgeDiagnosticThemeIcon(element.severity);
            item.contextValue = "dreamshaderBridgeDiagnostic";
            item.description = formatBridgeDiagnosticEntryDescription(element);
            item.tooltip = createBridgeDiagnosticEntryTooltip(element);
            item.command = {
                command: "dreamshader.openBridgeDiagnosticLocation",
                title: "Open Bridge Diagnostic",
                arguments: [element]
            };
            return item;
        }
        case "meta": {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = getBridgeDiagnosticThemeIcon(element.severity);
            item.contextValue = "dreamshaderBridgeMeta";
            item.description = element.description || "";
            item.tooltip = new vscode.MarkdownString([
                `**${element.label}**`,
                "",
                element.filePath ? `File: \`${element.filePath}\`` : "",
                element.detail || ""
            ].filter(Boolean).join("\n"));
            if (element.filePath) {
                item.command = {
                    command: "dreamshader.openBridgeDiagnosticLocation",
                    title: "Open Bridge File",
                    arguments: [element]
                };
            }
            return item;
        }
        default: {
            const item = new vscode.TreeItem(element.label || "Bridge Diagnostics", vscode.TreeItemCollapsibleState.None);
            item.iconPath = element.type === "placeholder" && element.label === "Bridge is clean"
                ? new vscode.ThemeIcon("check")
                : new vscode.ThemeIcon("info");
            item.description = element.description || "";
            item.tooltip = element.tooltip || "";
            return item;
        }
    }
}

function formatBridgeDiagnosticEntryDescription(entry) {
    const parts = [];
    if (entry.shaderPlatform) {
        parts.push(entry.shaderPlatform);
    }
    if (entry.qualityLevel) {
        parts.push(entry.qualityLevel);
    }
    if (entry.stage) {
        parts.push(entry.stage);
    }
    if (Number.isFinite(entry.line)) {
        parts.push(`L${entry.line}`);
    }
    return parts.join(" • ");
}

function createBridgeDiagnosticEntryTooltip(entry) {
    return new vscode.MarkdownString([
        `**${entry.label}**`,
        "",
        `File: \`${entry.filePath}\``,
        `Line: \`${entry.line}\`, Column: \`${entry.column}\``,
        entry.assetPath ? `Asset: \`${entry.assetPath}\`` : "",
        entry.shaderPlatform ? `Platform: \`${entry.shaderPlatform}\`` : "",
        entry.qualityLevel ? `Quality: \`${entry.qualityLevel}\`` : "",
        entry.code ? `Code: \`${entry.code}\`` : "",
        entry.source ? `Source: \`${entry.source}\`` : "",
        entry.detail ? "" : "",
        entry.detail || ""
    ].filter(Boolean).join("\n"));
}

function createBridgeDiagnosticProjectEntry(projectRoot, diagnosticsFilePath) {
    const normalizedProjectRoot = projectRoot ? normalizeFsPath(projectRoot) : "";
    return {
        type: "project",
        key: normalizedProjectRoot || diagnosticsFilePath,
        label: normalizedProjectRoot ? path.basename(normalizedProjectRoot) : path.basename(path.dirname(path.dirname(path.dirname(diagnosticsFilePath)))),
        projectRoot: normalizedProjectRoot,
        diagnosticsFilePath: normalizeFsPath(diagnosticsFilePath),
        updatedAtUtc: "",
        counts: createBridgeDiagnosticCounts(),
        fileMap: new Map(),
        fileEntries: []
    };
}

function createBridgeDiagnosticFileEntry(projectEntry, filePath) {
    const relativePath = projectEntry.projectRoot
        ? normalizeFsPath(path.relative(projectEntry.projectRoot, filePath))
        : normalizeFsPath(filePath);
    const relativeDirectory = normalizeFsPath(path.dirname(relativePath)).replace(/^\.$/, "");
    return {
        type: "file",
        key: `${projectEntry.key}|${filePath}`,
        label: path.basename(filePath),
        filePath,
        projectLabel: projectEntry.label,
        relativePath,
        relativeDirectory,
        counts: createBridgeDiagnosticCounts(),
        diagnosticEntries: [],
        primaryLine: 1,
        primaryColumn: 1
    };
}

function createBridgeDiagnosticMetaEntry(label, description, filePath, detail, severity = "warning") {
    return {
        type: "meta",
        label,
        description,
        filePath: filePath ? normalizeFsPath(filePath) : "",
        detail: detail || "",
        severity
    };
}

function resolveBridgeDiagnosticFilePath(inputPath, projectRoot) {
    if (typeof inputPath !== "string" || !inputPath.trim()) {
        return "";
    }

    const trimmedPath = inputPath.trim();
    const resolvedPath = path.isAbsolute(trimmedPath)
        ? trimmedPath
        : (projectRoot ? path.join(projectRoot, trimmedPath) : trimmedPath);
    return normalizeFsPath(path.resolve(resolvedPath));
}

function normalizeBridgeDiagnosticEntry(diagnostic, filePath, projectEntry) {
    const line = Math.max(1, Number.isFinite(diagnostic.line) ? Number(diagnostic.line) : 1);
    const column = Math.max(1, Number.isFinite(diagnostic.column) ? Number(diagnostic.column) : 1);
    const severity = normalizeBridgeDiagnosticSeverity(diagnostic.severity);
    const message = typeof diagnostic.message === "string" && diagnostic.message.trim()
        ? diagnostic.message.trim()
        : "DreamShader error";
    return {
        type: "diagnostic",
        key: `${filePath}:${line}:${column}:${severity}:${message}`,
        label: message,
        message,
        filePath,
        projectLabel: projectEntry.label,
        line,
        column,
        severity,
        detail: typeof diagnostic.detail === "string" ? diagnostic.detail.trim() : "",
        stage: typeof diagnostic.stage === "string" ? diagnostic.stage.trim() : "",
        assetPath: typeof diagnostic.assetPath === "string" ? diagnostic.assetPath.trim() : "",
        shaderPlatform: typeof diagnostic.shaderPlatform === "string" ? diagnostic.shaderPlatform.trim() : "",
        qualityLevel: typeof diagnostic.qualityLevel === "string" ? diagnostic.qualityLevel.trim() : "",
        code: typeof diagnostic.code === "string" ? diagnostic.code.trim() : "",
        source: typeof diagnostic.source === "string" && diagnostic.source.trim() ? diagnostic.source.trim() : "DreamShader"
    };
}

function createVsCodeBridgeDiagnostic(entry) {
    const line = Math.max(0, entry.line - 1);
    const column = Math.max(0, entry.column - 1);
    const range = new vscode.Range(line, column, line, column + 1);
    const vscodeDiagnostic = new vscode.Diagnostic(range, entry.message, mapSeverity(entry.severity));
    vscodeDiagnostic.source = entry.source;
    if (entry.code) {
        vscodeDiagnostic.code = entry.code;
    }

    const location = new vscode.Location(vscode.Uri.file(entry.filePath), range);
    const relatedInformation = [];
    if (entry.assetPath) {
        relatedInformation.push(new vscode.DiagnosticRelatedInformation(location, `Material: ${entry.assetPath}`));
    }
    const metadataParts = [];
    if (entry.shaderPlatform) {
        metadataParts.push(`Platform: ${entry.shaderPlatform}`);
    }
    if (entry.qualityLevel) {
        metadataParts.push(`Quality: ${entry.qualityLevel}`);
    }
    if (entry.stage) {
        metadataParts.push(`Stage: ${entry.stage}`);
    }
    if (metadataParts.length > 0) {
        relatedInformation.push(new vscode.DiagnosticRelatedInformation(location, metadataParts.join(" | ")));
    }
    if (entry.detail && entry.detail !== entry.message) {
        relatedInformation.push(new vscode.DiagnosticRelatedInformation(location, entry.detail));
    }
    if (relatedInformation.length > 0) {
        vscodeDiagnostic.relatedInformation = relatedInformation;
    }

    return vscodeDiagnostic;
}

async function openBridgeDiagnosticLocation(diagnosticEntry) {
    if (!diagnosticEntry || (typeof diagnosticEntry !== "object")) {
        return;
    }

    const targetPath = typeof diagnosticEntry.filePath === "string" && diagnosticEntry.filePath
        ? diagnosticEntry.filePath
        : "";
    if (!targetPath || !fs.existsSync(targetPath)) {
        vscode.window.showWarningMessage("DreamShader could not find the diagnostic target on disk.");
        return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const line = Math.max(0, Number.isFinite(diagnosticEntry.line) ? Number(diagnosticEntry.line) - 1 : 0);
    const column = Math.max(0, Number.isFinite(diagnosticEntry.column) ? Number(diagnosticEntry.column) - 1 : 0);
    const position = new vscode.Position(line, column);
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

async function refreshBridgeDiagnostics(collection, state) {
    collection.clear();
    resetBridgeDiagnosticsState(state);

    const diagnosticFiles = new Set();
    const workspaceMatches = await vscode.workspace.findFiles("**/Saved/DreamShader/Bridge/diagnostics.json");
    for (const uri of workspaceMatches) {
        diagnosticFiles.add(uri.fsPath);
    }

    for (const projectRoot of collectKnownProjectRoots()) {
        diagnosticFiles.add(getBridgeDiagnosticsFilePath(projectRoot));
    }

    const diagnosticsByFileUri = new Map();
    const projectEntriesByKey = new Map();
    for (const diagnosticFile of Array.from(diagnosticFiles).sort((left, right) => left.localeCompare(right))) {
        if (!fs.existsSync(diagnosticFile)) {
            continue;
        }

        state.hasAnyBridgeFile = true;
        state.diagnosticsFileCount += 1;
        const projectRoot = findProjectRootFromCandidate(diagnosticFile);
        const projectKey = normalizeFsPath(projectRoot || diagnosticFile);
        let projectEntry = projectEntriesByKey.get(projectKey);
        if (!projectEntry) {
            projectEntry = createBridgeDiagnosticProjectEntry(projectRoot, diagnosticFile);
            projectEntriesByKey.set(projectKey, projectEntry);
        }

        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(diagnosticFile, "utf8"));
        } catch (error) {
            state.metaEntries.push(createBridgeDiagnosticMetaEntry(
                "Bridge diagnostics parse error",
                path.basename(diagnosticFile),
                diagnosticFile,
                error && error.message ? error.message : "Failed to parse diagnostics.json",
                "warning"));
            continue;
        }

        if (!parsed || !Array.isArray(parsed.files)) {
            state.metaEntries.push(createBridgeDiagnosticMetaEntry(
                "Bridge diagnostics format error",
                path.basename(diagnosticFile),
                diagnosticFile,
                "Expected a JSON object with a files array.",
                "warning"));
            continue;
        }

        if (typeof parsed.updatedAtUtc === "string" && parsed.updatedAtUtc) {
            projectEntry.updatedAtUtc = parsed.updatedAtUtc;
            if (!state.updatedAtUtc || parsed.updatedAtUtc > state.updatedAtUtc) {
                state.updatedAtUtc = parsed.updatedAtUtc;
            }
        }

        for (const fileEntry of parsed.files) {
            if (!fileEntry || typeof fileEntry.path !== "string" || !Array.isArray(fileEntry.diagnostics)) {
                continue;
            }

            const filePath = resolveBridgeDiagnosticFilePath(fileEntry.path, projectRoot);
            if (!filePath) {
                continue;
            }

            let fileDiagnosticsEntry = projectEntry.fileMap.get(filePath);
            if (!fileDiagnosticsEntry) {
                fileDiagnosticsEntry = createBridgeDiagnosticFileEntry(projectEntry, filePath);
                projectEntry.fileMap.set(filePath, fileDiagnosticsEntry);
            }

            let diagnostics = diagnosticsByFileUri.get(filePath);
            if (!diagnostics) {
                diagnostics = [];
                diagnosticsByFileUri.set(filePath, diagnostics);
            }

            for (const diagnostic of fileEntry.diagnostics) {
                const entry = normalizeBridgeDiagnosticEntry(diagnostic, filePath, projectEntry);
                diagnostics.push(createVsCodeBridgeDiagnostic(entry));
                fileDiagnosticsEntry.diagnosticEntries.push(entry);
                if (fileDiagnosticsEntry.diagnosticEntries.length === 1) {
                    fileDiagnosticsEntry.primaryLine = entry.line;
                    fileDiagnosticsEntry.primaryColumn = entry.column;
                }
                addBridgeDiagnosticCount(fileDiagnosticsEntry.counts, entry.severity);
                addBridgeDiagnosticCount(projectEntry.counts, entry.severity);
                addBridgeDiagnosticCount(state.totals, entry.severity);
            }
        }
    }

    for (const [filePath, diagnostics] of diagnosticsByFileUri.entries()) {
        collection.set(vscode.Uri.file(filePath), diagnostics);
    }

    state.projectEntries = Array.from(projectEntriesByKey.values())
        .map((projectEntry) => {
            projectEntry.fileEntries = Array.from(projectEntry.fileMap.values())
                .filter((fileEntry) => fileEntry.diagnosticEntries.length > 0)
                .sort((left, right) => {
                    const severityDifference = getBridgeDiagnosticSeverityWeightFromCounts(left.counts) - getBridgeDiagnosticSeverityWeightFromCounts(right.counts);
                    if (severityDifference !== 0) {
                        return severityDifference;
                    }
                    return left.relativePath.localeCompare(right.relativePath);
                });
            delete projectEntry.fileMap;
            for (const fileEntry of projectEntry.fileEntries) {
                fileEntry.diagnosticEntries.sort((left, right) => {
                    const severityDifference = getBridgeDiagnosticSeverityWeight(left.severity) - getBridgeDiagnosticSeverityWeight(right.severity);
                    if (severityDifference !== 0) {
                        return severityDifference;
                    }
                    if (left.line !== right.line) {
                        return left.line - right.line;
                    }
                    if (left.column !== right.column) {
                        return left.column - right.column;
                    }
                    return left.label.localeCompare(right.label);
                });
            }
            return projectEntry;
        })
        .filter((projectEntry) => projectEntry.fileEntries.length > 0)
        .sort((left, right) => {
            const severityDifference = getBridgeDiagnosticSeverityWeightFromCounts(left.counts) - getBridgeDiagnosticSeverityWeightFromCounts(right.counts);
            if (severityDifference !== 0) {
                return severityDifference;
            }
            return left.label.localeCompare(right.label);
        });
    state.metaEntries.sort((left, right) => {
        const severityDifference = getBridgeDiagnosticSeverityWeight(left.severity) - getBridgeDiagnosticSeverityWeight(right.severity);
        if (severityDifference !== 0) {
            return severityDifference;
        }
        return left.label.localeCompare(right.label);
    });
}

function getBridgeDiagnosticSeverityWeightFromCounts(counts) {
    if (!counts) {
        return 4;
    }
    if (counts.error > 0) {
        return 0;
    }
    if (counts.warning > 0) {
        return 1;
    }
    if (counts.information > 0) {
        return 2;
    }
    if (counts.hint > 0) {
        return 3;
    }
    return 4;
}

function updateBridgeDiagnosticWatchers(state, onDidChange) {
    if (!state) {
        return;
    }

    const roots = collectKnownProjectRoots();
    const rootsKey = roots.join("|");
    if (state.rootsKey === rootsKey && Array.isArray(state.watchers) && state.watchers.length > 0) {
        return;
    }

    for (const watcher of state.watchers || []) {
        watcher.dispose();
    }

    state.watchers = [];
    state.rootsKey = rootsKey;

    const registerWatcher = (watcher) => {
        watcher.onDidCreate(onDidChange);
        watcher.onDidChange(onDidChange);
        watcher.onDidDelete(onDidChange);
        state.watchers.push(watcher);
    };

    registerWatcher(vscode.workspace.createFileSystemWatcher("**/Saved/DreamShader/Bridge/diagnostics.json"));
    for (const projectRoot of roots) {
        registerWatcher(vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(projectRoot), "Saved/DreamShader/Bridge/diagnostics.json")));
    }
}

function mapSeverity(severity) {
    if (typeof severity !== "string") {
        return vscode.DiagnosticSeverity.Error;
    }

    switch (severity.toLowerCase()) {
        case "warning":
            return vscode.DiagnosticSeverity.Warning;
        case "information":
        case "info":
            return vscode.DiagnosticSeverity.Information;
        case "hint":
            return vscode.DiagnosticSeverity.Hint;
        default:
            return vscode.DiagnosticSeverity.Error;
    }
}

function formatDreamShaderDocument(text) {
    const normalizedText = text.replace(/\r\n/g, "\n");
    const lines = normalizedText.split("\n");
    const formatted = [];
    let indentLevel = 0;

    for (const originalLine of lines) {
        const trimmed = originalLine.trim();
        if (trimmed.length === 0) {
            formatted.push("");
            continue;
        }

        const stripped = stripStringsAndComments(trimmed);
        const startsWithClosingBrace = stripped.startsWith("}");
        if (startsWithClosingBrace) {
            indentLevel = Math.max(0, indentLevel - 1);
        }

        formatted.push(`${INDENT.repeat(indentLevel)}${trimmed}`);

        const openCount = countCharactersOutsideStrings(stripped, "{");
        const closeCount = countCharactersOutsideStrings(stripped, "}");
        indentLevel = Math.max(0, indentLevel + openCount - closeCount);
    }

    return `${formatted.join("\n").replace(/[ \t]+$/gm, "")}\n`;
}

function stripStringsAndComments(text) {
    let result = "";
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (!inString && char === "/" && next === "/") {
            break;
        }

        if (char === "\"") {
            inString = !inString;
            result += " ";
            continue;
        }

        if (inString && char === "\\") {
            result += "  ";
            index += 1;
            continue;
        }

        result += inString ? " " : char;
    }
    return result;
}

function countCharactersOutsideStrings(text, needle) {
    let count = 0;
    for (const char of text) {
        if (char === needle) {
            count += 1;
        }
    }
    return count;
}

function splitTopLevelParameters(text) {
    const parameters = [];
    let current = "";
    let depth = 0;
    let inString = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            current += char;
            if (char === "\\") {
                index += 1;
                if (index < text.length) {
                    current += text[index];
                }
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            current += char;
            continue;
        }

        if (char === "(") {
            depth += 1;
            current += char;
            continue;
        }

        if (char === ")") {
            depth = Math.max(0, depth - 1);
            current += char;
            continue;
        }

        if (char === "," && depth === 0) {
            if (current.trim()) {
                parameters.push(current.trim());
            }
            current = "";
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        parameters.push(current.trim());
    }

    return parameters;
}

function resolveImportPath(currentFilePath, importSpecifier) {
    const normalizedImport = normalizeImportSpecifier(importSpecifier);
    const relativeCandidate = normalizeFsPath(path.resolve(path.dirname(currentFilePath), normalizedImport));
    if (fs.existsSync(relativeCandidate)) {
        return relativeCandidate;
    }

    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        const rootCandidate = normalizeFsPath(path.join(configuredRoot, "DShader", normalizedImport));
        if (fs.existsSync(rootCandidate)) {
            return rootCandidate;
        }

        const packageCandidate = normalizeFsPath(path.join(getPackagesDirectory(configuredRoot), normalizedImport));
        if (fs.existsSync(packageCandidate)) {
            return packageCandidate;
        }

        const builtinCandidate = normalizeFsPath(path.join(configuredRoot, "Plugins", "DreamShader", "Library", normalizedImport));
        if (fs.existsSync(builtinCandidate)) {
            return builtinCandidate;
        }
    }

    const projectRoot = findProjectRoot(currentFilePath);
    if (projectRoot) {
        const rootCandidate = normalizeFsPath(path.join(projectRoot, "DShader", normalizedImport));
        if (fs.existsSync(rootCandidate)) {
            return rootCandidate;
        }

        const packageCandidate = normalizeFsPath(path.join(getPackagesDirectory(projectRoot), normalizedImport));
        if (fs.existsSync(packageCandidate)) {
            return packageCandidate;
        }

        const builtinCandidate = normalizeFsPath(path.join(projectRoot, "Plugins", "DreamShader", "Library", normalizedImport));
        if (fs.existsSync(builtinCandidate)) {
            return builtinCandidate;
        }
    }

    return "";
}

function normalizeImportSpecifier(importSpecifier) {
    let normalized = importSpecifier.trim().replace(/\\/g, "/");
    if (!normalized.toLowerCase().endsWith(".dsh")) {
        normalized += ".dsh";
    }
    return normalized;
}

function getBridgeDiagnosticsFilePath(projectRoot) {
    return path.join(projectRoot, "Saved", "DreamShader", "Bridge", "diagnostics.json");
}

function collectKnownProjectRoots(seedPath = "") {
    const roots = new Set();
    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        roots.add(configuredRoot);
    }

    const candidatePaths = [];
    if (seedPath) {
        candidatePaths.push(seedPath);
    }

    const activeDocument = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    if (activeDocument) {
        candidatePaths.push(activeDocument.uri.fsPath);
    }

    for (const document of vscode.workspace.textDocuments) {
        if (document && typeof document.fileName === "string" && document.fileName) {
            candidatePaths.push(document.fileName);
        }
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
        candidatePaths.push(folder.uri.fsPath);
    }

    for (const candidatePath of candidatePaths) {
        const root = findProjectRootFromCandidate(candidatePath);
        if (root) {
            roots.add(root);
        }
    }

    return Array.from(roots).sort();
}

function findProjectRootFromCandidate(candidatePath) {
    if (!candidatePath) {
        return "";
    }

    let resolvedCandidate = path.resolve(candidatePath);
    try {
        if (!fs.existsSync(resolvedCandidate)) {
            return "";
        }
        if (fs.existsSync(resolvedCandidate) && fs.statSync(resolvedCandidate).isFile()) {
            resolvedCandidate = path.dirname(resolvedCandidate);
        }
    } catch (_error) {
        return "";
    }

    return findProjectRootFromDirectory(resolvedCandidate);
}

function getConfiguredProjectRoot() {
    const configuredRoot = vscode.workspace.getConfiguration("dreamshader").get("projectRoot", "");
    if (!configuredRoot) {
        return "";
    }

    return fs.existsSync(configuredRoot) ? normalizeFsPath(configuredRoot) : "";
}

function findProjectRoot(seedPath) {
    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        return configuredRoot;
    }

    for (const root of collectKnownProjectRoots(seedPath)) {
        return root;
    }

    return "";
}

function findProjectRootFromDirectory(startDirectory) {
    let current = path.resolve(startDirectory);
    while (true) {
        if (containsUproject(current)) {
            return normalizeFsPath(current);
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return "";
        }
        current = parent;
    }
}

function containsUproject(directory) {
    try {
        const entries = fs.readdirSync(directory);
        return entries.some((entry) => entry.toLowerCase().endsWith(".uproject"));
    } catch (_error) {
        return false;
    }
}

function isDreamShaderDocument(document) {
    return document.languageId === LANGUAGE_ID || DREAMSHADER_EXTENSIONS.has(path.extname(document.fileName).toLowerCase());
}

function normalizeFsPath(inputPath) {
    return inputPath.replace(/\\/g, "/");
}

function matchKeywordAt(text, index, keyword) {
    if (text.slice(index, index + keyword.length) !== keyword) {
        return false;
    }

    return isIdentifierBoundary(text[index - 1]) && isIdentifierBoundary(text[index + keyword.length]);
}

function isIdentifierBoundary(char) {
    return !char || !/[A-Za-z0-9_]/.test(char);
}

function isIdentifierStart(char) {
    return Boolean(char) && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
    return Boolean(char) && /[A-Za-z0-9_]/.test(char);
}

function skipWhitespace(text, index) {
    let cursor = index;
    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }
    return cursor;
}

function findMatchingDelimiter(text, openIndex, openChar, closeChar) {
    if (openIndex < 0 || text[openIndex] !== openChar) {
        return -1;
    }

    let depth = 1;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = openIndex + 1; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
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

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === openChar) {
            depth += 1;
        } else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function offsetToPosition(text, offset) {
    const prefix = text.slice(0, offset);
    const lines = prefix.split("\n");
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

module.exports = {
    activate,
    deactivate
};



