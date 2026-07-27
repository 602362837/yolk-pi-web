# Design：GitHub Webhook 自事件隔离与 Owner 评论协议

## 方案摘要

采用四层防线：

1. **入口分类**：验签后提取 actor/comment 安全元数据，按 event/action/source matrix 决定 audit、reconcile 或 enqueue。
2. **durable 幂等**：delivery exclusive-create + comment version key + generation gate，禁止任意事件创建新代。
3. **远端幂等**：稳定 canonical marker、body equality、unknown-outcome reconcile，语义无变化零写。
4. **用户闭环**：exact owner comment command → durable receipt → canonical status，评论文本永不成为策略/agent 指令。

## AS-IS 数据流

```text
Bot PATCH triage comment
  → GitHub issue_comment.edited
  → webhook accepts every issue_comment action/sender
  → terminal job => generation + 1
  → full claim + triage rerun
  → marker contains new trace => body differs
  → Bot PATCH triage comment
  → loop
```

同时，`issues.assigned/labeled/closed` 也走相同 enqueue path；Owner intent 通过扫描“最近任意匹配评论”识别，而不是绑定本次 delivery comment。

## TO-BE 数据流

```text
verified webhook
  → parse safe envelope
  → classify source (self app / bot / human / unknown)
  → action matrix
     ├─ audit-only: exclusive delivery + fixed ignore reason; zero job/wake
     ├─ lifecycle reconcile: existing issue/job only; no new claim generation
     └─ actionable human event: issue lease + exact state transition
          → exact comment fetch/version verify (comment events)
          → owner + command + global/policy gates
          → durable command key/effect reconcile
          → minimal GitHub mutation
          → canonical receipt/status (semantic diff only)
```

## 影响模块

| 模块 | 改动 |
| --- | --- |
| `lib/github-automation-store.ts` | envelope/delivery 增加 senderType、commentId、commentUpdatedAt/body hash、performedViaAppId；ignore reason、command receipt/effect 状态；兼容 schema v1 additive read |
| `lib/github-automation-runtime.ts` | source classifier、action matrix、audit-only/self-event fast path、generation eligibility、closed/edited reconciliation |
| `lib/github-automation-comments.ts` | stable marker v2、严格 marker identity、exact comment GET、unknown-outcome reconcile、receipt/status builders、零 PATCH |
| `lib/github-owner-intent.ts` | command target/grammar 的纯函数 parser；沿用 owner/否定/引用剥离规则 |
| `lib/github-issue-triage-runner.ts` | claim 与 re-triage 分离；exact delivery comment；parked communication state；command dispatch/receipt |
| `lib/github-automation-runner.ts` | 将 retry/pause/continue 以结构化 command 调用既有函数；继续禁止 comment text 注入 |
| `scripts/test-github-automation.mjs` | self-loop/action matrix/exact comment/marker/receipt focused coverage |
| `scripts/test-github-unattended*.mjs` | per-job command gates、global paused、no-injection |
| docs | architecture/api/library/integration setup/troubleshooting 契约更新 |

## Webhook envelope 契约

在已验签 payload 中仅提取：

```ts
interface GithubWebhookEnvelopeV2 {
  // existing safe fields...
  senderType: string | null;
  commentId: number | null;
  commentUpdatedAt: string | null;
  commentBodySha256: string | null; // opaque full hash; never body
  performedViaAppId: number | null;
}
```

来源解析优先级：

1. `performedViaAppId === effectiveAppId` → `self_app`（强证据）；
2. `senderType in {Bot, App}` → `bot_actor`（保守 fallback，永不授权）；
3. 有正整数 sender id 的非 Bot → `human_actor`；
4. 否则 `unknown_actor`，fail closed。

不依赖可变的 `${slug}[bot]` login 作为唯一身份。login 可作审计显示，不作授权主键。

## Event/action matrix

| Event | Action | Source | 处理 |
| --- | --- | --- | --- |
| issues | opened | human | 创建/恢复首代 triage |
| issues | reopened | human | lifecycle reconcile；允许显式新 generation |
| issues | edited | human | 已存在 Issue state 时受限 re-triage；不重复 claim |
| issues | closed | human | existing job fail-closed reconcile；零 claim/comment rewrite |
| issues | assigned/labeled/... | any | audit-only；self/bot reason 更具体 |
| issue_comment | created/edited | human | exact-comment command path |
| issue_comment | created/edited | self/bot | audit-only，零 job/wake |
| issue_comment | deleted | any | audit/superseded reconcile；不授权 |
| pull_request | supported actions | any | 保留现有 PR lifecycle 专用路径 |

全局 paused 在 action matrix 之后、业务执行之前保持最高优先级：delivery 记录 `paused`，不执行 command；Issue comment 绝不能改 config paused。

## Generation 规则

- `generation` 是 Issue 自动化生命周期代，不是 delivery 计数器。
- 允许增长：`issues.reopened`、operator 明确 restart、状态允许的 owner retry（是否新代由命令类型固定）。
- 禁止增长：Bot mutation、label/assign/comment status event、human status query、deleted comment、closed、duplicate delivery。
- comment command 默认复用 active Issue generation；receipt key 带 generation 防跨代误复用。
- `needs_info` 进入 `awaiting_owner`/`awaiting_clarification` parked state，由精确 command 或 Issue body edit 唤醒，而非 terminal 后新 claim。

