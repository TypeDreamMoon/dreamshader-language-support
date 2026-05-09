# DreamShaderLang Language Support

VSCode 扩展，为 DreamShaderLang `.dsm` / `.dsh` 文件提供语言支持。

## 发布信息

- Version：`1.3.2`
- Language：`DreamShaderLang`
- Author：TypeDreamMoon
- GitHub：<https://github.com/TypeDreamMoon>
- Web：<https://dev.64hz.cn>
- Copyright：Copyright (c) 2026 TypeDreamMoon. All rights reserved.

## 支持内容

- `Shader` / `ShaderFunction` / `MaterialLayer` / `MaterialLayerBlend` 使用 `Graph = { ... }` 作为图构建区块
- `Shader` / `ShaderFunction` / `MaterialLayer` / `MaterialLayerBlend` 支持 `Root="Game"` / `Root="Plugin.PluginName"` 顶层属性补全、高亮和 Hover
- `VirtualFunction` 支持补全、语法高亮、Hover、Signature Help、本地诊断和 `Path(Plugins.)` 插件名补全
- `GraphFunction` 支持在可复用 Graph helper 中调用 `UE.*` 节点，并在调用点展开
- 单返回值 `Function` / `GraphFunction` 支持在 Graph 中作为值表达式调用，多返回值仍要求显式 out 变量
- `Graph` 支持基础 `if` / `else` 本地诊断、作用域补全和语句切分
- `Graph` 表达式支持 `.rgba` / `.xyzw` 向量 swizzle，例如 `.rg`、`.rrr`、`.rgaa`、`.rgbb`
- 支持 `Properties` 显式 Parameter 类型、`const` helper、`StaticSwitchParameter`、`UE.CollectionParam(...)`、声明反射属性块、`opt` 输入和 `default` 调用参数
- `DreamShaderLang` `.dsm` / `.dsh` 文件关联
- 语法高亮
- Semantic Tokens 语义高亮，能区分类型、函数、参数、变量、材质输出和 UE 内置调用
- 自动补全
- 作用域感知变量补全
- 函数调用参数 Inlay Hints
- `import` 路径可点击跳转
- `Shader` / `ShaderFunction` / `MaterialLayer` / `MaterialLayerBlend` / `VirtualFunction` / `Function` / `GraphFunction` / `Namespace` 和区块折叠
- `Function` / `Namespace::Function` / `import` / `Path(...)` 联想
- `UE.*` 内置材质节点补全、Hover、Signature Help
- `Settings` 支持 `TranslucencyLightingMode` / `LightingMode`
- `Settings` 补全扩展到 PostProcess / Refraction / Mobile / Nanite / Usage / Lightmass / VirtualTexture 等常见材质分类
- `Settings` 中的对象引用支持 `Path(...)` 风格资产路径
- `Expression(...).Pin[n]` 输出节点绑定补全与高亮
- `Graph` 区域支持 `float a, b, c = ...;` 这种逗号声明写法
- `Function SelfContained Foo(...) { ... }` / `Function Inline Foo(...) { ... }` 语法支持
- 本地递归/循环依赖诊断，包含 `SelfContained` 函数调用环
- 只打开 `ProjectName/DShader` 工作区时，仍可自动读取 `ProjectName/Saved/DreamShader/Bridge/diagnostics.json`
- 更现代的 VSCode 交互：状态栏项目名提示、CodeLens 重编入口、编辑器标题栏快速操作、底部 Panel 中的 Bridge 诊断窗口
- 支持一键清理 `Intermediate/DreamShader/GeneratedShaders` 并触发全量重编
- DreamShader Package import 联想
- Go to Definition
- Signature Help
- Hover 类型/来源提示
- Find References
- 文档格式化
- 本地语法诊断
- Unreal 桥接诊断
- GitHub Package 安装、更新、移除和商店浏览
- 快速创建 Material/Header/Texture Sample/Noise Material 模板

## 当前重点特性

### 1.3.1 更新

