# DreamShaderLang Language Support

DreamShaderLang `.dsm` 材质文件、`.dsf` 函数文件和 `.dsh` 共享头文件的 VS Code 语言支持扩展。

主 README 使用英文展示；本文件为中文版本。

## 概览

DreamShaderLang 是 DreamShader Unreal Engine 插件使用的材质编写语言。这个 VS Code 扩展提供语法高亮、智能提示、符号、折叠、本地诊断、Bridge 诊断、包管理命令和常用模板。

`1.6.0` 版本新增对 DreamShaderLang 1.5 语法的支持——`Group("Name") { ... }` 属性作用域、单输出返回值函数（`Function float Luma(...) { return ...; }`）、区块名与 `{` 之间可选的 `=`、`Slider(min, max)` metadata 简写，以及裸 `"/Game/..."` 资产路径，全部向后兼容现有语法。同时继续提供 Template 块支持、DreamShader bridge 命令、包管理工具，并同步 `Function` 内置函数 metadata、UE 5.7 `Substrate.*` 图 helper 和 `Base.FrontMaterial` 输出支持。

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
- `.dsh` 共享头文件和 `.dsf` 函数文件的 import 路径补全和可点击跳转。
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
  "dreamshader.enableCodeLens": true
}
```

大多数情况下 `dreamshader.projectRoot` 可以留空，扩展会根据当前 DreamShader 文件或工作区自动寻找 Unreal 项目根目录。

`dreamshader.materialExpressionManifestPath` 可以直接指向生成出来的 `Saved/DreamShader/Bridge/material-expressions.json`。留空时会使用当前项目的 Bridge manifest，并回退到扩展内置 manifest。

## Bridge 诊断

配合 DreamShader Unreal 插件使用时，扩展会读取项目 `Saved/DreamShader/Bridge` 下生成的诊断文件，并同时显示为编辑器内诊断和 DreamShader Bridge 面板内容。

即使只打开项目的 `DShader` 目录作为工作区，也会尝试自动发现 Bridge 输出。

## 开发

安装依赖：

```powershell
npm install
```

跑测试。四层，每一层都能抓住下一层抓不到的东西：`test:language` 直接 import 语言层，`test:server`
拉起语言服务器走 stdio 跟它进行一次真实的 LSP 对话，`test:corpus` 拿编译器自己的语料校对这一半，
`test:extension` 驱动一个真的 VS Code：

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

生成的 VSIX 文件：

```text
dreamshaderlang-language-support-1.7.0.vsix
```

## License

MIT. Copyright (c) 2026 TypeDreamMoon.