## Canonical comment v2

推荐 marker：

```html
<!-- ypi-github-automation:v2 kind=triage repo=1278854433 issue=21 -->
```

- identity 不含 trace、时间、phase；trace 只留本地 safe audit。
- parser 同时识别既有 `<!-- ypi-github-automation:triage repo=... issue=... trace=... -->`。
- `findAutomationComment` 必须同时匹配 kind/repo/issue；历史重复时选择最早合法 authority 并记录 duplicate warning，不自动删评论。
- body builder 必须 deterministic；比较规范化换行后的完整 body。相同直接返回 `writePerformed:false`。
- POST/PATCH timeout/5xx 后 re-list marker/body：已出现则 remote_confirmed，否则 reconcile_needed；不得盲重发。
- receipt marker 额外稳定绑定 `commentId`，同一 comment edited 时更新同一 receipt。

## Owner 命令契约

### 精确事件绑定

1. delivery 保存 comment id、sender id/type、updatedAt、body hash，不保存正文。
2. worker 通过 `/repos/{owner}/{repo}/issues/comments/{commentId}` GET 精确 comment。
3. 校验 comment id、author id/type、updatedAt/body hash；不一致视为 `superseded`。
4. 纯函数解析 target 与 command；先 owner 身份，再文本分类。
5. 生成 `commandKey = hash(repoId, issue, generation, commentId, bodyHash, command)`。
6. under issue lease 检查 durable receipt/effect；只执行一次结构化 action。

### target 与兼容建议

- 推荐 target：`@AppBot` 或行首 `/ypi`。
- waiting-owner 阶段保留无需 mention 的明确 adoption 兼容。
- 默认不将 `@machine-assignee` 当自动化 target，除非用户明确批准该产品语义；它代表真实 GitHub 用户，自动拦截会混淆责任。

### 安全边界

- command parser 只返回枚举，不返回“剩余自由文本”给 agent。
- `重试` 仅调用结构化 wake；`暂停/继续` 只操作单 job state。
- `重新评估` 读取最新 Issue title/body；不使用 comment 自由文本扩展实现范围。
- authorization 继续要求 human owner、complete claim、Issue open、recommendation/policy gates。
- global paused、risk policy、validation commands、branch/remote/publisher 永不由 comment 改写。

## 可观察响应

新增两类 canonical comment：

- `command_receipt(commentId)`：识别命令、accepted/rejected/ignored/superseded、当前 phase、安全 reason、下一步。
- `automation_status`：当前阶段、最近成功 checkpoint、阻塞/PR 链接（若有）、下一步；只在语义状态变化时更新。

公共评论不回显原始正文/hash、不声称 App Bot 是 assignee、不暴露本地路径或 child transcript。非 owner/第三方 bot 默认只 audit，不发 rejection spam。

## 兼容性与迁移

- Store 使用 additive optional fields；历史 schema v1 delivery/job/issue state 可读，缺字段按 unknown/fail-closed。
- 历史 g1–g80 不删除、不合并；新的 generation gate 从部署后生效。
- 既有 v1 marker 首次真实语义变化时可迁移到 v2；无语义变化不为“纯迁移”额外 PATCH，避免再次触发。
- 现有 owner affirmative 词表与 P1 ownerAuthorization hash 保留；改为 exact comment 后不再扫描旧评论。
- API status projection保持 additive/现有字段兼容；本计划默认不改 Web UI。

## 并发、失败与恢复

- delivery id exclusive-create 仍是第一层 replay idempotency。
- repo+issue lease 包围 generation/command/effect mutation。
- effect 先 `intended`，远端回读后 `remote_confirmed`；unknown outcome 标 `reconcile_needed`。
- scheduler wake 只对状态实际从 parked/retry_due 转 queued 时发生；重复 command 不 wake。
- receipt/status 写失败不回滚已完成的 owner authorization，但 job 留 reconcile marker，后续安全补写。
- 任何 actor/version/claim/Issue state 不确定均 fail closed。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 只过滤 login，App 改名后复发 | performedViaAppId + senderType 保守 fallback |
| 忽略所有 Bot 导致第三方 bot 指令不处理 | 这是有意安全边界；Bot 本就不能 owner authorize |
| human edited event 与 GET 回读竞态 | comment version/hash 校验，旧 delivery superseded |
| marker v2 迁移触发一次 self edited | self event audit-only；尽量不做纯迁移写 |
| receipt/status 自己也产生 webhook | 同一 self filter；入口零 job/wake |
| `@assignee` 劫持真人沟通 | 默认不用 assignee target，等待产品确认 |
| closed 中途仍有进程 | checkpoint fail-closed；不强杀、不删 WorkTree，operator 可见 |

## 回滚

1. 保留 self/bot audit-only filter 与 action matrix作为不可回退的止血层。
2. 若 command protocol 有问题，可关闭 comment command dispatch，仅保留现有 awaiting-owner adoption与 Settings job controls。
3. 隐藏/停止更新 receipt/status，不删除已有评论。
4. 不删除 delivery/job/event/WorkTree/Studio task 历史，不改写 Issue 正文。
5. 全局 paused 继续作为 operator stop-bleed；只能由用户在受控管理面修改。
