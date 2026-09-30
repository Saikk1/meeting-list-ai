# 项目开发约定

## 定位与入口

本机单用户会务助手，React 19.2 / TypeScript；Vinext + Vite 构建，Node 本机运行器，Electron Windows 桌面包装。

- `app/`：页面、共享编辑器、助手与业务规则。
- `scripts/local-server.mjs`：仅回环地址的运行器。
- `scripts/local-api.mjs`、`scripts/local-store.mjs`：会议、通讯录和配置 API / 原子文件存储。
- `desktop/` 与 `electron-builder.config.cjs`：桌面入口和安装 / 便携打包。
- `tests/`：Node 和 TypeScript 自动测试。
- OA 接口边界见 `docs/oa-integration.md`；发布步骤见 `docs/releases.md`。

## 验证

Node.js >=22.13；使用 `npm ci` 安装锁定依赖。
修改后运行 `npm run lint`、`npm test`。桌面发布使用 `npm run desktop:build`；随后分别运行 `node scripts/test-desktop.mjs` 和追加便携版路径的相同命令。
源码克隆不包含 `dist`，启动前须构建。无 `.openai/hosting.json` 时自动使用 `hosting.example.json`。
根 `package.json`、锁文件根版本和 `desktop/package.json` 必须一致。

## 数据与安全边界

- 不提交真实会议、联系人、API Key、浏览器资料、备份、临时目录或部署标识。
- 安装 / 网页版业务数据位于 `%LOCALAPPDATA%\MeetingAssistantAI`；便携版在 EXE 旁“会务智办数据”。升级保留数据。
- `.env.example` 只放空密钥；AI / 搜索 Key 在浏览器设置中配置。
- `MEETING_ASSISTANT_DATA_DIR` 可指定独立测试数据目录；测试不得复用实际用户目录。
- `MEETING_ASSISTANT_INTEGRATION_TOKEN` 是可选服务端集成令牌，默认关闭，不进入前端和管理配置。
- 测试端口与数据覆盖仅用于测试，定义见 `scripts/local-server.mjs`、`desktop/main.mjs`。
- AI 操作保持白名单与人工确认；会议人员、车辆、正式名单、座次是独立业务对象。
- 人员必填姓名；单位缺失时可存会议，不能同步通讯录。车辆不绑定人员。
- 通讯录只按姓名与已配置的精确标准单位关系去重，人工字段优先，不按姓名或模糊单位强制合并。
- 工作区只在当前页面会话内保活，不持久化未保存草稿。

业务入口、数据存储、环境变量或发布步骤变更时同步 README 与对应 docs。无须为现有本机流程引入账号 / 公网代理。
