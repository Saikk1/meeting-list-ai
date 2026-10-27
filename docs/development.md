# 开发与构建

## 全局交互入口

`app/components/quick-navigation.tsx` 在 `WorkspaceTabsProvider` 内单实例挂载，侧栏/页签栏通过事件打开，Ctrl/Command+K 在无打开模态窗口时响应。功能与工作区匹配规则在 `app/lib/quick-navigation.ts`；会议从现有本机快照筛选；不访问文字模型、不新建索引和数据副本。未保存列表使用现有工作区 dirty/dirtyReasons 真值，不标记或保存草稿。

`app-dialog.tsx` 提供原生模态、Escape、正文锁滚与焦点恢复，用于快速打开、页签关闭和会议编辑；业务确认仍由 `ConfirmationDialog` 单队列处理，可叠在编辑窗口上。`app-feedback.tsx` 接收静态成功提示，调用点必须在本机持久化成功后触发，不把错误冒充成功；手工保存规则不变。`experience.css` 维护共享焦点、筛选反馈、固定表单操作区和窄屏样式。会议校验定位以 form 内的 name 查找，不命中隐藏的其他保活页面。UX 回归用 `.tmp/ux-validation-data/` 的虚构会议，覆盖键盘快速打开、未保存关闭取消、首个错误定位、嵌套确认与 390×700 窗口。

## 已移除的资料模块

2026-10-20 按用户要求移除智能纪要，包括页面、会议页签、录音及文档导入、生成问答、模型安装、后台队列、接口和构建资源。名单治理与助手填报共用的 `business-document-reader.ts`、PDF/OCR 保留。业务数据目录中已存在的 `minutes/` 和 `speech/` 不做清理，程序不再读取；若需要备份，退出服务后复制整个业务数据目录。

旧会议任务的 `minutesSource` 仅在类型与存储校验中兼容，任务内容、负责人、期限、状态照常保存，不再显示来源入口。会议 revision 与 expectedRevision 并发校验继续使用；旧数据缺省版本 0，后续保存递增，冲突保留前端修改。

## 图文操作手册

`docs/operation-manual.md` 为在线步骤源，`docs/tools/build-operation-manual.py --format docx` 生成 Word，`--format pdf --output docs/downloads/会务智办操作手册.pdf --font 中文字体路径` 生成 PDF。图片只使用独立测试目录的虚构资料；正文、截图或功能变化后同步下载版并渲染检查。生成器只读取手册与图片，不读取业务数据。中间渲染文件放在忽略目录。

## 技术与运行方式

React 19.2 / TypeScript 页面通过 Vinext + Vite 构建；`scripts/local-server.mjs` 提供本机网页和 API。Electron 包装同一套预编译页面与本机服务，仅生成 Windows x64 NSIS 安装程序。

会议、通讯录和后台配置由 `scripts/local-store.mjs` 保存为本机 JSON 文件，使用原子写入与备份恢复。当前业务没有使用 D1 / Drizzle 数据库，也没有 ChatGPT 登录系统。

## 安装、构建和启动

需要 Node.js >=22.13。

```bash
npm ci
npm run build
npm start
```

首次安装或锁文件变更后使用 `npm ci`；源码更新后重新构建。`npm start` 和 `start.bat` 不负责构建。服务固定绑定 `127.0.0.1:3000`，端口占用时先关闭旧服务，不自动切换。

`npm run dev` 会先构建再启动完整本机服务，不提供热更新。修改代码后需要停止服务、重新运行。

## 统一命令入口

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖；`npm run install:ci` 是兼容别名 |
| `npm run build` | 构建并校验运行入口、构建清单和内置默认配置 |
| `npm start` | 启动已有构建 |
| `npm run lint` | 检查代码 |
| `npm test` | 重新构建，再运行 Node 和 TypeScript 测试 |
| `npm run desktop` | 开发环境打开桌面入口；先完成构建 |
| `npm run desktop:build` | 构建并生成 Windows 安装程序，不生成便携版 |
| `npm run validate:artifact` | 兼容入口，与生产构建及校验相同 |

构建与验证统一使用上述 npm / Node 入口。早期要求 Linux `flock`、GNU `timeout` 的 Shell 辅助脚本已经移除，不需要 Bash。

## 目录与代码入口

- `app/meetings/`、`app/tasks/`、`app/lists/`、`app/admin/`：会议、待办、名单和后台页面。
- `app/components/`：人员、车辆、会议编辑器、座次、智能助手和工作区。座次由 `seating-planner.tsx` 管理草稿/60 步撤销历史，`seating-canvas.tsx` 管理图上交互，`app/lib/seating-layout.ts` 提供与真实场地尺寸无关的展示坐标。

