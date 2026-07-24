# Implement：Links GitHub OAuth Client ID 产品默认与 env 覆盖

## 先阅读

1. `AGENTS.md`
2. `docs/standards/code-style.md`
3. `docs/architecture/overview.md`（Links）
4. `docs/integrations/README.md`、`docs/deployment/README.md`、`docs/operations/troubleshooting.md`（Links）
5. `docs/modules/library.md`、`docs/modules/api.md`、`docs/modules/frontend.md`（Links）
6. `lib/github-link-oauth.ts`
7. `scripts/test-links.mjs`
8. `app/api/links/route.ts`、`app/api/links/[provider]/authorizations/route.ts`
9. `components/LinksConfig.tsx`（只审计，不计划修改）

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | ---: | ---: | --- | --- | --- |
| DEFAULT-01 | core | 1 | 在 server-only resolver 内加入产品默认、env 优先和测试三态 reset/override | — | 否 |
| TEST-01 | tests | 2 | 扩展 focused Links tests，覆盖默认/env/trim/空白/forced-null/browser 边界 | DEFAULT-01 | 是 |
| DOCS-01 | docs | 2 | 更新 architecture、integrations、deployment、modules、troubleshooting | DEFAULT-01 | 是 |
| CHECK-01 | validation | 3 | focused tests、lint、tsc、source scans、无 env/覆盖 live smoke 与 checker 评审 | TEST-01, DOCS-01 | 否 |

## 改动原则

