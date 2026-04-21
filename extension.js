"use strict";

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const LANGUAGE_ID = "dreamshaderlang";
const BRIDGE_DIAGNOSTIC_COLLECTION_NAME = "dreamshader";
const LOCAL_DIAGNOSTIC_COLLECTION_NAME = "dreamshader-local";
const DREAMSHADER_EXTENSIONS = new Set([".dsm", ".dsh"]);
const INDENT = "    ";

const LEGACY_SECTION_NAMES = [
    "Properties",
    "Settings",
    "Outputs",
    "Code",
    "Inputs"
];

const TOP_LEVEL_BLOCK_NAMES = [
    "Shader",
    "Function",
    "Namespace",
    "ShaderFunction"
];

const QUALIFIER_ITEMS = [
    ["in", "Function input parameter"],
    ["out", "Function output parameter"]
];

const GRAPH_TYPE_ITEMS = [
    ["float", "Scalar value"],
    ["float1", "Scalar value"],
    ["float2", "2-component vector"],
    ["float3", "3-component vector / color"],
    ["float4", "4-component vector"],
    ["vec2", "GLSL-style float2 alias"],
    ["vec3", "GLSL-style float3 alias"],
    ["vec4", "GLSL-style float4 alias"],
    ["half", "Scalar value"],
    ["half1", "Scalar value"],
    ["half2", "2-component vector"],
    ["half3", "3-component vector"],
    ["half4", "4-component vector"],
    ["int", "Scalar numeric alias"],
    ["int2", "2-component integer vector"],
    ["int3", "3-component integer vector"],
    ["int4", "4-component integer vector"],
    ["ivec2", "GLSL-style int2 alias"],
    ["ivec3", "GLSL-style int3 alias"],
    ["ivec4", "GLSL-style int4 alias"],
    ["uint", "Scalar numeric alias"],
    ["uint2", "2-component unsigned vector"],
    ["uint3", "3-component unsigned vector"],
    ["uint4", "4-component unsigned vector"],
    ["uvec2", "GLSL-style uint2 alias"],
    ["uvec3", "GLSL-style uint3 alias"],
    ["uvec4", "GLSL-style uint4 alias"],
    ["bool", "Scalar numeric alias"],
    ["bool2", "2-component bool vector"],
    ["bool3", "3-component bool vector"],
    ["bool4", "4-component bool vector"],
    ["bvec2", "GLSL-style bool2 alias"],
    ["bvec3", "GLSL-style bool3 alias"],
    ["bvec4", "GLSL-style bool4 alias"],
    ["Texture2D", "Texture object input"],
    ["TextureCube", "Texture cube input"],
    ["Texture2DArray", "Texture array input"],
];

const HLSL_TYPE_ITEMS = [
    ["float", "Shader helper scalar"],
    ["float2", "Shader helper 2-component vector"],
    ["float3", "Shader helper 3-component vector"],
    ["float4", "Shader helper 4-component vector"],
    ["vec2", "GLSL-style float2 alias"],
    ["vec3", "GLSL-style float3 alias"],
    ["vec4", "GLSL-style float4 alias"],
    ["half", "Shader helper half scalar"],
    ["half2", "Shader helper half2 vector"],
    ["half3", "Shader helper half3 vector"],
    ["half4", "Shader helper half4 vector"],
    ["int", "Shader helper integer"],
    ["int2", "Shader helper int2"],
    ["int3", "Shader helper int3"],
    ["int4", "Shader helper int4"],
    ["ivec2", "GLSL-style int2 alias"],
    ["ivec3", "GLSL-style int3 alias"],
    ["ivec4", "GLSL-style int4 alias"],
    ["uint", "Shader helper unsigned integer"],
    ["uint2", "Shader helper uint2"],
    ["uint3", "Shader helper uint3"],
    ["uint4", "Shader helper uint4"],
    ["uvec2", "GLSL-style uint2 alias"],
    ["uvec3", "GLSL-style uint3 alias"],
    ["uvec4", "GLSL-style uint4 alias"],
    ["bool", "Shader helper bool"],
    ["bool2", "Shader helper bool2"],
    ["bool3", "Shader helper bool3"],
    ["bool4", "Shader helper bool4"],
    ["bvec2", "GLSL-style bool2 alias"],
    ["bvec3", "GLSL-style bool3 alias"],
    ["bvec4", "GLSL-style bool4 alias"],
    ["float2x2", "Shader helper 2x2 matrix"],
    ["float3x3", "Shader helper 3x3 matrix"],
    ["float4x4", "Shader helper 4x4 matrix"],
    ["mat2", "GLSL-style float2x2 alias"],
    ["mat3", "GLSL-style float3x3 alias"],
    ["mat4", "GLSL-style float4x4 alias"],
    ["Texture2D", "Texture object"],
    ["TextureCube", "Texture cube object"],
    ["Texture2DArray", "Texture2DArray object"],
    ["SamplerState", "Sampler state"],
    ["void", "No return value"]
];

const HLSL_KEYWORD_ITEMS = [
    ["if", "Conditional"],
    ["else", "Conditional branch"],
    ["for", "Loop"],
    ["while", "Loop"],
    ["do", "Loop"],
    ["switch", "Switch statement"],
    ["case", "Switch case"],
    ["default", "Switch default case"],
    ["return", "Return from the current function"],
    ["break", "Break the current loop or switch"],
    ["continue", "Continue the current loop"],
    ["const", "Read-only value"],
    ["static", "Static storage"],
    ["struct", "Structure declaration"]
];

const SETTINGS_ITEMS = [
    ["MaterialDomain", "Material domain such as Surface or PostProcess"],
    ["Domain", "Alias of MaterialDomain"],
    ["ShadingModel", "Shading model such as DefaultLit"],
    ["BlendMode", "Blend mode such as Opaque or Translucent"],
    ["RenderType", "Alias of BlendMode"],
    ["TwoSided", "Render both sides of the mesh"],
    ["Wireframe", "Enable wireframe rendering"],
    ["DitheredLODTransition", "Enable dithered LOD transition"],
    ["DitherOpacityMask", "Enable dithered opacity mask"],
    ["AllowNegativeEmissiveColor", "Allow negative emissive values"],
    ["CastDynamicShadowAsMasked", "Treat translucent material as masked for shadow casting"],
    ["ResponsiveAA", "Enable responsive anti-aliasing"],
    ["ScreenSpaceReflections", "Enable screen space reflections"],
    ["ContactShadows", "Enable contact shadows"],
    ["DisableDepthTest", "Disable depth testing"],
    ["OutputTranslucentVelocity", "Write translucent velocity"],
    ["TangentSpaceNormal", "Use tangent-space normal input"],
    ["FullyRough", "Mark material as fully rough"],
    ["IsSky", "Mark material as sky"],
    ["ThinSurface", "Enable thin surface mode"],
    ["HasPixelAnimation", "Mark material as animated at pixel level"],
    ["OpacityMaskClipValue", "Set opacity mask clip value"],
    ["NumCustomizedUVs", "Set the number of customized UV channels"],
    ["Description", "Description text for a ShaderFunction material function asset"],
    ["ExposeToLibrary", "Expose a ShaderFunction to the Unreal material function library"],
    ["UserExposedCaption", "Custom node caption shown for a ShaderFunction"],
    ["LibraryCategories", "Comma-separated categories for a ShaderFunction"]
];

const MATERIAL_OUTPUT_ITEMS = [
    ["BaseColor", "Material base color output"],
    ["EmissiveColor", "Material emissive output"],
    ["Opacity", "Material opacity output"],
    ["OpacityMask", "Material opacity mask output"],
    ["Metallic", "Material metallic output"],
    ["Specular", "Material specular output"],
    ["Roughness", "Material roughness output"],
    ["Normal", "Material normal output"],
    ["AmbientOcclusion", "Material ambient occlusion output"],
    ["AO", "Alias of AmbientOcclusion"],
    ["Refraction", "Material refraction output"],
    ["WorldPositionOffset", "World position offset output"],
    ["WPO", "Alias of WorldPositionOffset"],
    ["PixelDepthOffset", "Pixel depth offset output"],
    ["PDO", "Alias of PixelDepthOffset"],
    ["SubsurfaceColor", "Subsurface color output"],
    ["ClearCoat", "Clear coat output"],
    ["ClearCoatRoughness", "Clear coat roughness output"],
    ["Anisotropy", "Anisotropy output"],
    ["Tangent", "Tangent output"]
];

const UE_BUILTINS = [
    ["TexCoord", "UE.TexCoord(Index=0)", "Creates a TextureCoordinate material expression."],
    ["Time", "UE.Time(Period=4.0)", "Creates a Time material expression."],
    ["Panner", "UE.Panner(Coordinate=UV, Time=UE.Time(), Speed=float2(0.1, 0.0))", "Creates a Panner material expression."],
    ["WorldPosition", "UE.WorldPosition()", "Creates a WorldPosition material expression."],
    ["ObjectPositionWS", "UE.ObjectPositionWS()", "Creates an ObjectPositionWS material expression."],
    ["CameraVectorWS", "UE.CameraVectorWS()", "Creates a CameraVectorWS material expression."],
    ["ScreenPosition", "UE.ScreenPosition()", "Creates a ScreenPosition material expression."],
    ["VertexColor", "UE.VertexColor()", "Creates a VertexColor material expression."],
    ["TransformVector", "UE.TransformVector(Input=NormalTS, Source=\"Tangent\", Destination=\"World\")", "Creates a TransformVector material expression."],
    ["TransformPosition", "UE.TransformPosition(Input=WorldPos, Source=\"Local\", Destination=\"World\")", "Creates a TransformPosition material expression."],
    ["Expression", "UE.Expression(Class=\"Sine\", OutputType=\"float1\", Input=UE.Time())", "Creates any reflected MaterialExpression class."]
];

const DREAMSHADER_HELPER_ITEMS = [
    ["Path", "Path(${1:Game}, \"${2:/Textures/MyTexture}\")", "Resolves a Game or Engine texture asset for a texture parameter default."],
    ["Path", "Path(\"${1:/Game/Textures/MyTexture}\")", "Resolves a fully qualified Unreal object path for a texture parameter default."]
];

