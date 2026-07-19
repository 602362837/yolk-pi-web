# review — Links / GitHub 多账号 Device Flow 连接

## 检查范围

- 对照 `brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` 与批准的 HTML 原型 `links-github-connections-prototype.html`
- 覆盖 LINKS-01…07 全部 done 子任务的生产 diff、调用方、文档与验证
- 运行 checks 计划中的 focused Links 套件与 auth 回归；对 Links 源做静态安全 / 隔离 / UI 契约审查
- 修复检查过程中发现的 3 个低风险实现问题（见 Findings Fixed）

## 门禁材料

| 项 | 状态 |
| --- | --- |
| UI 设计员 HTML 原型 | 有：`links-github-connections-prototype.html`（Device Flow 主路径，无 PAT 表单） |
| `ui.md` / `plan-review.md` | 有；计划审批书明确 Device Flow 为唯一主路径 |
| 用户审批 | 任务已进入实现/检查阶段；材料按 Device Flow 修订版验收 |
| Implementation plan | 7/7 done |
| Required artifact `review.md` | 本文件 |

## 需求覆盖（摘要）

| 检查项 | 结论 |
| --- | --- |
| Device Flow 是唯一 P0 主路径 | **Pass** — `LinksConfig` 主 CTA 为「连接 GitHub」；无 password/PAT 输入、无 import/reveal/copy token |
| 产品-owned OAuth App / server-only client id | **Pass** — `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 仅 `lib/github-link-oauth.ts` 读取；无 `NEXT_PUBLIC_*`；缺失 → `github_authorization_not_configured` |
| 无 client secret | **Pass** — 仓库/API/UI/日志路径均无 client secret 配置或传输 |
| 固定 egress / scope | **Pass** — device code / access token / user 三端点常量固定；scope 固定 `read:user`；客户端 body 禁止 token/scope/clientId/url 等 |
| 多账号 + 409 重复 identity | **Pass** — store 在锁内按 `providerUserId` 查重；duplicate 不写新 secret；UI 高亮现有卡片并给 GitHub 撤销指引 |
| 本地断开 ≠ 远端撤销 | **Pass** — AppPrompt 确认文案明确；disconnect quarantine → soft-delete metadata → unlink |
| 与 LLM auth 隔离 | **Pass** — Links lib/API/UI 不导入 CredentialStore / ModelRuntime / oauth-accounts / rpc-manager；只写 `~/.pi/agent/links/` |
| Settings Save 语义 | **Pass** — Links view 全局 Save/Reset 禁用并说明即时保存；不进 `pi-web.json` dirty |
| 文档 | **Pass** — architecture / api / frontend / library / integrations / deployment / operations / AGENTS 均已记录 Device Flow、隔离与配置前置条件 |

## 安全审查

### Secret / privacy

- 使用设计约定 sentinel 口径：`access_token` / `device_code` 不得出现在 wire snapshot、SSE、错误消息、metadata。
- `sanitizeSnapshot` 与 API 投影只暴露 `userCode` / `verificationUri` / status / connection metadata。
- `mapGitHubTokenError` / safe error 路径不把 upstream `error_description` 放进 message。
- `test:links` 含 sentinel 扫描与 snapshot key allowlist；**79 passed**。
- 允许：`userCode` 在 active 状态显示/复制；终态后 manager 清空 session `userCode`，UI 在 denied/expired/failed 时清除 auth card。

### 固定网络与配置

- `GITHUB_DEVICE_CODE_URL` / `GITHUB_ACCESS_TOKEN_URL` / `GITHUB_USER_API_URL` / `GITHUB_DEVICE_VERIFICATION_URI` 常量固定。
- Device code 请求 body 仅 `client_id` + `scope=read:user`。
- Token poll grant_type 固定 device_code；Bearer 仅服务端 `/user` 请求。
- `safeFetch`：timeout、64 KiB size cap、`redirect: "manual"` 并拒绝 3xx。
- 客户端禁止字段：`token` / `clientId` / `client_secret` / `scope` / `redirectUri` / `url` / `device_code` / `access_token` / `pat` 等。

### 存储

- `~/.pi/agent/links/registry.json` 元数据 only；secret 分文件 `github/<opaque-id>.json`。
- 目录 0700、文件 0600、tmp+fsync+rename、process queue + mkdir cross-process lock。
- create：锁内 duplicate 检查；registry 写失败清理 orphan secret。
- disconnect：quarantine rename → registry soft-delete → unlink quarantine；失败尝试回滚。
- `device_code` 不落盘；`readConnectionSecret` 仅内部导出，无 API 路由暴露。

## UI / 原型一致性

对照批准的 Device Flow HTML 原型与 `ui.md` 状态矩阵：

| 场景 | 实现 |
| --- | --- |
| Settings root leaf 位于 Studio 后、模型与用量前 | `SettingsTreeNavigation` `view:links` |
| 空态 / 未配置 fail closed | `LinksConfig` empty + not-configured；无 token 回退 |
| 启动 busy / 设备码 / 复制 / 打开官方页 / 倒计时 | 有 |
| popup 拦截 | `window.open` 失败 → warning + 手动打开主按钮 |
| slow_down 中性 info | `intervalSeconds > 5` 时 info 条 |
| 拒绝 / 过期 / 网络失败可重试 | SSE 终态投影到 `LinksTerminalError`（检查中补全） |
| 多账号卡片独立断开 | connection list + 单卡 busy |
| 重复 409 高亮 | `duplicateTargetId` |
| 断开确认本地 only | AppPrompt danger + GitHub revoke 指引 |
| 全局 Save/Reset 禁用 + 即时保存说明 | Settings footer links 分支 |
| 窄屏 / reduced motion CSS | `app/globals.css` `.links-*` + media queries |

未在本机跑真实浏览器矩阵与 screen reader；以静态对照 + 自动化为主，真实交互 UAT 记为残留风险。

## 测试与验证覆盖缺口（非阻塞）

`scripts/test-links.mjs` 覆盖 contracts、adapter mock、manager lifecycle snapshot、source isolation、sentinel、PAT 缺失、固定 scope。以下为设计 checks 中“建议 runtime 覆盖”但当前以源码/mock 断言为主的项：

- store 在临时 `PI_CODING_AGENT_DIR` 下的真实并发 create / 权限 chmod / 注入 rename 失败（现为 source inspection + test helpers export）
- 路由层 HTTP 集成（现为 route 源码 + helper 契约检查）
- fake timers 下 interval/slow_down 精确节拍（现为 mock pending/slow_down 语义 + min interval 常量）
- 浏览器 Network/DOM 实机 sentinel 扫描

上述不构成实现 blocker，但建议后续补强 runtime 测试；当前不阻塞 Pass。

## Findings Fixed

检查员在范围内修复了 3 个明确、低风险问题：

1. **Persist handler 仅在 SSE 订阅时注册（功能/安全回归风险）**  
   后台轮询成功进入 `persisting` 时若浏览器尚未订阅 SSE，或订阅失败，连接可能永不落盘。  
   - `POST .../authorizations` 现同时调用 `ensureLinksPersistHandler()`  
   - manager 在 handler 缺失时 fail closed 到 `failed`，避免卡在 `persisting` 占容量

2. **LinksConfig starting 态取消无效**  
   starting 时 `authorizationId` 为空，原逻辑直接 return，无法清 UI / abort 启动请求。  
   - cancel 始终 abort 本地请求并清状态；有 id 时再 DELETE 服务端 session

3. **SSE 终态 denied / expired / failed 无错误 UI**  
   终态只关 SSE，未投影到 `LinksTerminalError`，用户可能看不到可恢复错误。  
   - 终态设置 `authError` 并清除 user code 面板；duplicate 仍保留 snapshot 以高亮现有连接

另清理 Links 源 unused import / vars，使 Links 相关 eslint 干净。

## Remaining Findings

### 阻塞

- **None**（相对实现门禁 / PRD P0）

### 非阻塞 / 残留风险

1. **产品 OAuth client id 与 live GitHub UAT 未执行**  
   本环境未注入已启用 Device Flow 的真实 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`，也未用测试 GitHub 身份做双账号真机授权。  
   **不作为实现返工 blocker**（checks 明确：缺失时显式记录，不得伪造通过）。发布/UAT 前必须由产品 owner 提供 client id 与测试账号。

