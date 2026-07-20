# 计划审批书：为 Grok CLI 增加重新登录功能

## 当前审批状态

**用户已批准：** 主任务计划与 UI 原型已于 2026-07-20 通过会话浮窗批准（source=user-widget），审批已落库。

原因：本任务触发 UI 原型硬门禁，但当前架构师成员会话没有可用的 Studio member delegation 工具，尚未取得 UI 设计员的 HTML 原型。主会话需派发 `ui-designer`，按 [ui.md](./ui.md) 产出并附上 `grok-cli-reauth-prototype.html`；原型补齐后再请用户审批本计划与原型。

除 UI 原型外，PRD、技术设计、实施 DAG 和检查清单已完成。

## 一、问题与目标

当前 Grok managed accounts 只有“添加账号”，每次 `accountMode=add` 都创建新 `acct_*` slot。quota 层已经能投影 `reauthRequired`，顶部用量面板也提示“在 Models → Grok 重新登录”，但 Models 的 Grok quota/display 过度依赖 `provider.loggedIn`，invalid credential 时已有账号可能退回添加路径，且账号行没有原位恢复操作。

目标是：让用户对**指定 Grok saved-account slot 原位重新 OAuth 授权**，保留账号备注和 Active 关系，不创建重复账号；失败/取消零写入。

详见：[brief.md](./brief.md) · [prd.md](./prd.md)

## 二、推荐产品决策（需用户确认）

1. **账号级原位替换，而非只重登当前 Active。**
   - 支持修复 Active 和非 Active 备用账号。
   - opaque storage id、备注、补充信息、创建时间和 Active 指针保留。

2. **不承诺“同一 xAI 身份”强校验。**
   - `pi-grok-cli@0.5.0` credential 没有可靠稳定公开 account id；refresh-token hash 会变化。
   - 用户可以在浏览器用另一身份替换该 slot，但 UI 必须先警告并要求确认正确账号。

3. **Top-bar 只深链 Models → Grok/目标账号，不直接启动 OAuth。**
   - 避免 hover/focus 面板误触外部授权。
   - 用户先看到目标和 Active 影响，再确认、选择登录方式。

4. **P0 只开放 Grok。**
   - 不同步开放 Kiro/Antigravity/Codex reauth。
   - 公共 store helper 可复用，但 route allowlist 保持 Grok-only。

若用户不接受第 1 或第 2 项，需要先调整 PRD/Design，不能直接实现。

## 三、UI 方案与门禁

必须由 UI 设计员提供自包含 HTML，至少覆盖：

- valid/invalid managed provider；
- Active/非 Active 账号行的重新登录入口；
- quota `reauthRequired` banner CTA；
- 目标与影响确认；
- Browser / Device / Existing Grok Build 方法；
- connecting、manual callback、device code、progress、cancel、success、error、target conflict；
- standalone/aggregate Top-bar 深链；
- 375px、长账号、键盘、焦点和 dark/light。

委派规格：[ui.md](./ui.md)

待补原型：[grok-cli-reauth-prototype.html](./grok-cli-reauth-prototype.html)

**HTML 原型与用户审批完成前，不得实现。**

## 四、技术设计摘要

### API

扩展现有 OAuth SSE route：

```text
GET /api/auth/login/grok-cli?accountMode=reauth&accountId=<opaque-id>
```

- reauth 仅 Grok；目标前置和 commit-time 双重验证。
- 使用 isolated memory CredentialStore；成功前不改 durable Active。
- success 仅返回安全 account summary/active boolean；Grok login 错误做固定安全映射。
- existing add/login contract 保持。

### Store / Active

- 新增原位 `reauthenticateOAuthAccount()` 服务。
- 保留 slot 与用户 metadata；更新 secret 和安全 diagnostic id。
- 非 Active 不改 `auth.json`/runtime。
- Active 更新 mirror，保持同 Active id，`await reloadRpcAuthState()`。

### 并发 / cache

- 增加 Grok process + cross-process provider lock，覆盖 refresh、Activate、reauth。
- reauth 后失效 token flight。
- quota 使用 generation invalidation 并删除 target 的 persisted cache entry，旧 in-flight result 不得回写或在新远端身份下作为 stale 展示。

### UI

- managed provider `loggedIn=false + accountCount>0` 仍保留在 Models 已有账号区。
- Grok 有 saved accounts 时继续 quota 查询并解析 401 safe body。
- 账号行和 quota banner 共用 target-aware controller。
- Top-bar 传递一次性 provider/account focus context 打开 Models。

详见：[design.md](./design.md)

## 五、实施计划摘要

| ID | 内容 | 关键门禁 |
| --- | --- | --- |
| GROK-REAUTH-01 | store 原位替换、Grok lock、refresh/cache 隔离 | Active/non-Active、race、0600/0700、rollback |
| GROK-REAUTH-02 | OAuth SSE Grok-only reauth mode | isolated login、strict query、safe SSE/error |
| GROK-REAUTH-03 | Models 恢复态、账号级 UI、Top-bar 深链 | 已批准 HTML、target/busy/a11y/375px |
| GROK-REAUTH-04 | 行为测试、回归、浏览器验收、文档 | checker 独立检查 |

机器计划为 schemaVersion 2、`maxConcurrency=1`，见 [implement.md](./implement.md) 的 fenced `json ypi-implementation-plan`。

主会话在 HTML 原型补齐并经架构师核对后，应先保存 implementationPlan 并切到 `awaiting_approval`；用户明确批准计划与原型后，才可进入 implementing。

## 六、检查与验收摘要

自动验证建议：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-reauth
npm run test:grok-provider
npm run test:grok-accounts
npm run test:grok-quota
npm run test:grok-global-auth
npm run test:grok-usage-panel
npm run test:grok-failover-adapter
npm run test:grok-failover-runtime
```

人工重点：

- Active/非 Active 成功差异；
- 失败/取消/target deleted 零写入；
- 两种 refresh/reauth race 顺序；
- 新 credential 不显示旧 quota stale；
- Top-bar standalone/aggregate 深链；
- env token only；
- 375px、键盘、焦点、错误安全。

完整清单：[checks.md](./checks.md)

## 七、主要风险与回滚

- **身份不可验证：** 用确认文案和 slot replacement 定义解决，不伪造稳定 id。
- **旧 refresh 覆盖：** shared Grok lock。
- **旧 quota 串号：** generation + persisted entry removal。
- **Active 半成功：** atomic files、old snapshot rollback、固定错误和故障注入测试。
- **UI 恢复入口消失：** managed accountCount 参与 provider 可见性。

回滚先隐藏 UI并拒绝 `accountMode=reauth`；已成功更新的账号仍是合法 Grok saved account，不反向迁移、不删除账号目录或 Session。

## 八、主会话下一步

1. 派发 `ui-designer`，任务输入使用 [ui.md](./ui.md)。
2. 收到 `grok-cli-reauth-prototype.html` 后，由架构师核对 PRD/Design，并更新本审批书状态与原型链接。
3. 主会话保存 [implement.md](./implement.md) 的 implementationPlan，并将任务切到 `awaiting_approval`。
4. 请用户同时审批 HTML 原型和本审批书四项产品决策；只有明确获批后才进入 implementing，在获批前不得实现。
