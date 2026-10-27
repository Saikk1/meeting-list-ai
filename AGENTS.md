# 项目开发约定

## 定位与入口

本机单用户会务助手，React 19.2 / TypeScript；Vinext + Vite 构建，Node 本机运行器，Electron Windows 桌面包装。

- `app/`：页面、共享编辑器、助手与业务规则。
- 全局快速打开在 `quick-navigation.tsx` / `app/lib/quick-navigation.ts`；`app-dialog.tsx` 统一原生模态行为，`app-feedback.tsx` 仅在持久化成功后提示，通用交互样式见 `app/experience.css`。保活页签由单一 Provider 管理快捷键，避免每页重复注册。
- `scripts/local-server.mjs`：仅回环地址的运行器。
- `scripts/local-api.mjs`、`scripts/local-store.mjs`：会议、通讯录和配置 API / 原子文件存储。
- `desktop/` 与 `electron-builder.config.cjs`：桌面入口和 Windows 安装包；从 3.0.4 正式发布起只构建 NSIS 安装版，不再提供便携版。
- 3.1.5 起 `desktop/updates.mjs` 从公开 GitHub Release 检查和下载更新；更新窗口及 preload 为独立沙箱，只在用户确认且未保存检查通过后安装。发布资产使用 `npm run release:prepare` 生成英文名称和 SHA-256，不嵌入 GitHub 令牌。
- `tests/`：Node 和 TypeScript 自动测试。
- 用户说明见 `docs/user-guide.md`；运行与目录职责见 `docs/development.md`。
- 图文操作步骤见 `docs/operation-manual.md`，截图位于 `docs/images/`；Word 与 PDF 位于 `docs/downloads/`。界面或保存规则变化时同时核对在线版和下载版，不把旧截图当作当前功能证据。
- OA 接口边界见 `docs/oa-integration.md`；发布步骤见 `docs/releases.md`。
- 当前业务使用本机 JSON 存储，无 D1 / Drizzle 数据库和 ChatGPT 登录依赖。保留 `worker/`、`build/sites-vite-plugin.ts` 与无敏感信息的构建模板，它们仍被 Vinext 编译链使用。

## 验证

Node.js >=22.13；使用 `npm ci` 安装锁定依赖。
修改后运行 `npm run lint`、`npm test`。桌面发布使用 `npm run desktop:build`；随后运行 `node scripts/test-desktop.mjs` 验证安装版所用的解包运行程序。正式发布对应源码提交、不可覆盖的版本标签和 GitHub Release；EXE 与 SHA-256 校验文件只放 Release，不进源码历史。
源码克隆不包含 `dist`，启动前须构建。无 `.openai/hosting.json` 时自动使用 `hosting.example.json`。
根 `package.json`、锁文件根版本和 `desktop/package.json` 必须一致。
安装、构建、校验以 npm / Node 命令为准；不再使用早期 Linux Shell 部署辅助脚本。GitHub 首页只保留下载、快速启动和导航，完整业务说明写入使用指南。

## 数据与安全边界

- 不提交真实会议、联系人、API Key、浏览器资料、备份、临时目录或部署标识。
- 安装 / 网页版业务数据位于 `%LOCALAPPDATA%\MeetingAssistantAI`；历史便携版在 EXE 旁“会务智办数据”，路径兼容保留，不再生成新便携包。升级保留数据，不自动合并两个目录。
- `.env.example` 只放空密钥；AI / 搜索 Key 在浏览器设置中配置。
- `MEETING_ASSISTANT_DATA_DIR` 可指定独立测试数据目录；测试不得复用实际用户目录。
- `MEETING_ASSISTANT_INTEGRATION_TOKEN` 是可选服务端集成令牌，默认关闭，不进入前端和管理配置。
- 测试端口与数据覆盖仅用于测试，定义见 `scripts/local-server.mjs`、`desktop/main.mjs`。
- 操作手册截图使用独立测试数据目录和虚构姓名、单位、车牌；不得截图真实通讯录、用户附件或已填写的 API Key。
- AI 操作保持白名单与人工确认；会议人员、车辆、正式名单、座次是独立业务对象。
- 智能纪要模块已移除，不恢复页面、语音识别、模型安装或相关 API。业务数据目录内已有 `minutes/`、`speech/` 不自动删除；旧待办的可选 `minutesSource` 只作兼容保留，不再提供来源跳转。会议写入仍使用 expectedRevision 防止旧快照覆盖。
- 人员必填姓名；单位缺失时可存会议，不能同步通讯录。车辆不绑定人员。
- 通讯录只按姓名与已配置的精确标准单位关系去重，人工字段优先，不按姓名或模糊单位强制合并。
- 工作区只在当前页面会话内保活，不持久化未保存草稿。

业务入口、数据存储、环境变量或发布步骤变更时同步 README 与对应 docs。无须为现有本机流程引入账号 / 公网代理。
