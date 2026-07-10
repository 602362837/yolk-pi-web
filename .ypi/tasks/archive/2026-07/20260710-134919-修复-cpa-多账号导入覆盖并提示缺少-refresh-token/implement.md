# implement

## 前置门禁

1. 主会话派发 UI 设计员并取得 `cpa-refresh-token-risk-prototype.html`。
2. 用户明确批准 HTML 原型、本文计划以及“完全相同 credential 的重复导入策略”。
3. 仅在审批 grant 后进入 implementing；实现员不得自行绕过。

## 先阅读

- `AGENTS.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/standards/code-style.md`
- `lib/oauth-account-converters.ts`、`lib/oauth-accounts.ts`、`lib/subscription-quota.ts`
- `lib/openai-codex-warmup.ts`、`lib/chatgpt-account-failover.ts`、`lib/chatgpt-usage-refresh-scheduler.ts`
- `app/api/auth/accounts/[provider]/route.ts`、`app/api/auth/accounts/[provider]/activate/route.ts`、`app/api/auth/login/[provider]/route.ts`
- `components/ModelsConfig.tsx` 和批准后的 HTML 原型

## 执行顺序

| # | 子任务 | 依赖 | 主要文件 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | UI 原型与用户审批 | — | `ui.md`, `cpa-refresh-token-risk-prototype.html`, `plan-review.md` | 门禁解除，不改生产代码。 |
| 2 | 定义 OAuth storage/real-account 双标识和旧数据 reader | 1 | `lib/oauth-accounts.ts` | 新 opaque id、v1/v2 compatible lookup、刷新同路径回写。 |
| 3 | 修正 CPA 转换、批量验证和无 refresh risk contract | 2 | `lib/oauth-account-converters.ts`, `lib/oauth-accounts.ts` | 多 CPA 不覆盖，缺 refresh 非阻断、无半批写。 |
| 4 | 贯通 operation consumers | 2 | `lib/subscription-quota.ts`, warmup/failover/scheduler, auth routes | lookup/storage cache 使用 storage id，OpenAI header 使用真实 id。 |
| 5 | 依原型实施 UI 提示 | 1,3 | `components/ModelsConfig.tsx` | warning、错误、multi-import feedback/a11y。 |
| 6 | 测试、文档、完整回归 | 2,3,4,5 | targeted test + docs | 有证据覆盖兼容/风险路径。 |

## Implementation Plan

```ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "CPA multi-account storage identity and refresh-token warning",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "ui-prototype-approval",
      "title": "UI designer HTML prototype and user approval",
      "phase": "planning",
      "order": 1,
      "dependsOn": [],
      "files": [".ypi/tasks/20260710-134919-修复-cpa-多账号导入覆盖并提示缺少-refresh-token/ui.md", ".ypi/tasks/20260710-134919-修复-cpa-多账号导入覆盖并提示缺少-refresh-token/cpa-refresh-token-risk-prototype.html", ".ypi/tasks/20260710-134919-修复-cpa-多账号导入覆盖并提示缺少-refresh-token/plan-review.md"],
      "instructions": "Dispatch ui-designer. Produce self-contained HTML based on ModelsConfig Add Account modal, cover non-blocking no-refresh warning and blocking invalid fields, then request explicit user approval. Do not implement source code.",
      "acceptance": ["HTML prototype exists and is linked from ui.md and plan-review.md", "User approval is recorded", "Duplicate-import policy is explicitly approved"],
      "validation": ["manual prototype review"],
      "risks": ["UI gate cannot be bypassed by Markdown or architect-authored claims"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "oauth-identity-store",
      "title": "Separate stable storage identity from real ChatGPT identity",
      "phase": "implementing",
      "order": 2,
      "dependsOn": ["ui-prototype-approval"],
      "files": ["lib/oauth-accounts.ts"],
      "instructions": "Introduce opaque storage-id persistence while retaining credential.accountId as real ChatGPT id. Normalize v1/v2 metadata, preserve legacy paths, and ensure read/save/active/quota cache all key by storage id. Refresh must write back to the originating storage id.",
      "acceptance": ["Same real id can map to multiple saved credentials", "Old file/metadata records remain operable", "No storage id enters credential.accountId"],
      "validation": ["new focused identity/migration tests"],
      "risks": ["path migration and active metadata drift"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "cpa-conversion-import",
      "title": "Allow no-refresh CPA imports without overwriting accounts",
      "phase": "implementing",
      "order": 3,
      "dependsOn": ["oauth-identity-store"],
      "files": ["lib/oauth-account-converters.ts", "lib/oauth-accounts.ts"],
      "instructions": "Accept CPA object/array as approved, convert omitted or empty refresh token to an empty refresh string plus structured warning, keep access/expires validation, validate the full batch before writes, and allocate an independent storage id for each approved imported account.",
      "acceptance": ["No-refresh CPA imports when access/expires valid", "Missing access/expires remains error", "Same real ChatGPT id never overwrites another item", "No partial batch on validation failure"],
      "validation": ["focused converter/import tests"],
      "risks": ["duplicate import semantics; failure cleanup"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "oauth-consumer-compatibility",
      "title": "Update quota, refresh, warmup and rotation consumers",
      "phase": "implementing",
      "order": 4,
      "dependsOn": ["oauth-identity-store"],
      "files": ["lib/subscription-quota.ts", "lib/openai-codex-warmup.ts", "lib/chatgpt-account-failover.ts", "lib/chatgpt-usage-refresh-scheduler.ts", "app/api/auth/accounts/[provider]/route.ts", "app/api/auth/accounts/[provider]/activate/route.ts", "app/api/auth/login/[provider]/route.ts"],
      "instructions": "Keep route accountId payload as the opaque saved-account id. Resolve credential first for outbound headers; use real credential.accountId only for ChatGPT-Account-Id and label calls. Confirm failover cooldown/candidates and scheduled warmup continue to use storage ids.",
      "acceptance": ["Activate/quota/reset/warmup/failover work for duplicate real ids", "Header uses real id", "reloadRpcAuthState behavior is unchanged"],
      "validation": ["focused consumer tests and mocked header assertions"],
      "risks": ["accidentally cache by real id or use opaque id in header"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "cpa-risk-ui",
      "title": "Implement approved non-blocking refresh-token risk feedback",
      "phase": "implementing",
      "order": 5,
      "dependsOn": ["ui-prototype-approval", "cpa-conversion-import"],
      "files": ["components/ModelsConfig.tsx", "lib/oauth-account-converters.ts"],
      "instructions": "Implement exactly the approved prototype. Surface structured conversion risk after CPA conversion and before save; distinguish warning from error, preserve Save enabled for valid access/expires, provide accessible live feedback, and do not show tokens.",
      "acceptance": ["Warning is visible/non-blocking", "Invalid required fields still block", "Modal state and narrow layout work"],
      "validation": ["manual browser flow against approved prototype"],
      "risks": ["warning accidentally treated as validation failure"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "oauth-regression-validation",
      "title": "Run regression validation and update module docs",
      "phase": "checking",
      "order": 6,
      "dependsOn": ["oauth-consumer-compatibility", "cpa-risk-ui"],
      "files": ["docs/modules/api.md", "docs/modules/frontend.md", "docs/modules/library.md", "package.json"],
      "instructions": "Add/execute focused non-secret tests; document changed OAuth contracts and warning behavior. Run lint and typecheck, then manually test import, activation, quota, warmup, rotation and the approved UI path.",
      "acceptance": ["Checks in checks.md have evidence", "Docs match contracts", "No secrets in outputs"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "focused OAuth test", "manual browser/API checks"],
      "risks": ["insufficient coverage of old-store migration"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {"id": "approval", "title": "Approval gate", "subtaskIds": ["ui-prototype-approval"]},
      {"id": "storage", "title": "Storage and import", "subtaskIds": ["oauth-identity-store", "cpa-conversion-import"]},
      {"id": "consumers-ui", "title": "Consumers and UI", "subtaskIds": ["oauth-consumer-compatibility", "cpa-risk-ui"]},
      {"id": "validation", "title": "Validation", "subtaskIds": ["oauth-regression-validation"]}
    ]
  }
}
```

## Review gates and rollback

- Require code review of every `accountId` occurrence in OAuth paths: identify whether it means storage id or real header id.
- Require checker evidence for legacy v1, duplicate-real-id v2, no-refresh valid access, and refresh persistence.
- Roll back only with a reader that accepts both v1 and v2; never delete/move user credential files as a rollback shortcut.