- 只在 `lib/github-link-oauth.ts` 定义产品默认，不新建浏览器共享配置模块。
- 不修改 `components/LinksConfig.tsx`；如果实现员认为必须改 UI/文案，应停止并重新触发 UI HTML 原型门禁。
- test helper 的 `null` 必须继续表示强制未配置；`undefined` 清除 override/cache并重新读取 env/default。
- 非空错误 env 是显式 override，不得在 GitHub 报错后静默 fallback。
- 不删除稳定的 `github_authorization_not_configured` 错误码和 null guards。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-21T09:50:47Z",
  "sourceArtifact": "implement.md",
  "summary": "Add a server-only product default GitHub OAuth Client ID, preserve non-empty env override and focused fail-closed injection, update tests/docs, then validate without changing UI or API shape.",
  "strategy": "Implement the resolver contract first; run tests and documentation updates in parallel after it stabilizes; close with integrated security and live Device Flow checks.",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "DEFAULT-01",
      "title": "Implement product default and env-first Client ID resolution",
      "phase": "core",
      "order": 1,
      "dependsOn": [],
      "relation": "serial",
      "files": ["lib/github-link-oauth.ts"],
      "instructions": [
        "Define the exact product default Ov23li1Cb4aoB9kKQZNq in the server-only GitHub Links OAuth module.",
        "Resolve a non-empty trimmed YPI_LINKS_GITHUB_OAUTH_CLIENT_ID first; otherwise use the product default. Blank env is fallback, not disable.",
        "Preserve process-lifetime caching and defensive null guards/error codes.",
        "Make the test helper support forced string, forced null fail-closed, and undefined reset/re-resolve semantics without adding production config surfaces."
      ],
      "acceptance": [
        "No-env and blank-env resolution returns the exact product default and isGithubOAuthConfigured is true.",
        "Non-empty env is trimmed and wins.",
        "No Client secret, NEXT_PUBLIC, pi-web.json, browser import, API field, or LLM auth dependency is added.",
        "Test-only forced null can still exercise github_authorization_not_configured."
      ],
      "validation": [
        "Inspect all resolver callers with rg.",
        "Run focused resolver tests added by TEST-01.",
        "Run eslint on lib/github-link-oauth.ts."
      ],
      "risks": [
        "Ambiguous test cache semantics can leak state across focused tests.",
        "Changing/removing null guards would weaken defensive compatibility."
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 1,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "TEST-01",
      "title": "Extend focused Links resolver and browser-boundary tests",
      "phase": "tests",
      "order": 2,
      "dependsOn": ["DEFAULT-01"],
      "relation": "parallel",
      "parallelGroup": "coverage-docs",
      "files": ["scripts/test-links.mjs"],
      "instructions": [
        "Add isolated tests for exact default, env override, trim, unset/empty/whitespace fallback, configured=true, reset behavior, and forced-null fail-closed.",
        "Restore the original env and resolver cache in finally so authorization-manager tests remain deterministic.",
        "Add source assertions that the exact default/env configuration is absent from LinksConfig and browser wire definitions/routes while preserving existing no-NEXT_PUBLIC, no-PAT, sentinel, fixed-scope, and LLM-auth isolation tests."
      ],
      "acceptance": [
        "npm run test:links passes with the new resolution matrix.",
        "Existing requestDeviceCode not-configured test still passes through explicit forced null.",
        "The test never touches real ~/.pi/agent and does not leak env/cache state."
      ],
      "validation": [
        "npm run test:links",
        "Review test cleanup paths and exact Client ID source scans."
      ],
      "risks": [
        "Background polling timers and cached module state can make tests order-dependent if cleanup is incomplete.",
        "A broad text scan can false-positive on server-only docs; scope scans to browser/runtime files."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 2,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "DOCS-01",
      "title": "Document built-in default and optional server env override",
      "phase": "docs",
      "order": 2,
      "dependsOn": ["DEFAULT-01"],
      "relation": "parallel",
      "parallelGroup": "coverage-docs",
      "files": [
        "docs/architecture/overview.md",
        "docs/integrations/README.md",
        "docs/deployment/README.md",
        "docs/modules/library.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Replace the old required-env/official-export contract with product default plus optional non-empty trimmed server env override.",
        "State that blank env falls back to default, env changes require restart, and no secret/NEXT_PUBLIC/pi-web/UI form is added.",
        "Reframe the not-configured UI/API as defensive or test-only and add bad override/Device Flow disabled recovery.",
        "Do not change AGENTS.md because navigation and module entrypoints are unchanged."
      ],
      "acceptance": [
        "Official ypi/start instructions require no Client ID export.",
        "Developer/deployer override examples remain server-only.",
        "Docs consistently preserve Links/LLM auth isolation and no-client-secret semantics.",
        "No docs describe empty env as disable."
      ],
      "validation": [
        "rg -n 'YPI_LINKS_GITHUB_OAUTH_CLIENT_ID|not configured|未配置|Required' docs AGENTS.md",
        "Review all Links documentation hits for one consistent priority contract."
      ],
      "risks": [
        "A stale Required=Yes table or export snippet would keep misleading users.",
        "Troubleshooting may accidentally claim a production disable switch exists."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 2,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CHECK-01",
      "title": "Run integrated validation and release smoke",
      "phase": "validation",
      "order": 3,
      "dependsOn": ["TEST-01", "DOCS-01"],
      "relation": "barrier",
      "files": [],
      "instructions": [
        "Run focused tests, project lint and type-check, and scoped source scans for browser/config/auth boundary regressions.",
        "Manually verify GET /api/links and start Device Flow once with env absent and once with a known test override; restore environment afterward.",
        "Checker must review the exact default, env priority, test-only fail-closed, docs consistency, no UI diff, API compatibility, and rollback."
      ],
      "acceptance": [
        "Automated checks pass or unrelated pre-existing failures are isolated with evidence.",
        "No-env official path starts Device Flow using the product app.",
        "A trimmed env override is used only server-side and works after restart.",
        "Browser DOM/API responses contain no Client ID field and existing token/device_code sentinels remain absent."
      ],
      "validation": [
        "npm run test:links",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "rg -n 'Ov23li1Cb4aoB9kKQZNq|NEXT_PUBLIC.*LINKS|YPI_LINKS_GITHUB_OAUTH_CLIENT_ID' lib app components docs",
        "Manual no-env and env-override GitHub Device Flow smoke"
      ],
      "risks": [
        "Live GitHub smoke depends on network and the product OAuth App remaining enabled.",
        "Full-repo checks may expose unrelated pre-existing failures; do not misattribute them."
      ],
      "parallelizable": false,
      "member": "checker",
      "priority": 3,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ],
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "core",
        "title": "Resolver contract",
        "relation": "serial",
        "subtaskIds": ["DEFAULT-01"]
      },
      {
        "id": "coverage-docs",
        "title": "Focused coverage and documentation",
        "relation": "parallel",
        "dependencies": ["core"],
        "subtaskIds": ["TEST-01", "DOCS-01"]
      },
      {
        "id": "closeout",
        "title": "Integrated validation",
        "relation": "barrier",
        "dependencies": ["coverage-docs"],
        "subtaskIds": ["CHECK-01"]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run test:links
npm run lint
node_modules/.bin/tsc --noEmit
rg -n 'Ov23li1Cb4aoB9kKQZNq|NEXT_PUBLIC.*LINKS|YPI_LINKS_GITHUB_OAUTH_CLIENT_ID' \
  lib app components docs
```

不得运行 `next build`；发布验证如确需构建只能使用 `npm run build`，且不属于常规实现子任务。

## 检查门禁

- DEFAULT-01 完成前不得并行修改测试预期和文档契约。
- TEST-01 与 DOCS-01 可并行，最大并发 2。
- CHECK-01 必须由 checker 执行，并阻塞在前两项完成之后。
- 任意 UI/文案/信息结构改动都必须重新触发 UI 设计员 HTML 原型审批；当前计划无 UI 生产代码改动。
- 未取得用户对 `plan-review.md` 的批准前，不得进入 implementing。

## 回滚

优先设置已知可用的 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 并重启；必要时回退 resolver 为 env-only。任何回滚都不得删除 `~/.pi/agent/links/`、改写 LLM auth 或自动撤销 GitHub grants。
