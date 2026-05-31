"use strict";

function normalizeSymbolKey(name) {
    return String(name || "").trim().toLowerCase();
}

function param(type, name, placeholder, qualifier = "in") {
    return {
        qualifier,
        type,
        name,
        placeholder: placeholder || name
    };
}

function value(name, placeholder) {
    return param("value", name, placeholder || name);
}

function outValue(name, placeholder) {
    return param("value", name, placeholder || name, "out");
}

function texture(type, name, placeholder) {
    return param(type, name, placeholder || name);
}

function createFunctionBuiltinItem(name, parameters, detail, options = {}) {
    const snippet = options.snippet || `${name}(${parameters.map((parameter, index) => `\${${index + 1}:${parameter.placeholder || parameter.name || "value"}}`).join(", ")})`;
    return {
        name,
        snippet,
        detail,
        documentation: options.documentation || detail,
        category: options.category || "HLSL intrinsic",
        hlslName: options.hlslName || name,
        parameters: parameters.map((parameter) => ({
            qualifier: parameter.qualifier || "in",
            type: parameter.type || "value",
            name: parameter.name || "value"
        })),
        example: options.example || snippet.replace(/\$\{\d+:([^}]+)\}/g, "$1")
    };
}

const UNARY_INTRINSICS = [
    ["abs", "Absolute value."],
    ["acos", "Arc cosine."],
    ["all", "Returns true if all components are non-zero."],
    ["any", "Returns true if any component is non-zero."],
    ["asin", "Arc sine."],
    ["atan", "Arc tangent."],
    ["ceil", "Ceiling."],
    ["clip", "Discards the current pixel when the value is negative."],
    ["cos", "Cosine."],
    ["cosh", "Hyperbolic cosine."],
    ["ddx", "Screen-space derivative in x."],
    ["ddx_coarse", "Coarse screen-space derivative in x."],
    ["ddx_fine", "Fine screen-space derivative in x."],
    ["ddy", "Screen-space derivative in y."],
    ["ddy_coarse", "Coarse screen-space derivative in y."],
    ["ddy_fine", "Fine screen-space derivative in y."],
    ["degrees", "Converts radians to degrees."],
    ["determinant", "Matrix determinant."],
    ["exp", "Base-e exponent."],
    ["exp2", "Base-2 exponent."],
    ["floor", "Floor."],
    ["frac", "Fractional part."],
    ["fwidth", "Sum of absolute screen-space derivatives."],
    ["isfinite", "Tests whether the value is finite."],
    ["isinf", "Tests whether the value is infinite."],
    ["isnan", "Tests whether the value is NaN."],
    ["length", "Vector length."],
    ["lit", "Lighting coefficient helper."],
    ["log", "Natural logarithm."],
    ["log10", "Base-10 logarithm."],
    ["log2", "Base-2 logarithm."],
    ["normalize", "Normalize vector."],
    ["radians", "Converts degrees to radians."],
    ["round", "Rounds to nearest integer."],
    ["rsqrt", "Reciprocal square root."],
    ["saturate", "Clamps to 0..1."],
    ["sign", "Sign of the value."],
    ["sin", "Sine."],
    ["sinh", "Hyperbolic sine."],
    ["sqrt", "Square root."],
    ["tan", "Tangent."],
    ["tanh", "Hyperbolic tangent."],
    ["transpose", "Matrix transpose."],
    ["trunc", "Truncates fractional digits."]
];

const BINARY_INTRINSICS = [
    ["atan2", [value("y"), value("x")], "Arc tangent of y/x."],
    ["cross", [value("a"), value("b")], "Vector cross product."],
    ["distance", [value("a"), value("b")], "Distance between values."],
    ["dot", [value("a"), value("b")], "Vector dot product."],
    ["fmod", [value("x"), value("y")], "Floating-point remainder."],
    ["frexp", [value("x"), outValue("exponent")], "Splits a value into mantissa and exponent."],
    ["ldexp", [value("x"), value("exponent")], "Multiplies by two raised to an exponent."],
    ["max", [value("a"), value("b")], "Maximum."],
    ["min", [value("a"), value("b")], "Minimum."],
    ["modf", [value("x"), outValue("integerPart")], "Splits a value into fractional and integer parts."],
    ["mul", [value("a"), value("b")], "Matrix/vector multiply."],
    ["pow", [value("x"), value("y")], "Power."],
    ["reflect", [value("i"), value("n")], "Reflection vector."],
    ["refract", [value("i"), value("n"), value("eta")], "Refraction vector."]
];

