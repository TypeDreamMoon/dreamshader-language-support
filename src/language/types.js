"use strict";

const { normalizeSymbolKey } = require("./utils");

const SCALAR_TYPES = new Set(["float", "float1", "half", "half1", "int", "uint", "bool"]);
const VECTOR_TYPES = new Map([
    ["float2", 2], ["float3", 3], ["float4", 4],
    ["half2", 2], ["half3", 3], ["half4", 4],
    ["vec2", 2], ["vec3", 3], ["vec4", 4],
    ["int2", 2], ["int3", 3], ["int4", 4],
    ["uint2", 2], ["uint3", 3], ["uint4", 4],
    ["bool2", 2], ["bool3", 3], ["bool4", 4],
    ["ivec2", 2], ["ivec3", 3], ["ivec4", 4],
    ["uvec2", 2], ["uvec3", 3], ["uvec4", 4],
    ["bvec2", 2], ["bvec3", 3], ["bvec4", 4]
]);
const MATRIX_TYPES = new Set(["float2x2", "float3x3", "float4x4", "mat2", "mat3", "mat4"]);
const TEXTURE_TYPES = new Set(["texture2d", "texturecube", "texture2darray", "samplerstate"]);
const SUBSTRATE_TYPES = new Set([
    "substrate",
    "substratebsdf",
    "substratematerial",
    "substrateslab",
    "substrateclosure",
    "strata",
    "stratabsdf",
    "stratamaterial",
    "strataslab",
    "strataclosure"
]);
const MATERIAL_ATTRIBUTE_MEMBER_TYPES = new Map([
    ["materialattributes", "MaterialAttributes"],
    ["attributes", "MaterialAttributes"],
    ["basecolor", "float3"],
    ["emissivecolor", "float3"],
    ["emissive", "float3"],
    ["opacity", "float"],
    ["opacitymask", "float"],
    ["metallic", "float"],
    ["specular", "float"],
    ["roughness", "float"],
    ["normal", "float3"],
    ["ambientocclusion", "float"],
    ["ao", "float"],
    ["refraction", "float3"],
    ["worldpositionoffset", "float3"],
    ["wpo", "float3"],
    ["pixeldepthoffset", "float"],
    ["pdo", "float"],
    ["subsurfacecolor", "float3"],
    ["clearcoat", "float"],
    ["clearcoatroughness", "float"],
    ["customdata0", "float"],
    ["customdata1", "float"],
    ["diffusecolor", "float3"],
    ["specularcolor", "float3"],
    ["surfacethickness", "float"],
    ["displacement", "float"],
    ["anisotropy", "float"],
    ["tangent", "float3"],
    ["mooaencodedattribute0", "float4"],
    ["mooaencodedattribute1", "float4"],
    ["mooaencodedattribute2", "float4"],
    ["mooaencodedattribute3", "float4"],
    ["mooaencodedattribute4", "float4"]
]);
for (let index = 0; index <= 7; index += 1) {
    MATERIAL_ATTRIBUTE_MEMBER_TYPES.set(`customizeduv${index}`, "float2");
    MATERIAL_ATTRIBUTE_MEMBER_TYPES.set(`customizeduvs${index}`, "float2");
}
const PARAMETER_TYPES = new Set([
    "scalarparameter", "vectorparameter", "doublevectorparameter", "staticboolparameter", "staticswitchparameter",
    "textureobjectparameter", "texturesampleparameter2d", "texturesampleparameter2darray", "texturesampleparametercube",
    "texturesampleparametercubearray", "texturesampleparametervolume", "texturesampleparametersubuv",
    "runtimevirtualtexturesampleparameter", "sparsevolumetexturesampleparameter", "sparsevolumetextureobjectparameter",
    "channelmaskparameter", "staticcomponentmaskparameter", "texturecollectionparameter", "curveatlasrowparameter",
    "dynamicparameter", "fontsampleparameter", "spritetexturesampler"
]);
const PARAMETER_TYPE_INFOS = new Map([
    ["scalarparameter", { type: "scalarparameter", componentCount: 1, isParameter: true }],
    ["staticboolparameter", { type: "staticboolparameter", componentCount: 1, isParameter: true }],
    ["staticswitchparameter", { type: "staticswitchparameter", componentCount: 1, isParameter: true, isStaticSwitch: true }],
    ["vectorparameter", { type: "vectorparameter", componentCount: 4, isParameter: true }],
    ["doublevectorparameter", { type: "doublevectorparameter", componentCount: 4, isParameter: true }],
    ["channelmaskparameter", { type: "channelmaskparameter", componentCount: 1, isParameter: true }],
    ["staticcomponentmaskparameter", { type: "staticcomponentmaskparameter", componentCount: 4, isParameter: true }],
    ["dynamicparameter", { type: "dynamicparameter", componentCount: 4, isParameter: true }],
    ["fontsampleparameter", { type: "fontsampleparameter", componentCount: 4, isParameter: true }],
    ["curveatlasrowparameter", { type: "curveatlasrowparameter", componentCount: 3, isParameter: true }],
    ["spritetexturesampler", { type: "spritetexturesampler", componentCount: 4, isParameter: true }],
    ["textureobjectparameter", { type: "textureobjectparameter", isParameter: true, isTexture: true }],
    ["texturecollectionparameter", { type: "texturecollectionparameter", isParameter: true, isTexture: true }],
    ["sparsevolumetextureobjectparameter", { type: "sparsevolumetextureobjectparameter", isParameter: true, isTexture: true }],
    ["texturesampleparameter2d", { type: "texturesampleparameter2d", componentCount: 4, isParameter: true }],
    ["texturesampleparameter2darray", { type: "texturesampleparameter2darray", componentCount: 4, isParameter: true }],
    ["texturesampleparametercube", { type: "texturesampleparametercube", componentCount: 4, isParameter: true }],
    ["texturesampleparametercubearray", { type: "texturesampleparametercubearray", componentCount: 4, isParameter: true }],
    ["texturesampleparametervolume", { type: "texturesampleparametervolume", componentCount: 4, isParameter: true }],
    ["texturesampleparametersubuv", { type: "texturesampleparametersubuv", componentCount: 4, isParameter: true }],
    ["runtimevirtualtexturesampleparameter", { type: "runtimevirtualtexturesampleparameter", componentCount: 4, isParameter: true }],
    ["sparsevolumetexturesampleparameter", { type: "sparsevolumetexturesampleparameter", componentCount: 4, isParameter: true }]
]);