const HOVER_DOCS = new Map([
    ["shader", "Top-level DreamShader material declaration. DreamShader material implementation files use `.dsm`."],
    ["function", "Reusable shared function block. Define with `Function Name(in float Value, out vec3 Result) { ... }` and call with explicit out variables like `Name(Value, Result);`."],
    ["namespace", "Groups shared Function blocks. Define with `Namespace(Name=\"Texture\") { ... }` and call with `Texture::Sample(...)`."],
    ["import", "Imports a DreamShader header. Use `import \"Common/MyHeader.dsh\";`."],
    ["shaderfunction", "Top-level DreamShader MaterialFunction asset declaration."],
    ["properties", "Declares user inputs or UE-generated property nodes."],
    ["settings", "Declares Unreal material or ShaderFunction settings."],
    ["outputs", "Declares shader outputs or ShaderFunction result pins."],
    ["code", "Inside `Shader` or `ShaderFunction`, `Code` is DreamShader graph code. Put complex flow logic inside `Function` blocks."],
    ["inputs", "ShaderFunction input pin list."],
    ["outputtype", "Required for generic `UE.Expression(...)` or reflected `UE.ClassName(...)` calls."],
    ["resulttype", "Alias of `OutputType` for generic MaterialExpression calls."],
    ["class", "Explicit MaterialExpression class selector."],
    ["output", "Selects a named output from a multi-output expression or ShaderFunction call."],
    ["outputname", "Alias of `Output`."],
    ["outputindex", "Selects an output by zero-based output index."],
    ["path", "Resolves a texture default asset path. Use `Path(Game, \"/Textures/MyTexture\")` or `Path(\"/Game/Textures/MyTexture\")` inside texture property defaults."],
    ["in", "Function input parameter qualifier."],
    ["out", "Function output parameter qualifier. Callers pass a target variable explicitly, for example `ApplyTint(Color, Tint, Result)`."]
]);

const BLOCK_SECTION_RULES = new Map([
    ["Shader", new Set(["Properties", "Settings", "Outputs", "Code"])],
    ["ShaderFunction", new Set(["Inputs", "Outputs", "Settings", "Code"])]
]);

const SCALAR_TYPE_NAMES = new Set([
    "float",
    "float1",
    "half",
    "half1",
    "int",
    "uint",
    "bool"
]);

const VECTOR_TYPE_COMPONENTS = new Map([
    ["float2", 2],
    ["float3", 3],
    ["float4", 4],
    ["half2", 2],
    ["half3", 3],
    ["half4", 4],
    ["vec2", 2],
    ["vec3", 3],
    ["vec4", 4],
    ["int2", 2],
    ["int3", 3],
    ["int4", 4],
    ["uint2", 2],
    ["uint3", 3],
    ["uint4", 4],
    ["bool2", 2],
    ["bool3", 3],
    ["bool4", 4],
    ["ivec2", 2],
    ["ivec3", 3],
    ["ivec4", 4],
    ["uvec2", 2],
    ["uvec3", 3],
    ["uvec4", 4],
    ["bvec2", 2],
    ["bvec3", 3],
    ["bvec4", 4]
]);

const TEXTURE_TYPE_NAMES = new Set([
    "texture2d",
    "texturecube",
    "texture2darray",
    "samplerstate"
]);

const TYPE_LIKE_NAMES = new Set([
    ...SCALAR_TYPE_NAMES,
    ...VECTOR_TYPE_COMPONENTS.keys(),
    ...TEXTURE_TYPE_NAMES,
    "materialattributes",
    "void"
]);

const IGNORED_IDENTIFIER_NAMES = new Set([
    "true",
    "false",
    "in",
    "out"
]);

function activate(context) {
    const bridgeDiagnostics = vscode.languages.createDiagnosticCollection(BRIDGE_DIAGNOSTIC_COLLECTION_NAME);
    const localDiagnostics = vscode.languages.createDiagnosticCollection(LOCAL_DIAGNOSTIC_COLLECTION_NAME);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = "dreamshader.recompileCurrent";
    statusBar.text = "$(refresh) DreamShaderLang";
    statusBar.tooltip = "Request Unreal Editor to recompile the current DreamShaderLang source.";
    statusBar.show();

    context.subscriptions.push(bridgeDiagnostics, localDiagnostics, statusBar);

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider({ language: LANGUAGE_ID }, createCompletionProvider(), ".", "\"", "/"),
        vscode.languages.registerHoverProvider({ language: LANGUAGE_ID }, createHoverProvider()),
        vscode.languages.registerDocumentSymbolProvider({ language: LANGUAGE_ID }, createDocumentSymbolProvider()),
        vscode.languages.registerDefinitionProvider({ language: LANGUAGE_ID }, createDefinitionProvider()),
        vscode.languages.registerDocumentFormattingEditProvider({ language: LANGUAGE_ID }, createFormattingProvider())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("dreamshader.recompileCurrent", async () => {
            await requestRecompile("file");
        }),
        vscode.commands.registerCommand("dreamshader.recompileAll", async () => {
            await requestRecompile("all");
        })
    );

    const watcher = vscode.workspace.createFileSystemWatcher("**/Saved/DreamShader/Bridge/diagnostics.json");
    watcher.onDidCreate(() => refreshBridgeDiagnostics(bridgeDiagnostics));
    watcher.onDidChange(() => refreshBridgeDiagnostics(bridgeDiagnostics));
    watcher.onDidDelete(() => refreshBridgeDiagnostics(bridgeDiagnostics));
    context.subscriptions.push(watcher);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            refreshBridgeDiagnostics(bridgeDiagnostics);
            refreshAllLocalDiagnostics(localDiagnostics);
        }),
        vscode.workspace.onDidOpenTextDocument((document) => refreshLocalDiagnosticsForDocument(document, localDiagnostics)),
        vscode.workspace.onDidChangeTextDocument((event) => refreshLocalDiagnosticsForDocument(event.document, localDiagnostics)),
        vscode.workspace.onDidCloseTextDocument((document) => localDiagnostics.delete(document.uri))
    );

    refreshBridgeDiagnostics(bridgeDiagnostics);
    refreshAllLocalDiagnostics(localDiagnostics);
}

function deactivate() {}

function createCompletionProvider() {
    return {
        provideCompletionItems(document, position) {
            const context = analyzeDocument(document, position);
            const items = [];

            if (context.afterUEAccessor && context.inGraphLikeContext) {
                for (const [name, snippet, detail] of UE_BUILTINS) {
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                    item.insertText = new vscode.SnippetString(snippet.replace(/^UE\./, ""));
                    item.detail = detail;
                    items.push(item);
                }
                return items;
            }

            addKeywordItems(items, context);
            addImportItems(items, context);
            addTypeItems(items, context);
            addQualifierItems(items, context);
            addHlslKeywordItems(items, context);
            addSettingItems(items, context);
            addOutputItems(items, context);
            addBuiltinItems(items, context);
            addHelperItems(items, context);
            addReachableFunctionItems(items, document, context);
            addDeclaredIdentifierItems(items, context);

            return items;
        }
    };
}

function createHoverProvider() {
    return {
        provideHover(document, position) {
            const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
            if (!range) {
                return undefined;
            }

            const word = document.getText(range);
            const normalized = word.toLowerCase();
            if (HOVER_DOCS.has(normalized)) {
                return new vscode.Hover(new vscode.MarkdownString(HOVER_DOCS.get(normalized)));
            }

            const setting = SETTINGS_ITEMS.find(([name]) => name.toLowerCase() === normalized);
            if (setting) {
                return new vscode.Hover(new vscode.MarkdownString(`\`${setting[0]}\`\n\n${setting[1]}`));
            }

            const output = MATERIAL_OUTPUT_ITEMS.find(([name]) => name.toLowerCase() === normalized);
            if (output) {
                return new vscode.Hover(new vscode.MarkdownString(`\`${output[0]}\`\n\n${output[1]}`));
            }

            const builtin = UE_BUILTINS.find(([name]) => name.toLowerCase() === normalized);
            if (builtin) {
                return new vscode.Hover(new vscode.MarkdownString(`\`UE.${builtin[0]}\`\n\n${builtin[2]}\n\nExample: \`${builtin[1]}\``));
            }

            const qualifiedIdentifier = getQualifiedIdentifierAtPosition(document, position);
            const definitions = collectReachableFunctionDefinitions(document);
            const matchingDefinitions = getDefinitionsForName(definitions, qualifiedIdentifier ? qualifiedIdentifier.text : word);
            if (matchingDefinitions) {
                const firstDefinition = matchingDefinitions[0];
                return new vscode.Hover(new vscode.MarkdownString(`DreamShaderLang function \`${firstDefinition.name}\`\n\nDefined in \`${path.basename(firstDefinition.fsPath)}\``));
            }

            return undefined;
        }
    };
}

function createDocumentSymbolProvider() {
    return {
        provideDocumentSymbols(document) {
            const text = document.getText();
            const symbols = [];

            for (const block of parseTopLevelBlocks(text)) {
                const start = document.positionAt(block.startOffset);
                const end = document.positionAt(block.endOffset);
                const range = new vscode.Range(start, end);
                let kind = vscode.SymbolKind.Module;
                if (block.kind === "Shader") {
                    kind = vscode.SymbolKind.Object;
                } else if (block.kind === "Function") {
                    kind = vscode.SymbolKind.Function;
                } else if (block.kind === "Namespace") {
                    kind = vscode.SymbolKind.Namespace;
                }
                symbols.push(new vscode.DocumentSymbol(block.name, "", kind, range, range));
            }

            return symbols;
        }
    };
}

function createDefinitionProvider() {
    return {
        provideDefinition(document, position) {
            const importLocation = getImportDefinitionLocation(document, position);
            if (importLocation) {
                return importLocation;
            }

            const qualifiedIdentifier = getQualifiedIdentifierAtPosition(document, position);
            if (!qualifiedIdentifier) {
                return undefined;
            }

            const definitions = collectReachableFunctionDefinitions(document);
            const matchingDefinitions = getDefinitionsForName(definitions, qualifiedIdentifier.text);
            if (!matchingDefinitions) {
                return undefined;
            }

            return matchingDefinitions.map((definition) => {
                const uri = vscode.Uri.file(definition.fsPath);
                const rangeLength = definition.nameRangeLength || definition.name.length;
                const targetRange = new vscode.Range(definition.position.line, definition.position.character, definition.position.line, definition.position.character + rangeLength);
                return new vscode.Location(uri, targetRange);
            });
        }
    };
}

function getQualifiedIdentifierAtPosition(document, position) {
    const lineText = document.lineAt(position.line).text;
    const regex = /[A-Za-z_][A-Za-z0-9_]*(?:(?:::|\.)[A-Za-z_][A-Za-z0-9_]*)*/g;
    for (const match of lineText.matchAll(regex)) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
            return {
                text: match[0],
                range: new vscode.Range(position.line, start, position.line, end)
            };
        }
    }
    return null;
}

function getDefinitionsForName(definitions, name) {
    if (!name) {
        return undefined;
    }
    if (definitions.has(name)) {
        return definitions.get(name);
    }
    const normalized = name.toLowerCase();
    for (const [key, entries] of definitions.entries()) {
        if (key.toLowerCase() === normalized) {
            return entries;
        }
    }
    return undefined;
}

function createFormattingProvider() {
    return {
        provideDocumentFormattingEdits(document) {
            const originalText = document.getText();
            const formattedText = formatDreamShaderDocument(originalText);
            if (formattedText === originalText) {
                return [];
            }

            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(originalText.length));
            return [vscode.TextEdit.replace(fullRange, formattedText)];
        }
    };
}

