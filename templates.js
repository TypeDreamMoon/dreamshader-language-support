"use strict";

const DREAMSHADER_KEYWORD_COMPLETIONS = [
    { label: "Shader", insertText: "Shader", detail: "DreamShader top-level block keyword" },
    { label: "Function", insertText: "Function", detail: "DreamShader HLSL helper keyword" },
    { label: "GraphFunction", insertText: "GraphFunction", detail: "DreamShader graph helper keyword" },
    { label: "Namespace", insertText: "Namespace", detail: "DreamShader namespace keyword" },
    { label: "ShaderFunction", insertText: "ShaderFunction", detail: "DreamShader MaterialFunction asset keyword" },
    { label: "MaterialLayer", insertText: "MaterialLayer", detail: "DreamShader Material Layer asset keyword" },
    { label: "MaterialLayerBlend", insertText: "MaterialLayerBlend", detail: "DreamShader Material Layer Blend asset keyword" },
    { label: "VirtualFunction", insertText: "VirtualFunction", detail: "DreamShader external MaterialFunction declaration keyword" },
    { label: "import", insertText: "import", detail: "DreamShader import keyword" }
];

const DREAMSHADER_TEMPLATE_COMPLETIONS = [
    {
        label: "ShaderTemplate",
        detail: "Create a DreamShader material block",
        snippet: "Shader(Name=\"Materials/${1:MyMaterial}\", Root=\"${2:Game}\")\n{\n    $0\n}"
    },
    {
        label: "FunctionTemplate",
        detail: "Create a reusable DreamShader Function block",
        snippet: "Function NewFuntion(out float3 OutColor) {\n    OutColor = float3(1.0, 0.0, 0.0);\n}"
    },
    {
        label: "SelfContainedFunctionTemplate",
        detail: "Create a SelfContained DreamShader Function block",
        snippet: "Function SelfContained ${1:MyFunction}(in ${2:vec2} ${3:uv}, out ${4:vec4} ${5:result}) {\n    ${5:result} = ${4:vec4}(0.0, 0.0, 0.0, 1.0);\n}"
    },
    {
        label: "GraphFunctionTemplate",
        detail: "Create a DreamShader GraphFunction Custom node helper",
        snippet: "GraphFunction NewGraphFunction(out float3 OutColor) {\n    OutColor = float3(1.0, 0.0, 0.0);\n}"
    },
    {
        label: "NamespaceTemplate",
        detail: "Create a DreamShader Namespace block",
        snippet: "Namespace(Name=\"${1:Common}\")\n{\n    Function ${2:MyFunction}(in ${3:vec3} ${4:input}, out ${5:vec3} ${6:result}) {\n        ${6:result} = ${4:input};\n    }\n}"
    },
    {
        label: "ImportTemplate",
        detail: "Create a DreamShader import statement",
        snippet: "import \"${1:Shared/Common.dsh}\";"
    },
    {
        label: "ShaderFunctionTemplate",
        detail: "Create a DreamShader MaterialFunction asset",
        snippet: "ShaderFunction(Name=\"Functions/${1:MyFunction}\", Root=\"${2:Game}\")\n{\n    Properties = {\n        const Texture2D ${3:PreviewTex};\n    }\n\n    Inputs = {\n        opt Texture2D ${4:InputTex} = ${3:PreviewTex};\n    }\n\n    Outputs = {\n        ${5:float4} ${6:Result};\n    }\n\n    Graph = {\n        ${6:Result} = ${5:float4}(1.0, 1.0, 1.0, 1.0);\n    }\n}"
    },
    {
        label: "MaterialLayerTemplate",
        detail: "Create a native Unreal Material Layer function asset",
        snippet: "MaterialLayer(Name=\"Layers/${1:ML_MyLayer}\", Root=\"${2:Game}\")\n{\n    Properties = {\n        VectorParameter ${3:BaseColor} = float4(0.8, 0.8, 0.8, 1.0);\n    }\n\n    Outputs = {\n        MaterialAttributes ${4:Result};\n    }\n\n    Graph = {\n        ${4:Result}.BaseColor = ${3:BaseColor}.rgb;\n        ${4:Result}.Opacity = ${3:BaseColor}.a;\n        ${4:Result}.Roughness = 0.5;\n    }\n}"
    },
    {
        label: "MaterialLayerBlendTemplate",
        detail: "Create a native Unreal Material Layer Blend function asset",
        snippet: "MaterialLayerBlend(Name=\"Layers/${1:MLB_MyBlend}\", Root=\"${2:Game}\")\n{\n    Inputs = {\n        MaterialAttributes ${3:Base};\n        MaterialAttributes ${4:Layer};\n        opt float ${5:Alpha} = 1.0;\n    }\n\n    Outputs = {\n        MaterialAttributes ${6:Result};\n    }\n\n    Graph = {\n        ${6:Result} = ${4:Layer};\n    }\n}"
    },
    {
        label: "VirtualFunctionTemplate",
        detail: "Declare an existing Unreal MaterialFunction asset",
        snippet: "VirtualFunction(Name=\"${1:MyFunction}\")\n{\n    Options = {\n        Asset = Path(Plugins.${2:PluginName}, ${3:MaterialFunctions/MyFunction});\n    }\n\n    Inputs = {\n        ${4:float} ${5:Value};\n    }\n\n    Outputs = {\n        ${6:float} ${7:Result};\n    }\n}"
    }
];

module.exports = {
    DREAMSHADER_KEYWORD_COMPLETIONS,
    DREAMSHADER_TEMPLATE_COMPLETIONS
};
