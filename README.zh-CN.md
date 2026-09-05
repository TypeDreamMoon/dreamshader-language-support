# DreamShaderLang Language Support

DreamShaderLang `.dsm` 材质文件、`.dsf` 函数文件和 `.dsh` 共享头文件的 VS Code 语言支持扩展。

主 README 使用英文展示；本文件为中文版本。

## 概览

DreamShaderLang 是 DreamShader Unreal Engine 插件使用的材质编写语言。这个 VS Code 扩展提供语法高亮、智能提示、符号、折叠、本地诊断、Bridge 诊断、包管理命令和常用模板。

语言功能跑在一个 language server 里,它报出的诊断经过编译器自带测试语料的双向校对:编译器接受的源
这里一条都不报,而属于这一半职责的规则带上编译器的 `DSHnnnn` 码,Problems 里点一下就能跳到对应的文档
页。只有编译器才能判定的事——这个资产存不存在、类型对不对——留给编译器,经由 bridge 回传,因为同一个
问题有两个真相来源必然会漂移。

完整支持 DreamShaderLang 1.5 语法:`Group("Name") { ... }` 属性作用域、单输出返回值函数
(`Function float Luma(...) { return ...; }`)、区块名与 `{` 之间可选的 `=`、`Slider(min, max)`
metadata 简写,以及裸 `"/Game/..."` 资产路径。Template 块、bridge 命令、包管理工具,以及 `Function`
内置函数 metadata、UE 5.7 `Substrate.*` 图 helper 和 `Base.FrontMaterial` 输出,都与当前的
DreamShader 插件保持同步。

每个版本改了什么见[更新日志](./CHANGELOG.md)。

## 主要能力

- `.dsm`、`.dsf` 和 `.dsh` 文件关联。
- `Shader`、`ShaderFunction`、`ShaderLayer`、`ShaderLayerBlend`、`VirtualFunction`、`Function`、`GraphFunction`、`Namespace` 的上下文感知补全。
- `Properties`、`Inputs`、`Outputs`、`Settings`、`Options`、`Graph`、`Layout` 的区块级补全。
- DreamShaderLang 1.5 语法：`Group("Name") { ... }` 属性作用域（含 `propgroup` 代码片段）、单输出返回值 `Function`/`GraphFunction` 声明、区块名与 `{` 之间可选的 `=`、`Slider(min, max)` metadata 简写，以及参数 `=` 槽位上的裸 `"/Game/..."` 资产路径。
- 声明、函数签名、Graph 代码和 HLSL helper 中的类型补全。
- `UE.` 内置 Graph 节点补全。
- UE 5.7 `Substrate.` 图节点补全和 `Base.FrontMaterial` 输出支持。
- `Function` 和 Graph 类上下文中的 HLSL 原生函数、GLSL 别名和 Unreal 纹理 helper 补全。
- `Base.` 输出补全只插入成员名，避免 `Base.Base.xxx`。
- `MaterialAttributes` 成员补全，例如 `BaseColor`、`Roughness`、`Metallic`、`Normal`、`Opacity`。
- `Domain`、`MaterialDomain`、`ShadingModel`、`BlendMode`、`RenderType` 的 Settings 值补全。
- 声明 metadata 补全，例如 `Group`、`SortPriority`、`Description`、`SamplerType`、`GatherMode` 和纹理采样相关属性。
- 支持 `Layout = { Node(...); Comment(...); }` 和 Graph `#Region` / `#EndRegion` 布局指令。
- 条件编译：`#if` / `#ifdef` / `#ifndef` / `#elif` / `#else` / `#endif` / `#define` / `#undef` —— 高亮、打一个 `#` 就补全、`defined` 与六个 `DS_` 内置常量的 hover、折叠、十三条 `DSH103x` / `DSH104x` 诊断，以及把本工程 define 切掉的分支灰显。
- `.dsh` 共享头文件和 `.dsf` 函数文件的 import 路径补全和可点击跳转，按源根解析 —— 工程的 `DShader` 和每个插件各算一个根，也认跨根用的 `Project:` / `Plugin.<名字>:` 限定符。
- `.dsf` 文件形状诊断，支持 `ShaderFunction`、`Function`、`GraphFunction`、`Namespace` 和 `VirtualFunction`。
- Go to Definition、Find References、Hover、Signature Help、Inlay Hints、文档格式化、折叠和文档符号。
- Unreal Bridge 诊断面板。
- DreamShader Package 的安装、浏览、更新和移除命令。

