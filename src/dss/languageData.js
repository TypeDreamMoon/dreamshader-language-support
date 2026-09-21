"use strict";

// What the 2.0 language is made of that no index and no catalog lists: its words.
//
// Kept small on purpose. Everything that depends on the project -- which nodes exist, which functions a
// file can see -- comes from the compiler (catalog.js, indexStore.js); this file is only the grammar's
// own vocabulary, which moves when the language does and not before.

const DSS_LANGUAGE_ID = "dreamshader-dss";
const DSS_EXTENSIONS = new Set([".dss", ".dsi"]);

const KEYWORDS = [
    "uniform", "static", "const", "export", "extern", "struct",
    "in", "out", "inout",
    "if", "else", "for", "while", "do", "return", "break", "continue", "discard",
    "true", "false"
];

const TYPES = [
    "void", "bool", "int", "uint", "float", "half",
    "float2", "float3", "float4", "int2", "int3", "int4", "uint2", "uint3", "uint4", "bool2", "bool3", "bool4",
    "float2x2", "float3x3", "float4x4",
    "Texture2D", "Texture2DArray", "TextureCube", "Texture3D", "SamplerState",
    "material", "Substrate"
];

/** `/// @name value`: what the binder reads out of a doc block, and on what. */
const DIRECTIVES = [
    { name: "group", on: "uniform", detail: "@group Category|Subcategory", doc: "The parameter group in the material instance editor. `|` nests." },
    { name: "desc", on: "any", detail: "@desc text", doc: "The description: a parameter's tooltip, a function's description, an input pin's." },
    { name: "sort", on: "uniform", detail: "@sort 10", doc: "Sort priority inside the group." },
    { name: "slider", on: "uniform", detail: "@slider min max", doc: "Slider range of a scalar parameter." },
    { name: "static", on: "uniform", detail: "@static", doc: "A `uniform bool` becomes a static switch parameter: branches on it are compiled out, not selected." },
    { name: "default", on: "uniform", detail: "@default /Game/Textures/T_Default", doc: "The default asset of a texture parameter." },
    { name: "sampler", on: "uniform", detail: "@sampler Normal", doc: "The sampler type of a texture parameter." },
    { name: "name", on: "any", detail: "@name /Game/Materials/M_Name", doc: "On a product function: the asset path, instead of the one derived from the source path. On a uniform: the parameter's display name." },
    { name: "library", on: "function", detail: "@library Category|Subcategory", doc: "Expose the material function in the material editor's function library, under this category." },
    { name: "param", on: "function", detail: "@param Name text", doc: "The description of one parameter, which becomes the input pin's." },
    { name: "pin", on: "function", detail: "@pin Name Engine Pin Name", doc: "The engine's name for an input pin, when it is no identifier (`Customized UV 0`)." },
    { name: "asset", on: "function", detail: "@asset /Game/Functions/MF_Existing", doc: "On an `extern` prototype: the existing material function asset this declares." },
    { name: "custom", on: "function", detail: "@custom", doc: "The body is HLSL for a Custom node, handed to the shader compiler verbatim." },
    { name: "layer", on: "function", detail: "@layer", doc: "The function is a material layer asset: `export void L(inout material m)`." },
    { name: "layerblend", on: "function", detail: "@layerblend", doc: "The function is a material layer blend asset: `export void B(material Bottom, material Top, inout material Result)`." }
];

const PRAGMAS = [
    { name: "material", snippet: "pragma material(${1:ShadingModel} = ${2:DefaultLit})", doc: "Settings of the material this file builds: `ShadingModel`, `BlendMode`, `Domain`, `TwoSided`, any `UMaterial` property -- plus `Backend = Graph | ThinCustom` and `Substrate = Legacy | Bridge | Native`." },
    { name: "instance", snippet: "pragma instance(Parent = \"${1:/Game/Materials/M_Parent}\")", doc: "A `.dsi` file: the material instance's parent. The `uniform`s below it are the overrides." },
    { name: "region", snippet: "pragma region \"${1:Title}\"\n$0\n#pragma endregion", doc: "A comment box around the nodes of the statements up to `#pragma endregion`." },
    { name: "endregion", snippet: "pragma endregion", doc: "Closes `#pragma region`." },
    { name: "layout", snippet: "pragma layout(Node, Var = ${1:Name}, X = ${2:0}, Y = ${3:0})", doc: "Pins the node a variable's value is at a position, or declares a comment box (`Comment, Text = \"...\", X, Y, Width, Height`)." }
];

const SUBSTRATE_MODES = ["Legacy", "Bridge", "Native"];
const BACKENDS = ["Graph", "ThinCustom"];

module.exports = {
    DSS_LANGUAGE_ID,
    DSS_EXTENSIONS,
    KEYWORDS,
    TYPES,
    DIRECTIVES,
    PRAGMAS,
    SUBSTRATE_MODES,
    BACKENDS
};
