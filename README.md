# DreamShaderLang Language Support

VS Code language support for DreamShaderLang `.dsm` material files, `.dsf` function files, and `.dsh` shared headers.

> 中文文档: [README.zh-CN.md](./README.zh-CN.md)

## Overview

DreamShaderLang is a material authoring language for the DreamShader Unreal Engine plugin. This extension provides syntax highlighting, completion, symbols, folding, local diagnostics, bridge diagnostics, package tooling, and authoring templates for DreamShader source files.

The language features run in a language server, and the diagnostics it reports are checked against
the compiler's own test corpus: nothing it accepts is flagged here, and the rules this half owns
carry the compiler's `DSHnnnn` codes so a Problems entry links to the page documenting it. What the
compiler alone can decide — does this asset exist, does this type check — stays with the compiler
and arrives through the bridge, because two sources of truth on one question drift.

The full DreamShaderLang 1.5 syntax is supported: `Group("Name") { ... }` property scopes,
single-output return-value functions (`Function float Luma(...) { return ...; }`), the optional `=`
between a section name and its body, the `Slider(min, max)` metadata shorthand, and bare
`"/Game/..."` asset paths. Template blocks, bridge commands, package tooling, Function builtin
metadata, UE 5.7 `Substrate.*` graph helpers and `Base.FrontMaterial` outputs stay synced with the
current DreamShader plugin.

See the [changelog](./CHANGELOG.md) for what each release changed.

## Highlights

