# Changelog

## 1.9.0

**Graph breakpoints — preview any line's value on the mesh.** Set a breakpoint (F9) on a `Graph`
line in a `.dsm` and the preview shows the value bound at that line on the mesh, instead of the
finished material. It is the text-source equivalent of the Material Editor's right-click **Start
Previewing Node**: pick a place in the graph, see what flows there. The previewed line is marked in
the editor gutter, and the breakpoint disambiguates by picking the topmost enabled one when there
are several. A breakpoint set on a blank or comment line snaps forward to the next line that binds a
value; one set before the material has ever compiled attaches as soon as it does. Requires the
matching DreamShader plugin build (preview protocol `setProbe`/`clearProbe`).

**Faster, smoother streaming.** The live preview now streams **raw RGBA8 frames** straight onto a
canvas — no PNG encode on the editor side, no PNG decode or Base64 on the client side, and the
WebSocket is now owned by the preview view itself instead of being relayed frame by frame through the
extension host. Static previews cost almost nothing: identical frames are dropped and the render
rate backs off once the picture settles, then snaps back the moment you edit, rotate, or move the
breakpoint. The default live frame rate is raised from 2 to 12 FPS, and the preview now renders at
the panel's own size rather than a fixed 512×512 — crisper when enlarged, cheaper when small. It is
still a *square* frame, letterboxed into whatever shape the panel is: previews render through the
engine's thumbnail scene, whose projection matrix has its aspect ratio hardcoded to 1:1, so asking
for a non-square frame would not show more of the scene, it would stretch the sphere into an
ellipse. The legacy PNG path and the file-bridge fallback are still there for older plugin builds
and for `dreamshader.previewTransport: "file"`.

**Fixed: completions inserted a literal `$0`.** Accepting `TwoSided`, or any of the other 115
`Settings` entries, typed `TwoSided = "$0";` into the document instead of leaving the cursor between
the quotes. The same applied to `Base.<Output>` bindings and to section bodies. Snippet placeholders
have two spellings — braced (`${1:Surface}`) and bare (`$0`) — and the check that decided whether an
insert text was a snippet only recognised the braced one, so anything whose only placeholder was a
bare `$0` was declared plain text and inserted verbatim. The brace is now optional in that check,
and a server test asserts the invariant over a real `Settings` completion so it cannot regress.

New preview toolbar meshes: **Cylinder** and **Shader Ball**, alongside Sphere / Plane / Cube.

## 1.8.3

**Fixed: deleting a source file left its errors behind.** The count in the status bar stayed red and
the Bridge view kept a node for the file, which opened `cannot open file:///...` when clicked —
nothing an edit could clear, because the only thing that would clear it was a recompile of a file
that no longer existed.

The Bridge payload is a record of the **last compile**, not of what is on disk now. Nothing re-runs
generation for a deleted file, so its entry survives every later write the plugin makes — confirmed
on a real project, where two stale entries outlived a write that added a third, live file. The
extension mirrored the payload entry by entry and never asked whether the file was still there.

Two fixes, because either alone leaves half the failure standing:

- Entries whose file no longer exists on disk are dropped before publishing. The whole file entry
  goes, so the diagnostic, the tree node and the status-bar count disappear together rather than
  leaving a count with nothing behind it.
- Source files are now watched for deletion and creation, per project root, under `**/DShader/**`
  (plugins carry source roots of their own). This is what made the staleness intermittent: deleting
  a file that was **open** already triggered a refresh through `onDidCloseTextDocument`, so the
  errors cleared on their own; deleted from outside the editor, or never opened, nothing fired until
  an unrelated refresh happened to run. Change events stay ignored — editing a `.dsf` does not
  change the payload.

The extension test suite now carries a Bridge payload entry for a file that is deliberately never
written to disk, and asserts it is not published. Verified by reverting the fix: it fails with the
reported symptom.

Also: the release workflow publishes to the Marketplace itself when a `VSCE_PAT` secret is present,
instead of that being a manual step after every tag, and its path filter now includes `src/**` and
`templates.js` — both ship in the VSIX, and a fix touching only those would previously build and
release nothing.