座次方案沿用 `schemaVersion: 1`，可选新增 `lockedSeatIds` 与 `roomId`，旧数据无需迁移。锁定仅允许已有人员的有效席位；`regenerateSeatingPlan` 统一保护手动与助手重排，布局不兼容时拒绝写入。参考会议室不改变会议预订，容量只使用已登记值。人员/规则修改保留旧预览但阻止陈旧方案保存；页面状态继续由工作区统一保护。
- `app/lib/`：共享业务规则、数据模型及前端存储桥接。
- `app/api/`：AI 提取、助手、排序分析和搜索接口。
- `scripts/local-server.mjs`：服务入口、静态文件和本机访问限制。
- `scripts/local-api.mjs`、`scripts/local-store.mjs`：业务 API 与原子文件存储。
- `scripts/integration-api.mjs`、`scripts/integration-provider.mjs`：独立 OA 只读协议。
- `scripts/build.mjs`、`scripts/prepare-default-config.ts`：生产构建和内置配置生成。
- `scripts/prepare-desktop.mjs`、`scripts/package-desktop.mjs`：桌面资源与打包。
- `desktop/main.mjs`、`desktop/paths.mjs`、`electron-builder.config.cjs`：桌面生命周期、数据路径及分发清单。
- `app/lib/confirmation.ts` 与根布局的 `confirmation-dialog.tsx`：异步确认队列和 HTML 模态窗口，禁止业务页面再调用 `window.confirm/alert/prompt`。窗口位于保活页签外，取消/Escape 不执行操作，关闭后恢复可见原控件焦点。
- `desktop/window-focus.mjs`：退出草稿确认不阻塞主进程，取消恢复窗口和渲染页焦点；同一次确认中的重复关闭不再叠加窗口。`desktop/input-smoke.mjs` 仅显式测试模式触发，在隔离数据里通过键盘事件检查确认后输入，不读取真实用户资料。
- `tests/`：业务、API、页面渲染、本机运行器和存储的自动测试。

### 为什么仍保留构建平台文件

`worker/index.ts` 是当前 Vite / Vinext 构建入口，`build/sites-vite-plugin.ts` 写出构建清单。Cloudflare 相关依赖属于现有编译链，不代表本机业务需要云端数据库或上线 Sites。

`.openai/hosting.example.json` 是不含部署标识的构建模板。普通源码克隆不需要创建 `.openai/hosting.json`；构建自动使用模板。已有本机部署配置被 Git 忽略，桌面分发也排除 `dist/.openai/`。

不要仅因文件名含 `worker` 或 `sites` 就删除这些入口；替换编译链需要独立验证，不属于模板残留清理。

## 检查与测试

```bash
npm run lint
npm run typecheck
npm test
```

测试覆盖配置迁移、会议与通讯录存储、助手操作确认、待办、名单排序/导出、座次、工作区，以及不依赖 `node_modules` 的预编译运行环境。测试模型接口使用本机模拟服务，不需要真实 API Key。

`npm test` 与 `npm run desktop:build` 均先执行完整 TypeScript 检查；类型错误会直接停止后续构建。Worker 模板声明自身实际使用的资源接口，不依赖未安装的 Cloudflare 全局类型或 D1 绑定。

