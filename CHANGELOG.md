# Changelog

## 1.4.8

- Added language support for `Layout` sections with `Node(...)` and `Comment(...)` statements.
- Added Graph `#Region` / `#EndRegion` parsing, diagnostics, folding, snippets, and highlighting.
- Updated snippets, templates, README files, formatter, document symbols, and semantic tokens for layout metadata.

## 1.4.6

- Added language support, highlighting, completions, snippets, and diagnostics coverage for `VolumeTexture` / `Texture3D`.

## 1.4.5

- Loaded bundled MaterialExpression completions from the language core as a hard fallback, so `UE.` suggestions include `material-expressions.json` entries even when VSCode adapter services do not provide a project manifest.

## 1.4.4

- Changed reflected `UE.` MaterialExpression completions to insert `UE.Expression(Class="...", ...)` snippets while keeping short labels such as `Abs` and `TextureSampleParameter2D`.

## 1.4.3

- Bundled a fallback `material-expressions.json` manifest so reflected `UE.Expression(Class="...")` completions still work outside an auto-detected Unreal project.
- Added `dreamshader.materialExpressionManifestPath` for explicitly pointing the extension at a generated `Saved/DreamShader/Bridge/material-expressions.json`.
- Added a language smoke test covering manifest-backed reflected MaterialExpression class completion.

## 1.4.2

- Synced language metadata with current DreamShader reflected MaterialExpression support.
- Added completion, hover, formatting, and diagnostics support for reflected texture sampler metadata such as `SAMPLERTYPE_*`, `SSM_*`, `TMVM_*`, and `TGM_*`.
- Added `UE.StaticComponentMaskParameter(...)`, `UE.CurveAtlasRowParameter(...)`, and reflected TextureSample helper snippets.
- Updated `CurveAtlasRowParameter` type inference to behave as a 3-component color.
- Fixed inlay-hint signature lookup for document-specific reflected UE expression manifests.

## 1.4.1

- Added `.dsf` Dream Shader Function file association, command-palette template creation, import completion, clickable import handling, and workspace indexing.
- Added `.dsf` diagnostics that allow reusable `ShaderFunction`, `Function`, `GraphFunction`, `Namespace`, and `VirtualFunction` declarations while rejecting material/layer asset blocks.
- Added local diagnostics for standalone multi-output `ShaderFunction` / `VirtualFunction` calls using positional inputs followed by out variables.
- Preserved explicit import extensions so `import "Functions/F_Tint.dsf";` resolves as a function file instead of being rewritten as a `.dsh` import.
- Updated README, snippets, and templates for `.dsf` authoring.

## 1.4.0

- Rebuilt the DreamShaderLang language service around scanner, parser, context, symbol, completion, diagnostic, and provider modules.
- Routed completion, diagnostics, semantic tokens, folding, and document symbols through the new language core.
- Fixed broad completion scope leaks across `Inputs`, `Graph`, `Function`, `Settings`, `Outputs`, and metadata contexts.
- Fixed `Base.` output completion so applying `BaseColor` no longer inserts `Base.BaseColor`.
- Added parser-based formatting, cross-file import indexing, and function-cycle detection in the new language core.
- Restored deeper local diagnostics for ShaderLayer/ShaderLayerBlend shape, VirtualFunction options, Graph callable argument counts, Graph out variables, and MaterialAttributes member writes.
- Added Substrate/Strata type, syntax, completion, and diagnostic hints.
- Added language smoke tests for section-aware completion and diagnostics.
- Rewrote the README with English as the primary document and added `README.zh-CN.md`.

## 1.3.4

- Updated built-in templates and snippets to generate more practical project-ready DreamShader skeletons.
- Switched Material Layer language support and templates to the recommended `ShaderLayer` / `ShaderLayerBlend` keywords.
- Removed `MaterialLayer` / `MaterialLayerBlend` from active keyword, syntax, completion, diagnostic, and CodeLens paths.

