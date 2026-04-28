# DreamShaderLang Language Support

VSCode 扩展，为 DreamShaderLang `.dsm` / `.dsh` 文件提供语言支持。

## 发布信息

- Version：`1.2.14`
- Language：`DreamShaderLang`
- Author：TypeDreamMoon
- GitHub：<https://github.com/TypeDreamMoon>
- Web：<https://dev.64hz.cn>
- Copyright：Copyright (c) 2026 TypeDreamMoon. All rights reserved.

## 支持内容

- `Shader` / `ShaderFunction` 使用 `Graph = { ... }` 作为图构建区块
- `Shader` / `ShaderFunction` 支持 `Root="Game"` / `Root="Plugin.PluginName"` 顶层属性补全、高亮和 Hover
- `Graph` 支持基础 `if` / `else` 本地诊断、作用域补全和语句切分
- `DreamShaderLang` `.dsm` / `.dsh` 文件关联
- 语法高亮
- 自动补全
- 作用域感知变量补全
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
code --install-extension .\dreamshaderlang-language-support-1.2.14.vsix
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
