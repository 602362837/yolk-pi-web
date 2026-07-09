# Implement

> 本文件是实现规划，不代表 architect 已修改生产代码。UI 已纳入本次范围；必须先审批 [opencode-go-failover-ui.html](./opencode-go-failover-ui.html) 后才能实现 UI 相关子任务。

## 执行步骤概览

| 顺序 | 子任务 | 说明 | 可并行 |
| --- | --- | --- | --- |
| 1 | 配置、账号 metadata 与 API/helper | 新增 autoFailover config；新增 disabled metadata、enable/disable helper/API；激活拒绝 disabled | 否 |
| 2 | Failover controller | 新增错误分类、锁、budget、candidate selection；account_unusable 自动禁用 | 否 |
| 3 | RPC 接入 | 在 AgentSessionWrapper 接入请求账号捕获与 retry hook，防级联 | 依赖 1-2 |
| 4 | Settings 与账号 UI | 按已审批 HTML 原型实现开关、策略说明、Enable/Disable/Activate 状态 | 依赖 1，需审批 |
| 5 | 事件与前端提示 | 处理 `opencode_go_account_failover` 事件 | 依赖 3，需审批 |
| 6 | 测试与文档 | 单测/并发测试/文档更新 | 依赖 1-5 |
| 7 | Rollout/回滚 | 默认关闭验证、回滚说明、风险检查 | 依赖 6 |

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/library.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `lib/api-key-accounts.ts`
- `lib/chatgpt-account-failover.ts`
- `lib/rpc-manager.ts`
- `lib/pi-web-config.ts`
- `hooks/useAgentSession.ts`
- `components/SettingsConfig.tsx`
- `components/ModelsConfig.tsx` 或现有 API-key account 管理组件
- `app/api/**` 中现有 web-config 与 api-key-account routes
- `node_modules/@earendil-works/pi-ai/dist/providers/opencode-go.js`
- `node_modules/@earendil-works/pi-ai/dist/providers/opencode-go.models.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`（仅作为上游行为参考，不修改）

