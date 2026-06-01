"use strict";

const path = require("path");

function getTemplateSpec(kind) {
    const specs = {
        material: {
            title: "Create DreamShader Material",
            prompt: "Relative .dsm path under DShader.",
            placeHolder: "Materials/M_NewMaterial.dsm",
            extension: ".dsm"
        },
        functionFile: {
            title: "Create DreamShader Function File",
            prompt: "Relative .dsf path under DShader.",
            placeHolder: "Functions/F_NewFunction.dsf",
            extension: ".dsf"
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

    return specs[kind] || null;
}

function normalizeTemplateRelativePath(value, extension) {
    let result = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!result) {
        return "";
    }
    if (path.extname(result).toLowerCase() !== extension) {
        result += extension;
    }
    return result;
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
    const withoutExtension = relativePath.replace(/\\/g, "/").replace(/\.(dsm|dsf|dsh)$/i, "");
    return withoutExtension.includes("/")
        ? withoutExtension
        : `Materials/${withoutExtension}`;
}

function buildTemplate(kind, relativePath) {
    const symbolName = getTemplateSymbolName(relativePath, "DreamShaderExample");
    const shaderName = getTemplateShaderAssetPath(relativePath);
    if (kind === "header") {
        return `Namespace(Name="${symbolName}")
{
    Function Identity(in float3 input, out float3 result) {
        result = input;
    }

    Function ApplyTint(in float3 color, in float3 tint, out float3 result) {
        result = color * tint;
    }

    Function Remap01(in float value, in float inMin, in float inMax, out float result) {
        result = saturate((value - inMin) / max(inMax - inMin, 0.0001));
    }
}
`;
    }

    if (kind === "functionFile") {
        return `ShaderFunction(Name="Functions/${symbolName}")
{
    Inputs = {
        vec3 Color;
        float Strength;
    }

    Outputs = {
        vec3 Result;
    }

    Graph = {
        Result = Color * Strength;
    }
}
`;
    }

    if (kind === "texture") {
        return `import "Builtin/Texture.dsh";

Shader(Name="${shaderName}")
{
    Properties = {
        TextureSampleParameter2D BaseMap = Path(Engine, "/EngineResources/DefaultTexture") [
            Group="Textures";
            SortPriority=10;
            SamplerType="Color";
        ];
        VectorParameter Tint = float4(1.0, 1.0, 1.0, 1.0) [
            Group="Surface";
            SortPriority=20;
        ];
        ScalarParameter Tiling = 1.0 [
            Group="UV";
            SortPriority=30;
        ];
        ScalarParameter Roughness = 0.55 [
            Group="Surface";
            SortPriority=40;
        ];
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "DefaultLit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Color;
        float Rough;
        Base.BaseColor = Color;
        Base.Roughness = Rough;
    }

    Graph = {
        vec2 uv = UE.TexCoord(Index=0) * Tiling;
        vec3 sampledColor;
        Texture::Sample2DRGB(BaseMap, uv, sampledColor);
        Color = sampledColor * Tint.rgb;
        Rough = Roughness;
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
        float Contrast = 1.0;
        VectorParameter LowColor = float4(0.05, 0.08, 0.12, 1.0) [
            Group="Noise";
            SortPriority=10;
        ];
        VectorParameter HighColor = float4(0.8, 0.95, 1.0, 1.0) [
            Group="Noise";
            SortPriority=20;
        ];
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
        float mask = saturate((noiseValue - 0.5) * Contrast + 0.5);
        Color = lerp(LowColor.rgb, HighColor.rgb, mask);
    }
}
`;
    }

    return `Shader(Name="${shaderName}")
{
    Properties = {
        VectorParameter BaseColor = float4(1.0, 0.45, 0.2, 1.0) [
            Group="Surface";
            SortPriority=10;
        ];
        ScalarParameter Roughness = 0.55 [
            Group="Surface";
            SortPriority=20;
        ];
        ScalarParameter Metallic = 0.0 [
            Group="Surface";
            SortPriority=30;
        ];
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "DefaultLit";
        BlendMode = "Opaque";
    }

    Outputs = {
        vec3 Color;
        float Rough;
        float Metal;
        Base.BaseColor = Color;
        Base.Roughness = Rough;
        Base.Metallic = Metal;
    }

    Graph = {
        Color = BaseColor.rgb;
        Rough = Roughness;
        Metal = Metallic;
    }
}
`;
}

module.exports = {
    buildTemplate,
    getTemplateSpec,
    isSafeRelativePath,
    normalizeTemplateRelativePath
};