- 新增 `GraphFunction` 补全、snippet、语义高亮、折叠、符号、Hover、Signature Help 和本地诊断
- 单个 `out` 的 `Function` / `GraphFunction` 支持 `Color = Texture::Sample2DRGB(BaseTex, UV0);` 这种值表达式写法
- 多个 `out` 的 `Function` / `GraphFunction` 继续要求 `Foo(Input, OutA, OutB);` 这种显式返回值写法
- 顶层快速定义模板拆到 `templates.js`，关键字补全只插入关键字，完整骨架改为 `ShaderFunctionTemplate` / `GraphFunctionTemplate` 等模板项
- `GraphFunction` 体内按 Graph 语义诊断，可调用 `UE.*`
- 普通 `Function` 体内出现 `UE.*` 会被本地诊断标红，提示改用 `GraphFunction`

### 1.3.0 更新

- 新增 `MaterialLayer` / `MaterialLayerBlend` 补全、snippet、语义高亮、折叠、符号、CodeLens、Hover、Signature Help 和本地诊断
- `MaterialLayer` 本地诊断要求只输出一个 `MaterialAttributes`
- `MaterialLayerBlend` 本地诊断要求只输出一个 `MaterialAttributes`，并至少声明两个 `MaterialAttributes` 输入
- MaterialLayer snippet 使用显式 `.rgb`，Alpha 可通过 `.a` 继续读取

### 1.2.27 更新

- 自动读取 Unreal 侧生成的 `Saved/DreamShader/Bridge/material-expressions.json`
- `UE.*` 补全、Hover 和 Signature Help 会动态合并反射到的 `MaterialExpression`
- `UE.Expression(Class="...")` / `Expression(Class="...").Pin[n]` 的 `Class` 字符串支持从 manifest 补全

### 1.2.26 更新

- 同步 DreamShader 插件当前支持的 `Base.*` 输出，本地诊断不再误报 `Base.CustomizedUV1` / `Base.CustomizedUV2` / `Base.CustomizedUV3`
- 本地表达式诊断接受 `UE.CollectionParam(Collection=Path(...), ...)` 中的 `Path(...)` helper，不再误报 `Unknown function 'Path'`

### 1.2.25 更新

- `ShaderFunction` 新增 `Properties` section 语言服务支持，可在 `Inputs` 默认值和 `Graph` 中补全/诊断这些属性
- 新增 `const` property 关键字 Hover、补全和 `constprop` snippet
- ShaderFunction snippet 更新为 `Properties` + `opt Texture2D Input = PreviewTex` 的预览默认值写法

### 1.2.24 更新

- 新增 `MaterialAttributes` 图类型补全、Hover 和 snippets
- 新增 `Attrs.BaseColor` / `Attrs.Roughness` 等材质属性成员补全
- `Outputs` 中新增 `Base.MaterialAttributes` 输出绑定支持

### 1.2.23 更新

- 新增分号式 `[...]` 声明反射属性块 snippet 和解析，可用于 `Group`、`SortPriority`、`Description` 以及 Texture Sample 等参数节点反射字段
- 新增 `TextureSampleParameter2D` 反射属性 snippet，覆盖 sampler、mip、coordinate 和 view mip bias 常用字段
- 本地声明解析同时兼容历史逗号 metadata 和新的分号属性块

### 1.2.22 更新

- 新增 `ScalarParameter` / `VectorParameter` / `TextureObjectParameter` / `TextureSampleParameter*` / `StaticSwitchParameter` 等 Properties 类型补全、高亮和本地诊断
- 新增 `[Group="...", SortPriority=32, Description="..."]` 声明 metadata snippet 和解析
- 新增 `UE.CollectionParam(...)` 与 `UE.StaticSwitchParameter(...)` 补全、Hover、Signature Help 和 Inlay Hints
- `ShaderFunction` / `VirtualFunction` 现在识别 `opt` 输入与调用侧 `default` 参数

### 1.2.21 更新

- `Graph` / `Function` 表达式诊断现在识别向量 swizzle，`DebugFloat2Values(...).rg` 不会再把 `rg` 当成未知变量
- 新增 `.rgba` / `.xyzw` swizzle 补全和 Hover，支持 1 到 4 个通道以及重复通道，例如 `.rrr`、`.ggg`、`.aaa`、`.rgaa`

