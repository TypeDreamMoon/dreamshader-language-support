# DreamShaderLang Language Support

VS Code language support for DreamShaderLang `.dsm` material files, `.dsf` function files, and `.dsh` shared headers.

> 中文文档: [README.zh-CN.md](./README.zh-CN.md)

## Overview

DreamShaderLang is a material authoring language for the DreamShader Unreal Engine plugin. This extension provides syntax highlighting, completion, symbols, folding, local diagnostics, bridge diagnostics, package tooling, and authoring templates for DreamShader source files.

Version `1.4.5` keeps reflected `UE.Expression(Class="...")` completion available through project bridge manifests, an optional explicit manifest path, and a bundled fallback manifest loaded by the language core. `UE.` MaterialExpression short-name completions such as `Abs` expand directly to stable `UE.Expression(Class="Abs", ...)` snippets. Completion, diagnostics, document symbols, folding, and semantic tokens use a scanner/parser/context pipeline instead of the previous regex-heavy path, which makes section scope handling much more predictable.

## Highlights

- `.dsm`, `.dsf`, and `.dsh` file association.
- Syntax highlighting and semantic tokens for blocks, sections, types, variables, parameters, UE graph calls, and material outputs.
- Context-aware completion for `Shader`, `ShaderFunction`, `ShaderLayer`, `ShaderLayerBlend`, `VirtualFunction`, `Function`, `GraphFunction`, and `Namespace`.
- Section-aware completion for `Properties`, `Inputs`, `Outputs`, `Settings`, `Options`, and `Graph`.
- Type completion in declarations, function signatures, Graph code, and HLSL helper code.
- UE graph node completion with `UE.` member suggestions.
- HLSL intrinsic completion inside `Function` and graph-like code.
- `Base.` output completion that inserts only the selected material output member.
- `MaterialAttributes` member completion such as `BaseColor`, `Roughness`, `Metallic`, `Normal`, and `Opacity`.
- Settings value completion for `Domain`, `MaterialDomain`, `ShadingModel`, `BlendMode`, and `RenderType`.
- Metadata completion for declaration reflection blocks such as `Group`, `SortPriority`, `Description`, `SamplerType`, `GatherMode`, and texture sampling options.
- Import path completion and clickable import links for `.dsh` shared headers and `.dsf` function files.
- `.dsf` file-shape diagnostics for reusable `ShaderFunction`, `Function`, `GraphFunction`, `Namespace`, and `VirtualFunction` declarations.
- Go to Definition, Find References, Hover, Signature Help, Inlay Hints, document formatting, folding, and document symbols.
- Bridge diagnostics panel for Unreal-side DreamShader compiler diagnostics.
- Package commands for installing, browsing, updating, and removing DreamShader packages.

## Supported Keywords

Active top-level keywords:

```dreamshader
import
Shader
ShaderFunction
ShaderLayer
ShaderLayerBlend
VirtualFunction
Function
GraphFunction
Namespace
```

`MaterialLayer` and `MaterialLayerBlend` are intentionally not active language keywords anymore. Use `ShaderLayer` and `ShaderLayerBlend`.

## Quick Example

```dreamshader
Shader(Name="Materials/M_Example", Root="Game")
{
    Properties = {
        VectorParameter BaseColor = float4(0.8, 0.8, 0.8, 1.0) [
            Group="Surface";
            SortPriority=10;
        ];
        ScalarParameter Roughness = 0.55;
    }

    Settings = {
        Domain = "Surface";
        ShadingModel = "DefaultLit";
        BlendMode = "Opaque";
    }

    Outputs = {
        float3 Color;
        float Rough;
        Base.BaseColor = Color;
        Base.Roughness = Rough;
    }

    Graph = {
        Color = BaseColor.rgb;
        Rough = saturate(Roughness);
    }
}
```

## Dream Shader Function Files

Use `.dsf` files for reusable generated material functions and function helpers:

```dreamshader
ShaderFunction(Name="Functions/F_PulseTint")
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
}
```

Import and call multi-output functions with positional inputs followed by output variables:

```dreamshader
import "Functions/F_PulseTint.dsf";

Graph = {
    F_PulseTint(BaseColor.rgb, Tint, Pulse, Strength, Color, Mask);
}
```

## Templates

The extension contributes file and code templates for common DreamShader authoring tasks:

- `ShaderTemplate`: material asset source.
- `ShaderFunctionTemplate`: generated Material Function.
- `ShaderLayerTemplate`: Unreal Material Layer function asset.
- `ShaderLayerBlendTemplate`: Unreal Material Layer Blend function asset.
- `VirtualFunctionTemplate`: declaration for an existing Unreal Material Function asset.
- `FunctionTemplate`: reusable HLSL helper.
- `SelfContainedFunctionTemplate`: embedded helper function.
- `GraphFunctionTemplate`: reusable graph helper that may call `UE.*` nodes.
- `NamespaceTemplate`: grouped helper functions.
- `ImportTemplate`: shared header or function file import.
- `ImportFunctionFileTemplate`: `.dsf` function file import.

The active templates use `ShaderLayer` and `ShaderLayerBlend`; the old `MaterialLayer` / `MaterialLayerBlend` names are not suggested.

## Commands

Available commands include:

- `DreamShaderLang: Recompile Current Source`
- `DreamShaderLang: Recompile All Sources`
- `DreamShaderLang: Clean Generated Shaders`
- `DreamShaderLang: Show Bridge Panel`
- `DreamShaderLang: Refresh Bridge Diagnostics`
- `DreamShaderLang: Install Package from GitHub`
- `DreamShaderLang: Browse Package Store`
- `DreamShaderLang: Update Installed Packages`
- `DreamShaderLang: Remove Package`
- `DreamShaderLang: Open Packages Folder`
- `DreamShaderLang: Create Package Step by Step`
- `DreamShaderLang: Create DreamShader Material`
- `DreamShaderLang: Create DreamShader Function File`
- `DreamShaderLang: Create DreamShader Header`
- `DreamShaderLang: Create DreamShader Texture Sample`
- `DreamShaderLang: Create DreamShader Noise Material`

## Settings

```json
{
  "dreamshader.projectRoot": "",
  "dreamshader.materialExpressionManifestPath": "",
  "dreamshader.packageStoreIndexUrls": [
    "https://raw.githubusercontent.com/TypeDreamMoon/dreamshader-package-index/main/packages.json"
  ],
  "dreamshader.enableGitHubPackageSearch": true,
  "dreamshader.showStatusBar": true,
  "dreamshader.enableCodeLens": true
}
```

`dreamshader.projectRoot` can be left empty in most workspaces. The extension tries to auto-detect the Unreal project root from the active DreamShader file or workspace.

`dreamshader.materialExpressionManifestPath` can point directly at a generated `Saved/DreamShader/Bridge/material-expressions.json`. Leave it empty to use the active project's bridge manifest plus the bundled fallback manifest.

## Bridge Diagnostics

When used with the DreamShader Unreal plugin, the extension reads bridge diagnostic files generated under the project `Saved/DreamShader/Bridge` directory. Diagnostics are shown both inline and in the DreamShader Bridge panel.

The extension can still discover bridge output when the opened workspace is the project `DShader` directory.

## Development

Install dependencies:

```powershell
npm install
```

Run language smoke tests:

```powershell
npm run test:language
```

Package the extension:

```powershell
npm run package
```

The packaged VSIX is generated as:

```text
dreamshaderlang-language-support-1.4.2.vsix
```

## License

MIT. Copyright (c) 2026 TypeDreamMoon.