function addKeywordItems(items, context) {
    const keywordEntries = [
        ["Shader", "Shader(Name=\"Materials/${1:MyMaterial}\")\n{\n    $0\n}"],
        ["Function", "Function ${1:MyFunction}(in ${2:vec2} ${3:uv}, out ${4:vec4} ${5:result}) {\n    ${5:result} = ${4:vec4}(0.0, 0.0, 0.0, 1.0);\n}"],
        ["Namespace", "Namespace(Name=\"${1:Common}\")\n{\n    Function ${2:MyFunction}(in ${3:vec3} ${4:input}, out ${5:vec3} ${6:result}) {\n        ${6:result} = ${4:input};\n    }\n}"],
        ["import", "import \"${1:Shared/Common.dsh}\";"],
        ["ShaderFunction", "ShaderFunction(Name=\"Functions/${1:MyFunction}\")\n{\n    Inputs = {\n        $2\n    }\n\n    Outputs = {\n        $3\n    }\n\n    Code = {\n        $0\n    }\n}"]
    ];

    if (context.inFunctionBody || context.inFunctionSignature || context.currentSection) {
        return;
    }

    if (!context.currentLegacyBlock) {
        for (const [label, snippet] of keywordEntries) {
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
            item.insertText = new vscode.SnippetString(snippet);
            items.push(item);
        }
        return;
    }

    const allowedSections = BLOCK_SECTION_RULES.get(context.currentLegacyBlock.kind);
    if (!allowedSections) {
        return;
    }

    for (const sectionName of LEGACY_SECTION_NAMES) {
        if (!allowedSections.has(sectionName)) {
            continue;
        }

        const item = new vscode.CompletionItem(sectionName, vscode.CompletionItemKind.Module);
        item.insertText = new vscode.SnippetString(`${sectionName} = {\n    $0\n}`);
        items.push(item);
    }
}

function addImportItems(items, context) {
    if (!context.inImportLine) {
        return;
    }

    for (const headerPath of collectAvailableHeaderImports(context.document)) {
        const item = new vscode.CompletionItem(headerPath, vscode.CompletionItemKind.File);
        item.insertText = new vscode.SnippetString(`"${headerPath}"`);
        item.detail = "DreamShader header import";
        items.push(item);
    }
}

function addTypeItems(items, context) {
    const typeItems = context.inRawHlslContext || context.inFunctionSignature ? HLSL_TYPE_ITEMS : GRAPH_TYPE_ITEMS;
    for (const [name, detail] of typeItems) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.TypeParameter);
        item.detail = detail;
        items.push(item);
    }
}

function addQualifierItems(items, context) {
    if (!context.inFunctionSignature) {
        return;
    }

    for (const [name, detail] of QUALIFIER_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.detail = detail;
        items.push(item);
    }
}

function addHlslKeywordItems(items, context) {
    if (!context.inRawHlslContext && !context.inFunctionSignature) {
        return;
    }

    for (const [name, detail] of HLSL_KEYWORD_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.detail = detail;
        items.push(item);
    }
}

function addSettingItems(items, context) {
    if (!context.inSettings) {
        return;
    }

    for (const [name, detail] of SETTINGS_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
        item.insertText = new vscode.SnippetString(`${name} = "$0";`);
        item.detail = detail;
        items.push(item);
    }
}

function addOutputItems(items, context) {
    if (!context.inMaterialOutputs) {
        return;
    }

    for (const [name, detail] of MATERIAL_OUTPUT_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
        item.detail = detail;
        items.push(item);
    }
}

function addBuiltinItems(items, context) {
    if (!context.inGraphLikeContext) {
        return;
    }

    const ueRoot = new vscode.CompletionItem("UE", vscode.CompletionItemKind.Module);
    ueRoot.insertText = new vscode.SnippetString("UE.$0");
    ueRoot.detail = "DreamShader UE material expression namespace";
    items.push(ueRoot);

    for (const [name, snippet, detail] of UE_BUILTINS) {
        const item = new vscode.CompletionItem(`UE.${name}`, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = detail;
        items.push(item);
    }
}

function addHelperItems(items, context) {
    if (context.currentSection !== "Properties") {
        return;
    }

    for (const [name, snippet, detail] of DREAMSHADER_HELPER_ITEMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = detail;
        items.push(item);
    }
}

function addReachableFunctionItems(items, document, context) {
    const definitions = collectReachableFunctionDefinitions(document);
    const namespaceMatch = context?.linePrefix?.match(/([A-Za-z_][A-Za-z0-9_]*)::[A-Za-z0-9_]*$/);
    const namespacePrefix = namespaceMatch ? `${namespaceMatch[1]}::` : "";

    for (const [name, entries] of definitions.entries()) {
        if (namespacePrefix && !name.startsWith(namespacePrefix)) {
            continue;
        }

        const entry = entries[0];
        const localName = namespacePrefix ? (entry.localName || name.slice(namespacePrefix.length)) : name;
        const item = new vscode.CompletionItem(localName, vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(localName);
        item.detail = entry.sourceKind === "imported" ? "Imported DreamShader function" : "DreamShader function";
        if (namespacePrefix) {
            item.documentation = new vscode.MarkdownString(`Namespace function \`${name}\``);
        }
        items.push(item);
    }
}
function addDeclaredIdentifierItems(items, context) {
    for (const entry of collectVisibleIdentifierEntries(context)) {
        const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Variable);
        item.detail = entry.detail;
        items.push(item);
    }
}

function analyzeDocument(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const prefix = text.slice(0, offset);
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const topLevelBlocks = parseTopLevelBlocks(text);
    const currentLegacyBlock = findEnclosingTopLevelBlock(topLevelBlocks, offset, new Set(["Shader", "ShaderFunction"]));
    const currentSectionInfo = currentLegacyBlock ? findEnclosingLegacySection(text, currentLegacyBlock, offset) : null;
    const currentBlock = currentLegacyBlock ? currentLegacyBlock.kind : "";
    const currentSection = currentSectionInfo ? currentSectionInfo.name : "";
    const currentFunction = findInnermostFunctionDefinition(text, offset);
    const inFunctionSignature = Boolean(currentFunction && offset > currentFunction.paramOpenOffset && offset < currentFunction.paramCloseOffset);
    const inFunctionBody = Boolean(currentFunction && offset > currentFunction.bodyOpenOffset && offset < currentFunction.bodyCloseOffset);
    const inRawHlslContext = inFunctionBody;
    const inGraphCode = currentSection === "Code";
    const inImportLine = /^\s*import\b/i.test(linePrefix.trimStart());

    return {
        document,
        text,
        offset,
        currentBlock,
        currentSection,
        currentFunction,
        currentLegacyBlock,
        currentSectionInfo,
        linePrefix,
        inFunctionSignature,
        inFunctionBody,
        inRawHlslContext,
        inGraphCode,
        inSettings: currentSection === "Settings",
        inProperties: currentSection === "Properties" || currentSection === "Inputs",
        inOutputs: currentSection === "Outputs",
        inMaterialOutputs: currentSection === "Outputs" && currentBlock === "Shader",
        inGraphLikeContext: inGraphCode || currentSection === "Properties",
        inImportLine,
        afterUEAccessor: /UE\.\w*$/.test(linePrefix)
    };
}

function findCurrentLegacyTopLevelBlock(prefix) {
    const blockRegex = /\b(?:Shader|ShaderFunction)\s*\(/g;
    let current = "";
    for (const match of prefix.matchAll(blockRegex)) {
        const blockName = match[0].match(/[A-Za-z_][A-Za-z0-9_]*/);
        if (blockName) {
            current = blockName[0];
        }
    }
    return current;
}

function findCurrentLegacySection(prefix) {
    const sectionRegex = /\b(Properties|Settings|Outputs|Code|Inputs)\s*=\s*\{/g;
    let current = "";
    for (const match of prefix.matchAll(sectionRegex)) {
        current = match[1];
    }
    return current;
}

function parseTopLevelBlocks(text) {
    const blocks = [];

    for (const match of text.matchAll(/\bShader\s*\(\s*Name\s*=\s*"([^"]+)"/g)) {
        blocks.push(makeSimpleBlock("Shader", match[1], match.index, text, "{", "}"));
    }

    for (const namespaceBlock of parseNamespaceBlocks(text)) {
        blocks.push(namespaceBlock);
    }

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        blocks.push({
            kind: definition.kind,
            name: definition.name,
            startOffset: definition.startOffset,
            endOffset: definition.bodyCloseOffset + 1
        });
    }

    for (const match of text.matchAll(/\bShaderFunction\s*\(\s*Name\s*=\s*"([^"]+)"/g)) {
        blocks.push(makeSimpleBlock("ShaderFunction", match[1], match.index, text, "{", "}"));
    }

    return blocks.filter(Boolean).sort((a, b) => a.startOffset - b.startOffset);
}

function parseNamespaceBlocks(text) {
    const blocks = [];
    for (const match of text.matchAll(/\bNamespace\s*\(\s*Name\s*=\s*"([^"]+)"/g)) {
        const block = makeSimpleBlock("Namespace", match[1], match.index, text, "{", "}");
        if (block) {
            blocks.push(block);
        }
    }
    return blocks;
}

function findEnclosingNamespaceBlock(namespaceBlocks, offset) {
    return namespaceBlocks
        .filter((block) => typeof block.bodyOpenOffset === "number"
            && typeof block.bodyCloseOffset === "number"
            && offset > block.bodyOpenOffset
            && offset < block.bodyCloseOffset)
        .sort((a, b) => (a.bodyCloseOffset - a.bodyOpenOffset) - (b.bodyCloseOffset - b.bodyOpenOffset))[0];
}

function makeSimpleBlock(kind, name, startOffset, text, openChar, closeChar) {
    if (typeof startOffset !== "number") {
        return undefined;
    }

    const braceIndex = text.indexOf(openChar, startOffset);
    if (braceIndex === -1) {
        return undefined;
    }

    const closeIndex = findMatchingDelimiter(text, braceIndex, openChar, closeChar);
    return {
        kind,
        name,
        startOffset,
        bodyOpenOffset: braceIndex,
        bodyCloseOffset: closeIndex,
        endOffset: closeIndex === -1 ? braceIndex + 1 : closeIndex + 1
    };
}

function findEnclosingTopLevelBlock(blocks, offset, allowedKinds) {
    return blocks
        .filter((block) => {
            if (allowedKinds && !allowedKinds.has(block.kind)) {
                return false;
            }

            return typeof block.startOffset === "number"
                && typeof block.endOffset === "number"
                && offset >= block.startOffset
                && offset <= block.endOffset;
        })
        .sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))[0];
}

function findEnclosingLegacySection(text, block, offset) {
    return parseLegacySections(text, block)
        .filter((section) => typeof section.bodyOpenOffset === "number"
            && typeof section.bodyCloseOffset === "number"
            && section.bodyCloseOffset >= section.bodyOpenOffset
            && offset >= section.bodyOpenOffset
            && offset <= section.bodyCloseOffset + 1)
        .sort((a, b) => (a.bodyCloseOffset - a.bodyOpenOffset) - (b.bodyCloseOffset - b.bodyOpenOffset))[0];
}

