"use strict";

// What a `.dsp` is made of that neither pass-keys.json nor the symbol index lists.
//
// The keys, their values, the injection points, formats and pass kinds are the plugin's, read from pass-keys.json
// (passKeys.js), so this file does not repeat them. What is left is the language's own words, and the names an HLSL
// pass sees -- Docs/runtime/hlsl.md of the plugin: the names the compiler writes around the statements of an entry,
// and the fixed parameters and helpers of DreamPass.ush, which every pass is compiled with.

const DSP_LANGUAGE_ID = "dreamshader-dsp";
const DSP_EXTENSIONS = new Set([".dsp"]);

/** The words that begin a declaration at file scope. */
const DECLARATIONS = [
    { name: "uniform", snippet: "uniform ${1|float,float2,float3,float4,int,bool,Texture2D|} ${2:Name} = ${3:0};", doc: "A parameter an activation can override: `float`-`float4`, `int`, `bool`, `Texture2D` (with `/// @default <asset>`)." },
    { name: "static const", snippet: "static const ${1:float} ${2:Name} = ${3:0};", doc: "A constant, folded where it is used." },
    { name: "buffer", snippet: "buffer ${1:Name} : ${2:R8};", doc: "A texture the passes read and write: `buffer <Name> : <Format>[(<Key> = <Value>, ...)];`" },
    { name: "pass", snippet: "pass ${1:Name} : ${2:fullscreen}\n{\n    $0\n}", doc: "`pass <Name> : <kind> { ... }` -- passes run in declaration order within an injection point." },
    { name: "hlsl", snippet: "hlsl\n{\n    $0\n}", doc: "The file's `hlsl` block, at most one: shared code every pass whose code is in the `.dsp` is compiled with, and the entries a pass names with `Entry = <function>;`." }
];

/** `/// @name` on a pipeline's declarations (Docs/language-v2/passes.md). */
const DIRECTIVES = [
    { name: "group", detail: "@group Category", doc: "The parameter group in the pipeline's details panel." },
    { name: "desc", detail: "@desc text", doc: "The description of a parameter, a buffer or a pass." },
    { name: "slider", detail: "@slider min max", doc: "Slider range of a scalar parameter." },
    { name: "sort", detail: "@sort 10", doc: "Sort priority inside the group." },
    { name: "default", detail: "@default /Game/Textures/T_Default", doc: "The default asset of a `Texture2D` parameter." }
];

/** The member a buffer has: last frame's contents, for a buffer with `History = true`. */
const BUFFER_MEMBERS = [
    { name: "Previous", doc: "Last frame's contents of a buffer declared with `History = true`. `B.Previous` and `B` are two buffers: a pass may read one and write the other." }
];

/** The names the compiler writes around the statements of an entry (a block that holds no whole functions). */
const BODY_NAMES = {
    compute: [
        { name: "Id", type: "uint3", doc: "`SV_DispatchThreadID`: this thread's texel. A thread past `DP_DispatchSize` has returned before the statements." },
        { name: "GroupId", type: "uint3", doc: "`SV_GroupID`." },
        { name: "LocalId", type: "uint3", doc: "`SV_GroupThreadID`." },
        { name: "LocalIndex", type: "uint", doc: "`SV_GroupIndex`." }
    ],
    fullscreen: [
        { name: "SvPosition", type: "float4", doc: "`SV_POSITION`." },
        { name: "Pixel", type: "float2", doc: "The pixel's centre, counted from the view's top left." },
        { name: "UV", type: "float2", doc: "The pixel's place in the view, 0..1." }
    ]
};

function inputs() {
    const names = [];
    for (let index = 0; index < 8; index += 1) {
        names.push({ name: `DP_Input${index}`, kind: "variable", type: "Texture2D<float4>", doc: `The texture of the ${ordinal(index)} \`read\`; an unbound one is black.` });
    }
    for (let index = 0; index < 4; index += 1) {
        names.push({ name: `DP_Output${index}`, kind: "variable", type: "RWTexture2D<float4>", doc: `Compute only: the UAV of the ${ordinal(index)} \`write\`.` });
    }
    return names;
}

function ordinal(index) {
    return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][index] || `#${index}`;
}

/** The fixed parameters and helpers of `/Plugin/DreamShader/Pass/DreamPass.ush`. */
const FIXED_NAMES = [
    ...inputs(),
    { name: "DP_InputSize", kind: "variable", type: "float4[8]", doc: "The `read` textures' sizes (xy) and inverse sizes (zw)." },
    { name: "DP_InputUVRect", kind: "variable", type: "float4[8]", doc: "The UV rect of each `read`'s picture inside its texture (min xy, max zw): (0, 0, 1, 1) for a buffer of the pipeline, a sub-rect for the scene colour in split screen." },
    { name: "DP_OutputSize", kind: "variable", type: "float4[4]", doc: "The outputs' sizes." },
    { name: "DP_Params", kind: "variable", type: "float4[16]", doc: "The packed `param` values." },
    { name: "DP_Weight", kind: "variable", type: "float", doc: "The pipeline's weight in the view." },
    { name: "DP_ViewRect", kind: "variable", type: "int4", doc: "Output 0's rect for this view (min xy, max zw). A buffer of the pipeline starts at 0; the scene colour of one view in split screen does not -- write `Out[DP_ViewRect.xy + Id.xy]`." },
    { name: "DP_DispatchSize", kind: "variable", type: "uint4", doc: "Compute: the threads asked for. A dispatch rounds up to whole groups, so return early past it." },
    { name: "DP_Time", kind: "variable", type: "float4", doc: "World time, world delta time, real time (seconds), frame number. Stands in for `View`'s timing at `BeginView`." },
    { name: "DP_PointClamp", kind: "variable", type: "SamplerState", doc: "A point sampler, clamped." },
    { name: "DP_LinearClamp", kind: "variable", type: "SamplerState", doc: "A linear sampler, clamped." },
    { name: "DreamPassSample", kind: "function", signature: "DreamPassSample(Name, UV)", doc: "The `read` Name sampled (linear) at a UV over the view, inside its picture. A macro: it reads `<Name>UVRect`." },
    { name: "DreamPassLoad", kind: "function", signature: "DreamPassLoad(Name, Pixel)", doc: "A texel of the `read` Name, at a pixel counted from the view's top left." },
    { name: "DreamPassSceneUV", kind: "function", signature: "DreamPassSceneUV(UV)", doc: "A UV over the view as a UV of the scene textures, for `CalcSceneDepth` and the rest. Not at `BeginView`." },
    { name: "DreamPassInputUV", kind: "function", signature: "DreamPassInputUV(i, uv)", doc: "`uv` over input i's picture, as a UV in its texture." },
    { name: "View", kind: "variable", type: "FViewUniformShaderParameters", doc: "The engine's view uniform buffer. It does not exist yet at `BeginView`." },
    { name: "SceneTexturesStruct", kind: "variable", type: "FSceneTextureUniformParameters", doc: "The engine's scene textures: `CalcSceneDepth`, `CalcSceneCustomStencil` and the rest of `SceneTexturesCommon.ush` work. Placeholders at `BeginView`." }
];

module.exports = {
    DSP_LANGUAGE_ID,
    DSP_EXTENSIONS,
    DECLARATIONS,
    DIRECTIVES,
    BUFFER_MEMBERS,
    BODY_NAMES,
    FIXED_NAMES
};