## 机器可读 Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Implement default-off opencode-go managed API-key account failover with conservative error detection, persistent account enable/disable semantics for unusable keys, process-level concurrency safety, and approved Settings/Chat UI.",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "ogf-01-config-account-disable-api",
      "title": "Add opencode-go auto-failover config and managed account enable/disable contract",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/pi-web-config.ts",
        "lib/api-key-accounts.ts",
        "app/api/api-key-accounts/**",
        "docs/modules/library.md",
        "docs/modules/api.md"
      ],
      "instructions": "Add a default-off opencodeGo.autoFailover config block with maxAttemptsPerTurn, maxAccountSwitchesPerTurn, exhaustedCooldownMs, and minSwitchIntervalMs. Add additive non-secret account metadata fields for disabled, disabledAt, disabledReason, disabledBy, autoDisabledReason, enabledAt, and enabledBy. Implement enableApiKeyAccount/disableApiKeyAccount/getActiveApiKeyAccountId helpers and matching API route support using existing managed-provider allowlist. Update activateApiKeyAccount so disabled accounts cannot be set active. Handle active-account disable by requiring replacementAccountId or explicit clearActive, and never leave a disabled account active.",
      "acceptance": [
        "Default config keeps behavior disabled.",
        "Old account metadata without disabled is treated as enabled.",
        "Disabled accounts cannot be activated manually or automatically.",
        "Enable restores eligibility but does not automatically activate.",
        "Disabling active account cannot leave disabled account active.",
        "No plaintext API keys are returned or logged."
      ],
      "validation": [
        "unit tests for enable/disable/activate disabled behavior",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "Active-account disable policy touches auth mirror behavior; keep typed errors and explicit clearActive path."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "ogf-02-failover-controller",
      "title": "Create opencode-go failover controller with account_unusable auto-disable",
      "phase": "backend",
      "order": 2,
      "dependsOn": ["ogf-01-config-account-disable-api"],
      "files": [
        "lib/opencode-go-account-failover.ts",
        "lib/api-key-accounts.ts"
      ],
      "instructions": "Implement detectOpencodeGoFailoverReason, globalThis lock/cooldown state, withFailoverLock, candidate selection, and attemptOpencodeGoAccountFailover. Trigger only for opencode-go and explicit quota/account_unusable errors; do not trigger for transient 429/network/5xx. For quota_exhausted, mark trigger account in process cooldown. For account_unusable, persist disabled metadata for trigger account inside the lock before candidate selection. Candidate selection must skip disabled, active, trigger, attempted, cooldown, and missing-secret accounts. Use activateApiKeyAccount and reloadRpcAuthState callback. Return structured status values mirroring chatgpt-account-failover style.",
      "acceptance": [
        "Quota strings are classified as quota_exhausted.",
        "AuthError invalid/missing key is classified as account_unusable.",
        "account_unusable persists disabled metadata on trigger account.",
        "Plain rate limit/429/network/5xx are not eligible.",
        "Candidate selection skips disabled accounts and never activates them."
      ],
      "validation": [
        "unit tests for detection and candidate selection",
        "unit tests for account_unusable auto-disable",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Over-broad regex could switch on transient errors; keep allowlist conservative.",
        "Auto-disabling a key is persistent; make event/message explicit and recoverable via Enable."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "ogf-03-rpc-integration",
      "title": "Integrate failover into AgentSessionWrapper without cascading switches",
      "phase": "backend",
      "order": 3,
      "dependsOn": ["ogf-02-failover-controller"],
      "files": [
        "lib/rpc-manager.ts",
        "lib/pi-types.ts"
      ],
      "instructions": "Patch AgentSessionWrapper similarly to patchChatGptAccountFailover. Capture the active opencode-go account bound to the failing provider request, preferably by wrapping AgentSession._getRequiredRequestAuth or an equivalent request-preflight point. After original _handlePostAgentRun returns false, call attemptOpencodeGoAccountFailover. If retry is true, remove the failed assistant message from agent state and return true. Emit opencode_go_account_failover for switched, account disabled, already-switched, budget-exhausted, and no-usable statuses. Ensure per-turn budget resets at run start/success and default max retry/switch is one.",
      "acceptance": [
        "Native retry/compaction runs before opencode-go failover.",
        "Two concurrent sessions failing on A cause at most one actual activation A->B.",
        "Second session retries current active account instead of switching B->C.",
        "account_unusable event includes disabledAccountId but no secret.",
        "Failed assistant message is removed only for retry path."
      ],
      "validation": [
        "concurrency unit/integration test with mocked accounts",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "Patching private SDK methods can break on upstream changes; keep guard checks and no-op fallback.",
        "Capturing account only at outer turn start may be imprecise for multi-LLM-call turns; prefer per-request capture."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "ogf-04-settings-account-ui",
      "title": "Implement approved Settings and account enable/disable UI",
      "phase": "ui",
      "order": 4,
      "dependsOn": ["ogf-01-config-account-disable-api"],
      "files": [
        ".ypi/tasks/20260709-102717-设计-opencode-go-额度不足自动账号轮换与并发安全方案/ui.md",
        ".ypi/tasks/20260709-102717-设计-opencode-go-额度不足自动账号轮换与并发安全方案/opencode-go-failover-ui.html",
        "components/SettingsConfig.tsx",
        "components/ModelsConfig.tsx",
        "app/api/web-config/route.ts",
        "docs/modules/frontend.md"
      ],
      "instructions": "Before code, verify user approval of the HTML prototype. Then add a default-off Settings switch with conservative strategy text. Update managed account UI with Enabled/Disabled status, Enable/Disable actions, disabled reason display, disabled Activate button, and active-account disable confirmation/replacement flow. Keep all displayed key material masked.",
      "acceptance": [
        "HTML prototype approval is recorded before implementation.",
        "Settings save/load preserves opencodeGo.autoFailover config.",
        "Disabled accounts show status/reason and cannot be activated until enabled.",
        "Manual disable active account cannot leave disabled account active.",
        "Text clearly states global active-key side effect and non-triggering transient errors."
      ],
      "validation": [
        "manual UI approval check",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "UI gate blocks implementation if prototype/approval is missing.",
        "Existing account UI component boundaries may require locating the exact managed-account list component."
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "ogf-05-events-frontend-feedback",
      "title": "Surface opencode-go failover and auto-disable events safely",
      "phase": "frontend",
      "order": 5,
      "dependsOn": ["ogf-03-rpc-integration", "ogf-04-settings-account-ui"],
      "files": [
        "hooks/useAgentSession.ts",
        "components/ChatWindow.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": "Handle opencode_go_account_failover SSE events similarly to chatgpt_account_failover notices. Display concise non-secret status for switched, account disabled, already switched by other session, no usable account, and budget exhausted. Use displayName/masked preview resolved from account metadata when available; never show plaintext key.",
      "acceptance": [
        "No API key material is displayed.",
        "Auto-disabled account_unusable events are understandable and recoverable via Settings Enable.",
        "Existing ChatGPT failover notices are unaffected."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Event rendering must not duplicate or reorder normal assistant messages."
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "ogf-06-tests-docs-review",
      "title": "Add regression tests, docs, and final review",
      "phase": "checks",
      "order": 6,
      "dependsOn": ["ogf-03-rpc-integration", "ogf-04-settings-account-ui", "ogf-05-events-frontend-feedback"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "AGENTS.md"
      ],
      "instructions": "Add/adjust tests for detection, budget, candidate selection, disabled activation rejection, account_unusable auto-disable, manual enable/disable, and concurrent active-changed guard. Update docs for new config/events/modules and disabled semantics. Run full validation. AGENTS.md only changes if top-level navigation changes.",
      "acceptance": [
        "Tests cover quota vs transient 429 distinction.",
        "Tests cover Invalid/Missing API key auto-disable.",
        "Tests cover disabled accounts cannot be activated or selected.",
        "Tests cover concurrent A failures with only one activation.",
        "Docs record default-off behavior, disabled semantics, and no reliable quota API conclusion."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Concurrent behavior may need mockable account store seams."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "ogf-07-rollout-rollback",
      "title": "Validate default-off rollout and rollback path",
      "phase": "release-readiness",
      "order": 7,
      "dependsOn": ["ogf-06-tests-docs-review"],
      "files": [
        "docs/operations/troubleshooting.md",
        "docs/deployment/README.md"
      ],
      "instructions": "Document rollback by disabling opencodeGo.autoFailover. Document how users can re-enable an auto-disabled account after replacing/fixing the key. Confirm old account metadata remains enabled by default and no migration is required.",
      "acceptance": [
        "Feature can be disabled without data migration.",
        "Users have documented recovery path for auto-disabled accounts.",
        "No startup migration is required for existing accounts."
      ],
      "validation": [
        "documentation review"
      ],
      "risks": [
        "Persistent disabled state may surprise users if not clearly surfaced."
      ],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议补充自动测试（具体框架按项目现状）：

- `detectOpencodeGoFailoverReason()` 表驱动单测。
- `disableApiKeyAccount()` / `enableApiKeyAccount()` / `activateApiKeyAccount()` disabled 行为单测。
- `attemptOpencodeGoAccountFailover()` 候选筛选、budget、account_unusable 自动禁用单测。
- 并发模拟：两个 promise 同时以 trigger A 进入 failover，断言 `activateApiKeyAccount` 只调用一次，第二个结果为 `already_switched_by_other_session` 且 `retry=true`。
- UI 手工/组件测试：disabled 账号 Activate 禁用，Enable 后恢复；active 禁用确认流程。

## 检查门禁

- UI 变更必须先有 HTML 原型和用户审批。
- 不得泄露 plaintext API key。
- disabled 账号不得参与候选，不得被激活。
- `account_unusable` 必须持久禁用触发账号，并提供可恢复的 Enable 操作。
- 普通 transient 429/rate limit/network/5xx 不得切号。
- 每 turn 不得超过配置 budget。
- 激活账号必须走既有 `activateApiKeyAccount()` active-mirror 路径。