## 支持的关键字

当前有效顶层关键字：

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

`MaterialLayer` 和 `MaterialLayerBlend` 已不再作为活动语言关键字使用。请使用 `ShaderLayer` 和 `ShaderLayerBlend`。

## 示例

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

## Dream Shader Function 文件

`.dsf` 用来放可复用的生成函数和 helper：

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

导入并调用多输出函数时，参数顺序是输入在前，输出变量在后：

```dreamshader
import "Functions/F_PulseTint.dsf";

Graph = {
    F_PulseTint(BaseColor.rgb, Tint, Pulse, Strength, Color, Mask);
}
```

## Substrate Graph Helper

Substrate 材质可以把 `Substrate` 图值绑定到 `Base.FrontMaterial`：

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

扩展会补全 DreamShader 当前支持的 `Substrate.*` wrapper，包括 `Unlit`、`Slab`、`ConvertMaterialAttributes`、`HorizontalMix`、`VerticalLayer`、`Add`、`Weight`、`Select`、`ThinFilm` 和相关 UE 5.7 Substrate helper。

## 条件编译

`#if`、`#ifdef`、`#ifndef`、`#elif`、`#else`、`#endif`、`#define`、`#undef` 这八条指令按行识别，在**生成期**求值，发生在解析之前。没被选中的那一支根本到不了解析器，也就不会变成任何节点 —— 这正是 `#if` 能切到 `StaticSwitchParameter` 够不到的**声明层**的原因：一行 `Settings`、一整块 `Outputs`、一条 `import`，乃至一整个 `Function`。

```dreamshader
Shader(Name="Materials/M_Foo", Root="Game")
{
    Settings = {
        Domain = "Surface";
#if !DS_SUBSTRATE
        ShadingModel = "DefaultLit";
#endif
    }

    Outputs = {
#if DS_SUBSTRATE
        Substrate Surface;
        Base.FrontMaterial = Surface;
#else
        vec3 BaseColor;
        Base.BaseColor = BaseColor;
#endif
    }
}
```

扩展这边：八条指令有高亮，打一个 `#` 就弹补全，条件里能读常量的位置会提示 `defined` 和六个只读的 `DS_` 内置常量（`DS_ENGINE_MAJOR`、`DS_ENGINE_MINOR`、`DS_ENGINE_PATCH`、`DS_SUBSTRATE`、`DS_PLATFORM`、`DS_PLUGIN_VERSION`），这七个都有写清规则的 hover，`#if` … `#endif` 能折叠，十三条预处理诊断 `DSH1030` 到 `DSH1042` 全部在本地报出，并带上编译器自己的码。

**所有分支对语言功能一律有效。** 补全、跳转定义、查找引用和 import 索引读的是「只把指令行抹掉」的那份文本，所以本次构建会切掉的那一支里声明的符号照样能解析，里面的 `import` 照样算依赖。插件自己的依赖图就是这么做的，理由也一样：扩展这边没有 define 表可以拿来求值，悄悄替你猜一支比哪种答案都糟。

### 未激活分支

被本工程 define 切掉的分支会**灰显**，免得一份带条件的源码变成脑子里要同时装着的两份文本。指令行本身永远不灰 —— 「这块为什么是灰的」，答案就写在它们身上。