## 1.8.2

**Fixed: every import inside a plugin's own `DShader` folder was reported as unresolvable.** A file
under `Plugins/MoonToon/DShader/` writing `import "Shared/ToonFunctions.dsh"` — the form a plugin's
sources are supposed to use — got `could not be resolved` while the engine compiled it without
complaint. Go-to-definition and the document link on the specifier were dead for the same reason.

Resolution was still written against a single directory: candidates were built from
`<Project>/DShader` and then containment-checked against it, so a plugin's file could neither reach
its own root nor keep a relative path that left `<Project>/DShader`. The compiler stopped working
that way when it grew **source roots** — the project contributes one root, and so does every plugin
shipping a `DShader` folder.

That model is now mirrored here, from `Docs/language/import.md`:

- Roots are discovered per project: `<Project>/DShader`, plus `<Plugin>/DShader` for each plugin
  under `Plugins/` (nested a directory or two deep, as UE allows). Each carries its own `Packages`.
- An unqualified specifier resolves against the root that **owns** the importing file and never
  against another's, so adding a plugin cannot change what an existing import means.
- Root qualifiers are understood: `Project:`, `Plugin.<Name>:`, `Plugins.<Name>:`, `Plugin/<Name>:`,
  `Plugins/<Name>:`. Text before a `:` that is not one of those shapes is still an ordinary path, so
  `import "C:/Shared/Common.dsh"` fails the way it always did.
- Candidate 1 is confined to the longest root directory containing the file rather than always to
  `<Project>/DShader`, which is what makes `../` behave the same as it does in the build.

Import completion follows the same rule: the owning root's files are offered bare, every other
root's in the qualified form that actually reaches them. It no longer offers a path that would
complete straight into an unresolved-import diagnostic.

One editor-side addition with no counterpart in the plugin: the engine asks `IPluginManager` which
plugins are mounted, and an editor has no such list. A plugin opened on its own with no `.uproject`
above it, or one living outside `<Project>/Plugins`, therefore contributes no root — so a file under
none of the discovered roots falls back to its nearest ancestor named `DShader`. Without it those
files report every import as broken, which is the worse of the two ways to disagree with the
compiler.

New `npm run test:imports` builds real directory trees and checks the resolution table — the three
candidates in order, containment, both directions of root isolation, every qualifier spelling, and
that every specifier offered by completion resolves from the file it was offered for.

## 1.8.1

**Fixed: the document outline was failing entirely on most files.** `textDocument/documentSymbol`
came back as `Error: name must not be falsy`, taking the outline, the breadcrumbs and go-to-symbol
with it.

A Graph statement (`Color = Tint;`) parses with the same `assignment` kind as a Settings assignment
(`Domain = "UI";`), but carries its left-hand side in `target` where Settings uses `name` — and the
symbol builder read only `name`. Every Graph assignment was therefore nameless, which is 41 nodes
across the 41 files of the compiler's corpus: almost every real file has one.

The bug dates to the original symbol implementation in May, not to 1.8.0. What 1.8.0 changed is how
loudly it fails. In-process, the editor rejected the nameless symbol inside the provider and quietly
left the outline blank; over the protocol the client converts the whole tree in one pass, so one
nameless node three levels down fails the entire request and logs a stack trace each time.

Two fixes, because either alone would have left the other half of the failure standing:

- The symbol builder reads `name` **or** `target`, so Graph assignments are named after their
  target — the same field a binding already used.
- The server never emits a falsy name. A future nameless node degrades to one `(unnamed)` label
  instead of destroying the request.

`test:corpus` now walks every symbol at every depth over the whole corpus and asserts each has a
name. Verified by reverting the fix: it reports exactly the 41. No fixture had the shape that broke
this, which is why the existing tests passed a release with the outline broken.

## 1.8.0

First Marketplace release. The extension now ships with the plugin's own icon.

### DSHnnnn diagnostic codes

The compiler now gives each rule a stable `DSHnnnn` code, and names the editor extensions as one of
the things keying off it. Diagnostics raised here that report the *same rule* now carry the same
code, and the Problems entry links to the page that documents it.