const FUNCTION_BUILTIN_ITEMS = [
    ...UNARY_INTRINSICS.map(([name, detail]) => createFunctionBuiltinItem(name, [value("x")], detail)),
    ...BINARY_INTRINSICS.map(([name, parameters, detail]) => createFunctionBuiltinItem(name, parameters, detail)),
    createFunctionBuiltinItem("clamp", [value("x"), value("minValue"), value("maxValue")], "Clamps a value to a range."),
    createFunctionBuiltinItem("lerp", [value("a"), value("b"), value("alpha")], "Linear interpolation."),
    createFunctionBuiltinItem("smoothstep", [value("minValue"), value("maxValue"), value("x")], "Smooth Hermite interpolation."),
    createFunctionBuiltinItem("step", [value("y"), value("x")], "Step comparison."),
    createFunctionBuiltinItem("sincos", [value("x"), outValue("sine"), outValue("cosine")], "Computes sine and cosine together."),
    createFunctionBuiltinItem("mix", [value("a"), value("b"), value("alpha")], "GLSL-style alias for lerp.", {
        category: "GLSL alias",
        hlslName: "lerp",
        documentation: "GLSL-style alias accepted by DreamShader. Generated HLSL is rewritten to `lerp(a, b, alpha)`."
    }),
    createFunctionBuiltinItem("fract", [value("x")], "GLSL-style alias for frac.", {
        category: "GLSL alias",
        hlslName: "frac",
        documentation: "GLSL-style alias accepted by DreamShader. Generated HLSL is rewritten to `frac(x)`."
    }),
    createFunctionBuiltinItem("mod", [value("x"), value("y")], "GLSL-style alias for fmod.", {
        category: "GLSL alias",
        hlslName: "fmod",
        documentation: "GLSL-style alias accepted by DreamShader. Generated HLSL is rewritten to `fmod(x, y)`."
    }),
    createFunctionBuiltinItem("Texture2DSample", [texture("Texture2D", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uv")], "Samples a Texture2D in HLSL helper code.", {
        category: "Unreal texture helper",
        example: "Texture2DSample(BaseColorTex, BaseColorTexSampler, uv)"
    }),
    createFunctionBuiltinItem("Texture2DSampleLevel", [texture("Texture2D", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uv"), value("level")], "Samples a Texture2D at an explicit mip level.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("Texture2DSampleBias", [texture("Texture2D", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uv"), value("bias")], "Samples a Texture2D with mip bias.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("Texture2DSampleGrad", [texture("Texture2D", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uv"), value("ddx"), value("ddy")], "Samples a Texture2D with explicit gradients.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("Texture2DArraySample", [texture("Texture2DArray", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uv")], "Samples a Texture2DArray in HLSL helper code.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("Texture2DArraySampleLevel", [texture("Texture2DArray", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uv"), value("level")], "Samples a Texture2DArray at an explicit mip level.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("TextureCubeSample", [texture("TextureCube", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("direction")], "Samples a TextureCube in HLSL helper code.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("TextureCubeSampleLevel", [texture("TextureCube", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("direction"), value("level")], "Samples a TextureCube at an explicit mip level.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("Texture3DSample", [texture("VolumeTexture", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uvw")], "Samples a volume texture in HLSL helper code.", {
        category: "Unreal texture helper"
    }),
    createFunctionBuiltinItem("Texture3DSampleLevel", [texture("VolumeTexture", "texture"), texture("SamplerState", "sampler", "textureSampler"), value("uvw"), value("level")], "Samples a volume texture at an explicit mip level.", {
        category: "Unreal texture helper"
    })
];

const FUNCTION_BUILTIN_BY_KEY = new Map();
for (const item of FUNCTION_BUILTIN_ITEMS) {
    FUNCTION_BUILTIN_BY_KEY.set(normalizeSymbolKey(item.name), item);
}

function findFunctionBuiltin(name) {
    return FUNCTION_BUILTIN_BY_KEY.get(normalizeSymbolKey(name)) || null;
}

function isFunctionBuiltinName(name) {
    return Boolean(findFunctionBuiltin(name));
}

module.exports = {
    FUNCTION_BUILTIN_ITEMS,
    findFunctionBuiltin,
    isFunctionBuiltinName
};