- `.dsm`, `.dsf`, and `.dsh` file association.
- Syntax highlighting and semantic tokens for blocks, sections, types, variables, parameters, UE graph calls, and material outputs.
- Context-aware completion for `Shader`, `ShaderFunction`, `ShaderLayer`, `ShaderLayerBlend`, `VirtualFunction`, `Function`, `GraphFunction`, and `Namespace`.
- Section-aware completion for `Properties`, `Inputs`, `Outputs`, `Settings`, `Options`, `Graph`, and `Layout`.
- DreamShaderLang 1.5 syntax: `Group("Name") { ... }` property scopes (with the `propgroup` snippet), single-output return-value `Function`/`GraphFunction` declarations, the optional `=` between a section name and its body, the `Slider(min, max)` metadata shorthand, and bare `"/Game/..."` asset paths in a parameter's `=` slot.
- Type completion in declarations, function signatures, Graph code, and HLSL helper code.
- UE graph node completion with `UE.` member suggestions.
- UE 5.7 Substrate graph completion with `Substrate.` member suggestions and `Base.FrontMaterial` output support.
- HLSL intrinsic, GLSL alias, and Unreal texture helper completion inside `Function` and graph-like code.
- `Base.` output completion that inserts only the selected material output member.
- `MaterialAttributes` member completion such as `BaseColor`, `Roughness`, `Metallic`, `Normal`, and `Opacity`.
- Settings value completion for `Domain`, `MaterialDomain`, `ShadingModel`, `BlendMode`, and `RenderType`.
- Metadata completion for declaration reflection blocks such as `Group`, `SortPriority`, `Description`, `SamplerType`, `GatherMode`, and texture sampling options.
- Layout authoring support for `Layout = { Node(...); Comment(...); }` and Graph `#Region` / `#EndRegion` directives.
- Import path completion and clickable import links for `.dsh` shared headers and `.dsf` function files, resolved per source root — the project's `DShader` and each plugin's — including the `Project:` / `Plugin.<Name>:` qualifiers that cross between them.
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
        VolumeTexture NoiseVolume = Path(Game, "Textures/T_NoiseVolume");
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
        #Region "Surface"
        Color = BaseColor.rgb;
        Rough = saturate(Roughness);
        #EndRegion
    }

    Layout = {
        Comment(Name="Surface", X=-400, Y=-260, W=1200, H=700, Color=float4(0.10, 0.16, 0.22, 0.35));
        Node(Var="BaseColor", X=-240, Y=-80);
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

## Substrate Graph Helpers

Substrate materials can bind a `Substrate` graph value to `Base.FrontMaterial`:

```dreamshader
Shader(Name="Materials/M_Substrate")
{
    Settings = {
        ShadingModel = "Substrate";
    }

    Outputs = {
        Substrate Surface;
        Base.FrontMaterial = Surface;
    }

    Graph = {
        Surface = Substrate.Unlit(EmissiveColor=float3(0.1, 0.6, 1.0));
    }
}
```

The extension completes DreamShader's current `Substrate.*` wrappers, including `Unlit`, `Slab`, `ConvertMaterialAttributes`, `HorizontalMix`, `VerticalLayer`, `Add`, `Weight`, `Select`, `ThinFilm`, and related UE 5.7 Substrate helpers.

## Function Builtins

`Function` blocks are HLSL-style helper code. The extension provides completion, hover, signature help, semantic highlighting, and local diagnostic allow-list coverage for these builtins.

HLSL intrinsics:

```text
abs, acos, all, any, asin, atan, atan2, ceil, clamp, clip, cos, cosh, cross,
ddx, ddx_coarse, ddx_fine, ddy, ddy_coarse, ddy_fine, degrees, determinant,
distance, dot, exp, exp2, floor, fmod, frac, frexp, fwidth, isfinite, isinf,
isnan, ldexp, length, lerp, lit, log, log10, log2, max, min, modf, mul,
normalize, pow, radians, reflect, refract, round, rsqrt, saturate, sign, sin,
sincos, sinh, smoothstep, sqrt, step, tan, tanh, transpose, trunc
```

GLSL aliases accepted by DreamShader:

```text
mix -> lerp
fract -> frac
mod -> fmod
```

Unreal texture sampling helpers:

```text
Texture2DSample, Texture2DSampleLevel, Texture2DSampleBias, Texture2DSampleGrad,
Texture2DArraySample, Texture2DArraySampleLevel,
TextureCubeSample, TextureCubeSampleLevel,
Texture3DSample, Texture3DSampleLevel
```

Example:

```dreamshader
Function Sample2DRGB(in Texture2D texture, in float2 uv, out float3 color) {
    color = Texture2DSample(texture, textureSampler, uv).rgb;
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
- `LayoutBlock`: explicit material graph layout metadata.
- `GraphRegion`: named Graph region that generates layout comments.
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

Run the tests. Five tiers, each catching what the one below it cannot: `test:language` imports the
language layer directly, `test:imports` builds real directory trees and checks import resolution
against them, `test:server` spawns the language server and holds an LSP conversation with it over
stdio, `test:corpus` checks this half against the compiler's own corpus, and `test:extension` drives
a real VS Code:

```powershell
npm test
```

`test:corpus` is opt-in, because the plugin is not part of this repository. Point it at one and it
asserts both directions — nothing flagged on a source the compiler accepts, and a matching
diagnostic on each source it rejects for a reason visible in the text:

```powershell
$env:DREAMSHADER_CORPUS_DIR = 'I:\...\Plugins\DreamShader'; npm run test:corpus
```

### Architecture

The extension is two processes. `src/server/` is a standard LSP server carrying all fourteen
language providers and the diagnostics derived from the source; `src/activate.js` is the client,
which keeps everything that is not a question about the text — the preview, the package store, the
Bridge diagnostics tree and its `dreamshader` collection, the status bar, the commands.

`src/language/` imports neither `vscode` nor the protocol, which is what let the providers move
without touching it. Where the layer needs to know about the world around it — a setting, the
workspace folders — it asks `src/host.js`, which each process fills in for itself.

It is deliberately not bundled: `src/bridge/database.js` locates sql.js's WASM through
`require.resolve`, which a bundler would leave pointing at nothing.

`F5` launches an Extension Development Host. To put breakpoints in the server as well, run the
**Extension + Server** compound, which attaches a second debugger to port 6018.

Package the extension:

```powershell
npm run package
```

The packaged VSIX is generated as `dreamshaderlang-language-support-<version>.vsix`, taking the
version from `package.json`.

## License

MIT. Copyright (c) 2026 TypeDreamMoon.