function parseFunctionDefinitionsFromText(text) {
    const definitions = [];
    const namespaceBlocks = parseNamespaceBlocks(text);
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (!matchKeywordAt(text, index, "Function")) {
            continue;
        }

        let cursor = index + "Function".length;
        cursor = skipWhitespace(text, cursor);
        if (!isIdentifierStart(text[cursor])) {
            continue;
        }

        const nameStart = cursor;
        cursor += 1;
        while (cursor < text.length && isIdentifierPart(text[cursor])) {
            cursor += 1;
        }
        const localName = text.slice(nameStart, cursor);

        cursor = skipWhitespace(text, cursor);
        if (text[cursor] !== "(") {
            continue;
        }

        const paramOpenOffset = cursor;
        const paramCloseOffset = findMatchingDelimiter(text, cursor, "(", ")");
        if (paramCloseOffset === -1) {
            continue;
        }

        cursor = skipWhitespace(text, paramCloseOffset + 1);
        if (text[cursor] !== "{") {
            continue;
        }

        const bodyCloseOffset = findMatchingDelimiter(text, cursor, "{", "}");
        if (bodyCloseOffset === -1) {
            continue;
        }

        const namespaceBlock = findEnclosingNamespaceBlock(namespaceBlocks, index);
        const namespaceName = namespaceBlock ? namespaceBlock.name : "";
        const name = namespaceName ? `${namespaceName}::${localName}` : localName;

        definitions.push({
            kind: "Function",
            name,
            localName,
            namespaceName,
            nameRangeLength: localName.length,
            startOffset: index,
            nameOffset: nameStart,
            paramOpenOffset,
            paramCloseOffset,
            bodyOpenOffset: cursor,
            bodyCloseOffset
        });

        index = bodyCloseOffset;
    }

    return definitions;
}
function findInnermostFunctionDefinition(text, offset) {
    const definitions = parseFunctionDefinitionsFromText(text)
        .filter((definition) => definition.kind === "Function" && offset >= definition.startOffset && offset <= definition.bodyCloseOffset)
        .sort((a, b) => (a.bodyCloseOffset - a.startOffset) - (b.bodyCloseOffset - b.startOffset));
    return definitions[0];
}

function parseImportStatements(text) {
    const imports = [];
    const lineRegex = /^\s*import\s+["']([^"']+)["']\s*;/gm;
    for (const match of text.matchAll(lineRegex)) {
        imports.push({
            path: match[1],
            startOffset: match.index,
            endOffset: match.index + match[0].length,
            pathOffset: match.index + match[0].indexOf(match[1])
        });
    }
    return imports;
}

function parseNamedLegacyBlocks(text, kind) {
    let regex;
    if (kind === "Shader") {
        regex = /\bShader\s*\(\s*Name\s*=\s*"([^"]+)"/g;

    } else if (kind === "ShaderFunction") {
        regex = /\bShaderFunction\s*\(\s*Name\s*=\s*"([^"]+)"/g;
    } else {
        return [];
    }

    const blocks = [];
    for (const match of text.matchAll(regex)) {
        const block = makeSimpleBlock(kind, match[1], match.index, text, "{", "}");
        if (block) {
            blocks.push(block);
        }
    }
    return blocks;
}

function skipTrivia(text, index, endIndex = text.length) {
    let cursor = index;
    while (cursor < endIndex) {
        const char = text[cursor];
        const next = cursor + 1 < endIndex ? text[cursor + 1] : "\0";
        if (/\s/.test(char)) {
            cursor += 1;
            continue;
        }
        if (char === "/" && next === "/") {
            cursor += 2;
            while (cursor < endIndex && text[cursor] !== "\n") {
                cursor += 1;
            }
            continue;
        }
        if (char === "/" && next === "*") {
            cursor += 2;
            while (cursor + 1 < endIndex && !(text[cursor] === "*" && text[cursor + 1] === "/")) {
                cursor += 1;
            }
            cursor = Math.min(endIndex, cursor + 2);
            continue;
        }
        break;
    }
    return cursor;
}

function parseLegacySections(text, block) {
    const sections = [];
    if (typeof block.bodyOpenOffset !== "number" || typeof block.bodyCloseOffset !== "number" || block.bodyCloseOffset < 0) {
        return sections;
    }

    let cursor = block.bodyOpenOffset + 1;
    while (cursor < block.bodyCloseOffset) {
        cursor = skipTrivia(text, cursor, block.bodyCloseOffset);
        if (cursor >= block.bodyCloseOffset || !isIdentifierStart(text[cursor])) {
            cursor += 1;
            continue;
        }

        const nameStart = cursor;
        cursor += 1;
        while (cursor < block.bodyCloseOffset && isIdentifierPart(text[cursor])) {
            cursor += 1;
        }
        const name = text.slice(nameStart, cursor);

        cursor = skipWhitespace(text, cursor);
        if (text[cursor] !== "=") {
            continue;
        }

        cursor = skipWhitespace(text, cursor + 1);
        if (text[cursor] !== "{") {
            continue;
        }

        const bodyOpenOffset = cursor;
        const bodyCloseOffset = findMatchingDelimiter(text, bodyOpenOffset, "{", "}");
        if (bodyCloseOffset === -1) {
            sections.push({
                name,
                nameOffset: nameStart,
                bodyOpenOffset,
                bodyCloseOffset: -1,
                bodyText: text.slice(bodyOpenOffset + 1, block.bodyCloseOffset)
            });
            break;
        }

        sections.push({
            name,
            nameOffset: nameStart,
            bodyOpenOffset,
            bodyCloseOffset,
            bodyText: text.slice(bodyOpenOffset + 1, bodyCloseOffset)
        });

        cursor = bodyCloseOffset + 1;
    }

    return sections;
}

function splitTopLevelDelimitedWithOffsets(text, baseOffset, delimiter) {
    const normalizedText = stripCommentsPreserveLayout(text);
    const segments = [];
    let startIndex = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < normalizedText.length; index += 1) {
        const char = normalizedText[index];
        const next = index + 1 < normalizedText.length ? normalizedText[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }
        if (char === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (char === delimiter && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            const raw = normalizedText.slice(startIndex, index);
            const trimmedStartDelta = raw.search(/\S|$/);
            const trimmedEndDelta = raw.length - raw.trimEnd().length;
            const trimmed = raw.trim();
            if (trimmed) {
                segments.push({
                    text: trimmed,
                    startOffset: baseOffset + startIndex + trimmedStartDelta,
                    endOffset: baseOffset + index - trimmedEndDelta
                });
            }
            startIndex = index + 1;
        }
    }

    const trailingRaw = normalizedText.slice(startIndex);
    const trimmedStartDelta = trailingRaw.search(/\S|$/);
    const trimmedEndDelta = trailingRaw.length - trailingRaw.trimEnd().length;
    const trailing = trailingRaw.trim();
    if (trailing) {
        segments.push({
            text: trailing,
            startOffset: baseOffset + startIndex + trimmedStartDelta,
            endOffset: baseOffset + normalizedText.length - trimmedEndDelta,
            terminated: false
        });
    }

    return segments;
}

function stripCommentsPreserveLayout(text) {
    let result = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
                result += "\n";
            } else if (char === "\r") {
                result += "\r";
            } else {
                result += " ";
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                result += "  ";
                inBlockComment = false;
                index += 1;
                continue;
            }

            if (char === "\n" || char === "\r") {
                result += char;
            } else {
                result += " ";
            }
            continue;
        }

        if (inString) {
            result += char;
            if (char === "\\") {
                if (index + 1 < text.length) {
                    result += text[index + 1];
                    index += 1;
                }
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            result += char;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            result += "  ";
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            result += "  ";
            index += 1;
            continue;
        }

        result += char;
    }

    return result;
}

function splitStatementsWithOffsets(text, baseOffset) {
    return splitTopLevelDelimitedWithOffsets(text, baseOffset, ";").map((segment) => ({
        ...segment,
        terminated: segment.terminated !== false
    }));
}

function splitTopLevelAssignment(text) {
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "(") {
            parenDepth += 1;
            continue;
        }
        if (char === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }
        if (char === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
            continue;
        }

        if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
            return {
                left: text.slice(0, index).trim(),
                right: text.slice(index + 1).trim(),
                equalsIndex: index
            };
        }
    }

    return null;
}

function splitDeclarationTypeAndName(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!match) {
        return null;
    }

    return {
        type: match[1].trim(),
        name: match[2].trim()
    };
}

function normalizeSymbolKey(name) {
    return String(name || "").trim().toLowerCase();
}

function resolveTypeInfo(typeText) {
    const normalized = String(typeText || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!normalized) {
        return null;
    }

    if (SCALAR_TYPE_NAMES.has(normalized)) {
        return { type: normalized, componentCount: 1, isTexture: false };
    }

    if (VECTOR_TYPE_COMPONENTS.has(normalized)) {
        return { type: normalized, componentCount: VECTOR_TYPE_COMPONENTS.get(normalized), isTexture: false };
    }

    if (TEXTURE_TYPE_NAMES.has(normalized)) {
        return { type: normalized, componentCount: 0, isTexture: true };
    }

    if (normalized === "materialattributes") {
        return { type: normalized, componentCount: 0, isTexture: false };
    }

    return null;
}

function isTypeLikeName(name) {
    return TYPE_LIKE_NAMES.has(String(name || "").trim().toLowerCase());
}

function parseFunctionSignatureParameters(definition, text) {
    const parameterText = text.slice(definition.paramOpenOffset + 1, definition.paramCloseOffset);
    const segments = splitTopLevelDelimitedWithOffsets(parameterText, definition.paramOpenOffset + 1, ",");
    const inputs = [];
    const outputs = [];

    for (const segment of segments) {
        const parts = segment.text.split(/\s+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 3) {
            continue;
        }

        let qualifier = "in";
        let typeText = parts[0];
        let name = parts[1];
        if (parts.length === 3) {
            qualifier = parts[0].toLowerCase();
            typeText = parts[1];
            name = parts[2];
        }

        const entry = {
            qualifier,
            type: typeText,
            name
        };

        if (qualifier === "out") {
            outputs.push(entry);
        } else {
            inputs.push(entry);
        }
    }

    return { inputs, outputs };
}

function parseTypedDeclarationsFromSection(section, allowBindings = false) {
    const declarations = [];
    const bindings = [];
    const statements = splitStatementsWithOffsets(section.bodyText, section.bodyOpenOffset + 1);

    for (const statement of statements) {
        const assignment = splitTopLevelAssignment(statement.text);
        if (assignment) {
            const declaration = splitDeclarationTypeAndName(assignment.left);
            if (declaration) {
                declarations.push({
                    ...statement,
                    kind: "declaration",
                    type: declaration.type,
                    name: declaration.name,
                    valueText: assignment.right
                });
                continue;
            }

            if (allowBindings) {
                bindings.push({
                    ...statement,
                    kind: "binding",
                    target: assignment.left,
                    valueText: assignment.right
                });
                continue;
            }
        }

        const declaration = splitDeclarationTypeAndName(statement.text);
        if (declaration) {
            declarations.push({
                ...statement,
                kind: "declaration",
                type: declaration.type,
                name: declaration.name,
                valueText: ""
            });
            continue;
        }

        declarations.push({
            ...statement,
            kind: "invalid"
        });
    }

    return { declarations, bindings, statements };
}

