# Implement：xAI managed API-key accounts

## 先阅读

`AGENTS.md` → `docs/standards/code-style.md` → `docs/modules/{library,api,frontend}.md` → `lib/api-key-accounts.ts` → auth API routes → `components/ModelsConfig.tsx`。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 |
|---|---:|---:|---|---|
| XAI-01 | core | 1 | allowlist 加入 xai，清理陈旧注释 | — |
| XAI-02 | tests | 2 | 隔离环境覆盖 xAI managed/legacy/mirror/隔离 | XAI-01 |
| XAI-03 | UI/API | 3 | 验证通用路由和组件；仅修 provider-specific 假设 | XAI-01 |
| XAI-04 | docs | 4 | 更新 library/API/frontend/operations 文档 | XAI-02, XAI-03 |
| XAI-05 | validation | 5 | lint、tsc、focused tests、浏览器验收 | XAI-04 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "XAI-01",
      "title": "Enable xAI in the managed-account provider registry",
      "phase": "core",
      "order": 1,
      "dependsOn": [],
      "files": ["lib/api-key-accounts.ts"],
      "instructions": "Add provider id xai to the single managed-provider allowlist and update stale v1 comments. Do not add provider-specific storage or CRUD branches.",
      "acceptance": ["isManagedApiKeyProvider('xai') is true", "opencode-go remains managed", "other providers remain single"],
      "validation": ["focused managed-provider test"],
      "risks": ["provider id typo would silently keep single mode"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "XAI-02",
      "title": "Add isolated xAI account lifecycle regression coverage",
      "phase": "tests",
      "order": 2,
      "dependsOn": ["XAI-01"],
      "files": ["lib/api-key-accounts.test.ts", "package.json"],
      "instructions": "Use a temporary agent directory and test legacy import idempotency, create/activate/update/delete, active mirror, no plaintext in summaries, and xai/opencode-go isolation. Add a focused script only if consistent with existing test conventions.",
      "acceptance": ["tests never read/write the user's real auth store", "legacy xAI key imports exactly once", "active mirror follows activation and last-delete clears xAI"],
      "validation": ["run the focused test command"],
      "risks": ["AuthStorage/getAgentDir module state may require subprocess isolation"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "XAI-03",
      "title": "Verify generic API and Models UI reuse for xAI",
      "phase": "ui-api",
      "order": 3,
      "dependsOn": ["XAI-01"],
      "files": ["app/api/auth/all-providers/route.ts", "app/api/auth/api-key/[provider]/route.ts", "app/api/auth/api-key/[provider]/accounts/**", "components/ModelsConfig.tsx"],
      "instructions": "Confirm xAI receives managed_accounts through existing predicates and ApiKeyAccountsDetail. Change only stale provider-specific comments/text/conditions; do not duplicate components/routes. Implement only after HTML prototype user approval.",
      "acceptance": ["xAI renders ApiKeyAccountsDetail", "all managed account actions target provider xai", "plaintext is cleared on provider switch/close", "single-mode providers are unchanged"],
      "validation": ["manual Settings Models xAI flow", "browser console/network inspection"],
      "risks": ["hidden OpenCode-specific UI copy", "UI prototype approval gate"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "XAI-04",
      "title": "Update managed-provider documentation",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["XAI-02", "XAI-03"],
      "files": ["docs/modules/library.md", "docs/modules/api.md", "docs/modules/frontend.md", "docs/operations/troubleshooting.md"],
      "instructions": "Replace only stale opencode-go-only statements, document xAI account-store path and explicitly distinguish xAI manual switching from OpenCode Go auto-failover.",
      "acceptance": ["docs list opencode-go and xai as managed providers", "docs do not imply xAI auto-failover"],
      "validation": ["rg for stale 'v1: only opencode-go' statements"],
      "risks": ["overstating unchanged deployment behavior"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "XAI-05",
      "title": "Validate and review the completed change",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["XAI-04"],
      "files": [],
      "instructions": "Run minimum project checks, focused tests, and manual xAI legacy/add/activate/delete/reveal flows. Checker must verify no xAI failover scope creep and no secret leakage.",
      "acceptance": ["lint and tsc pass", "focused tests pass", "manual acceptance checklist passes", "approved HTML prototype matches implemented UI"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "focused account tests", "manual browser flow"],
      "risks": ["full lint may expose unrelated pre-existing failures; report separately"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {"id": "core", "subtaskIds": ["XAI-01"]},
      {"id": "coverage-and-reuse", "subtaskIds": ["XAI-02", "XAI-03"]},
      {"id": "closeout", "subtaskIds": ["XAI-04", "XAI-05"]}
    ]
  }
}
```

## 回滚

回退 allowlist、相关通用文案和文档；不要删除已生成的 xAI account store。必要时由用户显式激活/写回目标 Key。

## 门禁

- UI 设计员 HTML 原型复核 + 用户批准后，主会话才可保存计划并进入 implementing。
- 实现员不得顺手泛化 auto-failover。
- checker 必须检查 secrets/no-store/真实 agent dir 隔离。