function resolveTypeInfo(typeText) {
    const key = normalizeSymbolKey(typeText).replace(/\s+/g, "");
    if (!key) {
        return null;
    }
    if (SCALAR_TYPES.has(key)) {
        return { type: key, componentCount: 1 };
    }
    if (VECTOR_TYPES.has(key)) {
        return { type: key, componentCount: VECTOR_TYPES.get(key) };
    }
    if (MATRIX_TYPES.has(key)) {
        return { type: key, isMatrix: true };
    }
    if (TEXTURE_TYPES.has(key)) {
        return { type: key, isTexture: true };
    }
    if (PARAMETER_TYPES.has(key)) {
        return PARAMETER_TYPE_INFOS.get(key) || { type: key, isParameter: true, isStaticSwitch: key === "staticswitchparameter" };
    }
    if (key === "materialattributes") {
        return { type: key, isMaterialAttributes: true };
    }
    if (SUBSTRATE_TYPES.has(key)) {
        return { type: key, isSubstrate: true, isMaterialAttributes: true };
    }
    if (key === "void") {
        return { type: key, isVoid: true };
    }
    return null;
}

function isTypeName(typeText) {
    return Boolean(resolveTypeInfo(typeText));
}

function getMaterialAttributeMemberType(memberName) {
    return MATERIAL_ATTRIBUTE_MEMBER_TYPES.get(normalizeSymbolKey(memberName)) || "";
}

function areTypesCompatible(leftType, rightType) {
    const left = resolveTypeInfo(leftType);
    const right = resolveTypeInfo(rightType);
    if (!left || !right) {
        return true;
    }
    if (left.isMaterialAttributes || right.isMaterialAttributes) {
        return Boolean(left.isMaterialAttributes) === Boolean(right.isMaterialAttributes);
    }
    if (left.isTexture || right.isTexture) {
        return Boolean(left.isTexture) === Boolean(right.isTexture);
    }
    if (left.componentCount && right.componentCount) {
        return left.componentCount === right.componentCount || left.componentCount === 1 || right.componentCount === 1;
    }
    return true;
}

module.exports = {
    resolveTypeInfo,
    isTypeName,
    getMaterialAttributeMemberType,
    areTypesCompatible
};