function addCallableSignature(map, signature) {
    const key = normalizeSymbolKey(signature.name);
    if (!key) {
        return;
    }
    if (!map.has(key)) {
        map.set(key, []);
    }
    map.get(key).push(signature);
}

function collectReachableCallableSignatures(document) {
    const results = new Map();
    const visited = new Set();
    collectReachableCallableSignaturesFromFile(document.fileName, document.getText(), results, visited);
    return results;
}

function collectReachableCallableSignaturesFromFile(fsPath, text, results, visited) {
    const normalizedPath = normalizeFsPath(fsPath);
    if (visited.has(normalizedPath)) {
        return;
    }
    visited.add(normalizedPath);

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (definition.kind !== "Function") {
            continue;
        }

        const parameters = parseFunctionSignatureParameters(definition, text);
        addCallableSignature(results, {
            kind: "Function",
            name: definition.name,
            inputs: parameters.inputs,
            outputs: parameters.outputs,
            fsPath: normalizedPath,
            nameOffset: definition.nameOffset
        });
    }


    for (const block of parseNamedLegacyBlocks(text, "ShaderFunction")) {
        const sectionMap = new Map(parseLegacySections(text, block).map((section) => [section.name, section]));
        const inputs = sectionMap.has("Inputs") ? parseTypedDeclarationsFromSection(sectionMap.get("Inputs")).declarations.filter((entry) => entry.kind === "declaration") : [];
        const outputs = sectionMap.has("Outputs") ? parseTypedDeclarationsFromSection(sectionMap.get("Outputs")).declarations.filter((entry) => entry.kind === "declaration") : [];
        addCallableSignature(results, {
            kind: "ShaderFunction",
            name: block.name,
            inputs: inputs.map((entry) => ({ type: entry.type, name: entry.name })),
            outputs: outputs.map((entry) => ({ type: entry.type, name: entry.name })),
            fsPath: normalizedPath,
            nameOffset: block.startOffset
        });
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(normalizedPath, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            continue;
        }

        try {
            const importedText = fs.readFileSync(resolvedPath, "utf8");
            collectReachableCallableSignaturesFromFile(resolvedPath, importedText, results, visited);
        } catch (_error) {
            // Ignore unreadable imports here; diagnostics handle reporting separately.
        }
    }
}

function collectReachableFunctionDefinitions(document) {
    const results = new Map();
    const visited = new Set();
    collectReachableFunctionDefinitionsFromFile(document.fileName, document.getText(), true, results, visited);
    return results;
}

function collectReachableFunctionDefinitionsFromFile(fsPath, text, isRoot, results, visited) {
    const normalizedPath = normalizeFsPath(fsPath);
    if (visited.has(normalizedPath)) {
        return;
    }
    visited.add(normalizedPath);

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        const location = {
            name: definition.name,
            localName: definition.localName || definition.name,
            nameRangeLength: definition.nameRangeLength || definition.name.length,
            fsPath: normalizedPath,
            position: offsetToPosition(text, definition.nameOffset),
            sourceKind: isRoot ? "local" : "imported"
        };

        if (!results.has(definition.name)) {
            results.set(definition.name, []);
        }
        results.get(definition.name).push(location);
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(normalizedPath, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            continue;
        }

        try {
            const importedText = fs.readFileSync(resolvedPath, "utf8");
            collectReachableFunctionDefinitionsFromFile(resolvedPath, importedText, false, results, visited);
        } catch (_error) {
            // Ignore unreadable imports here; diagnostics handle reporting.
        }
    }
}

function collectAvailableHeaderImports(document) {
    const root = findProjectRoot(document.fileName);
    const headers = new Set();
    const candidateRoots = [];

    if (root) {
        candidateRoots.push(path.join(root, "DShader"));
        candidateRoots.push(path.join(root, "Plugins", "DreamShader", "Library"));
    }

    for (const headerRoot of candidateRoots) {
        if (!fs.existsSync(headerRoot)) {
            continue;
        }

        collectHeaderFiles(headerRoot, headerRoot, headers);
    }

    return Array.from(headers).sort();
}

function collectHeaderFiles(rootDirectory, currentDirectory, outHeaders) {
    let entries = [];
    try {
        entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch (_error) {
        return;
    }

    for (const entry of entries) {
        const absolutePath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
            collectHeaderFiles(rootDirectory, absolutePath, outHeaders);
            continue;
        }

        if (path.extname(entry.name).toLowerCase() !== ".dsh") {
            continue;
        }

        outHeaders.add(normalizeFsPath(path.relative(rootDirectory, absolutePath)));
    }
}

function collectVisibleIdentifierEntries(context) {
    const entries = new Map();
    const { text, offset, currentFunction, currentLegacyBlock, currentSectionInfo } = context;

    if (context.inFunctionBody && currentFunction) {
        const parameters = parseFunctionSignatureParameters(currentFunction, text);
        for (const parameter of [...parameters.inputs, ...parameters.outputs]) {
            addVisibleIdentifierEntry(entries, parameter.name, `${parameter.type} Function ${parameter.qualifier} parameter`);
        }

        addLocalDeclarationEntries(entries, text, currentFunction.bodyOpenOffset + 1, offset, "Function local variable");
        return Array.from(entries.values());
    }

    if (!currentLegacyBlock || !currentSectionInfo) {
        return [];
    }

    const sectionMap = new Map(parseLegacySections(text, currentLegacyBlock).map((section) => [section.name, section]));
    const primaryDeclarationSectionName = currentLegacyBlock.kind === "Shader"
        ? "Properties"
        : "Inputs";
    const secondaryDeclarationSectionName = "Outputs";

    if (currentSectionInfo.name === primaryDeclarationSectionName || currentSectionInfo.name === secondaryDeclarationSectionName) {
        if (currentSectionInfo.name === secondaryDeclarationSectionName) {
            addSectionDeclarationEntries(
                entries,
                sectionMap.get(primaryDeclarationSectionName),
                Number.POSITIVE_INFINITY,
                describeSectionSymbol(currentLegacyBlock.kind, primaryDeclarationSectionName)
            );
        }

        addSectionDeclarationEntries(
            entries,
            currentSectionInfo,
            offset,
            describeSectionSymbol(currentLegacyBlock.kind, currentSectionInfo.name)
        );
        return Array.from(entries.values());
    }

    if (currentSectionInfo.name === "Code") {
        addSectionDeclarationEntries(
            entries,
            sectionMap.get(primaryDeclarationSectionName),
            Number.POSITIVE_INFINITY,
            describeSectionSymbol(currentLegacyBlock.kind, primaryDeclarationSectionName)
        );
        addSectionDeclarationEntries(
            entries,
            sectionMap.get(secondaryDeclarationSectionName),
            Number.POSITIVE_INFINITY,
            describeSectionSymbol(currentLegacyBlock.kind, secondaryDeclarationSectionName)
        );

        const reachableCallables = collectReachableCallableSignatures(context.document);
        addGraphCodeEntries(entries, currentSectionInfo, offset, reachableCallables);
    }

    return Array.from(entries.values());
}

function addVisibleIdentifierEntry(entries, name, detail) {
    const normalized = normalizeSymbolKey(name);
    if (!normalized || entries.has(normalized)) {
        return;
    }

    entries.set(normalized, { name, detail });
}

function describeSectionSymbol(blockKind, sectionName) {
    const sectionLabelMap = new Map([
        ["Properties", "property"],
        ["Inputs", "input"],
        ["Outputs", "output"],
        ["Results", "result"]
    ]);

    return `${blockKind} ${sectionLabelMap.get(sectionName) || sectionName.toLowerCase()}`;
}

function addSectionDeclarationEntries(entries, section, cutoffOffset, detailLabel) {
    if (!section) {
        return;
    }

    const allowBindings = section.name === "Outputs";
    const parsed = parseTypedDeclarationsFromSection(section, allowBindings);
    for (const declaration of parsed.declarations) {
        if (declaration.kind !== "declaration" || declaration.startOffset >= cutoffOffset) {
            continue;
        }

        addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} ${detailLabel}`);
    }
}

function addLocalDeclarationEntries(entries, text, startOffset, cutoffOffset, detailLabel) {
    if (cutoffOffset <= startOffset) {
        return;
    }

    const visibleText = text.slice(startOffset, cutoffOffset);
    const statements = splitStatementsWithOffsets(visibleText, startOffset);
    for (const statement of statements) {
        const assignment = splitTopLevelAssignment(statement.text);
        const declaration = assignment
            ? splitDeclarationTypeAndName(assignment.left)
            : splitDeclarationTypeAndName(statement.text);
        if (!declaration) {
            continue;
        }

        addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} ${detailLabel}`);
    }
}

