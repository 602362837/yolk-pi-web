# 计划审批书：新增 Links 模块并支持 GitHub 多账号连接管理

## 请求审批

本计划新增一个与 LLM 认证体系完全隔离的 **Links** 模块。P0 在 Settings → Links 中通过 **GitHub OAuth Device Flow** 连接多个 GitHub 身份：用户点击「连接 GitHub」，在 GitHub 官方页面输入短期设备码并批准；服务端取得 OAuth access token 后安全保存，浏览器只显示身份、验证状态与 scopes。

**上一版错误地把“不要求用户创建 OAuth App”理解成“不要 OAuth / 让用户粘贴 PAT”。本版已纠正并整篇替换审批材料与 HTML 原型。** 用户批准本审批书和 Device Flow HTML 原型前，不进入生产实现。

## 审批材料

- [Brief / 目标与边界](brief.md)
- [PRD / 需求与验收标准](prd.md)
- [UI / 交互、状态与实现基线](ui.md)
- [HTML 原型 / Settings → Links → GitHub Device Authorization](links-github-connections-prototype.html)
- [Design / 技术边界、数据流与 API 契约](design.md)
- [Implement / DAG Implementation Plan](implement.md)
- [Checks / 自动与人工验收](checks.md)

HTML 原型为自包含文件，可通过任务本地 CSP sandbox preview 打开。原型顶部可切换：空态、OAuth 未配置、启动 busy、设备码等待、弹窗拦截、slow_down、拒绝/过期/取消/网络、SSE 重连、成功、多账号、重复 identity、断开确认/busy/失败、light/dark、窄屏、keyboard focus、reduced motion。

## PRD 摘要

- **只做连接**：Device Flow 授权、活动列表、身份/状态/scope 展示、本机断开。
- **多账号**：多个不同 GitHub numeric user id 可同时连接。
- **主路径**：产品方 GitHub OAuth App 的 Device Flow；终端用户不创建 OAuth App，也不填任何 secret。
- **scope**：P0 固定请求 `read:user`。
- **PAT**：完全移出 P0；无主路径、无隐藏 fallback。
- **不做**：clone、repo/org 列表、PR、Issue、Actions、权限引擎、账号 failover、runtime 消费、GitHub App 安装、Authorization Code callback、`gh auth` 导入。
- **token 永不返回**：access token 与 `device_code` 不得出现在 API 响应、DOM、toast/error、metadata、日志、任务/session JSONL。

## Design 摘要

- Provider registry 首个 adapter 为 `github`；未知 provider fail closed。
- 固定三个 GitHub 端点：device code、access token polling、`GET /user`；Bearer 仅服务端；redirect rejection、超时、响应大小限制。
- Device Flow 只需 server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`；**不需要 client secret**；缺失配置返回 `github_authorization_not_configured`，UI 不回退 token 输入。
- 授权状态在 `globalThis` 短期内存中：opaque authorization id、TTL、取消、与 SSE 订阅解耦的后台轮询；`device_code` 不落盘。
- 存储位于 `~/.pi/agent/links/`：metadata registry 与 OAuth secret 分离，目录 0700、文件 0600、原子写和 provider mutation lock。
- Links 不读写 `auth.json`、`auth-accounts/`、`auth-api-key-accounts/`，不导入 CredentialStore、ModelRuntime 或 RPC auth reload。
- REST/SSE：`GET /api/links`、`POST /api/links/github/authorizations`、`GET .../authorizations/[id]/events`、`DELETE .../authorizations/[id]`、`GET/DELETE .../connections[...]`；全部 `Cache-Control: no-store`（SSE 另加 no-cache）。

## 已选产品策略（请用户确认）

1. **主路径**：GitHub OAuth Device Flow（点连接 → 设备码 → GitHub 官方页授权）。
2. **应用身份**：产品方拥有的 OAuth App；server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`；官方构建/部署注入，源码开发者可覆盖；**无 client secret**。
3. **终端用户**：不创建 OAuth App，不填 PAT/token。
4. **scope P0**：仅 `read:user`。
5. **PAT**：完全移出 P0；未来若要做高级 fallback 必须重新审批。
6. **重复 GitHub 用户**：同一 provider + GitHub numeric user id 返回 `409 duplicate_identity`；不静默更新 token；P0 轮换方式为先断开再重新连接。
7. **断开语义**：metadata soft-delete 保留审计；活动 OAuth secret 删除；界面明确“本机断开不会撤销 GitHub 远端 OAuth 授权”。
8. **Settings Save**：Links 操作即时保存，不进入 `pi-web.json` dirty/save；全局 Save/Reset 在 Links view 禁用并持续显示“即时保存”。
9. **与 LLM auth 隔离**：独立 domain / 存储 / API / UI。