2. **仓库级 `npm run lint` / 全量 `tsc` 仍有既有失败，与 Links 无关**  
   - lint errors：`ChatMinimap.tsx`、`TrellisWorkflowVisualizer.tsx`（pre-existing React Compiler / purity）  
   - tsc：`mermaid` / `@xterm/xterm` 缺类型声明（pre-existing）  
   - Links 相关文件：`eslint ... --max-warnings=0` **通过**；`tsc` 无 Links 路径报错

3. **`npm run test:api-key-accounts` 本环境失败**  
   失败原因：`@earendil-works/pi-coding-agent` 下 `typebox` 模块解析缺失（环境依赖树问题），与 Links  diff 无关。  
   `test:web-credential-store` **14 passed**；`test:links` **79 passed**。

4. **文档小不一致（非功能）**  
   `docs/modules/api.md` SSE 状态列表写 `validating`，实现/类型为 `validating_identity`；cancel 文案写 404，实现为 idempotent 200 + 空 `cancelledId`。建议后续文档对齐，不阻塞功能。

5. **`readConnectionSecret` 已导出但 P0 无 runtime 消费**  
   符合“连接 only、暂不消费”边界；需保证未来任何消费路径仍不经 browser API 泄露。

6. **verification URI 校验**  
   严格等于 `https://github.com/login/device`，否则仅要求 `https://github.com/` 前缀。比“仅固定 URI”略宽，但仍限制在 GitHub HTTPS 主机；可接受。