function addGraphCodeEntries(entries, codeSection, cutoffOffset, reachableCallables) {
    if (!codeSection || cutoffOffset <= codeSection.bodyOpenOffset + 1) {
        return;
    }

    const visibleText = codeSection.bodyText.slice(0, Math.max(0, cutoffOffset - (codeSection.bodyOpenOffset + 1)));
    const statements = splitStatementsWithOffsets(visibleText, codeSection.bodyOpenOffset + 1);
    for (const statement of statements) {
        const assignment = splitTopLevelAssignment(statement.text);
        if (assignment) {
            const declaration = splitDeclarationTypeAndName(assignment.left);
            if (declaration) {
                addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} Code local variable`);
            }
            continue;
        }

        const declaration = splitDeclarationTypeAndName(statement.text);
        if (declaration) {
            addVisibleIdentifierEntry(entries, declaration.name, `${declaration.type} Code local variable`);
            continue;
        }

        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (!callExpression) {
            continue;
        }

        const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
        const signature = signatures.find((entry) => entry.kind === "Function");
        if (!signature) {
            continue;
        }

        for (let index = 0; index < signature.outputs.length; index += 1) {
            const argument = callExpression.arguments[signature.inputs.length + index];
            if (!argument || argument.isNamed || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument.valueText)) {
                continue;
            }

            addVisibleIdentifierEntry(entries, argument.valueText, `${signature.outputs[index].type} Code out variable`);
        }
    }
}

function getImportDefinitionLocation(document, position) {
    const offset = document.offsetAt(position);
    for (const importStatement of parseImportStatements(document.getText())) {
        if (offset < importStatement.pathOffset || offset > importStatement.pathOffset + importStatement.path.length) {
            continue;
        }

        const resolvedPath = resolveImportPath(document.fileName, importStatement.path);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            return undefined;
        }

        return new vscode.Location(vscode.Uri.file(resolvedPath), new vscode.Position(0, 0));
    }

    return undefined;
}

function refreshAllLocalDiagnostics(collection) {
    for (const document of vscode.workspace.textDocuments) {
        refreshLocalDiagnosticsForDocument(document, collection);
    }
}

function refreshLocalDiagnosticsForDocument(document, collection) {
    if (!isDreamShaderDocument(document)) {
        return;
    }

    const diagnostics = computeLocalDiagnostics(document);
    collection.set(document.uri, diagnostics);
}

function computeLocalDiagnostics(document) {
    const diagnostics = [];
    const text = document.getText();
    const extension = path.extname(document.fileName).toLowerCase();
    const reachableCallables = collectReachableCallableSignatures(document);

    if (extension === ".dsm" && !/\bShader\s*\(/.test(text) && !/\bShaderFunction\s*\(/.test(text)) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            "DreamShader implementation (.dsm) should declare a top-level Shader(Name=\"...\") or ShaderFunction(Name=\"...\") block.",
            vscode.DiagnosticSeverity.Warning));
    }

    if (extension === ".dsh" && (/\bShader\s*\(/.test(text) || /\bShaderFunction\s*\(/.test(text))) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            "DreamShader header (.dsh) may only contain import statements, Function blocks, and Namespace blocks.",
            vscode.DiagnosticSeverity.Error));
    }

    for (const importStatement of parseImportStatements(text)) {
        const resolvedPath = resolveImportPath(document.fileName, importStatement.path);
        if (resolvedPath && fs.existsSync(resolvedPath)) {
            continue;
        }

        const start = document.positionAt(importStatement.pathOffset);
        const end = document.positionAt(importStatement.pathOffset + importStatement.path.length);
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(start, end),
            `DreamShader import '${importStatement.path}' could not be resolved.`,
            vscode.DiagnosticSeverity.Error));
    }

    const seenFunctions = new Map();
    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (!seenFunctions.has(definition.name)) {
            seenFunctions.set(definition.name, []);
        }
        seenFunctions.get(definition.name).push(definition);
    }

    for (const [name, definitions] of seenFunctions.entries()) {
        if (definitions.length < 2) {
            continue;
        }

        for (const definition of definitions) {
            const start = document.positionAt(definition.nameOffset);
            const end = new vscode.Position(start.line, start.character + (definition.nameRangeLength || definition.localName?.length || name.length));
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(start, end),
                `DreamShader function '${name}' is declared more than once in this file.`,
                vscode.DiagnosticSeverity.Error));
        }
    }

    for (const definition of parseFunctionDefinitionsFromText(text)) {
        if (definition.kind !== "Function") {
            continue;
        }

        diagnostics.push(...computeFunctionSignatureDiagnostics(document, text, definition));
    }

    diagnostics.push(...computeDetailedBlockDiagnostics(document, text, reachableCallables));
    diagnostics.push(...computeBraceDiagnostics(document, text));
    return diagnostics;
}

function computeFunctionSignatureDiagnostics(document, text, definition) {
    const diagnostics = [];
    const parameterText = text.slice(definition.paramOpenOffset + 1, definition.paramCloseOffset);
    const parameters = splitTopLevelParameters(parameterText);
    let sawOutParameter = false;

    for (const parameter of parameters) {
        const trimmed = parameter.trim();
        if (!trimmed) {
            continue;
        }

        const parts = trimmed.split(/\s+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 3) {
            diagnostics.push(makeFunctionDiagnostic(
                document,
                definition,
                `Function '${definition.name}' has an invalid parameter declaration '${trimmed}'.`));
            continue;
        }

        let qualifier = "in";
        if (parts.length === 3) {
            qualifier = parts[0].toLowerCase();
        }

        if (!["in", "out"].includes(qualifier)) {
            diagnostics.push(makeFunctionDiagnostic(
                document,
                definition,
                `Function '${definition.name}' parameter '${trimmed}' uses unsupported qualifier '${parts[0]}'. Supported qualifiers are in and out.`));
            continue;
        }

        if (qualifier === "out") {
            sawOutParameter = true;
        }
    }

    if (!sawOutParameter) {
        diagnostics.push(makeFunctionDiagnostic(
            document,
            definition,
            `Function '${definition.name}' must declare at least one out parameter.`));
    }

    return diagnostics;
}

function makeFunctionDiagnostic(document, definition, message) {
    const start = document.positionAt(definition.nameOffset);
    const end = new vscode.Position(start.line, start.character + (definition.nameRangeLength || definition.localName?.length || definition.name.length));
    return new vscode.Diagnostic(new vscode.Range(start, end), message, vscode.DiagnosticSeverity.Error);
}

function computeDetailedBlockDiagnostics(document, text, reachableCallables) {
    const diagnostics = [];
    const blocks = [
        ...parseNamedLegacyBlocks(text, "Shader"),
        ...parseNamedLegacyBlocks(text, "ShaderFunction")
    ].sort((a, b) => a.startOffset - b.startOffset);

    for (const block of blocks) {
        diagnostics.push(...analyzeLegacyBlockDiagnostics(document, block, text, reachableCallables));
    }

    return diagnostics;
}

function analyzeLegacyBlockDiagnostics(document, block, text, reachableCallables) {
    const diagnostics = [];
    const sections = parseLegacySections(text, block);
    const allowedSections = BLOCK_SECTION_RULES.get(block.kind) || new Set();
    const seenSections = new Map();

    for (const section of sections) {
        if (!allowedSections.has(section.name)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                section.nameOffset,
                section.nameOffset + section.name.length,
                `${block.kind} block '${block.name}' does not support section '${section.name}'.`));
            continue;
        }

        if (!seenSections.has(section.name)) {
            seenSections.set(section.name, []);
        }
        seenSections.get(section.name).push(section);
    }

    for (const [sectionName, entries] of seenSections.entries()) {
        if (entries.length < 2) {
            continue;
        }

        for (const entry of entries) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                entry.nameOffset,
                entry.nameOffset + sectionName.length,
                `${block.kind} block '${block.name}' declares section '${sectionName}' more than once.`));
        }
    }

    const symbols = new Map();

    if (block.kind === "Shader") {
        const propertiesSection = seenSections.get("Properties")?.[0];
        const outputsSection = seenSections.get("Outputs")?.[0];
        if (propertiesSection) {
            diagnostics.push(...validateDeclarationSection(document, propertiesSection, symbols, "Properties", false));
        }
        if (outputsSection) {
            diagnostics.push(...validateDeclarationSection(document, outputsSection, symbols, "Outputs", true));
        }
    } else if (block.kind === "ShaderFunction") {
        const inputsSection = seenSections.get("Inputs")?.[0];
        const outputsSection = seenSections.get("Outputs")?.[0];
        if (inputsSection) {
            diagnostics.push(...validateDeclarationSection(document, inputsSection, symbols, "Inputs", false));
        }
        if (outputsSection) {
            diagnostics.push(...validateDeclarationSection(document, outputsSection, symbols, "Outputs", false));
        }

    }

    const settingsSection = seenSections.get("Settings")?.[0];
    if (settingsSection) {
        diagnostics.push(...validateSettingsSection(document, settingsSection));
    }

    const codeSection = seenSections.get("Code")?.[0];
    if (codeSection) {
        diagnostics.push(...analyzeCodeSection(document, codeSection, symbols, reachableCallables));
    }

    return diagnostics;
}

function validateDeclarationSection(document, section, symbols, sectionLabel, allowBindings) {
    const diagnostics = [];
    const parsed = parseTypedDeclarationsFromSection(section, allowBindings);
    const localNames = new Map();

    for (const statement of parsed.statements) {
        if (!statement.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                `${sectionLabel} statement is missing a trailing ';'.`));
        }
    }

    for (const declaration of parsed.declarations) {
        if (declaration.kind === "invalid") {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                declaration.startOffset,
                declaration.endOffset,
                `Invalid ${sectionLabel} statement '${declaration.text}'.`));
            continue;
        }

        const resolvedType = resolveTypeInfo(declaration.type);
        if (!resolvedType && !/^UE\./i.test(declaration.type)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                declaration.startOffset,
                declaration.endOffset,
                `Unsupported ${sectionLabel} type '${declaration.type}'.`));
            continue;
        }

        if (resolvedType?.isTexture && declaration.valueText) {
            const valueOffset = declaration.startOffset + declaration.text.indexOf(declaration.valueText);
            const texturePathResult = parseTexturePathReferenceText(declaration.valueText);
            if (texturePathResult.error) {
                diagnostics.push(makeOffsetDiagnostic(
                    document,
                    valueOffset,
                    valueOffset + declaration.valueText.length,
                    texturePathResult.error));
            }
        }

        const nameKey = normalizeSymbolKey(declaration.name);
        if (localNames.has(nameKey)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                declaration.startOffset,
                declaration.endOffset,
                `${sectionLabel} variable '${declaration.name}' is declared more than once.`));
            continue;
        }

        localNames.set(nameKey, declaration.name);
        if (symbols) {
            symbols.set(nameKey, {
                name: declaration.name,
                typeInfo: resolvedType
            });
        }
    }

    for (const binding of parsed.bindings) {
        if (!binding.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                binding.startOffset,
                binding.endOffset,
                `${sectionLabel} binding is missing a trailing ';'.`));
        }

        if (!binding.target || !binding.valueText) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                binding.startOffset,
                binding.endOffset,
                `Invalid ${sectionLabel} binding '${binding.text}'.`));
        }
    }

    return diagnostics;
}

function validateSettingsSection(document, section) {
    const diagnostics = [];
    const statements = splitStatementsWithOffsets(section.bodyText, section.bodyOpenOffset + 1);
    for (const statement of statements) {
        if (!statement.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                "Settings statement is missing a trailing ';'."));
        }

        const assignment = splitTopLevelAssignment(statement.text);
        if (!assignment || !assignment.left || !assignment.right) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                `Invalid Settings statement '${statement.text}'.`));
        }
    }
    return diagnostics;
}

function analyzeCodeSection(document, section, symbols, reachableCallables) {
    const diagnostics = [];
    const statements = splitStatementsWithOffsets(section.bodyText, section.bodyOpenOffset + 1);

    for (const statement of statements) {
        if (!statement.terminated) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                "Code statement is missing a trailing ';'."));
        }

        const assignment = splitTopLevelAssignment(statement.text);
        if (assignment) {
            const declaration = splitDeclarationTypeAndName(assignment.left);
            const rightOffset = statement.startOffset + statement.text.indexOf(assignment.right);
            diagnostics.push(...analyzeExpressionText(document, assignment.right, rightOffset, symbols, reachableCallables, "value"));

            if (declaration) {
                const resolvedType = resolveTypeInfo(declaration.type);
                if (!resolvedType) {
                    diagnostics.push(makeOffsetDiagnostic(
                        document,
                        statement.startOffset,
                        statement.endOffset,
                        `Unsupported Code variable type '${declaration.type}' for '${declaration.name}'.`));
                    continue;
                }

                symbols.set(normalizeSymbolKey(declaration.name), {
                    name: declaration.name,
                    typeInfo: resolvedType
                });
            } else {
                symbols.set(normalizeSymbolKey(assignment.left), {
                    name: assignment.left,
                    typeInfo: symbols.get(normalizeSymbolKey(assignment.left))?.typeInfo || null
                });
            }

            continue;
        }

        const declaration = splitDeclarationTypeAndName(statement.text);
        if (declaration) {
            const resolvedType = resolveTypeInfo(declaration.type);
            if (!resolvedType) {
                diagnostics.push(makeOffsetDiagnostic(
                    document,
                    statement.startOffset,
                    statement.endOffset,
                    `Unsupported Code variable type '${declaration.type}' for '${declaration.name}'.`));
                continue;
            }

            symbols.set(normalizeSymbolKey(declaration.name), {
                name: declaration.name,
                typeInfo: resolvedType
            });
            continue;
        }

        const callExpression = parseCallExpressionText(statement.text, statement.startOffset);
        if (!callExpression) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                statement.startOffset,
                statement.endOffset,
                `Code statement '${statement.text}' must use assignment syntax or a standalone Function call.`));
            continue;
        }

        diagnostics.push(...analyzeStandaloneFunctionCall(document, callExpression, symbols, reachableCallables));
    }

    return diagnostics;
}

function analyzeStandaloneFunctionCall(document, callExpression, symbols, reachableCallables) {
    const diagnostics = [];
    const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
    const signature = signatures.find((entry) => entry.kind === "Function");

    if (!signature) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.calleeOffset + callExpression.callee.length,
            `Standalone Code call '${callExpression.callee}(...)' is unsupported. Only DreamShader Function calls may use statement syntax.`));
        return diagnostics;
    }

    const expectedArgumentCount = signature.inputs.length + signature.outputs.length;
    if (callExpression.arguments.length !== expectedArgumentCount) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.endOffset,
            `DreamShader Function '${signature.name}' expects ${expectedArgumentCount} arguments (${signature.inputs.length} inputs, ${signature.outputs.length} out targets) but got ${callExpression.arguments.length}.`));
        return diagnostics;
    }

    for (let index = 0; index < signature.inputs.length; index += 1) {
        const argument = callExpression.arguments[index];
        diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
    }

    for (let index = 0; index < signature.outputs.length; index += 1) {
        const argument = callExpression.arguments[signature.inputs.length + index];
        const expectedOutput = signature.outputs[index];
        if (argument.isNamed) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                argument.startOffset,
                argument.endOffset,
                `DreamShader Function '${signature.name}' out argument '${expectedOutput.name}' must be passed positionally as a plain variable name.`));
            continue;
        }

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument.valueText)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                argument.startOffset,
                argument.endOffset,
                `DreamShader Function '${signature.name}' out argument '${expectedOutput.name}' must be a plain variable name.`));
            continue;
        }

        const resolvedType = resolveTypeInfo(expectedOutput.type);
        const existing = symbols.get(normalizeSymbolKey(argument.valueText));
        if (existing && existing.typeInfo && resolvedType && !areTypeInfosCompatible(existing.typeInfo, resolvedType)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                argument.startOffset,
                argument.endOffset,
                `Out variable '${argument.valueText}' does not match Function result type '${expectedOutput.type}'.`));
            continue;
        }

        symbols.set(normalizeSymbolKey(argument.valueText), {
            name: argument.valueText,
            typeInfo: resolvedType
        });
    }

    return diagnostics;
}

function analyzeExpressionText(document, text, baseOffset, symbols, reachableCallables, mode) {
    const diagnostics = [];
    let index = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < text.length) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            index += 1;
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 2;
            } else {
                if (char === "\"") {
                    inString = false;
                }
                index += 1;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 2;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 2;
            continue;
        }

        if (!isIdentifierStart(char)) {
            index += 1;
            continue;
        }

        const identifier = readQualifiedIdentifier(text, index);
        if (!identifier) {
            index += 1;
            continue;
        }

        const afterIdentifier = skipWhitespace(text, identifier.end);
        if (text[afterIdentifier] === "(") {
            const callText = text.slice(identifier.start, Math.min(text.length, findMatchingDelimiter(text, afterIdentifier, "(", ")") + 1));
            const callExpression = parseCallExpressionText(callText, baseOffset + identifier.start);
            if (!callExpression) {
                diagnostics.push(makeOffsetDiagnostic(
                    document,
                    baseOffset + identifier.start,
                    baseOffset + identifier.end,
                    `Invalid function call syntax near '${identifier.name}'.`));
                index = afterIdentifier + 1;
                continue;
            }

            diagnostics.push(...analyzeCallExpression(document, callExpression, symbols, reachableCallables, mode));
            index = identifier.start + callText.length;
            continue;
        }

        const baseName = identifier.name.split(".")[0];
        const normalizedBaseName = normalizeSymbolKey(baseName);
        if (baseName !== "UE" && !IGNORED_IDENTIFIER_NAMES.has(normalizedBaseName) && !isTypeLikeName(baseName) && !symbols.has(normalizedBaseName)) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                baseOffset + identifier.start,
                baseOffset + identifier.start + baseName.length,
                `Unknown identifier '${baseName}'.`));
        }

        index = identifier.end;
    }

    return diagnostics;
}

function analyzeCallExpression(document, callExpression, symbols, reachableCallables, mode) {
    const diagnostics = [];

    for (const argument of callExpression.arguments) {
        if (argument.isNamed) {
            diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
        }
    }

    if (/^UE\./.test(callExpression.callee) || isConstructorName(callExpression.callee)) {
        for (const argument of callExpression.arguments) {
            if (!argument.isNamed) {
                diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
            }
        }
        return diagnostics;
    }

    const signatures = reachableCallables.get(normalizeSymbolKey(callExpression.callee)) || [];
    if (signatures.length === 0) {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.calleeOffset + callExpression.callee.length,
            `Unknown function '${callExpression.callee}'.`));
        return diagnostics;
    }

    const signature = signatures[0];
    if (signature.kind === "Function" && mode === "value") {
        diagnostics.push(makeOffsetDiagnostic(
            document,
            callExpression.calleeOffset,
            callExpression.endOffset,
            `DreamShader Function '${signature.name}' cannot be used as a value expression. Call it as '${signature.name}(..., OutVar);'.`));
        return diagnostics;
    }

    for (const argument of callExpression.arguments) {
        if (!argument.isNamed) {
            diagnostics.push(...analyzeExpressionText(document, argument.valueText, argument.valueOffset, symbols, reachableCallables, "value"));
        }
    }

    if (signature.kind === "ShaderFunction") {
        const positionalArguments = callExpression.arguments.filter((argument) => !argument.isNamed);
        if (positionalArguments.length > signature.inputs.length) {
            diagnostics.push(makeOffsetDiagnostic(
                document,
                callExpression.calleeOffset,
                callExpression.endOffset,
                `ShaderFunction '${signature.name}' has too many positional arguments.`));
        }
    }

    return diagnostics;
}

function parseTexturePathReferenceText(text) {
    const callExpression = parseCallExpressionText(text, 0);
    if (!callExpression || normalizeSymbolKey(callExpression.callee) !== "path") {
        return {
            error: "Texture defaults must use Path(Game|Engine, \"/Folder/Asset\") or Path(\"/Game/Folder/Asset\")."
        };
    }

    if (callExpression.arguments.some((argument) => argument.isNamed)) {
        return {
            error: "Texture Path(...) does not support named arguments."
        };
    }

    if (callExpression.arguments.length !== 1 && callExpression.arguments.length !== 2) {
        return {
            error: "Texture Path(...) expects either 1 argument (absolute asset path) or 2 arguments (Game|Engine, asset path)."
        };
    }

    if (callExpression.arguments.length === 1) {
        const assetPath = readTexturePathArgumentText(callExpression.arguments[0].valueText);
        if (!assetPath || !/^\/(?:Game|Engine)\//i.test(assetPath)) {
            return {
                error: "Single-argument Path(...) must use an absolute /Game/... or /Engine/... asset path."
            };
        }

        return { error: "" };
    }

    const rootText = callExpression.arguments[0].valueText.trim();
    if (!/^(Game|Engine)$/i.test(rootText)) {
        return {
            error: `Unsupported texture Path root '${rootText}'. Use Game or Engine.`
        };
    }

    const assetPath = readTexturePathArgumentText(callExpression.arguments[1].valueText);
    if (!assetPath) {
        return {
            error: "Texture Path(...) requires a non-empty asset path."
        };
    }

    return { error: "" };
}

function readTexturePathArgumentText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return "";
    }

    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}

function parseCallExpressionText(text, baseOffset) {
    const trimmed = text.trim();
    const leadingWhitespace = text.search(/\S|$/);
    const identifier = readQualifiedIdentifier(trimmed, 0);
    if (!identifier) {
        return null;
    }

    const openParenOffset = skipWhitespace(trimmed, identifier.end);
    if (trimmed[openParenOffset] !== "(") {
        return null;
    }

    const closeParenOffset = findMatchingDelimiter(trimmed, openParenOffset, "(", ")");
    if (closeParenOffset === -1) {
        return null;
    }

    if (trimmed.slice(closeParenOffset + 1).trim().length !== 0) {
        return null;
    }

    const argsText = trimmed.slice(openParenOffset + 1, closeParenOffset);
    const argumentsList = splitTopLevelDelimitedWithOffsets(argsText, baseOffset + leadingWhitespace + openParenOffset + 1, ",").map((segment) => {
        const assignment = splitTopLevelAssignment(segment.text);
        if (assignment && /^[A-Za-z_][A-Za-z0-9_]*$/.test(assignment.left)) {
            const valueOffset = segment.startOffset + segment.text.indexOf(assignment.right);
            return {
                isNamed: true,
                name: assignment.left,
                valueText: assignment.right,
                valueOffset,
                startOffset: segment.startOffset,
                endOffset: segment.endOffset
            };
        }

        return {
            isNamed: false,
            name: "",
            valueText: segment.text,
            valueOffset: segment.startOffset,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset
        };
    });

    return {
        callee: identifier.name,
        calleeOffset: baseOffset + leadingWhitespace + identifier.start,
        arguments: argumentsList,
        endOffset: baseOffset + leadingWhitespace + closeParenOffset + 1
    };
}

function readQualifiedIdentifier(text, index) {
    if (!isIdentifierStart(text[index])) {
        return null;
    }

    let cursor = index + 1;
    while (cursor < text.length && isIdentifierPart(text[cursor])) {
        cursor += 1;
    }

    while (cursor < text.length) {
        if (text[cursor] === "." && isIdentifierStart(text[cursor + 1])) {
            cursor += 2;
        } else if (text[cursor] === ":" && text[cursor + 1] === ":" && isIdentifierStart(text[cursor + 2])) {
            cursor += 3;
        } else {
            break;
        }

        while (cursor < text.length && isIdentifierPart(text[cursor])) {
            cursor += 1;
        }
    }

    return {
        name: text.slice(index, cursor),
        start: index,
        end: cursor
    };
}

function isConstructorName(name) {
    const normalized = normalizeSymbolKey(name);
    return SCALAR_TYPE_NAMES.has(normalized)
        || VECTOR_TYPE_COMPONENTS.has(normalized)
        || normalized === "float2x2"
        || normalized === "float3x3"
        || normalized === "float4x4"
        || normalized === "mat2"
        || normalized === "mat3"
        || normalized === "mat4";
}

function areTypeInfosCompatible(left, right) {
    if (!left || !right) {
        return true;
    }

    return left.isTexture === right.isTexture && left.componentCount === right.componentCount;
}

function makeOffsetDiagnostic(document, startOffset, endOffset, message, severity = vscode.DiagnosticSeverity.Error) {
    const start = document.positionAt(Math.max(0, startOffset));
    const safeEndOffset = Math.max(startOffset + 1, endOffset);
    const end = document.positionAt(safeEndOffset);
    return new vscode.Diagnostic(new vscode.Range(start, end), message, severity);
}

function computeBraceDiagnostics(document, text) {
    const diagnostics = [];
    const stack = [];
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === "{") {
            stack.push(index);
            continue;
        }

        if (char === "}") {
            if (stack.length === 0) {
                const position = document.positionAt(index);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(position, new vscode.Position(position.line, position.character + 1)),
                    "Unexpected closing brace.",
                    vscode.DiagnosticSeverity.Error));
            } else {
                stack.pop();
            }
        }
    }

    for (const openIndex of stack) {
        const position = document.positionAt(openIndex);
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(position, new vscode.Position(position.line, position.character + 1)),
            "Unclosed opening brace.",
            vscode.DiagnosticSeverity.Error));
    }

    return diagnostics;
}

async function requestRecompile(scope) {
    const document = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined;
    const projectRoot = findProjectRoot(document ? document.uri.fsPath : "");
    if (!projectRoot) {
        vscode.window.showWarningMessage("DreamShader could not locate the Unreal project root.");
        return;
    }

    if (scope === "file") {
        if (!document || !isDreamShaderDocument(document)) {
            vscode.window.showWarningMessage("DreamShader recompile needs an active .dsm or .dsh document.");
            return;
        }

        if (document.isDirty) {
            await document.save();
        }
    }

    const effectiveScope = scope === "file" && document && path.extname(document.fileName).toLowerCase() === ".dsh"
        ? "all"
        : scope;

    const requestDirectory = path.join(projectRoot, "Saved", "DreamShader", "Bridge", "Requests");
    fs.mkdirSync(requestDirectory, { recursive: true });

    const payload = {
        action: "recompile",
        scope: effectiveScope
    };

    if (effectiveScope === "file" && document) {
        payload.sourceFile = normalizeFsPath(document.fileName);
    }

    const requestPath = path.join(requestDirectory, `request-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(payload, null, 2), "utf8");

    if (effectiveScope === "all") {
        vscode.window.setStatusBarMessage("DreamShader requested a full Unreal recompile.", 2500);
    } else {
        vscode.window.setStatusBarMessage(`DreamShader requested Unreal to recompile ${path.basename(document.fileName)}.`, 2500);
    }
}

async function refreshBridgeDiagnostics(collection) {
    collection.clear();

    const diagnosticFiles = new Set();
    const workspaceMatches = await vscode.workspace.findFiles("**/Saved/DreamShader/Bridge/diagnostics.json");
    for (const uri of workspaceMatches) {
        diagnosticFiles.add(uri.fsPath);
    }

    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        diagnosticFiles.add(path.join(configuredRoot, "Saved", "DreamShader", "Bridge", "diagnostics.json"));
    }

    for (const diagnosticFile of diagnosticFiles) {
        if (!fs.existsSync(diagnosticFile)) {
            continue;
        }

        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(diagnosticFile, "utf8"));
        } catch (_error) {
            continue;
        }

        if (!parsed || !Array.isArray(parsed.files)) {
            continue;
        }

        for (const fileEntry of parsed.files) {
            if (!fileEntry || typeof fileEntry.path !== "string" || !Array.isArray(fileEntry.diagnostics)) {
                continue;
            }

            const fileUri = vscode.Uri.file(fileEntry.path);
            const diagnostics = [];
            for (const diagnostic of fileEntry.diagnostics) {
                const message = typeof diagnostic.message === "string" ? diagnostic.message : "DreamShader error";
                const line = Math.max(0, Number.isFinite(diagnostic.line) ? Number(diagnostic.line) - 1 : 0);
                const column = Math.max(0, Number.isFinite(diagnostic.column) ? Number(diagnostic.column) - 1 : 0);
                const range = new vscode.Range(line, column, line, column + 1);
                const vscodeDiagnostic = new vscode.Diagnostic(range, message, mapSeverity(diagnostic.severity));
                vscodeDiagnostic.source = typeof diagnostic.source === "string" ? diagnostic.source : "DreamShader";
                diagnostics.push(vscodeDiagnostic);
            }

            collection.set(fileUri, diagnostics);
        }
    }
}