## 1.3.1 - 1.3.2

- Added `GraphFunction` language support for reusable graph-node helpers that can call `UE.*` nodes and expand at the call site
- Allowed single-output `Function` and `GraphFunction` calls to be used as value expressions in Graph diagnostics
- Kept multi-output `Function` and `GraphFunction` calls on explicit out-variable syntax
- Split top-level block templates into `templates.js`; keyword completions now insert only keywords, while `ShaderFunctionTemplate`, `GraphFunctionTemplate`, and related entries expand full templates
- Added `GraphFunction` snippets, completion, hover, signature help, symbols, folding, and local diagnostics
- Added local diagnostics that reject `UE.*` graph node calls inside plain HLSL `Function` blocks and recommend `GraphFunction`

## 1.3.0

- Added `MaterialLayer` and `MaterialLayerBlend` language support, snippets, semantic tokens, folding, symbols, CodeLens, completion, hover, signature help, and local diagnostics
- Added local validation for Material Layer output shape and Material Layer Blend `MaterialAttributes` inputs
- Updated `.dsm` / `.dsh` diagnostics to recognize generated Material Layer assets
- Updated Material Layer snippets to use explicit `.rgb` access so alpha remains available through `.a`

## 1.2.27

- Added dynamic `MaterialExpression` completion, hover, and signature metadata from `Saved/DreamShader/Bridge/material-expressions.json`
- Added `Class="..."` value completion for generic `UE.Expression(...)` and shader output `Expression(...).Pin[n]` bindings
- Kept the existing hand-authored UE builtin metadata as stable overrides while merging reflected Unreal expression metadata behind it

## 1.2.26

- Synced local material output diagnostics with the DreamShader plugin, including `Base.CustomizedUV0..7`, `Base.CustomizedUVs0..7`, custom data, legacy color, displacement, surface thickness, and Mooa encoded attribute outputs
- Updated expression diagnostics so DreamShader `Path(...)` helper calls are accepted inside `UE.CollectionParam(...)` arguments

## 1.2.25

- Added `ShaderFunction.Properties` section support in completion, diagnostics, symbols, and visible identifier collection
- Added `const` property keyword support and a `constprop` snippet
- Updated ShaderFunction snippets so optional texture inputs can use property-backed preview defaults

## 1.2.24

- Added `MaterialAttributes` graph type completion, hover text, and snippets
- Added completion for `Attrs.BaseColor`, `Attrs.Roughness`, and other Material Attributes members
- Updated local diagnostics so `Attrs.Member = ...` is treated as a MaterialAttributes member write instead of a new variable
- Added `Base.MaterialAttributes` as a valid Shader Outputs binding

## 1.2.23

- Updated declaration metadata parsing and snippets to the semicolon-based reflection block syntax
- Added a TextureSampleParameter2D reflection snippet covering sampler, mip, coordinate, and view mip bias properties
- Kept local symbol extraction compatible with both comma-style historical metadata and the new reflected property blocks

## 1.2.22

- Added Properties support for explicit Parameter node types, `StaticSwitchParameter`, declaration metadata, and optional function inputs
- Added `UE.CollectionParam(...)` and `UE.StaticSwitchParameter(...)` completion, hover, signature help, and inlay-hint metadata
- Updated local diagnostics to understand `opt` inputs and `default` arguments for ShaderFunction / VirtualFunction calls
- Added snippets for optional inputs, declaration metadata, static switch parameters, and Material Parameter Collection reads
- Updated extension packaging metadata for the 1.2.22 release

## 1.2.21

- Added `.rgba` / `.xyzw` vector swizzle diagnostics support for chained expressions such as `DebugFloat2Values(...).rg`
- Added swizzle completion and hover entries for 1-4 channel selections, including repeated channels such as `.rrr`, `.ggg`, `.aaa`, `.rgaa`, and `.rgbb`
- Updated extension packaging metadata for the 1.2.21 release

## 1.2.20