灰显要靠 define 表，由插件导出到 `Saved/DreamShader/Bridge/preprocessor-defines.json`。**manifest 不存在时什么都不灰，也不吭声。** 插件版本旧，或者工程的 bridge 还没写过，都属于正常降级，不是故障。预处理器会拒绝的文件同样一块都不灰 —— `#if` 没闭合、条件写错、大小写错的 `#IF` —— 因为灰错了会把人指到错的分支上，而它跟「没这个功能」看起来还不一样：少灰一块只是少个功能，灰错一块是骗人。

```json
{
  "dreamshader.preprocessor.dimInactiveRegions": true,
  "dreamshader.preprocessor.inactiveOpacity": 0.5
}
```

`dreamshader.preprocessor.dimInactiveRegions`（默认 `true`）设成 `false` 就彻底关掉灰显；`dreamshader.preprocessor.inactiveOpacity`（默认 `0.5`）是灰的程度，设成 `1` 等于功能还开着但看不出来。

### `Function` 体里的 `#` 属于着色器编译器

`Function` / `GraphFunction` 体是裸 HLSL，而 HLSL 有自己的预处理器。写在那里的 `#` 行找的是**那一个**，用的是着色器编译器的 define —— `MATERIALBLENDING_SOLID`、`PIXELSHADER`、引擎自己的那套环境 —— 所以扩展一概不碰：不按 DreamShader 指令高亮、不诊断、不灰显。

```dreamshader
Function BlendModeSwitch(in float3 Opaque, in float3 Masked, out float3 Result)
{
#if MATERIALBLENDING_SOLID     // 这是 HLSL 的，编译着色器时才解析
    Result = Opaque;
#else
    Result = 0;
#endif
}
```

想在生成期二选一挑函数体，就把 `#if` 写到 `Function` 块外面 —— 那里 DreamShader 才看得见。

## Function 内置函数

`Function` 块是 HLSL 风格 helper 代码。扩展会为下面这些内置函数提供补全、Hover、Signature Help、语义高亮和本地诊断白名单。

HLSL 原生函数：

```text
abs, acos, all, any, asin, atan, atan2, ceil, clamp, clip, cos, cosh, cross,
ddx, ddx_coarse, ddx_fine, ddy, ddy_coarse, ddy_fine, degrees, determinant,
distance, dot, exp, exp2, floor, fmod, frac, frexp, fwidth, isfinite, isinf,
isnan, ldexp, length, lerp, lit, log, log10, log2, max, min, modf, mul,
normalize, pow, radians, reflect, refract, round, rsqrt, saturate, sign, sin,
sincos, sinh, smoothstep, sqrt, step, tan, tanh, transpose, trunc
```

DreamShader 接受的 GLSL 风格别名：

```text
mix -> lerp
fract -> frac
mod -> fmod
```

Unreal 纹理采样 helper：

```text
Texture2DSample, Texture2DSampleLevel, Texture2DSampleBias, Texture2DSampleGrad,
Texture2DArraySample, Texture2DArraySampleLevel,
TextureCubeSample, TextureCubeSampleLevel,
Texture3DSample, Texture3DSampleLevel
```

示例：

```dreamshader
Function Sample2DRGB(in Texture2D texture, in float2 uv, out float3 color) {
    color = Texture2DSample(texture, textureSampler, uv).rgb;
}
```

## 模板

扩展提供以下常用模板：

- `ShaderTemplate`：材质资产源码。
- `ShaderFunctionTemplate`：生成 Material Function。
- `ShaderLayerTemplate`：Unreal Material Layer 函数资产。
- `ShaderLayerBlendTemplate`：Unreal Material Layer Blend 函数资产。
- `VirtualFunctionTemplate`：声明已有 Unreal Material Function 资产。
- `FunctionTemplate`：可复用 HLSL helper。
- `SelfContainedFunctionTemplate`：嵌入式 helper 函数。
- `GraphFunctionTemplate`：可调用 `UE.*` 节点的可复用 Graph helper。
- `LayoutBlock`：显式材质图布局 metadata。
- `GraphRegion`：生成布局注释框的命名 Graph 区域。
- `NamespaceTemplate`：分组 helper 函数。
- `ImportTemplate`：共享头文件或函数文件 import。
- `ImportFunctionFileTemplate`：`.dsf` 函数文件 import。

