# Changelog

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