Six so far — `DSH3011`, `DSH3012`, `DSH3030`, `DSH3031`, `DSH3105`, `DSH3110`. Most diagnostics
still carry no code, which is the expected state rather than a gap: some are this extension's own,
and the compiler's own migration has tagged four of its nine ranges. A code is attached only where
the rule is genuinely the same, never merely where the wording reads alike — a wrong code is worse
than none, because the code is the half that is promised not to change.

`test:corpus` now checks the codes two ways: the expected rejections assert on code as well as
message, and every `DSHnnnn` this extension emits must appear in the compiler's published pages, so
a typo or a renumbering fails the build.

**`DSH3011` is now an error, not a warning.** A function with no output is a hard parse failure in
the compiler, and the condition is decided entirely from the block's own signature — there is no
uncertainty for a warning to represent, so reporting it softer than the build does was the "editor
says fine, build says no" failure in miniature. The message follows suit ("must declare at least one
out parameter"), except that it still names the actual kind: the compiler says "Function" even for a
GraphFunction, and its own code contract is what allows the difference — the `DSHnnnn` is the
identity, which is precisely what frees the text.

### Aligned with the compiler

Checked against the DreamShader plugin's own `Tests/Corpus` — the files the C++ parser is tested
with. Nothing the compiler accepts was being flagged; three things it rejects were not.

- **`Shader(Name="...") is required.`** A Shader block with no name parsed happily here, because the
  block's `name` falls back to its kind when there is no `Name=` attribute — so a nameless Shader
  was quietly named "Shader".
- **`Only one top-level Shader block is currently supported.`**
- **`A function with a return type cannot use a bare 'return;'. Return a value, e.g. 'return expr;'.`**
  Ported from the compiler's return-type rewriter, including the two conditions that keep it from
  over-firing: identifier boundaries on both sides, and brace depth zero.

Each carries the compiler's own wording. An editor that phrased the same refusal differently would
read as a second, disagreeing opinion.

- **`Shader("Name")` is not valid syntax.** The positional form was never accepted by the compiler —
  `ParseAttributes` requires `Key = Value` — and appears nowhere in the plugin's corpus or docs. It
  was only ever in this repo's own smoke-test fixtures, which have been corrected. The new
  missing-name diagnostic is what surfaced it.
- **New `npm run test:corpus`**, opt-in via `DREAMSHADER_CORPUS_DIR`, so this comparison keeps
  running instead of being a one-off. It asserts both directions: no diagnostic on the 35 sources
  the compiler accepts, and a matching diagnostic on each of the 6 it rejects for a reason visible
  in the text. A `.bad.` file that fails on something only the engine knows stays the compiler's.

### The language half is now a language server

`src/language/` never imported `vscode` and already answered every provider as a plain object
carrying offsets, so it moved across untouched; what was rewritten is the 532 lines of converter
that used to wrap it, plus the two modules that reached for the editor behind its back.

- **All fourteen providers and the `dreamshader-local` diagnostics now run in a separate process.**
  The collection keeps its name, and the split with `dreamshader` — this for what the source says,
  that for what a recompile reported — is unchanged. The preview, the package store, the Bridge
  diagnostics tree, the status bar and the commands all stay on the client.
- **One parse per document text, shared.** `parseDocument` is now memoised on the text, sixteen
  entries deep. There are thirteen call sites and fourteen providers, and completion is triggered by
  every letter of the alphabet, so on one keystroke a good few of them were re-parsing the same
  buffer. Verified safe first: all thirteen consumers read the tree without writing to it.
- **`vscode` is no longer reached for from the language path.** `project/projects.js` and
  `bridge/manifests.js` used a `require("vscode")` in a try/catch to read settings, the workspace
  folders and the focused editor; they now ask `src/host.js`, which each process fills in. The
  manifest lookups took a whole document only to read a path off it, and take the path now — passing
  them the protocol's `TextDocument`, whose `uri` is a string, would have silently narrowed every
  one of them to the no-project case.