当前模板只使用 `ShaderLayer` 和 `ShaderLayerBlend`，不会再提示旧的 `MaterialLayer` / `MaterialLayerBlend`。

## 命令

常用命令：

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

## 设置

```json
{
  "dreamshader.projectRoot": "",
  "dreamshader.materialExpressionManifestPath": "",
  "dreamshader.packageStoreIndexUrls": [
    "https://raw.githubusercontent.com/TypeDreamMoon/dreamshader-package-index/main/packages.json"
  ],
  "dreamshader.enableGitHubPackageSearch": true,
  "dreamshader.showStatusBar": true,
  "dreamshader.enableCodeLens": true,
  "dreamshader.preprocessor.dimInactiveRegions": true,
  "dreamshader.preprocessor.inactiveOpacity": 0.5
}
```

大多数情况下 `dreamshader.projectRoot` 可以留空，扩展会根据当前 DreamShader 文件或工作区自动寻找 Unreal 项目根目录。

`dreamshader.materialExpressionManifestPath` 可以直接指向生成出来的 `Saved/DreamShader/Bridge/material-expressions.json`。留空时会使用当前项目的 Bridge manifest，并回退到扩展内置 manifest。

两个 `dreamshader.preprocessor.*` 控制被本工程 define 切掉的 `#if` 分支的灰显，见[未激活分支](#未激活分支)。工程的 bridge 没导出 define 表之前，这两项都不会有任何效果。

## Bridge 诊断

配合 DreamShader Unreal 插件使用时，扩展会读取项目 `Saved/DreamShader/Bridge` 下生成的诊断文件，并同时显示为编辑器内诊断和 DreamShader Bridge 面板内容。

即使只打开项目的 `DShader` 目录作为工作区，也会尝试自动发现 Bridge 输出。

## 开发

安装依赖：

```powershell
npm install
```

跑测试。五层，每一层都能抓住下一层抓不到的东西：`test:language` 直接 import 语言层，`test:imports`
建出真实目录树来校对 import 解析，`test:server` 拉起语言服务器走 stdio 跟它进行一次真实的 LSP
对话，`test:corpus` 拿编译器自己的语料校对这一半，`test:extension` 驱动一个真的 VS Code：

```powershell
npm test
```

`test:corpus` 需要显式开启,因为插件不在本仓库里。指向一个插件目录,它会双向断言 —— 编译器接受的源
一条诊断都不许报,编译器因文本可见的原因拒绝的源必须报出对应那条：

```powershell
$env:DREAMSHADER_CORPUS_DIR = 'I:\...\Plugins\DreamShader'; npm run test:corpus
```

### 架构

扩展是两个进程。`src/server/` 是标准 LSP 服务器，承载全部 14 个语言 provider 以及从源码推导出的诊断；
`src/activate.js` 是客户端，保留所有「跟文本无关」的东西 —— 预览、包管理、Bridge 诊断树及其
`dreamshader` 集合、状态栏、命令。

`src/language/` 既不 import `vscode` 也不 import 协议，正因如此 provider 才能搬走而不必改动它。语言层
需要了解外部世界时（某项配置、workspace 目录），它问 `src/host.js`，由两个进程各自填充。

刻意不打包：`src/bridge/database.js` 通过 `require.resolve` 定位 sql.js 的 WASM，打包器会让那个路径指空。

`F5` 启动 Extension Development Host。要在 server 里下断点，用 **Extension + Server** 复合配置，
它会额外挂一个调试器到 6018 端口。

打包扩展：

```powershell
npm run package
```

生成的 VSIX 文件为 `dreamshaderlang-language-support-<version>.vsix`,版本号取自 `package.json`。

## License

MIT. Copyright (c) 2026 TypeDreamMoon.