function mapSeverity(severity) {
    if (typeof severity !== "string") {
        return vscode.DiagnosticSeverity.Error;
    }

    switch (severity.toLowerCase()) {
        case "warning":
            return vscode.DiagnosticSeverity.Warning;
        case "information":
        case "info":
            return vscode.DiagnosticSeverity.Information;
        case "hint":
            return vscode.DiagnosticSeverity.Hint;
        default:
            return vscode.DiagnosticSeverity.Error;
    }
}

function formatDreamShaderDocument(text) {
    const normalizedText = text.replace(/\r\n/g, "\n");
    const lines = normalizedText.split("\n");
    const formatted = [];
    let indentLevel = 0;

    for (const originalLine of lines) {
        const trimmed = originalLine.trim();
        if (trimmed.length === 0) {
            formatted.push("");
            continue;
        }

        const stripped = stripStringsAndComments(trimmed);
        const startsWithClosingBrace = stripped.startsWith("}");
        if (startsWithClosingBrace) {
            indentLevel = Math.max(0, indentLevel - 1);
        }

        formatted.push(`${INDENT.repeat(indentLevel)}${trimmed}`);

        const openCount = countCharactersOutsideStrings(stripped, "{");
        const closeCount = countCharactersOutsideStrings(stripped, "}");
        indentLevel = Math.max(0, indentLevel + openCount - closeCount);
    }

    return `${formatted.join("\n").replace(/[ \t]+$/gm, "")}\n`;
}

