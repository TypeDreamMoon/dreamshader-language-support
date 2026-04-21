# DreamShaderLang Language Support

VSCode 扩展，为 DreamShaderLang `.dsm` / `.dsh` 文件提供语言支持。

## 发布信息

- Version：`1.2.2`
- Language：`DreamShaderLang`
- Author：TypeDreamMoon
- GitHub：<https://github.com/TypeDreamMoon>
- Web：<https://dev.64hz.cn>
- Copyright：Copyright (c) 2026 TypeDreamMoon. All rights reserved.

## 支持内容

- `DreamShaderLang` `.dsm` / `.dsh` 文件关联
- 语法高亮
- 自动补全
- 作用域感知变量补全
- `Function` / `Namespace::Function` / `import` / `Path(...)` 联想
- `UE.*` 内置材质节点补全、Hover、Signature Help
- `Expression(...).Pin[n]` 输出节点绑定补全与高亮
- `Code` 区域支持 `float a, b, c = ...;` 这种逗号声明写法
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

### 语法模型

- `.dsm`：材质实现
- `.dsh`：共享头文件
- `Function Name(in ..., out ...) { ... }`
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
- `Shader` / `ShaderFunction` 的 `Code` 只补当前 block 可见输入、输出和局部变量
- 不再把无关 `Properties` 泄露到不该出现的函数体里

### 本地诊断

会直接在编辑器里提示：

- 未解析 `import`
- 重复函数 / 命名空间函数
- `Function` 参数声明错误
- `Code` 中非法语句
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

## 安装

```powershell
npm install
npm run package
code --install-extension .\dreamshaderlang-language-support-1.2.2.vsix
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