### 1.2.20 更新

- 新增 Semantic Tokens 语义高亮，让类型、函数、参数、变量、材质输出和 UE 内置调用有更明确的编辑器语义
- 新增函数调用参数 Inlay Hints，`Graph` 中调用 `Function` / `ShaderFunction` / `VirtualFunction` / `UE.*` 时会显示参数名
- 新增 `import` 文档链接和结构折叠，头文件可直接点击打开，Outline 也会显示区块内声明
- `import "Header.dsh"` 现在兼容不写末尾分号
- 清理旧的 `dreamshader.packageUninstall` 重复命令，统一使用 `DreamShaderLang: Remove Installed Package`

### 1.2.19 更新

- 编辑器标题栏、Bridge 面板标题栏和右键菜单命令补充 codicon 缩略图
- CodeLens 快捷入口从长文本改为纯图标按钮：重编当前、重编全部和打开 Bridge

### 1.2.18 更新

- 新增 `VirtualFunction` 语言服务支持，用于声明并调用现有 Unreal `MaterialFunction` 资产
- `VirtualFunction` 的 `Options.Asset = Path(Plugins.PluginName, "...")` 支持项目内容插件名补全
- snippets、语法高亮、Hover、Signature Help 和本地诊断同步识别 `VirtualFunction`

### 1.2.17 更新

- `Root="Plugins."` 作为兼容写法也支持项目内容插件名补全
- `Plugin.MoonToon` 与 `Plugins.MoonToon` 都会解析到同一个项目插件内容根

### 1.2.16 更新

- `Root="Plugin."` 后会自动补全项目 `Plugins` 目录下带 `Content` 的插件名
- 补全结果来自当前 Unreal 项目根目录，支持 `dreamshader.projectRoot` 配置

### 1.2.15 更新

- 明确 `Root="Plugin.PluginName"` 指向项目插件内容目录 `[Project]/Plugins/PluginName/Content`
- 例如 `Shader(Name="Mat/Test", Root="Plugin.MoonToon")` 生成到 `/MoonToon/Mat/Test.Test`

### 1.2.14 更新

- 新增 `Root` 顶层属性支持，用于 `Shader` / `ShaderFunction` 生成资产根路径
- `Root` 支持补全、Hover、snippets 和语法高亮
- `Shader(Root="...", Name="...")` 这种属性顺序现在也能被 CodeLens 和本地结构分析识别

### 1.2.13 更新

- 新增 GitHub Actions 自动发布流程：推送到 `main` 后读取 `package.json` 版本，打包 VSIX，并创建或更新对应 GitHub Release
- Release 会自动上传 `dreamshaderlang-language-support-x.y.z.vsix`
- 也支持手动触发 workflow，用于重新生成某个版本的发布包

### 1.2.12 更新

- `DreamShader Bridge` 从 Explorer 侧边栏迁移到 VSCode 底部 Panel，使用方式更接近“问题 / 输出”窗口
- 状态栏点击后打开 Bridge Panel，并直接展示当前项目的桥接诊断摘要
- CodeLens 增加 Bridge 入口，Bridge 树节点增加更清晰的状态图标和右键打开操作
- Package Store Webview 控件重新整理，搜索、来源管理、安装按钮和卡片状态更统一

### 1.2.11 更新

- `Code = { ... }` 语言服务入口更新为 `Graph = { ... }`
- `Graph` 中的基础 `if` / `else` 可以参与本地诊断和可见变量收集
- 创建材质、材质函数、纹理采样、噪声材质和 package 示例时默认生成 `Graph`
- snippets、语法高亮、hover 和错误提示统一使用 `Graph` 文案

### 语法模型