function stripStringsAndComments(text) {
    let result = "";
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (!inString && char === "/" && next === "/") {
            break;
        }

        if (char === "\"") {
            inString = !inString;
            result += " ";
            continue;
        }

        if (inString && char === "\\") {
            result += "  ";
            index += 1;
            continue;
        }

        result += inString ? " " : char;
    }
    return result;
}

function countCharactersOutsideStrings(text, needle) {
    let count = 0;
    for (const char of text) {
        if (char === needle) {
            count += 1;
        }
    }
    return count;
}

function splitTopLevelParameters(text) {
    const parameters = [];
    let current = "";
    let depth = 0;
    let inString = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            current += char;
            if (char === "\\") {
                index += 1;
                if (index < text.length) {
                    current += text[index];
                }
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            current += char;
            continue;
        }

        if (char === "(") {
            depth += 1;
            current += char;
            continue;
        }

        if (char === ")") {
            depth = Math.max(0, depth - 1);
            current += char;
            continue;
        }

        if (char === "," && depth === 0) {
            if (current.trim()) {
                parameters.push(current.trim());
            }
            current = "";
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        parameters.push(current.trim());
    }

    return parameters;
}

function resolveImportPath(currentFilePath, importSpecifier) {
    const normalizedImport = normalizeImportSpecifier(importSpecifier);
    const relativeCandidate = normalizeFsPath(path.resolve(path.dirname(currentFilePath), normalizedImport));
    if (fs.existsSync(relativeCandidate)) {
        return relativeCandidate;
    }

    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        const rootCandidate = normalizeFsPath(path.join(configuredRoot, "DShader", normalizedImport));
        if (fs.existsSync(rootCandidate)) {
            return rootCandidate;
        }

        const builtinCandidate = normalizeFsPath(path.join(configuredRoot, "Plugins", "DreamShader", "Library", normalizedImport));
        if (fs.existsSync(builtinCandidate)) {
            return builtinCandidate;
        }
    }

    const projectRoot = findProjectRoot(currentFilePath);
    if (projectRoot) {
        const rootCandidate = normalizeFsPath(path.join(projectRoot, "DShader", normalizedImport));
        if (fs.existsSync(rootCandidate)) {
            return rootCandidate;
        }

        const builtinCandidate = normalizeFsPath(path.join(projectRoot, "Plugins", "DreamShader", "Library", normalizedImport));
        if (fs.existsSync(builtinCandidate)) {
            return builtinCandidate;
        }
    }

    return "";
}

function normalizeImportSpecifier(importSpecifier) {
    let normalized = importSpecifier.trim().replace(/\\/g, "/");
    if (!normalized.toLowerCase().endsWith(".dsh")) {
        normalized += ".dsh";
    }
    return normalized;
}

function getConfiguredProjectRoot() {
    const configuredRoot = vscode.workspace.getConfiguration("dreamshader").get("projectRoot", "");
    if (!configuredRoot) {
        return "";
    }

    return fs.existsSync(configuredRoot) ? normalizeFsPath(configuredRoot) : "";
}

function findProjectRoot(seedPath) {
    const configuredRoot = getConfiguredProjectRoot();
    if (configuredRoot) {
        return configuredRoot;
    }

    const candidates = [];
    if (seedPath) {
        candidates.push(path.dirname(seedPath));
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
        candidates.push(folder.uri.fsPath);
    }

    for (const candidate of candidates) {
        const root = findProjectRootFromDirectory(candidate);
        if (root) {
            return root;
        }
    }

    return "";
}

function findProjectRootFromDirectory(startDirectory) {
    let current = path.resolve(startDirectory);
    while (true) {
        if (containsUproject(current)) {
            return normalizeFsPath(current);
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return "";
        }
        current = parent;
    }
}

function containsUproject(directory) {
    try {
        const entries = fs.readdirSync(directory);
        return entries.some((entry) => entry.toLowerCase().endsWith(".uproject"));
    } catch (_error) {
        return false;
    }
}

function isDreamShaderDocument(document) {
    return document.languageId === LANGUAGE_ID || DREAMSHADER_EXTENSIONS.has(path.extname(document.fileName).toLowerCase());
}

function normalizeFsPath(inputPath) {
    return inputPath.replace(/\\/g, "/");
}

function matchKeywordAt(text, index, keyword) {
    if (text.slice(index, index + keyword.length) !== keyword) {
        return false;
    }

    return isIdentifierBoundary(text[index - 1]) && isIdentifierBoundary(text[index + keyword.length]);
}

function isIdentifierBoundary(char) {
    return !char || !/[A-Za-z0-9_]/.test(char);
}

function isIdentifierStart(char) {
    return Boolean(char) && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
    return Boolean(char) && /[A-Za-z0-9_]/.test(char);
}

function skipWhitespace(text, index) {
    let cursor = index;
    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }
    return cursor;
}

function findMatchingDelimiter(text, openIndex, openChar, closeChar) {
    if (openIndex < 0 || text[openIndex] !== openChar) {
        return -1;
    }

    let depth = 1;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = openIndex + 1; index < text.length; index += 1) {
        const char = text[index];
        const next = index + 1 < text.length ? text[index + 1] : "\0";

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === openChar) {
            depth += 1;
        } else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function offsetToPosition(text, offset) {
    const prefix = text.slice(0, offset);
    const lines = prefix.split("\n");
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

module.exports = {
    activate,
    deactivate
};