- **Fixed: the recompile CodeLens could act on the wrong file.** Its argument is a uri, and now
  crosses as JSON rather than as a `vscode.Uri`; the handler's `instanceof` check would have failed
  and fallen through to whatever editor had focus. It accepts both forms.
- **Fixed: a failed capability registration could kill the server.** The registration promise was
  left floating, so a client that refused one would take the process down by unhandled rejection.
- The .vsix grew from 523 KB to 898 KB — the language-server stack, less its source maps and
  typings, which are now excluded the same way sql.js's unused builds already were.
- New `npm run test:server`: spawns the built server over stdio and exercises all fourteen providers
  against the fixture. The extension tests now wait on the client being ready, which activation
  exposes rather than blocking on — a server that fails to start costs completion, not the
  recompile button.

## 1.7.0

- Added nested `Group("Outer") { Group("Inner") { ... } }` scopes, composing to `"Outer|Inner"` (matching Unreal's native `|` sub-category syntax for the Group/Category property) instead of the inner name silently replacing the outer one. `Group("A|B")` typed as a single literal name already worked and is unchanged.
- Fixed a formatter bug (unrelated to the above, but directly hit by it): three or more nested blocks closing in a row lost an indent level (e.g. `Shader > Properties > Group`, or the new `Group > Group` nesting) instead of dedenting one level per closing brace.
- Added the short `UE.<Name>(...)` reflection sugar (e.g. `UE.Arcsine(OutputType="float1", Input=Value)`) to completion for every reflected MaterialExpression whose name doesn't collide with one of the compiler's hard-coded `UE.*` builtins (`Time`, `Panner`, `VertexColor`, `StaticSwitchParameter`, ..., which keep the long `UE.Expression(Class="...", ...)` form since the compiler's dispatcher checks those by name before falling back to generic reflection). Previously every reflected member always expanded to the long form on completion, even though the compiler already accepted the short form.
- Fixed completion ranking: the generic `UE.Expression(Class="...")` escape hatch could win a completion race against a more specific same-named member (e.g. typing `UE.Si` could complete to `Expression(Class="Sine", ...)` instead of the shorter `Sine(...)`) because no completion item had an explicit sort priority. `Expression` now always sorts behind every other `UE.*`/reflected member.
- Fixed hover parameter types showing the generic `value` placeholder almost everywhere: hard-coded `UE.*` builtins (`TexCoord`, `Time`, `Panner`, ...) and every reflected member's synthetic `OutputType`/`Output`/`OutputName`/`OutputIndex` parameters now show their real type (int/float/bool/string). A reflected member's own input pins (e.g. `Arcsine`'s `Input`) will show their real type too once the DreamShader plugin is rebuilt and the Bridge manifest/database is regenerated — the plugin's manifest exporter now queries `GetInputValueType`/`GetInputType` instead of writing a placeholder for every input pin.
- Added SQLite Bridge support: the plugin now dual-writes material expressions, Substrate builtins, settings mappings, and diagnostics to `Saved/DreamShader/Bridge/bridge.db` alongside the existing JSON files. The extension now reads from that database (via `sql.js`) whenever it's present, falling back to the JSON files for older plugin versions or before the database has been generated once. The JSON Bridge files are deprecated and scheduled for removal in DreamShader plugin 1.7.0.
- Reduced completion latency: resolving a document's Unreal project root, and reading/merging Bridge manifests, are now cached (invalidated automatically when the underlying files actually change) instead of being recomputed from scratch on every keystroke — every letter re-triggers a completion request, so this had been adding up while typing quickly.

## 1.6.3

- Fixed syntax highlighting for Allman-style formatting (opening `{` on its own line). `Properties`, `Inputs`, `Outputs`, `Graph`, `Layout`, `Settings`, `Options`, `Group("Name") { ... }`, `Template Shader(...)`, and `Function`/`GraphFunction` bodies all previously required the `{` on the same line as the keyword — a `TextMate` grammar limitation, since scopes are matched one line at a time. Any of these written with the `{` on the next line (including the extension's own `Template Shader` completion snippet) lost all nested highlighting for their body.
- Fixed `Group` completion: the `Group("Name") { ... }` snippet was only offered under the label `propgroup`, so typing `Group` inside a `Properties`/`Inputs` block surfaced nothing. It's now also offered under the label `Group` (the `propgroup` alias is unchanged).

## 1.6.2

- Fixed import resolution for extensionless specifiers. `import "ColorLib";` now resolves to a sibling `ColorLib.dsh` (the `.dsh` extension is appended when the specifier has no extension, and a leading `./` is stripped), matching the plugin's `NormalizeImportSpecifier`. Bare imports no longer produce a false "DreamShader import '...' could not be resolved." error; genuinely missing imports are still reported.

## 1.6.1

- Fixed Graph and function-body control-flow parsing. An `if (...) { ... } else { ... }` block (and `for`/`while` blocks) is now recognized as a single self-terminating statement, eliminating a cluster of false positives on valid code:
  - no more false "Graph statement is missing a trailing ';'" on if/else blocks;
  - the statement after an if-block is no longer absorbed into it (was reported as "Unsupported Graph variable type '...'");
  - variables declared inside a branch (or `for`/`while` body) now resolve in scope — no false "Identifier 'X' is not declared in this scope" — and are offered as completions, including swizzle and MaterialAttributes members and the `for` loop variable.
- Fixed syntax highlighting:
  - Function/GraphFunction and Template bodies are now highlighted (the body rule was dead, so `return`, intrinsics, and types in every body rendered unstyled);
  - declarations after a `Group("X") { ... }` scope no longer lose their highlighting (the group's `}` ended the section early);
  - `Base.<Attribute>` output members and `Substrate.<Node>()` receivers are now scoped correctly.
- SignatureHelp no longer leaks the internal `__return` name for return-type functions (shown as a `: <type>` return suffix); Function/GraphFunction parameters now appear in the document outline.

## 1.6.0

- Added support for the DreamShaderLang 1.5 syntax, kept fully backward compatible with the existing syntax:
  - `Group("Name") { ... }` property scopes — highlighting, parsing (declarations flattened with their group), completion (`propgroup` snippet), and a `Slider(min, max)` metadata shorthand.
  - Single-output return-value functions — `Function float Luma(...) { return ...; }` (and `GraphFunction`) highlight the return type, resolve as values when called, and no longer warn about a missing `out` parameter.
  - Optional `=` between a section name and its body — `Properties { ... }` is treated identically to `Properties = { ... }`.
  - Bare `"/Game/..."` asset paths in a parameter's `=` slot, plus a `texparampath` snippet.
- Modernized the default "New DreamShader Material" scaffold to use Group scope, the `Slider` shorthand, and section blocks without `=`.

## 1.5.3

- Added a DreamShader material preview command with WebSocket streaming and file bridge fallback support.

## 1.5.2

- Added callable hover return and output pin metadata for DreamShader functions, UE builtins, and Substrate helpers.
- Added Substrate ThinFilm output pin hover details, including old bridge manifest fallback handling.

## 1.5.1

- Added `Template` block parsing, completion, formatting, semantic tokens, and syntax highlighting.
- Added DreamShader bridge commands, status bar, and diagnostics panel integration.
- Added package install, browse, update, remove, and scaffold commands.
- Added command-palette authoring templates for materials, functions, headers, texture samples, and noise materials.
- Restored CodeLens and Inlay Hint registration after the extension activation module split.
- Refreshed bridge diagnostics when Unreal updates `Saved/DreamShader/Bridge/diagnostics.json`.

## 1.4.9

- Added shared Function builtin metadata for HLSL intrinsics, GLSL aliases, and Unreal texture sampling helpers.
- Added Function builtin completion, hover, signature help, inlay-hint metadata, semantic highlighting, and diagnostics allow-list coverage.
- Synced UE 5.7 `Substrate.*` graph helper completion and `Base.FrontMaterial` output diagnostics/highlighting with the current DreamShader plugin.
- Documented the supported Function builtin list in both README files.

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
