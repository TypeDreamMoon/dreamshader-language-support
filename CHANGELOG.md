# Changelog

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