## Implementation Plan 摘要

计划含 7 个 schemaVersion 2 子任务，最大并发 2：

1. `LINKS-01` Links contracts、产品 client 配置、GitHub Device Flow adapter、短期授权状态机。
2. `LINKS-02` OAuth secret/metadata 分离存储、锁、duplicate/disconnect 事务。
3. `LINKS-03` catalog、authorization start/SSE/cancel、connections list/disconnect APIs。
4. `LINKS-04` Settings Links Device Flow UI；与 API 在 contracts 稳定后可并行。
5. `LINKS-05` 临时 agent dir、fetch stub、polling/并发/故障/secret sentinel 测试。
6. `LINKS-06` architecture/API/frontend/library/deployment/operations/AGENTS 文档。
7. `LINKS-07` lint、tsc、focused regressions、浏览器与 checker 安全评审。

实现阶段必须按 task implementationPlan claim/dispatch；不得把 PAT 表单、OAuth web callback、GitHub App 安装、`gh auth`、repo/clone/PR 或 token reveal 顺手带入。

## Checks 摘要

- 自动：`npm run test:links`、`npm run test:web-credential-store`、`npm run test:api-key-accounts`、`npm run lint`、`node_modules/.bin/tsc --noEmit`。
- 安全：access-token / device_code sentinel 在响应、metadata、DOM、logs、errors、task/session JSONL 中全量缺失；user code 可显示但终态清除；GitHub URL/scope 固定；断开故障不虚假成功。
- 人工：空态、连接 Device Flow、多账号、重复、错误恢复、断开确认/busy/失败、窄屏、键盘、focus restore、reduced motion、Settings Save 语义、未配置 fail closed。
- 阻塞项：任何 token/`device_code` 泄漏、写入 LLM auth store、缺少/偏离 Device Flow HTML 原型、重复身份静默覆盖、disconnect split-brain、回退已移出 P0 的 token 粘贴方案或范围扩展。

## 风险与回滚

主要风险：产品 client id 未在实现/UAT 前准备、token/`device_code` 泄漏、polling 超频、SSE 断线误解、重复授权产生未保存远端 token、与 LLM auth 误耦合、断开不等于远端撤销的安全误解。设计分别通过 fail-closed 配置、专用 secret 类型与 sentinel 扫描、interval/slow_down、后台授权与订阅解耦、409 + GitHub 撤销指引、import 门禁、确认文案缓解。

回滚时可隐藏 Links leaf / 让 authorization start 返回 503，但不自动删除 `~/.pi/agent/links/`，也绝不迁回 `auth.json`。远端 OAuth grant 由用户在 GitHub Settings 手工撤销。

## 请用户确认

请审阅上述材料，尤其是 [HTML 原型](links-github-connections-prototype.html) 中的 Settings root leaf、连接 GitHub 主路径、设备码面板、多账号卡片、scope 文案、断开确认和全局 Save/Reset 处理。

**请明确回复「批准」或「需要修改」。** 批准表示同意：

- Device Flow 是 P0 唯一主路径；
- 应用身份归产品方 OAuth App，client id 为 server-only 配置且无 client secret；
- 终端用户不创建 OAuth App、不填 PAT；
- scope 仅 `read:user`；
- PAT 完全移出 P0；
- 重复 identity 返回 409；
- 断开仅清理本机凭据；
- Links 与 LLM auth 完全隔离。
