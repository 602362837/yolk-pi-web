# Implement：Antigravity provider、多账号quota与自动切号

## 实现前提

1. UI设计员已通过YPI Studio交付task-local HTML原型，`ui.md`已链接且用户明确批准。
2. 用户已批准 [plan-review.md](./plan-review.md) 的安全风险与产品行为。
3. 主会话已通过Studio工具保存本计划为task `implementationPlan`，并在合法approval gate后进入`implementing`。
4. 实现员每次只处理已claim的一个`subtaskId`；不得绕过DAG、并行写同一文件或覆盖无关用户改动。

## 优先阅读

1. `AGENTS.md`、`docs/integrations/README.md`、`docs/architecture/overview.md`
2. `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/standards/code-style.md`
3. 本任务`brief.md`、`prd.md`、`ui.md`、HTML原型、`design.md`、`checks.md`
4. `lib/pi-provider-extensions.ts`、`next.config.ts`与所有bootstrap call sites
5. `lib/oauth-account-providers.ts`、`lib/oauth-accounts.ts`、`lib/kiro-account-lock.ts`、`lib/kiro-account-token.ts`
6. `lib/kiro-subscription-quota.ts`、`lib/kiro-account-failover.ts`、`lib/grok-account-failover.ts`、`lib/rpc-manager.ts`
7. `components/ModelsConfig.tsx`、Kiro/Grok quota与usage panels、ProviderUsage contracts、`AppShell.tsx`、`SettingsConfig.tsx`
8. 临时`npm pack @yofriadi/pi-antigravity-oauth@0.3.0`发布物：`src/index.ts`、OAuth、models、cloud-code-assist；只读审计，生产代码不得私有import。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| AG-01 | provider-bootstrap | 1 | — | 固定依赖、jiti/external、统一bootstrap与callback loopback | 是 |
| AG-02 | oauth-accounts | 2 | AG-01 | Adapter、opaque多账号、provider lock、token refresh/CAS与Auth安全 | 是 |
| AG-03 | config-settings | 2 | AG-01 | Antigravity panel/failover配置与Settings | 是（与02） |
| AG-04 | quota-service | 3 | AG-02 | fetchAvailableModels、model key mapping、cache与安全API | 是 |
| AG-05 | failover-runtime | 4 | AG-03, AG-04 | model-aware独立Path B、RPC/SSE/Chat notice | 是 |
| AG-06 | models-ui | 4 | AG-03, AG-04 | Models OAuth账号与按模型quota体验 | 是（与05） |
| AG-07 | topbar-aggregate | 4 | AG-03, AG-04 | usage panel、N-ring detail-only、Compact/Aggregate第四provider | 是（与05/06） |
| AG-08 | integration-docs | 5 | AG-01…07 | 回归、真实流程、隐私检查与文档 | 否 |