测试必须使用独立目录或 `MEETING_ASSISTANT_DATA_DIR`，不得复用用户真实数据目录。详见 [数据边界](user-guide.md#数据边界) 与 [OA 认证配置](oa-integration.md#运行与认证)。

## Windows 桌面打包

```bash
npm run desktop:build
node scripts/test-desktop.mjs
```

桌面验证必须实际启动沙箱化渲染器并完成两次测试，不能以 HTTP 检查替代。受限自动执行账户可能报 GPU 子进程 `0xC0000135` 或渲染器 `launch-failed/49`；后者表示无法创建 Chromium 所需受限令牌。诊断脚本会给出日志路径和正常 Windows 用户终端的验证指引，仍以失败退出，不跳过断言、不关闭渲染沙箱。临时软件渲染诊断不进入发行配置。

当前源码输出在 `release/desktop/`，安装程序为 `会务智办-3.1.5-安装版.exe`，不提交 Git；正式发布时命名 `MeetingAssistant-3.1.5-Setup.exe`。历史发布保持不变。配置和命令均只选择 NSIS，回归测试禁止重新加入便携目标。旧便携包可能仍保留在本机忽略目录中，不代表新版本分发内容。Windows x64 构建和桌面验证应在 Windows 上执行；未配置签名证书时不得标称已签名。

根 `package.json`、锁文件根版本、`desktop/package.json` 三处版本保持一致。更改版本时同步说明及测试命令里的 EXE 名称。发布步骤见 [发布记录](releases.md#发布验证)。

已发布的安装包不会随主分支更新自动变化；源码整理与软件发版分开记录。

## 会议方案与助手页面上下文

- `business-data-events.ts` 为通讯录与后台配置提供可订阅版本号。通讯录所有成功写入（含会议同步、替换和撤销）统一通知；配置发布、回滚、助手修改和撤销都通知 `useAdminConfig`。页面使用 `useSyncExternalStore`，Activity 恢复时也能发现隐藏期间的更新；重读不卸载已加载编辑器，旧请求不覆盖新响应，失败保留上次配置。
- 编辑器使用上次采用的数据作为草稿基线，不能把新服务器快照误当成原草稿基线；干净时采用最新版本，存在人工修改时保留草稿并阻止冲突覆盖。会议基本信息弹窗不以更新时间作为组件 key。
- `app/lib/meeting-plan.ts` 管理模板数据、来源差异和选择同步；`meeting-plan-export.ts` 使用 `public/templates/meeting-plan.docx` 的样式段落生成可编辑 Word，不包含模板中的真实参会数据。
- `scripts/meeting-plan-schema.mjs` 在浏览器与本机存储共用校验；方案随会议保存，继续使用会议 API 的 expectedRevision。
- `use-assistant-workspace.ts` 注册可见工作区的草稿、允许字段和操作模式；助手请求捕获工作区及版本，采用时重新校验。React Activity 隐藏的工作区不接受写入。
- AI 会话独立保留对话；模型设置共用。同一次会话跟随当前业务页面，附件、未保存草稿、待确认操作及请求状态不跨刷新恢复；聊天历史的持久化规则见下一项。
- `assistant-conversations.ts` 将聊天记录白名单保存到浏览器 localStorage 的 `meeting-list-ai:assistant-conversations:v1`，恢复会话列表、标题和当前选择；不持久化附件、草稿、API 配置、执行计划和生成状态。此项更新替代此前 AI 会话仅在内存保留的规则，业务工作区草稿仍不跨刷新恢复。恢复的历史会话按需挂载，避免一次打开所有历史助手。
- `assistant-error-boundary.tsx` 隔离单个助手会话的渲染异常；`desktop/renderer-health.mjs` 记录技术诊断标记及渲染进程退出原因。日志不收集普通控制台内容、提示词、模型回复或密钥；重新加载及重建会话均需用户明确操作。

## 桌面版本更新

`desktop/updates.mjs` 使用 Electron `net.fetch` 读取公开仓库 `Saikk1/meeting-list-ai` 的 GitHub Releases latest API。匿名 API 限流时改用公开 latest 发布页的最终 tag 地址、同版 `SHA256SUMS-版本.txt` 与安装包 HEAD 大小。只接受更高的三段正式版本、精确的 `MeetingAssistant-版本-Setup.exe` 资产名与本仓库下载地址，拒绝草稿、预发布、缺少 SHA-256 或超出 512 MB 的安装包。检查网络请求超时 15 秒，下载总超时 10 分钟；不发送业务数据、API Key 或 GitHub 令牌。

下载暂存于业务目录下独立的 `desktop-updates/`，校验字节数和 SHA-256 后才改名为缓存 EXE；取消/失败清理本次 partial 文件。安装请求及进程交接时重新校验。更新窗口使用独立沙箱、CSP、CommonJS preload 和受限 IPC，只接受该窗口主 frame 的请求，业务网页无更新进程权限。源码运行、历史便携版不自动更新；烟雾模式使用虚构更新源，不联网、不运行安装程序。

点击安装后走现有 `beforeunload` 及异步确认；取消或确认失败立即清除安装请求。只有主窗口允许关闭、后台退出后，才启动当前目录的 NSIS 更新（`/S --updated --force-run /D=当前安装目录`）。无自动退出安装或下次启动强制安装。下载不修改业务数据，安装仍使用保留数据的既有 NSIS 配置。

`desktop/update-window.mjs` 与 `desktop/update-ui/` 负责更新窗口，`desktop/update-preload.cjs` 只提供固定状态/操作消息；所有文件必须包含在 Electron asar。`tests/desktop-updates.test.mjs` 验证发布边界、网络/取消/损坏、缓存及安装交接和 IPC 隔离。`scripts/test-desktop.mjs` 实际启动打包更新窗口，验证 preload、IPC、检测与下载；不替换用户安装。

正式发布在桌面构建和验证后运行 `npm run release:prepare`，生成英文安装包与校验文件。GitHub Release 必须为正式版并设为 Latest，安装包名、tag 与版本严格对应。更新器使用 GitHub 自动提供的资产 digest，无需另放 `latest.yml` 或第三方更新服务器。历史版本不覆盖；自动更新从 3.1.5 首次安装后生效。

## 不上传的文件

`node_modules/`、`dist/`、`release/`、`.tmp/`、`.sites-runtime/`、`.wrangler/`、`.npm-cache/` 是本机产物。真实会议、通讯录、后台配置、浏览器资料、备份、API Key 和部署标识也不得提交。

本机旧安装包保留在忽略目录中；仓库整理不删除用户数据，不重写 Git 历史。
