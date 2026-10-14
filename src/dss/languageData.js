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
    { name: "layerblend", on: "function", detail: "@layerblend", doc: "The function is a material layer blend asset: `export void B(material Bottom, material Top, inout material Result)`." },
    { name: "root", on: "function", detail: "@root Game", doc: "The 1.x `Root=` of the block a migrated function came from: `Game`, `Engine`, `Plugin.Name`, `/Mount`. `dsc migrate` writes it." },
    { name: "generate", on: "function", detail: "@generate Folder/MF_Name", doc: "In a package's header: the material function asset to generate from this function, under the package's asset root. `@generate none` opts it out of a `#pragma generate`. Anywhere else it does nothing (DSH7234)." },
    { name: "nogeneration", on: "function", detail: "@nogeneration", doc: "On an `export`: only a compile that names the file builds its asset -- not the startup sweep, a save, a dependency's rebuild, `compile -All` or a cook. Whatever uses it uses the asset on disk." }
];

const PRAGMAS = [
    { name: "material", snippet: "pragma material(${1:ShadingModel} = ${2:DefaultLit})", doc: "Settings of the material this file builds: `ShadingModel`, `BlendMode`, `Domain`, `TwoSided`, any `UMaterial` property -- plus `Backend = Graph | ThinCustom` and `Substrate = Legacy | Bridge | Native`." },
    { name: "instance", snippet: "pragma instance(Parent = \"${1:/Game/Materials/M_Parent}\")", doc: "A `.dsi` file: the material instance's parent. The `uniform`s below it are the overrides." },
    { name: "region", snippet: "pragma region \"${1:Title}\"\n$0\n#pragma endregion", doc: "A comment box around the nodes of the statements up to `#pragma endregion`." },
    { name: "endregion", snippet: "pragma endregion", doc: "Closes `#pragma region`." },
    { name: "layout", snippet: "pragma layout(Node, Var = ${1:Name}, X = ${2:0}, Y = ${3:0})", doc: "Pins the node a variable's value is at a position, or declares a comment box (`Comment, Text = \"...\", X, Y, Width, Height`)." },
    { name: "generate", snippet: "pragma generate(Functions = \"${1:MF_}{Name}\", Library = \"${2:Category}\")", doc: "In a package's header: every function after it with a body and no linkage keyword generates a material function, named by the template (`{Name}` is the function's name). `/// @generate` on one function overrides it; `@generate none` opts out." },
    { name: "nogeneration", snippet: "pragma nogeneration", doc: "Every asset this file builds is built only by a compile that names the file (*Compile* in the Material Content Browser, `compile -Source`). The startup sweep, a save, a dependency's rebuild, `compile -All` and a cook leave it as it is on disk." },
    { name: "disable_warning", snippet: "pragma disable_warning(${1:DSH0000})", doc: "These warnings are not reported -- anywhere in this file, and in the file being compiled for everything the compile reports. `// disable_warning DSHnnnn` disables one line." },
    { name: "disable_error", snippet: "pragma disable_error(${1:DSH0000})", doc: "These errors are not reported and do not fail the compile. A stage that cannot go on without one still stops, and then the error is reported after all. `// disable_error DSHnnnn` disables one line." }
];

/** `// disable_warning DSHnnnn` / `// disable_error DSHnnnn`: one line's list, in either language. */
const DISABLE_COMMENTS = [
    { name: "disable_warning", doc: "These warnings are not reported on this line -- or, alone on its line, on the next line that holds code." },
    { name: "disable_error", doc: "These errors are not reported, and do not fail the compile, on this line -- or, alone on its line, on the next line that holds code." }
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
    DISABLE_COMMENTS,
    SUBSTRATE_MODES,
    BACKENDS
};