- Added Semantic Tokens for DreamShaderLang symbols, types, parameters, material outputs, and UE builtin calls
- Added parameter inlay hints for DreamShader Function, ShaderFunction, VirtualFunction, and UE builtin calls
- Added clickable document links for resolved `import` headers and folding ranges for top-level blocks and legacy sections
- Improved document symbols with nested section declarations for a richer Outline view
- Updated `import "Header.dsh"` parsing to accept optional trailing semicolons
- Removed the duplicate `dreamshader.packageUninstall` command alias and cleaned ignored historical VSIX build artifacts

## 1.2.19

- Added codicon thumbnails to DreamShader command contributions so editor title, view title, and context-menu shortcuts render as compact icon actions
- Changed DreamShader CodeLens shortcuts from long text labels to icon-only actions
- Updated extension packaging metadata for the 1.2.19 release

## 1.2.18

- Added completion, hover, signature help, snippets, syntax highlighting, and diagnostics for `VirtualFunction`
- Added `Path(Plugins.*)` project content plugin completion for `VirtualFunction` asset references
- Updated extension packaging metadata for the 1.2.18 release

## 1.2.17

- Added `Root="Plugins.*"` completion and hover compatibility for the same project content plugin targets as `Root="Plugin.*"`
- Updated extension packaging metadata for the 1.2.17 release

## 1.2.16

- Added `Root="Plugin.*"` value completion from project plugins that contain a `Content` directory
- Updated extension packaging metadata for the 1.2.16 release

## 1.2.15

- Clarified `Root="Plugin.PluginName"` documentation as a project content plugin target under `[Project]/Plugins/PluginName/Content`
- Updated extension packaging metadata for the 1.2.15 release

## 1.2.14

- Added completion, hover, snippet, and syntax-highlighting support for the `Root` top-level attribute on `Shader` and `ShaderFunction`
- Updated Shader and ShaderFunction block detection so `Name` can appear after other attributes such as `Root`
- Updated extension packaging metadata for the 1.2.14 release

## 1.2.13

- Added a GitHub Actions release workflow that packages the VSCode extension after pushes to `main`
- The workflow reads `package.json`, creates or reuses the matching `vX.Y.Z` tag, and uploads the generated VSIX to a GitHub Release
- Added workflow dispatch support for manually rebuilding a release package

## 1.2.12

- Moved the `DreamShader Bridge` diagnostics view from Explorer into a dedicated bottom Panel container
- Added a `Show Bridge Panel` command, status bar bridge focus action, and CodeLens bridge shortcut
- Refined Bridge diagnostics tree icons, context values, and item context actions for a clearer issue browsing workflow
- Polished Package Store Webview controls with a cleaner layout, stats, focus states, card hover states, and more consistent buttons

## 1.2.11

- Renamed Shader and ShaderFunction graph authoring support from `Code = { ... }` to `Graph = { ... }`
- Added local parsing and diagnostics for basic `Graph` `if` / `else` statements
- Updated visible-symbol collection so declarations and Function out targets inside Graph branches participate in completion
- Updated snippets, built-in file templates, hover text, syntax highlighting, and diagnostics to use `Graph` terminology

## 1.2.10

- Updated DreamShaderLang function definition support for the modern `in` / `out` signature model
- Improved completion and diagnostics around Function definitions and calls

## 1.2.9

- Added a dedicated `DreamShader Bridge` explorer view that lists Unreal bridge diagnostics by project, source file, and individual issue
- Enriched VSCode bridge diagnostics with material compile metadata such as stage, asset path, shader platform, quality level, and raw detail text
- Added a `Refresh Bridge Diagnostics` command and view title actions so bridge state can be refreshed, recompiled, or cleaned without leaving the diagnostics window

## 1.2.8

- Added a `Clean Generated Shaders` command that asks Unreal to delete `Intermediate/DreamShader/GeneratedShaders` and queue a full DreamShader recompile
- Added VSCode command palette, editor title, and editor context-menu entries for generated shader cleanup