## Verification

| 命令 | 结果 |
| --- | --- |
| `npm run test:links` | **79 passed, 0 failed** |
| `npm run test:web-credential-store` | **14 passed, 0 failed** |
| `npm run test:api-key-accounts` | **环境失败**（pi-coding-agent/typebox 解析；非 Links） |
| `npx eslint`（Links 源 + routes，`--max-warnings=0`） | **Pass** |
| `node_modules/.bin/tsc --noEmit` | **无 Links 错误**；仓库既有 mermaid/xterm 错误 |
| `npm run lint`（全仓） | **失败**（既有 ChatMinimap / TrellisWorkflowVisualizer；Links 已干净） |
| 静态安全 / 隔离 / 无 PAT / 固定 egress / 文档 | **Pass**（见上） |
| 真实 GitHub Device Flow 双账号 UAT | **未跑**（缺产品 client id / 测试身份） |

## Verdict

**Pass（实现门禁通过）**

自动化验证、安全边界静态审查、与批准 Device Flow 原型的 UI/契约对照满足 PRD / Design / Implement / Checks 的 P0 实现标准。检查员已修复 persist 注册竞态、starting 取消与 SSE 终态错误展示三类低风险问题。

真实 GitHub OAuth / 浏览器矩阵因本机无产品 client id 与测试身份未执行，已显式记为 **UAT 残留风险**，不作为实现返工 blocker。全仓既有 lint/tsc 与 `test:api-key-accounts` 环境问题已隔离，不归因于本任务 diff。

## 建议主会话后续

1. 将任务推进到 `review`（或工作流要求的用户验收态）。
2. 产品 owner 注入 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`（Device Flow 已启用）后做双账号 live smoke。
3. 可选：补 store runtime 测试、对齐 api.md SSE 状态命名与 cancel 响应语义、清理仓库既有 lint/tsc 噪音。
4. **不要**在本检查回合 commit / push / merge。
