# OA 集成接口 v1

本项目已预留独立的集成接口和数据提供者边界。当前实现是本机只读接口，可供同机 OA 连接器验证协议。正式接入公司的 OA 时，再根据厂商资料实现身份、组织、审批和消息适配。

## 运行与认证

- 网页运行器地址：`http://127.0.0.1:3000`；桌面运行器默认地址：`http://127.0.0.1:32187`。
- 服务启动时读取 `MEETING_ASSISTANT_INTEGRATION_TOKEN`。留空返回 `503 INTEGRATION_DISABLED`；启用时配置 32～256 位不含空格的 ASCII 随机令牌。修改后重启运行器。
- 源码运行可通过 `.env.local` 设置；桌面版通过启动进程的环境变量设置。不要手工修改便携版临时解包目录。
- 每次请求携带 `Authorization: Bearer <集成令牌>`。不要把令牌放入 URL、前端页面、管理配置或配置导出。
- 仅接受 `GET`、`HEAD`，不开放 CORS；带 Origin 的浏览器请求被拒绝。当前令牌拥有全部集成读取权限，不代表 OA 用户身份。
- 当前服务仍绑定本机回环地址。远端 OA 不能直接访问这台桌面软件；正式部署需要公司服务端网关和企业认证。现有网页页面禁止 iframe 嵌入。

## 已实现的接口

前缀为 `/api/integrations/v1`，接口版本与内部文件版本相互独立。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET / HEAD | `/capabilities` | 版本能力、认证方式、分页上限、是否支持写入 |
| GET / HEAD | `/meetings` | 会议分页列表，默认只返回 active |
| GET / HEAD | `/meetings/{id}` | 一场会议的基本信息和生命周期状态 |
| GET / HEAD | `/meetings/{id}/tasks` | 会前、会中、会后待办分页列表 |
| GET / HEAD | `/meetings/{id}/attendees` | 参会名单分页列表 |
| GET / HEAD | `/contacts` | 人员通讯录分页列表与搜索 |

列表通用参数：`limit` 默认 50、范围 1～200；`offset` 默认 0、非负安全整数。会议列表还接受 `status=active|archived|deleted|all`；通讯录接受 `q`，最多 100 个字符。未知或重复参数返回 `400 INVALID_QUERY`。会议 ID 沿用本系统 ID，不能以会议名称作为关联主键。

成功响应：

```json
{
  "apiVersion": "1",
  "requestId": "生成的请求追踪 ID",
  "data": {
    "items": [],
    "total": 0,
    "limit": 50,
    "offset": 0,
    "nextOffset": null,
    "snapshotAt": null
  }
}
```

会议详情的 `data` 是单个会议对象；能力接口的 `data` 是能力对象。`snapshotAt` 是所在数据文件的更新时间，空库为 null。分页不是跨请求锁定快照：读取过程中若发生修改，应重新拉取并按 ID 去重。本版没有增量同步游标或删除事件流。

失败响应：

```json
{
  "apiVersion": "1",
  "requestId": "生成的请求追踪 ID",
  "error": { "code": "UNAUTHORIZED", "message": "集成令牌无效或缺失" }
}
```

所有响应带 `X-Request-Id` 和 `Cache-Control: no-store`。HEAD 保留响应状态和头部，正文为空。错误状态包括 400（参数）、401（令牌）、403（浏览器访问）、404（路径、版本或会议不存在）、405（写入未开放）、500（数据服务错误）、503（集成关闭）。

## v1 数据字段

| 对象 | 固定字段 |
| --- | --- |
| 会议 | `id, title, date, startTime, endTime, location, meetingRoomId, organizer, owner, attendeeEstimate, status, createdAt, updatedAt, archivedAt, deletedAt` |
| 待办 | `id, meetingId, title, description, phase, group, status, owner, dueDate, note` |
| 参会人 | `id, meetingId, name, unit, department, title` |
| 联系人 | `id, name, unit, department, title, createdAt, updatedAt` |

日期为 `YYYY-MM-DD`，时间为 `HH:mm`，按照公司/本机业务时区（目前 Asia/Shanghai）解释；时间戳为 ISO 8601。可选会议结束时间、会议室 ID、归档/删除时间统一返回 null。待办 phase 为 `before|during|after`，status 为 `todo|doing|blocked|review|done|waived`；dueDate 未设置时为空字符串。

对外对象明确列出字段，不透传内部存储；会议规则快照、模板、内部备注、附件文件名、人员原始来源、通讯录内部身份别名和模型配置不在这些响应中。参会人 ID 与通讯录 ID 是不同资源，不能直接当作 OA 用户 ID。负责人当前是文本，也不能直接当作企业账号。

## 接入代码边界

- `scripts/integration-api.mjs`：版本路由、令牌校验、分页参数、统一响应与错误。
- `scripts/integration-provider.mjs`：本地存储到公开字段的转换。
- `createIntegrationApi({ provider, token })` 支持注入替代 provider。provider 实现 `listMeetings(options)`、`getMeeting(id)`、`listMeetingTasks(id, options)`、`listMeetingAttendees(id, options)`、`listContacts(options)`；列表返回上面的分页结构，会议不存在返回 null。
- `scripts/local-server.mjs` 负责装配；桌面打包清单包含这两个集成模块。

新增 OA 适配器应放在独立模块中，转换厂商字段并实现同一 provider 协议；路由和页面不依赖某一家 OA 的 SDK。字段的破坏性变更应另建 v2；v1 消费方应容忍未来新增的非破坏字段。

## 下一阶段扩展设计（尚未实现）

| 接入点 | 实施要求 |
| --- | --- |
| 单点登录与用户权限 | OA 服务端验证身份后映射到企业用户、组织与权限；替换当前共享读取令牌。前端不保存企业级集成密钥 |
| 人员、部门与会议室同步 | 建独立映射表，以 `system + resourceType + externalId` 唯一定位内部 ID，避免按姓名匹配；确定 OA 和本系统分别负责哪些字段 |
| 会议创建、修改与待办回写 | 新增逐条命令接口、服务端业务校验、版本冲突检查、幂等键和审计；校验会议室冲突。当前整库替换接口不能用作 OA 并发写入口 |
| 审批关联与回调 | 独立保存 externalProcessId 和审批状态，校验签名、时间戳及重放；审批状态与本系统任务状态显式映射 |
| 消息通知与双向同步 | 使用可持久化 outbox、事件 ID、重试和去重；本机文件模式不保证事件交付 |
| OA 页面入口 / 嵌入 | 确认是菜单链接还是 iframe；iframe 需按公司域名配置 frame-ancestors，并配套 SSO 和 HTTPS 网关 |

正式对接前需 OA 厂商/版本、接口文档、测试环境、登录方式、组织人员主数据、需要同步的业务范围，以及部署位置。以上扩展仅定义实施边界，当前能力接口明确返回 `writeSupported: false`。
