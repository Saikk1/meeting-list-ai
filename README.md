# 会务智办｜AI 全流程会议助手

本机单用户会务工具：会议安排、会务待办、参会人员、正式名单、座次编排，以及可联动系统操作的 AI 助手。

## 下载软件

不开发代码、只使用软件，请打开 [软件下载页（Releases）](https://github.com/Saikk1/meeting-list-ai/releases/tag/v3.0.2)。

| 文件 | 用途 |
| --- | --- |
| `MeetingAssistant-3.0.2-Setup.exe` | 安装版：安装后通过快捷方式打开 |
| `MeetingAssistant-3.0.2-Portable.exe` | 免安装版：双击即可运行 |
| `SHA256SUMS-3.0.2.txt` | 下载文件的 SHA-256 校验值 |

两个 EXE 都内置运行环境，不需要另装 Node.js。仓库为私有仓库，下载需要已获授权的 GitHub 账号；EXE 尚未数字签名。

**GitHub 的“Code → Download ZIP”下载的是源代码，不是安装包。** 已发布软件版本为 `3.0.2`；主分支可能包含后续源码整理，不会自动更新发布页的 EXE。

安装版业务数据位于 `%LOCALAPPDATA%\MeetingAssistantAI`；便携版在 EXE 旁的“会务智办数据”目录。便携版迁移到其他电脑时，请连同数据目录一起复制。升级、卸载保留业务数据。

## 使用入口

- [带截图的操作手册](docs/operation-manual.md)：按日常办理顺序逐步操作；另提供[Word](docs/downloads/会务智办操作手册.docx)和[PDF](docs/downloads/会务智办操作手册.pdf)下载。
- [使用指南](docs/user-guide.md)：会议、人员、车辆、名单、座次、后台配置与 AI 设置。
- [开发与构建](docs/development.md)：源码运行、目录职责、测试和 Windows 打包。
- [发布记录与检查步骤](docs/releases.md)。
- [OA 对接边界](docs/oa-integration.md)：现有只读接口与尚未实现的扩展。

会议可以只记录预计人数，也可以手动添加人员或从通讯录选人；正式名单治理独立启用。车辆按单位登记，不绑定个人，只有开启停车保障的会议显示车辆入口。

AI 通过用户配置的云端 API 调用，不本地部署模型。没有 API Key 仍可手动安排会议、管理人员和执行规则整理；AI 识别与自然语言操作需要联网和调用额度。

## 从源码运行

需要 Node.js **22.13 或更新版本**。在项目目录执行：

```bash
npm ci
npm run build
npm start
```

浏览器打开 `http://127.0.0.1:3000`。首次下载源码必须安装依赖并构建；`start.bat` 只启动已有构建，不代替以上步骤。

日常代码修改后重新构建，或使用 `npm run dev`（先构建再启动，非热更新）。AI 服务商和 Key 在软件内设置。

## 仓库结构

| 目录 | 职责 |
| --- | --- |
| `app/` | 页面、组件、业务规则和模型接口 |
| `scripts/` | 本机服务、文件存储、构建、桌面打包及测试工具 |
| `desktop/` | Electron 桌面入口与运行配置 |
| `tests/` | 自动测试 |
| `public/` | 实际使用的图标和操作指引图片 |
| `docs/` | 使用、开发、发布和集成说明 |
| `build/`、`worker/`、`.openai/hosting.example.json` | 当前 Vinext 构建所需文件，不是业务数据库 |

依赖、构建产物、旧 EXE、临时文件、部署标识、真实会议/通讯录数据和 API Key 不提交到仓库。EXE 只发布到 Releases，不进入源码历史。

`dist/`、`release/`、`node_modules/` 等目录在本机使用时生成；不要把这些目录当作源代码上传。