## 1.2.7

- Added local cycle diagnostics for recursive DreamShader Function graphs, including SelfContained recursion reachable through imports
- Modernized the VSCode UX with contextual status bar details, inline CodeLens recompile actions, and editor title/context actions
- Added new extension settings for toggling the DreamShader status bar item and CodeLens actions

## 1.2.6

- Added editor support for `Function SelfContained Name(...) { ... }` and `Function Inline Name(...) { ... }`
- Updated completion, hover, snippets, and syntax highlighting for SelfContained shared functions

## 1.2.5

- Expanded `Settings` completion coverage for PostProcess, Refraction, WorldPositionOffset, Mobile, Nanite, ForwardShading, PhysicalMaterial, Usage, Lightmass, Substrate, VirtualTexture, and PixelDepthOffset material categories
- Updated `Path(...)` help text to reflect that it can be used for Settings object references such as physical materials and override assets

## 1.2.4

- Added `TranslucencyLightingMode` and `LightingMode` Settings completion entries
- DreamShader material Settings now accept Unreal enum display labels such as `Surface ForwardShading` in addition to raw enum names like `TLM_SurfacePerPixelLighting`

## 1.2.3

- Fixed package uninstall so removal uses the recorded installed path instead of assuming every package lives at `DShader/Packages/<name>`
- Added `dreamshader.packageUninstall` as a compatibility alias for older command naming
- Fixed Unreal bridge diagnostics discovery and watching when VSCode is opened on `ProjectName/DShader` instead of the Unreal project root
- Bridge diagnostics now auto-detect candidate Unreal project roots from open documents, active editors, and workspace folders

## 1.2.2

- Added editor-side support for comma-separated Code declarations such as `float i, d, s, t = UE.Time(), f = t + 1.0;`
- Updated local diagnostics and visible-symbol tracking so later declarators in the same statement can reference earlier ones
- Kept auxiliary `Expression(...).Pin[n]` Outputs support from 1.2.1 while improving Code parsing

## 1.2.1

- Added local Outputs validation for `Expression(...).Pin[n] = ...` auxiliary material output bindings
- Added completion, snippet, and syntax-highlighting support for `Expression(Class="ThinTranslucentMaterialOutput").Pin[...]` and `Expression(Class="TangentOutput").Pin[...]`
- Updated built-in templates and snippets to use `Base.*` output bindings consistently

## 1.2.0

- Reworked UE builtin metadata so completion, hover, and signature help share a single extensible definition table
- Added richer UE builtin snippets for `TexCoord`, `Time`, `Panner`, `TransformVector`, `TransformPosition`, and `Expression`
- Updated `Outputs` completion to suggest `Base.*` assignments and auxiliary `Expression(...).Pin[n]` output node bindings
- Updated hover text to reflect the new `Base.*` / `Expression(...).Pin[n]` material output syntax

## 1.1.0

- Added DreamShader package management commands and package index support
- Improved local diagnostics, function navigation, references, and formatting
- Expanded DreamShaderLang language metadata and packaging

## 1.0.0

- Initial DreamShaderLang VSCode extension
- Added `.dsm` material and `.dsh` header language registration
- Added `Function` / `import` authoring support with richer mixed shader / GLSL type coverage
- Added go-to-definition for imported headers and shared function blocks
- Added Namespace(Name=...) and Namespace::Function language support
- Added document formatting and local syntax diagnostics
- Added Signature Help, richer Hover, and Find References support
- Added stronger DreamShader bridge integration for current-source and full `.dsm` recompiles
- Added DreamShader Package commands for GitHub install, VSCode-style Webview package store browse, update, remove, source management, and package import completion
- Added step-by-step DreamShader package scaffold creation
- Added quick template commands for Material, Header, Texture Sample, and Noise Material files
- Added TypeDreamMoon publisher metadata for the 1.0.0 release
