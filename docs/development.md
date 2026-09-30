# 开发与构建

[返回仓库首页](../README.md) · [使用指南](user-guide.md) · [发布检查](releases.md)

## 技术与运行方式

React 19.2 / TypeScript 页面通过 Vinext + Vite 构建；`scripts/local-server.mjs` 提供本机网页和 API。Electron 包装同一套预编译页面与本机服务，生成 Windows x64 安装版和便携版。

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
| `npm run desktop:build` | 构建并生成 Windows 安装版、便携版 |
| `npm run validate:artifact` | 兼容入口，与生产构建及校验相同 |

构建与验证统一使用上述 npm / Node 入口。早期要求 Linux `flock`、GNU `timeout` 的 Shell 辅助脚本已经移除，不需要 Bash。

## 目录与代码入口

- `app/meetings/`、`app/tasks/`、`app/lists/`、`app/admin/`：会议、待办、名单和后台页面。
- `app/components/`：人员、车辆、会议编辑器、座次、智能助手和工作区。
- `app/lib/`：共享业务规则、数据模型及前端存储桥接。
- `app/api/`：AI 提取、助手、排序分析和搜索接口。
- `scripts/local-server.mjs`：服务入口、静态文件和本机访问限制。
- `scripts/local-api.mjs`、`scripts/local-store.mjs`：业务 API 与原子文件存储。
- `scripts/integration-api.mjs`、`scripts/integration-provider.mjs`：独立 OA 只读协议。
- `scripts/build.mjs`、`scripts/prepare-default-config.ts`：生产构建和内置配置生成。
- `scripts/prepare-desktop.mjs`、`scripts/package-desktop.mjs`：桌面资源与打包。
- `desktop/main.mjs`、`desktop/paths.mjs`、`electron-builder.config.cjs`：桌面生命周期、数据路径及分发清单。
- `tests/`：业务、API、页面渲染、本机运行器和存储的自动测试。

### 为什么仍保留构建平台文件

`worker/index.ts` 是当前 Vite / Vinext 构建入口，`build/sites-vite-plugin.ts` 写出构建清单。Cloudflare 相关依赖属于现有编译链，不代表本机业务需要云端数据库或上线 Sites。

`.openai/hosting.example.json` 是不含部署标识的构建模板。普通源码克隆不需要创建 `.openai/hosting.json`；构建自动使用模板。已有本机部署配置被 Git 忽略，桌面分发也排除 `dist/.openai/`。

不要仅因文件名含 `worker` 或 `sites` 就删除这些入口；替换编译链需要独立验证，不属于模板残留清理。

## 检查与测试

```bash
npm run lint
npm test
```

测试覆盖配置迁移、会议与通讯录存储、助手操作确认、待办、名单排序/导出、座次、工作区，以及不依赖 `node_modules` 的预编译运行环境。测试模型接口使用本机模拟服务，不需要真实 API Key。

测试必须使用独立目录或 `MEETING_ASSISTANT_DATA_DIR`，不得复用用户真实数据目录。详见 [数据边界](user-guide.md#数据边界) 与 [OA 认证配置](oa-integration.md#运行与认证)。

## Windows 桌面打包

```bash
npm run desktop:build
node scripts/test-desktop.mjs
node scripts/test-desktop.mjs "release/desktop/会务智办-3.0.2-便携版.exe"
```

输出在 `release/desktop/`，不提交 Git。Windows x64 构建和桌面验证应在 Windows 上执行；未配置签名证书时不得标称已签名。

根 `package.json`、锁文件根版本、`desktop/package.json` 三处版本保持一致。更改版本时同步说明及测试命令里的 EXE 名称。发布步骤见 [发布记录](releases.md#发布验证)。

已发布的安装包不会随主分支更新自动变化；源码整理与软件发版分开记录。

## 不上传的文件

`node_modules/`、`dist/`、`release/`、`.tmp/`、`.sites-runtime/`、`.wrangler/`、`.npm-cache/` 是本机产物。真实会议、通讯录、后台配置、浏览器资料、备份、API Key 和部署标识也不得提交。

本机旧安装包保留在忽略目录中；仓库整理不删除用户数据，不重写 Git 历史。
