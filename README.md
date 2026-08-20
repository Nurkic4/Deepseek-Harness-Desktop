# Deepseek Harness Desktop

这是一个 Windows 桌面版 DeepSeek Harness。 DSH Web UI 放进了桌面窗口，并补充了浏览器、文件、终端和桌面级管理功能。

## 怎么使用

### 直接安装

1. 双击 `release/Deepseek-Harness-Desktop-Setup-0.1.2.exe`。
2. 选择安装目录并完成安装。
3. 启动 Deepseek Harness Desktop。
4. 在首次设置中填写自己的模型 API 地址、API Key 和模型名称。
5. 进入对话页面即可使用。

安装包已经包含运行所需的 Node.js、Harness Web UI 和插件，不需要另外安装 Node.js 或 pnpm。

### API Key

每个人都要使用自己的 API Key。API Key 只保存在本机用户配置目录，不在项目目录中，也不会随源代码上传。

支持通过界面配置，也支持使用环境变量：

```powershell
$env:DEEPSEEK_API_KEY = "你的 API Key"
```

### 常用功能

- 对话页面：选择模型和推理等级，发送文字或图片。
- 浏览器：在会话顶部打开「浏览器」，支持多标签、搜索、前进后退、刷新、截图、缩放、打印和站点数据清理。
- 文件：查看本轮文件修改、展开差异、逐文件还原、保存和回滚检查点。
- 终端：支持 Git Bash 和 PowerShell 7，可在终端面板中选择；普通开发命令优先使用 Git Bash。
- 工作区：选择项目目录后，DSH 会自动把它注册为当前工作区。
- 插件、MCP、Skill：在设置中查看和启用已安装的工具。
- 主题：支持浅色、深色、自定义主题和背景图。
- 对话管理：可以删除不需要的对话。

## 这版改了什么

- 增加 Electron 桌面窗口、托盘和工作区启动管理。
- 修复 Windows 下 Bash 误走 WSL 的问题，优先使用 Git for Windows Bash。
- Bash 和 PowerShell 工具缺少 `description`（工具调用说明）时自动补全。
- 检测明显的 Bash / PowerShell 语法混用并给出提示。
- 增加环境诊断，可检查 Node、Git Bash、PowerShell、Git、pnpm 和 Serena。
- 增加文件修改检查点，可保存某一轮修改并回滚。
- 增加 Git Worktree（Git 独立工作目录）管理后端。
- 增强内置浏览器的缩放、打印、开发者工具和站点数据管理。
- 增加缓存命中详情，能够查看缓存读取、缓存写入和未缓存输入 token。
- 支持第三方模型的推理等级选择。
- 支持主模型不具备图片能力时调用备用识图模型。
- 保留原有 DSH 的对话、工具调用、审批和插件机制。

## 从源代码运行

适用于需要修改代码的情况。要求 Windows 10 或更高版本、Node.js 22.19+ 和 pnpm 11。

```powershell
cd Deepseek-Harness-Desktop-GitHub
npm install
npm run setup:harness
npm start
```

之后再次运行只需要：

```powershell
npm start
```

修改 DSH Web UI 后，在 `vendor/deepseek-harness` 中执行：

```powershell
pnpm run typecheck
pnpm run build:web
```

然后重启桌面程序即可。一般使用不需要重新打包安装程序。

## 本地重新打包

```powershell
npm run dist
```

安装包会生成在 `dist/`。当前发布用的安装包已经放在 `release/` 中。

## 注意事项

- 当前安装包是 Windows x64 版本。
- 安装包未进行代码签名，Windows 可能显示 SmartScreen（Windows 下载安全提示）。
- 不要把自己的 API Key、凭据文件或用户配置复制到项目目录。
- `node_modules`、构建缓存和打包临时文件已通过 `.gitignore` 排除，不需要上传。