建议`maxConcurrency=3`。第4阶段文件所有权：AG-05只写runtime/hook/Chat notice；AG-06只写Models/QuotaView；AG-07只写usage panel/AppShell/shared contract/CSS。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "固定接入 @yofriadi/pi-antigravity-oauth@0.3.0，复用 opaque OAuth store，实现固定 fetchAvailableModels 按模型额度、model-aware 独立 Path B 自动切号，并接入现有 Full/Compact/Aggregate 顶栏契约。",
  "strategy": "provider bootstrap and callback security first; parallel OAuth foundation and config; quota/model-mapping barrier; parallel runtime, Models UI, and topbar; final integration/security/docs barrier",
  "maxConcurrency": 3,
  "scheduler": {
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "AG-01",
      "title": "固定接入 Antigravity provider 并强制 OAuth callback loopback",
      "phase": "provider-bootstrap",
      "order": 1,
      "dependsOn": [],
      "files": [
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "lib/pi-provider-extensions.ts",
        "app/api/models/route.ts",
        "app/api/auth/providers/route.ts",
        "app/api/auth/login/[provider]/route.ts",
        "app/api/auth/logout/[provider]/route.ts",
        "app/api/auth/all-providers/route.ts",
        "app/api/auth/api-key/[provider]/route.ts",
        "app/api/models-config/test/route.ts",
        "app/api/skills/route.ts",
        "app/api/commands/route.ts",
        "app/api/terminal/env/assist/route.ts",
        "app/api/trellis/workflow/assist/route.ts",
        "app/api/model-prices/route.ts",
        "app/api/model-prices/suggest/route.ts",
        "lib/deepseek-balance.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "scripts/test-antigravity-provider.mjs",
        "scripts/test-antigravity-callback-security.mjs"
      ],
      "instructions": [
        "Add exact dependency @yofriadi/pi-antigravity-oauth@0.3.0 and serverExternalPackages entry; never statically import its src tree.",
        "Add a named inline extension using createJiti(...).import('@yofriadi/pi-antigravity-oauth') and invoke only the public default factory.",
        "Load fixed providers in Grok -> Kiro -> Antigravity order before call-site extras; keep each provider load failure isolated.",
        "Before the first Antigravity jiti import, force PI_OAUTH_CALLBACK_HOST to 127.0.0.1 under a one-shot loader/single-flight so unset or non-loopback values cannot widen the listener. Preserve the existing manual redirect paste path for remote Web users.",
        "Audit every ResourceLoader/createAgentSessionServices/ModelRegistry path; existing unified helpers must preserve all three providers after refresh.",
        "Add cold-start, source-contract, package-version, model/auth discovery, all-callsite coverage, Grok/Kiro preservation, and actual loopback policy tests."
      ],
      "acceptance": [
        "Cold /api/models and /api/auth/providers discover google-antigravity without opening Chat.",
        "Main and Studio child factories contain all fixed providers.",
        "No application static import of package private source exists.",
        "OAuth callback cannot listen on a non-loopback interface.",
        "Grok and Kiro provider tests preserve current semantics."
      ],
      "validation": [
        "npm install",
        "npm run test:antigravity-provider",
        "npm run test:antigravity-callback-security",
        "npm run test:grok-provider",
        "npm run test:kiro-provider",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Environment mutation around jiti import races with another provider load",
        "A missed registry call site drops Antigravity after refresh",
        "Transitive TypeScript/runtime dependency is incorrectly bundled"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["bootstrap coverage", "callback binding", "private-import ban"] }
    },
    {
      "id": "AG-02",
      "title": "实现 Antigravity OAuth saved accounts、provider lock与安全refresh",
      "phase": "oauth-accounts",
      "order": 2,
      "dependsOn": ["AG-01"],
      "files": [
        "lib/oauth-account-providers.ts",
        "lib/oauth-accounts.ts",
        "lib/antigravity-account-lock.ts",
        "lib/antigravity-account-token.ts",
        "app/api/auth/accounts/[provider]/route.ts",
        "app/api/auth/accounts/[provider]/activate/route.ts",
        "app/api/auth/providers/route.ts",
        "app/api/auth/login/[provider]/route.ts",
        "scripts/test-antigravity-accounts.mjs",
        "scripts/test-antigravity-refresh-activate-race.mjs"
      ],
      "instructions": [
        "Add ANTIGRAVITY_PROVIDER_ID='google-antigravity' adapter requiring non-empty access/refresh/projectId and finite expires; support OAuth login only.",
        "Derive diagnostic real id from refresh-token SHA-256 and use only safe email/name display hints; never place projectId in metadata or account summaries.",
        "Allocate a new opaque storage id for every add login; preserve credential unknown fields only in the secret file.",
        "Implement an Antigravity-specific process + mkdir provider lock shared by refresh and Activate, following the proven Kiro lock pattern without coupling providers.",
        "Implement per-account single-flight forceRefresh, merge refresh results with existing projectId, atomic 0600 write, and lock-held active-mirror CAS.",
        "Map upstream login/token/refresh errors to fixed safe messages before SSE/API projection; never log raw response text.",
        "Cover duplicate identities, file modes, delete-active protection, missing/default project behavior, refresh races, Activate races, and CAS."
      ],
      "acceptance": [
        "Two OAuth adds create independent opaque account files and metadata entries.",
        "projectId remains server-side and absent from accounts.json/API/DOM/SSE/log.",
        "Non-active refresh cannot overwrite auth.json Active.",
        "Activate updates subsequent live requests after reload without session pinning.",
        "Raw upstream errors are not projected."
      ],
      "validation": [
        "npm run test:antigravity-accounts",
        "npm run test:antigravity-refresh-activate-race",
        "npm run test:oauth-accounts",
        "npm run test:grok-accounts",
        "npm run test:kiro-accounts",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Refresh response omits projectId and breaks getApiKey",
        "Provider lock integration regresses generic Activate",
        "Upstream error body leaks through existing SSE generic catch"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["secret projection", "refresh/Activate race", "credential shape"] }
    },
    {
      "id": "AG-03",
      "title": "增加 Antigravity配置与Settings控制",
      "phase": "config-settings",
      "order": 2,
      "dependsOn": ["AG-01"],
      "files": [
        "lib/pi-web-config.ts",
        "app/api/web-config/route.ts",
        "components/SettingsConfig.tsx",
        "scripts/test-antigravity-config.mjs"
      ],
      "instructions": [
        "Add antigravity.usagePanelEnabled default false and independent autoFailover config aligned with Kiro/Grok budgets, cooldown, and quota freshness defaults.",
        "Add strict additive validation/read/write merge so partial Antigravity patches preserve unrelated config.",
        "Add an Antigravity Settings section peer to Grok/Kiro with approved prototype copy; keep panel and failover default off.",
        "Update global Usage Compact/Aggregate copy to include Antigravity; do not add provider-specific compact/aggregate flags.",
        "Surface fail-closed model-aware behavior and non-official/wide-scope warning according to the approved HTML."
      ],
      "acceptance": [
        "Old pi-web.json reads with hidden Antigravity panel and disabled failover.",
        "Save/reload preserves new and unrelated settings.",
        "Settings structure/copy matches approved HTML and does not duplicate global flags."
      ],
      "validation": [
        "npm run test:antigravity-config",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Normalizer strips unknown config",
        "Settings navigation misses the new section",
        "Security copy becomes an unapproved blocking confirmation"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["defaults", "partial merge", "prototype fidelity"] }
    },
    {
      "id": "AG-04",
      "title": "实现 fetchAvailableModels quota、model mapping与安全API",
      "phase": "quota-service",
      "order": 3,
      "dependsOn": ["AG-02"],
      "files": [
        "lib/antigravity-subscription-quota.ts",
        "lib/antigravity-model-quota.ts",
        "app/api/auth/quota/[provider]/route.ts",
        "scripts/test-antigravity-quota.mjs",
        "scripts/test-antigravity-model-quota.mjs"
      ],
      "instructions": [
        "Call only the fixed daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels endpoint with server-side token/projectId, fixed headers/body, and 10s timeout; never accept a credential URL or arbitrary headers.",
        "Parse a bounded models record and only quotaInfo.remainingFraction/resetTime; require finite 0..1 remaining and compute usedPercent=100*(1-remaining). Never coerce invalid/unknown to zero.",
        "Implement 60s fresh/24h stale normalized cache, per-account single-flight, force refresh, and one 401 force-refresh retry. Treat 403/project failures separately from reauth.",
        "Create a fixed 0.3.0 public-model -> accepted quota-key compatibility table without runtime private imports. Every catalog model must be mapped or explicitly failover-unsupported.",
        "Return AntigravityQuotaResultV1 only with opaque accountId, bounded model fields, cache state, and fixed error codes/messages. No token/refresh/projectId/raw body/URL/header/path/request id.",
        "Add GET Active/accountId/refresh route branch and explicit POST 405, all no-store."
      ],
      "acceptance": [
        "0/1/fraction remaining values produce correct used percentage and reset display.",
        "Malformed/oversized/empty payloads fail safely without raw leakage.",
        "Current model mapping is deterministic and unknown mappings fail closed.",
        "401 retries once; stale fallback works; POST is 405.",
        "Default project id alone never marks quota/account healthy."
      ],
      "validation": [
        "npm run test:antigravity-quota",
        "npm run test:antigravity-model-quota",
        "npm run test:grok-quota",
        "npm run test:kiro-quota",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Quota host/schema changes",
        "Public model/request/quota key drift within upstream",
        "remainingFraction is accidentally treated as utilization",
        "Default project returns misleading empty success"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["fixed egress", "parser math", "mapping coverage", "wire privacy"] }
    },
    {
      "id": "AG-05",
      "title": "实现model-aware Antigravity独立Path B自动切号",
      "phase": "failover-runtime",
      "order": 4,
      "dependsOn": ["AG-03", "AG-04"],
      "files": [
        "lib/antigravity-account-failover.ts",
        "lib/rpc-manager.ts",
        "hooks/useAgentSession.ts",
        "components/ChatWindow.tsx",
        "components/ChatInput.tsx",
        "scripts/test-antigravity-failover-adapter.mjs",
        "scripts/test-antigravity-failover-runtime.mjs"
      ],
      "instructions": [
        "Create an Antigravity-only classifier/controller and place its RPC patch outside Kiro while preserving all existing provider controller internals.",
        "Check hard negatives before positive quota/rate-limit semantics. Reject bare 429/API error(429), auth/project/network/timeout/abort/5xx/capacity/context/content/model/help errors.",
        "Allow only explicit RESOURCE_EXHAUSTED/quota reset/exhaustion and explicit rate-limit/too-many-requests semantics.",
        "Capture trigger Active and current public model at run start. Candidates require valid credential plus fresh/live matching model quota remainingFraction>0; unknown/stale/reauth/other-model-only fail closed.",
        "Use process lock, Active-after-lock check, candidate revalidation, pre-Activate TOCTOU, cooldown, and max one switch/retry per turn.",
        "Retry after another session switched only when the new Active still has fresh matching-model quota; otherwise terminal.",
        "Emit an allowlisted antigravity_account_failover event/notice. Never project account ids, projectId, token, path, raw error, or Retrying for terminal states."
      ],
      "acceptance": [
        "Explicit quota/rate-limit switches and retries once; all required negatives do not switch.",
        "Candidate with quota only for another model is rejected.",
        "Concurrent sessions cause at most one actual Active switch and no cascade.",
        "No usable candidate is terminal and display-safe.",
        "GPT/Grok/Kiro/OpenCode failover behavior remains unchanged."
      ],
      "validation": [
        "npm run test:antigravity-failover-adapter",
        "npm run test:antigravity-failover-runtime",
        "npm run test:chatgpt-failover-contract",
        "npm run test:grok-failover-adapter",
        "npm run test:grok-failover-runtime",
        "npm run test:kiro-failover-adapter",
        "npm run test:kiro-failover-runtime",
        "npm run test:opencode-go-failover-behavior",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Package retries hide structured errors and leave only bare status",
        "Outer patch order changes existing retry lifecycle",
        "Candidate quota probes add latency",
        "Already-switched path retries an unusable new Active"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["classifier negatives", "model-aware candidate", "concurrency", "SSE privacy"] }
    },
    {
      "id": "AG-06",
      "title": "在Models实现Antigravity OAuth多账号与按模型quota体验",
      "phase": "models-ui",
      "order": 4,
      "dependsOn": ["AG-03", "AG-04"],
      "files": [
        "components/ModelsConfig.tsx",
        "components/AntigravityQuotaView.tsx",
        "scripts/test-antigravity-models-ui.mjs"
      ],
      "instructions": [
        "Extend capability-driven managed OAuth rendering for google-antigravity rather than cloning a disconnected UI tree.",
        "Use the existing SSE browser OAuth/manual redirect flow; do not offer JSON import or expose projectId.",
        "Render Active-first accounts, remark/extra info, selected quota account, Activate, reauth recovery, protected delete, and global-Active semantics.",
        "Render bounded per-model remaining/used/reset with live/fresh/stale/none/reauth/access denied/invalid project states; never render a cross-model total.",
        "Clear previous-account quota immediately on selection/Activate and reject stale responses by AbortController, generation, and accountId.",
        "Match approved HTML including security disclosure, loading/empty/error/long-name/narrow/keyboard states."
      ],
      "acceptance": [
        "User can add, label, select, Activate, recover, and delete multiple Antigravity accounts.",
        "All valid model quotas are inspectable without total/average fabrication.",
        "Unknown quota does not block account management or chat.",
        "No token/refresh/projectId/raw upstream error reaches DOM."
      ],
      "validation": [
        "npm run test:antigravity-models-ui",
        "npm run test:antigravity-accounts",
        "npm run test:antigravity-quota",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser Models Antigravity OAuth/account/quota flow"
      ],
      "risks": [
        "Hard-coded Grok/Kiro booleans omit a capability",
        "Generic login error leaks upstream response text",
        "Multi-model table overflows narrow view",
        "Old account quota flashes after Activate"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["prototype fidelity", "account race", "DOM privacy", "accessibility"] }
    },
    {
      "id": "AG-07",
      "title": "接入Antigravity顶栏Full/Compact/Aggregate与detail-only投影",
      "phase": "topbar-aggregate",
      "order": 4,
      "dependsOn": ["AG-03", "AG-04"],
      "files": [
        "lib/antigravity-usage-ring.ts",
        "components/ProviderUsagePanelContract.ts",
        "components/ProviderUsageTrigger.tsx",
        "components/ProviderUsageAggregatePanel.tsx",
        "components/AntigravityUsagePanel.tsx",
        "components/AppShell.tsx",
        "app/globals.css",
        "scripts/test-antigravity-usage-panel.mjs",
        "scripts/test-provider-usage-compact.mjs",
        "scripts/test-provider-usage-aggregate.mjs"
      ],
      "instructions": [
        "Add Antigravity as the fourth allowlisted provider projection/order without changing GPT/Grok/Kiro schema owners or creating a total percent.",
        "Build safe window candidates from normalized model quotas. resetTime is title/detail only and never duration/order evidence.",
        "Use one ring only when the shared projector has one safe candidate. Multi-model unknown-duration candidates must become detail-only with ringUnit=null and fixed fallback, never aggregate/min/max/average or sort by percent/remaining/reset/id/order.",
        "Implement standalone Full/Compact and aggregate detail slot from the same account/quota state owner, with foreground 30s light revalidation and force refresh=1.",
        "Mount enabled panels in approved order with JSX mutual exclusion, one usage host, one right-padding reserve, and no double poll.",
        "Apply accountId/generation/abort race guards, viewport clamp, Escape/outside/focus restore, ARIA, long labels, responsive widths, and reduced motion according to approved HTML."
      ],
      "acceptance": [
        "Antigravity participates in global Compact/Aggregate without affecting per-provider visibility.",
        "Single-window ring and multi-model detail-only behavior are honest and deterministic.",
        "No old-account quota flash or duplicate polling occurs.",
        "All provider combinations preserve approved order/spacing and a single host reserve.",
        "Aggregate projection contains no accountId/projectId/credential/raw fields."
      ],
      "validation": [
        "npm run test:antigravity-usage-panel",
        "npm run test:provider-usage-compact",
        "npm run test:provider-usage-aggregate",
        "npm run test:chatgpt-usage-panel",
        "npm run test:grok-usage-panel",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser desktop and 320/375/640px prototype comparison"
      ],
      "risks": [
        "Shared key/label union change regresses aggregate shell",
        "Multi-model quotas are collapsed into a misleading total",
        "Fourth panel duplicates host padding or overflows",
        "resetTime is accidentally reused as duration evidence"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["detail-only invariant", "aggregate privacy", "mount/polling", "responsive UI"] }
    },
    {
      "id": "AG-08",
      "title": "完成Antigravity集成回归、安全复核与文档",
      "phase": "integration-docs",
      "order": 5,
      "dependsOn": ["AG-01", "AG-02", "AG-03", "AG-04", "AG-05", "AG-06", "AG-07"],
      "files": [
        "AGENTS.md",
        "package.json",
        "docs/integrations/README.md",
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/operations/troubleshooting.md",
        "scripts/test-antigravity-integration.mjs"
      ],
      "instructions": [
        "Run all Antigravity suites plus GPT/Grok/Kiro/OpenCode regressions, lint, tsc, and git diff --check; do not run next build directly.",
        "Exercise cold Models/Auth, callback loopback, real OAuth/manual redirect where credentials permit, model chat, quota, two-account Activate, and approved topbar states.",
        "Scan API/SSE/DOM/log/cache/accounts metadata for token/refresh/projectId/raw response/path leakage and verify 0600/0700 modes.",
        "Re-audit the locked 0.3.0 package for scripts/postinstall/fs/child_process/eval/non-Google egress and document nonofficial channel, wide scope, hardcoded client, simulated UA, default project, cache/failover/detail-only semantics, and rollback.",
        "Record any real-provider flow that could not execute. Do not claim live failover/quota passed from mocks only.",
        "Update AGENTS navigation only for the new major integration entry points; keep detailed rationale in docs."
      ],
      "acceptance": [
        "Automated baseline passes with no existing provider regressions.",
        "Callback security and privacy boundaries have runtime evidence.",
        "At least one real OAuth/model/quota flow is evidenced or its credential blocker is explicit.",
        "Desktop/narrow UI matches the approved HTML.",
        "Docs accurately describe risks, safe data flow, defaults, failure downgrade, and rollback."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:antigravity-integration",
        "npm run test:antigravity-provider",
        "npm run test:antigravity-accounts",
        "npm run test:antigravity-callback-security",
        "npm run test:antigravity-quota",
        "npm run test:antigravity-model-quota",
        "npm run test:antigravity-failover-adapter",
        "npm run test:antigravity-failover-runtime",
        "npm run test:antigravity-models-ui",
        "npm run test:antigravity-usage-panel",
        "npm run test:provider-usage-compact",
        "npm run test:provider-usage-aggregate",
        "npm run test:chatgpt-failover-contract",
        "npm run test:grok-all",
        "npm run test:kiro-integration",
        "npm run test:opencode-go-failover-behavior",
        "git diff --check"
      ],
      "risks": [
        "Mock-only tests miss real Google callback/project/quota differences",
        "Docs understate unsupported/nonofficial channel risk",
        "Privacy scan misses error/log path",
        "Unrelated worktree changes are overwritten"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker", "focus": ["full regression", "real-provider evidence", "security/privacy", "docs accuracy"] }
    }
  ],
  "execution": {
    "mode": "mixed",
    "maxParallel": 3,
    "groups": [
      { "id": "bootstrap", "relation": "serial", "subtaskIds": ["AG-01"] },
      { "id": "foundation", "relation": "parallel", "dependencies": ["bootstrap"], "subtaskIds": ["AG-02", "AG-03"] },
      { "id": "quota", "relation": "barrier", "dependencies": ["foundation"], "subtaskIds": ["AG-04"] },
      { "id": "runtime-ui", "relation": "parallel", "dependencies": ["quota"], "subtaskIds": ["AG-05", "AG-06", "AG-07"] },
      { "id": "integration", "relation": "barrier", "dependencies": ["runtime-ui"], "subtaskIds": ["AG-08"] }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:antigravity-integration
npm run test:antigravity-provider
npm run test:antigravity-accounts
npm run test:antigravity-callback-security
npm run test:antigravity-quota
npm run test:antigravity-model-quota
npm run test:antigravity-failover-adapter
npm run test:antigravity-failover-runtime
npm run test:antigravity-models-ui
npm run test:antigravity-usage-panel
npm run test:provider-usage-compact
npm run test:provider-usage-aggregate
npm run test:chatgpt-failover-contract
npm run test:grok-all
npm run test:kiro-integration
npm run test:opencode-go-failover-behavior
git diff --check
```

不直接运行`next build`；发布/交付验证才使用`npm run build`。

## 评审门禁

- 缺UI设计员HTML、用户审批或task-level plan保存：不得进入implementing。
- 新增rotator依赖/代理、任意credential URL/header、raw upstream投影、默认project健康捷径、跨模型总额度或unknown盲切：停止并上报。
- 修改GPT/Grok/Kiro/OpenCode既有classifier或预算：必须另行确认。
- checker必须实际浏览器验证Models/topbar，并尽可能执行真实Google OAuth/model/quota；不能只做source grep。

## 回滚

1. 设置`antigravity.usagePanelEnabled=false`、`antigravity.autoFailover.enabled=false`止血。
2. 从固定provider列表移除Antigravity并隐藏Models/Auth/API/UI分支；Grok/Kiro/native继续工作。
3. 从aggregate key/order移除第四provider时保留前三provider行为与Compact偏好。
4. 保留`auth-accounts/google-antigravity/`与normalized cache；不删除用户credential。
5. 无历史JSONL/ledger迁移，无需回写。
