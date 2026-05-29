"use strict";

const DREAMSHADER_KEYWORD_COMPLETIONS = [
    { label: "Shader", insertText: "Shader", detail: "DreamShader top-level block keyword" },
    { label: "Function", insertText: "Function", detail: "DreamShader HLSL helper keyword" },
    { label: "GraphFunction", insertText: "GraphFunction", detail: "DreamShader graph helper keyword" },
    { label: "Namespace", insertText: "Namespace", detail: "DreamShader namespace keyword" },
    { label: "ShaderFunction", insertText: "ShaderFunction", detail: "DreamShader MaterialFunction asset keyword" },
    { label: "ShaderLayer", insertText: "ShaderLayer", detail: "DreamShader Material Layer asset keyword" },
    { label: "ShaderLayerBlend", insertText: "ShaderLayerBlend", detail: "DreamShader Material Layer Blend asset keyword" },
    { label: "VirtualFunction", insertText: "VirtualFunction", detail: "DreamShader external MaterialFunction declaration keyword" },
    { label: "import", insertText: "import", detail: "DreamShader import keyword" }
];

const DREAMSHADER_TEMPLATE_COMPLETIONS = [
    {
        label: "ShaderTemplate",
        detail: "Create a DreamShader material block",
        snippet: "Shader(Name=\"Materials/${1:M_Surface}\", Root=\"${2:Game}\")\n{\n    Properties = {\n        VectorParameter ${3:BaseColor} = float4(0.8, 0.8, 0.8, 1.0) [\n            Group=\"Surface\";\n            SortPriority=10;\n        ];\n        ScalarParameter ${4:Roughness} = 0.55 [\n            Group=\"Surface\";\n            SortPriority=20;\n        ];\n        ScalarParameter ${5:Metallic} = 0.0 [\n            Group=\"Surface\";\n            SortPriority=30;\n        ];\n    }\n\n    Settings = {\n        Domain = \"Surface\";\n        ShadingModel = \"DefaultLit\";\n        BlendMode = \"Opaque\";\n    }\n\n    Outputs = {\n        float3 Color;\n        float Rough;\n        float Metal;\n        Base.BaseColor = Color;\n        Base.Roughness = Rough;\n        Base.Metallic = Metal;\n    }\n\n    Graph = {\n        #Region \"Surface\"\n        Color = ${3:BaseColor}.rgb;\n        Rough = ${4:Roughness};\n        Metal = ${5:Metallic};\n        #EndRegion\n    }\n}"
    },
    {
        label: "FunctionTemplate",
        detail: "Create a reusable DreamShader Function block",
        snippet: "Function ${1:ApplyTint}(in float3 color, in float3 tint, out float3 result) {\n    result = color * tint;\n}"
    },
    {
        label: "SelfContainedFunctionTemplate",
        detail: "Create a SelfContained DreamShader Function block",
        snippet: "Function SelfContained ${1:MyFunction}(in ${2:vec2} ${3:uv}, out ${4:vec4} ${5:result}) {\n    ${5:result} = ${4:vec4}(0.0, 0.0, 0.0, 1.0);\n}"
    },
    {
        label: "GraphFunctionTemplate",
        detail: "Create a DreamShader GraphFunction Custom node helper",
        snippet: "GraphFunction ${1:TimePulse}(in float2 uv, out float pulse) {\n    float t = UE.Time();\n    pulse = saturate(0.5 + 0.5 * sin(uv.x * ${2:8.0} + t));\n}"
    },
    {
        label: "NamespaceTemplate",
        detail: "Create a DreamShader Namespace block",
        snippet: "Namespace(Name=\"${1:Common}\")\n{\n    Function ${2:MyFunction}(in ${3:vec3} ${4:input}, out ${5:vec3} ${6:result}) {\n        ${6:result} = ${4:input};\n    }\n}"
    },
    {
        label: "ImportTemplate",
        detail: "Create a DreamShader .dsh/.dsf import statement",
        snippet: "import \"${1:Shared/Common.dsh}\";"
    },
    {
        label: "ImportFunctionFileTemplate",
        detail: "Import a DreamShader function file",
        snippet: "import \"${1:Functions/F_Tint.dsf}\";"
    },
    {
        label: "ShaderFunctionTemplate",
        detail: "Create a DreamShader MaterialFunction asset",
        snippet: "ShaderFunction(Name=\"Functions/${1:F_Tint}\", Root=\"${2:Game}\")\n{\n    Inputs = {\n        float3 ${3:Color};\n        opt float3 ${4:Tint} = float3(1.0, 1.0, 1.0);\n        opt float ${5:Strength} = 1.0;\n    }\n\n    Outputs = {\n        float3 ${6:Result};\n    }\n\n    Graph = {\n        ${6:Result} = lerp(${3:Color}, ${3:Color} * ${4:Tint}, saturate(${5:Strength}));\n    }\n}"
    },
    {
        label: "ShaderLayerTemplate",
        detail: "Create a native Unreal Material Layer function asset",
        snippet: "ShaderLayer(Name=\"Layers/${1:L_Surface}\", Root=\"${2:Game}\")\n{\n    Properties = {\n        VectorParameter ${3:BaseColor} = float4(0.8, 0.8, 0.8, 1.0) [\n            Group=\"Layer\";\n            SortPriority=10;\n        ];\n        ScalarParameter ${4:Roughness} = 0.55 [\n            Group=\"Layer\";\n            SortPriority=20;\n        ];\n        ScalarParameter ${5:Metallic} = 0.0 [\n            Group=\"Layer\";\n            SortPriority=30;\n        ];\n    }\n\n    Outputs = {\n        MaterialAttributes ${6:Attrs};\n    }\n\n    Graph = {\n        ${6:Attrs}.BaseColor = ${3:BaseColor}.rgb;\n        ${6:Attrs}.Opacity = ${3:BaseColor}.a;\n        ${6:Attrs}.Roughness = ${4:Roughness};\n        ${6:Attrs}.Metallic = ${5:Metallic};\n    }\n}"
    },
    {
        label: "ShaderLayerBlendTemplate",
        detail: "Create a native Unreal Material Layer Blend function asset",
        snippet: "ShaderLayerBlend(Name=\"Layers/${1:LB_AlphaBlend}\", Root=\"${2:Game}\")\n{\n    Inputs = {\n        MaterialAttributes ${3:Base};\n        MaterialAttributes ${4:Layer};\n        opt float ${5:Alpha} = 1.0;\n    }\n\n    Outputs = {\n        MaterialAttributes ${6:Result};\n    }\n\n    Graph = {\n        float alpha = saturate(${5:Alpha});\n        ${6:Result} = ${3:Base};\n        ${6:Result}.BaseColor = lerp(${3:Base}.BaseColor, ${4:Layer}.BaseColor, alpha);\n        ${6:Result}.Roughness = lerp(${3:Base}.Roughness, ${4:Layer}.Roughness, alpha);\n        ${6:Result}.Metallic = lerp(${3:Base}.Metallic, ${4:Layer}.Metallic, alpha);\n        ${6:Result}.Opacity = lerp(${3:Base}.Opacity, ${4:Layer}.Opacity, alpha);\n    }\n}"
    },
    {
        label: "VirtualFunctionTemplate",
        detail: "Declare an existing Unreal MaterialFunction asset",
        snippet: "VirtualFunction(Name=\"${1:MyFunction}\")\n{\n    Options = {\n        Asset = Path(Plugins.${2:PluginName}, \"${3:MaterialFunctions/MyFunction}\");\n    }\n\n    Inputs = {\n        ${4:float} ${5:Value};\n    }\n\n    Outputs = {\n        ${6:float} ${7:Result};\n    }\n}"
    },
    {
        label: "LayoutBlock",
        detail: "Create a DreamShader Layout block",
        snippet: "Layout = {\n    Node(Var=\"${1:Value}\", X=${2:0}, Y=${3:0});\n    Comment(Name=\"${4:Main}\", X=${5:0}, Y=${6:0}, W=${7:1200}, H=${8:700}, Color=float4(${9:0.10}, ${10:0.16}, ${11:0.22}, ${12:0.35}));\n}"
    },
    {
        label: "GraphRegion",
        detail: "Create a named Graph layout region",
        snippet: "#Region \"${1:Main}\"\n$0\n#EndRegion"
    }
];

module.exports = {
    DREAMSHADER_KEYWORD_COMPLETIONS,
    DREAMSHADER_TEMPLATE_COMPLETIONS
};