- `.dsm`：材质实现
- `.dsh`：共享头文件
- `Function Name(in ..., out ...) { ... }`
- `Function SelfContained Name(in ..., out ...) { ... }`
- `Namespace(Name="Texture") { Function Sample(...) { ... } }`
- `VirtualFunction(Name="MyFunction") { Options = { Asset = Path(Plugins.MyPlugin, "MaterialFunctions/MyFunction"); } ... }`
- `import "Shared/Common.dsh";`
- `import "Builtin/Texture.dsh";`
- `import "@typedreammoon/dream-noise/Library/Noise.dsh";`
- `Plugins/DreamShader/Library/**/*.dsh` 内置库导入
- 当前内置库包含 `Texture`、`Math`、`Color`、`UV`、`Noise`、`SDF`、`Normal`、`PBR`、`PostProcess`
- `DShader/Packages/**/*.dsh` package 导入
- 内置纹理函数使用 `Texture::Sample2DRGB(...)` 这种命名空间形式
- `Outputs` 区域支持 `Base.BaseColor = ...` 和 `Expression(...).Pin[n] = ...` 风格提示

### 作用域补全

扩展会尽量按当前位置收集可见符号：

- `Function` 体只补当前函数参数和局部变量
- `Shader` / `ShaderFunction` 的 `Graph` 只补当前 block 可见输入、输出和局部变量
- 不再把无关 `Properties` 泄露到不该出现的函数体里

### 本地诊断

会直接在编辑器里提示：

- 未解析 `import`
- 重复函数 / 命名空间函数
- `Function` 参数声明错误
- `Graph` 中非法语句
- 未知标识符 / 未知函数
- `out` 参数写法错误
- `Path(...)` 纹理默认值写法错误
- `.dsm` / `.dsh` 顶层结构错误
- 花括号不匹配
- 旧的 `Scalar` / `Color` / `Vector` 类型已移除

### Unreal 桥接

当 Unreal 插件启用后：

- `DreamShaderLang: Recompile Current Source`
- `DreamShaderLang: Recompile All DSM`
- `DreamShaderLang: Install Package from GitHub`
- `DreamShaderLang: Browse Package Store`：打开 VSCode 风格 Webview 商店面板
- `DreamShaderLang: Update Installed Packages`
- `DreamShaderLang: Remove Installed Package`
- `DreamShaderLang: Open Packages Folder`
- `DreamShaderLang: Add Package Store Index Source`
- `DreamShaderLang: Remove Package Store Index Source`
- `DreamShaderLang: Create Package Step by Step`
- `DreamShaderLang: Create DreamShader Material`
- `DreamShaderLang: Create DreamShader Header`
- `DreamShaderLang: Create DreamShader Texture Sample`
- `DreamShaderLang: Create DreamShader Noise Material`

Package 安装和更新需要本机可用 `git` 命令。

会把请求写给 Unreal，随后 Unreal 返回的生成/编译错误会镜像到 VSCode 诊断面板。Unreal Parser 错误会尽量精确到真实 `.dsm/.dsh` 文件行列，包括 import 后的头文件位置。

同时会在底部 Panel 提供 `DreamShader Bridge` 视图，按项目 / 文件 / 具体错误分组显示 Unreal Bridge 返回的问题。材质编译错误会附带更多上下文，例如：

- 所属材质资源路径
- Shader Platform
- Quality Level
- Bridge 阶段（生成 / 材质编译）
- 原始 detail 文本

## 安装

```powershell
npm install
npm run package
code --install-extension .\dreamshaderlang-language-support-1.3.1.vsix
```

## 项目根目录

如果 VSCode 工作区不是 Unreal 项目根目录，可配置：

```json
"dreamshader.projectRoot": "I:/UnrealProject_Moon/Moon_Dev"
```

Package store 配置：

```json
"dreamshader.packageStoreIndexUrls": [
    "https://raw.githubusercontent.com/TypeDreamMoon/dreamshader-package-index/main/packages.json"
],
"dreamshader.enableGitHubPackageSearch": true
```

`dreamshader.packageStoreIndexUrl` 旧单源配置仍兼容，但推荐使用 `dreamshader.packageStoreIndexUrls` 列表。

## 相关文档

DreamShader 主文档位于：

- `Plugins/DreamShader/Docs/README.md`
