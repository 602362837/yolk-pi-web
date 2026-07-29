# Implement：精简 GitHub Issue 自动化

## 1. 执行前硬门禁

- **当前不得进入生产实现。** [ui.md](ui.md) 已判定触发 UI 原型硬门禁，但任务目录尚无 UI 设计员 `.html` 原型和用户审批记录。
- 主会话须先指派 `ui-designer` 完成 GIA-00；architect 不得用 Markdown 或自行伪造的 HTML 替代 UI 设计员交付。
- 用户批准 [plan-review.md](plan-review.md) 与 HTML 原型后，才保存/启用 implementation plan 并转入 implementing。
- 实现期间不 commit、push、merge，不使用真实 GitHub/App/provider 凭据。
- 删除顺序必须是“新路径与迁移门禁落地 → 解除所有引用 → 删除旧闭环”，不能先删通用依赖。

## 2. 优先阅读

| 顺序 | 文件 | 重点 |
| --- | --- | --- |
| 1 | [brief.md](brief.md)、[prd.md](prd.md)、[ui.md](ui.md)、[design.md](design.md)、[checks.md](checks.md) | 产品口径、只读/close/迁移/UI 门禁 |
| 2 | UI 设计员批准的任务目录 `.html` 原型 | 设置页实现唯一视觉/交互依据 |
| 3 | `docs/architecture/overview.md`、`docs/integrations/README.md`、`docs/integrations/github-app-automation-setup.md` | 现有安全基础与需退役口径 |
| 4 | `lib/github-automation-runtime.ts`、`store.ts`、`scheduler.ts`、`types.ts` | ingress、durable state、lease/fence |
| 5 | `lib/github-issue-triage-runner.ts`、`comments.ts`、`labels.ts` | 当前 Issue fetch、marker/upsert 与待删除 claim/command |
| 6 | `lib/github-app-client.ts`、`github-webhook-verify.ts`、`github-automation-config.ts` | 固定 GitHub host、HMAC、config CAS/Project Registry |
| 7 | `lib/model-price-assistant.ts`、`lib/web-model-runtime.ts` | `ModelRuntime.completeSimple` 与 provider-aware model boundary |
| 8 | `components/GithubAutomationConfig.tsx`、`SettingsConfig.tsx`、`SettingsTreeNavigation.tsx`、`app/globals.css` | 现有 Settings shell、响应式与需删除 UI |
| 9 | `package.json`、`scripts/test-github-*.mjs`、`.pi/skills/github-*` | 旧测试/script/skill 依赖图 |
| 10 | `docs/modules/{api,frontend,library}.md`、`docs/deployment/README.md`、`docs/operations/troubleshooting.md`、`AGENTS.md` | 文档/导航同步 |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 说明 |
| --- | --- | --- | --- | --- |
| GIA-00 | ui-gate | UI 设计员 HTML 原型与用户审批 | — | 当前 blocker；不改生产代码 |
| GIA-01 | contracts | v2 types/config/store/legacy retirement 契约 | GIA-00 | 新旧 schema 隔离、升级默认关闭 |
| GIA-02 | analysis | 只读 evidence controller 与 model/schema 分析器 | GIA-00 | 可与 GIA-01 并行 |
| GIA-03 | runtime | opened-only ingress、单用途 scheduler/runner、comment/close 幂等 | GIA-01,GIA-02 | 核心纵向闭环 |
| GIA-04 | api | config/status/verify/jobs/App permission 投影收敛 | GIA-01,GIA-03 | API 安全面 |
| GIA-05 | ui | 按批准原型重构 GithubAutomationConfig | GIA-01,GIA-04 | 不自行改变已批准 IA |
| GIA-06 | retirement | 解除引用并删除 claim/unattended/WorkTree/Studio/PR 图 | GIA-03,GIA-04 | 保留 WorkTree Check/Studio 通用模块 |
| GIA-07 | tests | analysis-focused 测试、迁移/隐私/无自旋回归 | GIA-03,GIA-04,GIA-06 | 可与 UI 尾部并行 |
| GIA-08 | docs-check | 文档、Skills、全量验证与人工验收 | GIA-05,GIA-07 | 最终 checker 门禁 |

建议用户批准后 `maxConcurrency=2`：GIA-01/02 并行；GIA-05 与 GIA-07 在 API/runtime 稳定后可部分并行；删除和最终文档检查串行。

## 4. 实现顺序与边界

### 4.1 GIA-00：先完成 UI 门禁

UI 设计员交付任务目录 `github-issue-analysis-settings-prototype.html`（文件名可调整）并更新 [ui.md](ui.md) 链接。主会话向用户确认单一 enabled、recent analysis/retry、auto-close 警示、仓库字段和窄屏布局。任何审批反馈都要先回写 PRD/Design/Implement/Checks 与 plan revision。

### 4.2 GIA-01/02：建立可独立审查的安全内核

- 先定义 v2 schema/parser/迁移和旧 job scheduler hard skip；
- evidence controller 独立于 GitHub mutation 与 scheduler，用 temp root/fake runtime 完成安全测试；
- model 输出只产生候选结果，controller 后校验才产生 durable verdict；
- 不在此阶段接回旧 triage runner。

### 4.3 GIA-03/04：接通唯一业务路径

- webhook 只建 opened analysis job；
- scheduler 直接调用唯一 analysis handler，删除 dynamic handler registry/default handler；
- runner 按 result/comment/close effect checkpoint 续跑；
- API 投影只暴露新字段，verify read-only；
- close 门禁任一失败保持 open。

### 4.4 GIA-05/06：UI 收敛后再删旧图

- UI 严格对照批准 HTML；
- 用 `rg`/import graph 解除旧模块、scripts、Skills、docs 引用；
- 删除后立即运行 tsc + focused suites，发现 Studio/WorkTree Check 依赖则恢复并分离，而不是继续硬删。

### 4.5 GIA-07/08：证明“没有旧能力”

除了新功能 positive tests，还必须有 negative capability assertions：无 `gh`、无 AgentSession、无 WorkTree/Session/PR、无 issue_comment job、无 v1 lease。最终人工 UI/UAT 未执行时不得声称 release-ready。

## 5. 验证命令

```bash
npm run test:github-automation
npm run test:worktree-check
npm run test:studio-sdk-runner
npm run test:studio-dag
npm run test:package-assets
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

删除旧 scripts 后，以下命令应从 `package.json` 消失，而不是继续保留空壳：

```text
test:github-unattended
test:github-unattended-runner
test:github-publish-policy
test:github-handler-runtime
test:github-session-bootstrap
verify:github-automation-30142
```

Routine 开发不直接运行 `next build`；release 验证只使用 `npm run build`。

## 6. 评审门禁

- GIA-00：HTML + 用户批准；没有就停止。
- GIA-01：v1 不可调度、migration disabled、unknown schema 不覆盖。
- GIA-02：无 AgentSession/bash/edit/write/network；账本可证；grep miss 不 close。
- GIA-03：comment/close unknown effect 回读；self event 0 job；known disposition 无自旋。
- GIA-04：permission/readiness 最小化；GET/verify 不 wake；wire 隐私扫描。
- GIA-05：批准 HTML 对照、响应式/键盘/stale/revision conflict。
- GIA-06：删除图完整且 WorkTree Check/Studio/通用 bootstrap 保留。
- GIA-07：temp agent-dir + mock GitHub/model；无真实网络/凭据。
- GIA-08：docs/Skills/AGENTS 与 runtime 一致；真实 UAT blocker 如实记录。

## 7. 回滚

- 运行时 stop-bleed：`paused=true` 或 `enabled=false`；不删除凭据/allowlist/audit。
- v2 代码回滚不得让旧 binary 覆盖 schema v2；迁移前 v1 备份只供人工恢复，恢复后仍 disabled。
- 已确认 GitHub comment/close 不自动补偿；历史 Issue/PR/WorkTree/Session 不清理。
- 若新 analyzer 出现安全问题，可保留 webhook audit 与 credentials/config UI，但关闭 scheduler/analysis mutation；self/Bot 过滤不能回滚。

---

## Implementation Plan (machine-readable)

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-29T01:03:57.000Z",
  "summary": "Replace the GitHub claim-to-PR automation graph with an opened-only, read-only repository evidence analyzer that writes one canonical Issue comment and closes only high-confidence disproven bugs behind strict idempotent gates.",
  "strategy": "First obtain an approved UI-designer HTML prototype, then build isolated v2 contracts and the read-only analyzer in parallel, connect a single durable opened-Issue runtime, converge API/UI, retire the old execution graph only after references are removed, and finish with privacy/migration/no-loop tests plus documentation and UAT gates.",
  "maxConcurrency": 2,
  "sourceArtifact": "implement.md",
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "ui-prerequisite",
        "title": "UI prototype and approval prerequisite",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["GIA-00"]
      },
      {
        "id": "security-core",
        "title": "v2 durable contracts and read-only analysis core",
        "relation": "parallel",
        "dependencies": ["GIA-00"],
        "subtaskIds": ["GIA-01", "GIA-02"]
      },
      {
        "id": "runtime-api",
        "title": "single-purpose runtime and safe API",
        "relation": "serial",
        "dependencies": ["GIA-01", "GIA-02"],
        "subtaskIds": ["GIA-03", "GIA-04"]
      },
      {
        "id": "surface-retirement",
        "title": "approved UI and old graph retirement",
        "relation": "parallel",
        "dependencies": ["GIA-03", "GIA-04"],
        "subtaskIds": ["GIA-05", "GIA-06"]
      },
      {
        "id": "quality",
        "title": "focused regressions and final documentation",
        "relation": "serial",
        "dependencies": ["GIA-05", "GIA-06"],
        "subtaskIds": ["GIA-07", "GIA-08"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "GIA-00",
      "title": "Produce and approve the GitHub Issue Analysis Settings HTML prototype",
      "phase": "ui-gate",
      "order": 0,
      "dependsOn": [],
      "dependencies": [],
      "relation": "barrier",
      "files": [
        ".ypi/tasks/20260729-084811-精简议题自动化为新议题规范化评论与真实性分析/ui.md",
        ".ypi/tasks/20260729-084811-精简议题自动化为新议题规范化评论与真实性分析/github-issue-analysis-settings-prototype.html",
        "components/GithubAutomationConfig.tsx",
        "components/SettingsConfig.tsx",
        "components/SettingsTreeNavigation.tsx",
        "app/globals.css",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Assign the ui-designer member; the architect or implementer must not substitute a Markdown wireframe or self-authored HTML for this gate.",
        "Base the prototype on the current Settings shell and the state/interaction inventory in ui.md, covering credentials, setup, repository binding, enabled/paused controls, analysis boundary, recent analyses, retry, stale/revision conflict, and narrow layouts.",
        "Store a standalone HTML prototype in this task directory and update ui.md with its link and scope.",
        "Ask the user to approve the single enable control, recent analysis/retry, auto-close warning, repository field removal, inconclusive presentation, and mobile behavior.",
        "If feedback changes product behavior, revise PRD/Design/Implement/Checks and bump the plan revision before approval. Do not modify production code in this subtask."
      ],
      "acceptance": [
        "A task-local standalone HTML prototype exists and is attributed to ui-designer.",
        "The prototype covers all required states at desktop, <=640px, and <=390px.",
        "User approval or revision feedback is recorded before implementing begins.",
        "No production source file was modified as part of the prototype gate."
      ],
      "validation": [
        "Open the task-local HTML through the Studio preview sandbox and inspect desktop and narrow layouts.",
        "Confirm ui.md links the HTML and records approval status.",
        "git diff --check"
      ],
      "risks": [
        "Starting implementation from the current 4,500-line component without an approved prototype would recreate obsolete information architecture.",
        "A Markdown-only artifact does not exercise responsive hierarchy, actions, or state density."
      ],
      "parallelizable": false,
      "member": "ui-designer",
      "localReview": {
        "required": false,
        "reviewer": "architect"
      }
    },
    {
      "id": "GIA-01",
      "title": "Define v2 analysis config, durable records, migration, and legacy retirement",
      "phase": "contracts",
      "order": 10,
      "dependsOn": ["GIA-00"],
      "dependencies": ["GIA-00"],
      "relation": "parallel",
      "files": [
        "lib/github-automation-types.ts",
        "lib/github-automation-config.ts",
        "lib/github-automation-store.ts",
        "lib/github-automation-scheduler.ts",
        "lib/github-automation-errors.ts",
        "lib/github-automation-provenance.ts",
        "lib/github-automation-migration.ts"
      ],
      "instructions": [
        "Introduce config schema v2 with enabled, paused, repositories, analysis.maxConcurrency, revision, and updatedAt only; remove mode/unattended/full-agent/baseRef/owner-assignee fields from the live contract.",
        "Require positive installationId and Project Registry projectId for every v2 repository; derive projectRoot server-side and never project it.",
        "Migrate v1 under the existing config lock, create a fixed non-secret retirement backup, preserve valid repository identity/binding, and force enabled=false. Unknown/future schema must fail closed without overwrite.",
        "Define schema-v2 kind=issue_analysis delivery/job/result/effect records and the minimal phases/statuses/outcomes in design.md.",
        "Use repositoryId+issueNumber+kind as the one-opened-analysis lifecycle key in issue state; a second distinct opened delivery must not create another job.",
        "Make scheduler selection hard-require schemaVersion=2 and kind=issue_analysis. Write retirement sidecars for v1 non-terminal jobs with legacy_pipeline_retired while preserving original files/events.",
        "Retain lease heartbeat/fencing, explicit dispositions, bounded retry, filesystem modes, atomic writes, and safe event scalar-only rules.",
        "Do not import or retain Agent/Session/WorkTree/PR concepts in v2 types."
      ],
      "acceptance": [
        "Fresh and migrated configurations are disabled by default and contain no closed-loop fields.",
        "Queued/running/retry_due v1 jobs can never acquire a v2 business lease.",
        "Migration is idempotent, preserves audit and valid repo binding, and never overwrites unknown schema.",
        "v2 records cannot store Issue body, prompt, transcript, raw model output, absolute path, or credentials.",
        "Known scheduler outcomes retain no-spin dispositions and lost-fence writes fail."
      ],
      "validation": [
        "npm run test:github-automation",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "Reusing schemaVersion=1 unions would allow a legacy unattended job to enter the new runner.",
        "Read-time migration without a lock could race config PATCH and lose repository bindings.",
        "Overwriting old job records would damage audit and make rollback ambiguous."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-02",
      "title": "Build the contained read-only evidence controller and strict model analyzer",
      "phase": "analysis",
      "order": 20,
      "dependsOn": ["GIA-00"],
      "dependencies": ["GIA-00"],
      "relation": "parallel",
      "files": [
        "lib/github-issue-analysis-types.ts",
        "lib/github-issue-analysis-evidence.ts",
        "lib/github-issue-analysis-model.ts",
        "lib/web-model-runtime.ts",
        "lib/model-price-assistant.ts"
      ],
      "instructions": [
        "Implement server-owned contained list/find/grep/read operations with the exact path, symlink, binary, directory, secret-like filename, file-count, byte, operation, and deadline limits in design.md.",
        "Use Node filesystem APIs only. Do not expose bash, edit, write, Git, network, project extensions/skills/context, subagents, or AgentSession.",
        "Resolve the root only from a validated Project Registry binding; normalize all model-requested paths to relative paths and reject escapes before I/O.",
        "Record a controller evidence ledger with opaque evidence id, relative path, verified line range, file hash, bytes, and supports/contradicts/context relation. Do not persist excerpts or absolute paths.",
        "Drive bounded strict JSON action rounds through provider-aware ModelRuntime.completeSimple, following the approved main-model policy. Validate exact keys/unions/lengths for every action and final result.",
        "Treat Issue text as untrusted claim data; it cannot choose root/model/budget/tool schema. Bound title/body in memory and mark truncation.",
        "Apply controller post-validation: non-bugs become not_applicable; missing evidence, unknown evidence ids, grep misses, truncation, budget exhaustion, provider errors, or invalid schema become inconclusive and can never close.",
        "Require explicit verified contradiction evidence and approved threshold for high-confidence not_exists. Keep reason/direction prose bounded and sanitize for comments.",
        "Expose readiness and stable safe reason codes only; raw provider/fs errors remain internal and unpersisted."
      ],
      "acceptance": [
        "Traversal, symlink, excluded directory, secret-like file, binary, and every budget overflow fail safely without path leakage.",
        "The analyzer creates no Session/Task/WorkTree and performs no write/command/network operation.",
        "A grep/find miss alone cannot produce not_exists; malformed/hallucinated evidence always degrades to inconclusive.",
        "Feature/docs/question are not_applicable rather than not_exists.",
        "All final evidence references reconcile to controller-observed ledger entries."
      ],
      "validation": [
        "npm run test:github-automation",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "Pi tool helpers may include write-capable definitions; do not reuse the full WorkTree Check tool bundle.",
        "Following symlinks before containment validation can expose same-user files outside the project.",
        "Static analysis cannot prove environment-specific runtime behavior; it must return inconclusive instead of executing repository code."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-03",
      "title": "Replace ingress and runner with the single opened-Issue analysis lifecycle",
      "phase": "runtime",
      "order": 30,
      "dependsOn": ["GIA-01", "GIA-02"],
      "dependencies": ["GIA-01", "GIA-02"],
      "relation": "serial",
      "files": [
        "lib/github-automation-runtime.ts",
        "lib/github-automation-scheduler.ts",
        "lib/github-issue-analysis-runner.ts",
        "lib/github-issue-analysis-close.ts",
        "lib/github-automation-comments.ts",
        "lib/github-automation-labels.ts",
        "lib/github-app-client.ts",
        "lib/github-automation-store.ts",
        "app/api/github-automation/webhook/route.ts"
      ],
      "instructions": [
        "Refactor webhook order to cap raw body, verify HMAC, parse/classify, exclusive-write, then return 202. Do not ensure a model/handler or mint installation tokens before signature verification.",
        "Only human issues.opened under enabled, unpaused, allowlisted repositoryId and exact installationId may enqueue. Every other event/action/actor is bounded audit-only with zero job/wake/mutation.",
        "Remove reopen generation, edited/closed lifecycle, issue_comment commands, pull_request reconciliation, and dynamic handler registration/default handler. Scheduler directly invokes one issue analysis handler.",
        "Fetch the current Issue into memory, compute title/body content hash and updatedAt, and never persist raw Issue text. Re-check content before remote effects.",
        "Persist validated analysis result/checkpoint once. Retry after result_ready must not rerun the model unless the result sidecar is missing/invalid, in which case fail closed rather than guess.",
        "Build and upsert one v3 kind=issue_analysis Markdown comment with deterministic sections and safe bounded relative evidence. Reuse semantic no-op and unknown-write remote reconcile.",
        "If classification labels are approved, mutate only YPI-owned type siblings; leave all user and historical lifecycle labels untouched.",
        "Implement close gating exactly as design.md: bug+not_exists+high+complete+contradiction+comment confirmed+content unchanged+fence+enabled+not paused. Establish the updatedAt baseline after comment/label effects because those may update the Issue.",
        "For unknown close PATCH result, GET Issue; never blindly repeat. Update the same canonical comment to completed closed or not-closed reason without repeating close.",
        "Return explicit dispositions for all success, inconclusive, wait, retry, block, and terminal outcomes."
      ],
      "acceptance": [
        "One human opened event produces at most one job, one validated analysis, one canonical comment, and at most one confirmed close effect.",
        "Self/Bot/comment/reopen/edit/close/label/PR webhooks produce no business job or wake, including repeated canonical comment edits.",
        "confirmed/inconclusive/not_applicable always remain open.",
        "Close never occurs after content change, truncation, budget exhaustion, missing contradiction, comment uncertainty, lost fence, disable, or pause.",
        "Unknown comment/close effects converge through read-back without duplicate writes or scheduler spin."
      ],
      "validation": [
        "npm run test:github-automation",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "GitHub comment/label writes can change Issue updatedAt; comparing only with the opened timestamp would disable or misclassify every close.",
        "GitHub Issue PATCH lacks a proven atomic content CAS in the current code; final GET narrows but does not eliminate TOCTOU.",
        "A cached analysis must be bound to the exact content hash and evidence ledger, not only repo/issue identity."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-04",
      "title": "Converge GitHub automation config, status, verify, jobs, and permission projections",
      "phase": "api",
      "order": 40,
      "dependsOn": ["GIA-01", "GIA-03"],
      "dependencies": ["GIA-01", "GIA-03"],
      "relation": "serial",
      "files": [
        "lib/github-automation-projection.ts",
        "lib/github-automation-setup-verify.ts",
        "lib/github-app-client.ts",
        "app/api/github-automation/config/route.ts",
        "app/api/github-automation/status/route.ts",
        "app/api/github-automation/verify/route.ts",
        "app/api/github-automation/jobs/[jobId]/route.ts",
        "app/api/github-automation/credentials/route.ts"
      ],
      "instructions": [
        "Remove machine assignee, P1 permissions, full-agent risk, mode/unattended, WorkTree/Session/PR fields and actions from wire types and route payloads.",
        "Report only Metadata read + Issues read/write capability. Keep fixed-host App JWT/installation token and safe credential source projections.",
        "Make config GET/PATCH expose v2 enabled, paused, analysis.maxConcurrency, safe repositories, revision, and Project Registry choices. Reject legacy fields, paths, secrets, tokens, model credentials, and unknown keys.",
        "Make verify check App credentials, installation, Issues permission, allowlist, project binding/readability, analysis model readiness, and webhook health. Keep it read-only with explicit zero side effects.",
        "Make status project minimal recent analysis fields: phase/status/category/verdict/confidence/completeness/comment/close/retry/time/safe reason. Never include Issue body, evidence excerpts, prompt, model raw output, path, Session, WorkTree, or PR.",
        "Keep job GET and only the retry POST action. Retry is state-gated/rate-limited and resumes the first unconfirmed checkpoint; remove pause/resume per-job semantics unless the approved UI explicitly reintroduces them as a product decision.",
        "Preserve Cache-Control no-store and recursive projection safety assertions. GET/status/verify must not wake the scheduler or run a model."
      ],
      "acceptance": [
        "The management API contains no claim/unattended/full-agent/Session/WorkTree/publisher/PR concept.",
        "Setup can become ready with only Metadata read and Issues read/write plus local project/model readiness.",
        "Config revision CAS and Project Registry server-side binding remain enforced.",
        "Verify and all GET routes are side-effect free; job retry cannot accept phase/repo/policy/token/command input.",
        "Every response is no-store and passes privacy/forbidden-key scanning."
      ],
      "validation": [
        "npm run test:github-automation",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "Retaining old projection defaults can make the UI believe an Agent or PR exists.",
        "Model readiness must not expose provider credentials or trigger an unbounded network refresh from status GET.",
        "Removing repository fields from wire parsing without v1 migration can make existing bindings disappear."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-05",
      "title": "Rebuild GithubAutomationConfig from the approved analysis-only prototype",
      "phase": "ui",
      "order": 50,
      "dependsOn": ["GIA-01", "GIA-04"],
      "dependencies": ["GIA-01", "GIA-04"],
      "relation": "parallel",
      "files": [
        "components/GithubAutomationConfig.tsx",
        "components/SettingsConfig.tsx",
        "components/SettingsTreeNavigation.tsx",
        "app/globals.css",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Implement only after the user-approved task-local HTML exists; preserve the current Settings modal/root-leaf and immediate-save conventions unless the prototype says otherwise.",
        "Keep local credential save/rotate/remove and env-name-only advanced disclosure without revealing any saved value/path/fingerprint.",
        "Replace setup checklist, repository form, runtime controls, safety copy, and recent jobs with the exact approved analysis-only IA.",
        "Remove Assignee, claim, Owner commands, mode segmented control, unattended/full-agent risk, WorkTree/Session/Agent/validation/publish/PR facts and filters.",
        "Use only server-safe projections and actions. Stale snapshots remain readable but disable mutations; revision conflicts refresh safely.",
        "Explain that local projects are read-only evidence sources, no code/PR is produced, inconclusive remains open, and only strict high-confidence contradiction may close.",
        "Retry only unresolved stages and must not imply model/comment/close replay. Cover loading, missing credentials/allowlist/project/model, enabled/paused, all job outcomes, <=640px, <=390px, keyboard, focus, and reduced motion.",
        "Do not add config fields or UI decisions absent from the approved prototype; route product ambiguities back to the main session."
      ],
      "acceptance": [
        "The rendered Settings view matches the approved HTML hierarchy, states, copy, and responsive behavior.",
        "No obsolete closed-loop term or control remains visible.",
        "Credential transient values are cleared on success/delete/mode switch/unmount and never re-rendered.",
        "Stale/revision conflict/retry behavior is truthful and accessible.",
        "Global Settings Save/Reset remains disabled for this immediate-save leaf."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:github-automation",
        "Manual compare against approved HTML at desktop, <=640px, and <=390px",
        "git diff --check"
      ],
      "risks": [
        "Incrementally hiding old sections in a 4,500-line component may leave stale types/actions; prefer a deliberate analysis-only rewrite within the existing Settings shell.",
        "Auto-close wording can overstate certainty or hide the local-snapshot residual risk.",
        "Responsive CSS removal can affect unrelated Settings selectors if github-automation classes are not scoped."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-06",
      "title": "Remove the claim-to-PR execution graph without deleting shared Studio and checker foundations",
      "phase": "retirement",
      "order": 60,
      "dependsOn": ["GIA-03", "GIA-04"],
      "dependencies": ["GIA-03", "GIA-04"],
      "relation": "parallel",
      "files": [
        "lib/github-machine-assignee.ts",
        "lib/github-owner-intent.ts",
        "lib/github-full-agent-profile.ts",
        "lib/github-automation-handler-runtime.ts",
        "lib/github-automation-notification.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-session.ts",
        "lib/github-automation-worktree.ts",
        "lib/github-git-publisher.ts",
        "lib/github-pr-lifecycle.ts",
        "lib/github-risk-policy.ts",
        "lib/github-diff-policy.ts",
        "lib/github-pr-contract.ts",
        "lib/github-validation-broker.ts",
        ".pi/skills/github-issue-auto-implement/SKILL.md",
        ".pi/skills/github-issue-triage/SKILL.md",
        ".pi/skills/submit-pr/SKILL.md",
        ".pi/skills/pr-review-handle/SKILL.md",
        "package.json",
        "scripts/test-github-unattended.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-publish-policy.mjs",
        "scripts/test-github-handler-runtime.mjs",
        "scripts/test-github-session-bootstrap.mjs",
        "scripts/verify-github-automation-30142.mjs"
      ],
      "instructions": [
        "Run repository-wide import/reference searches, remove callers first, then delete closed-loop-only modules and scripts. Do not leave dead shims that can still execute Agent/Git/publisher paths.",
        "Remove github-issue-auto-implement. Update manual github-issue-triage so it no longer assumes automation claims/assignees/Owner adoption and does not conflict with a live issue_analysis job/comment.",
        "Keep historical automation PR review rules self-contained where needed, but remove dependencies on deleted runtime files and do not imply new automation PRs will be created.",
        "Remove obsolete package scripts and 30142 acceptance contract. Rewrite the surviving test:github-automation entry for the new suite.",
        "Explicitly preserve worktree-check-policy/execution/extension/cli-extension, ypi-studio-child-session-runner, YPI Studio modules, Project Registry, agent-session-bootstrap, and agent-session-bootstrap-errors.",
        "Preserve string-valued historical Studio provenance such as github-owner-intent if it is part of persisted compatibility; deleting a runtime module does not justify rewriting old task records.",
        "Do not delete historical durable files or remote labels/comments/assignees/PRs/branches/WorkTrees/Sessions."
      ],
      "acceptance": [
        "No production import or route can reach machine assignee, Owner command, Agent/Session/WorkTree, checker/validation, Git publisher, or PR lifecycle code.",
        "Old package scripts and auto-implement skill are removed or accurately retired.",
        "WorkTree Check package assets and Studio SDK runner still exist and pass focused tests.",
        "agent-session-bootstrap-errors remains used by generic agent-session-bootstrap.",
        "Historical data/PR review compatibility is documented without re-enabling execution."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:package-assets",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "Deleting worktree-check or Studio runner because they appeared in GitHub unattended imports would break unrelated product features.",
        "Deleting github-pr-contract without updating review Skills would leave broken documentation references for historical PRs.",
        "Leaving one route/import behind can preserve the dangerous old capability despite UI removal."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-07",
      "title": "Replace old GitHub suites with analysis, migration, privacy, and no-loop regressions",
      "phase": "tests",
      "order": 70,
      "dependsOn": ["GIA-03", "GIA-04", "GIA-06"],
      "dependencies": ["GIA-03", "GIA-04", "GIA-06"],
      "relation": "serial",
      "files": [
        "scripts/test-github-automation.mjs",
        "package.json",
        "lib/github-issue-analysis-types.ts",
        "lib/github-issue-analysis-evidence.ts",
        "lib/github-issue-analysis-model.ts",
        "lib/github-issue-analysis-runner.ts",
        "lib/github-automation-runtime.ts",
        "lib/github-automation-store.ts",
        "lib/github-automation-scheduler.ts",
        "lib/github-automation-comments.ts",
        "lib/github-automation-projection.ts"
      ],
      "instructions": [
        "Rewrite test:github-automation around the full matrix in checks.md using temporary PI_CODING_AGENT_DIR, temporary repositories, fake ModelRuntime, and mocked GitHub fetch only.",
        "Cover every ingress actor/action, duplicate delivery and distinct-delivery same-Issue concurrency, HMAC/body limits, and zero wake/mutation for non-opened events.",
        "Cover traversal/symlink/secret/binary/excluded-directory/budget limits and verify no absolute temp root leaks.",
        "Cover strict model action/final schemas and every safe downgrade, especially grep miss, unknown evidence id, truncation, and non-bug not_applicable.",
        "Cover comment semantic no-op/duplicate authority/unknown reconcile and the complete close negative matrix including updatedAt-after-comment behavior and lost fences.",
        "Cover v1 config migration disabled, v1 job retirement/no lease, retry checkpoint resume, bounded backoff, and no-spin finite ticks.",
        "Add recursive forbidden-key/value and sentinel scans across store files, safe events, comments, and API projections.",
        "Add source/capability assertions that the new runtime does not import AgentSession, Studio, WorkTree, bash/edit/write, machine credentials, publisher, or Links/PAT auth.",
        "Keep generic WorkTree Check/Studio/package tests separate and green; do not absorb them into the GitHub suite."
      ],
      "acceptance": [
        "All checks.md automated matrices have positive and negative coverage.",
        "Tests make zero real GitHub/provider calls and never inspect the operator agent dir.",
        "A repeated self-comment webhook cannot increase job count or model calls.",
        "A retry from each effect checkpoint cannot duplicate validated analysis, comment, or close.",
        "The suite proves v1 jobs are inert and shared Studio/checker foundations remain functional."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:worktree-check",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:package-assets",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "Source-string assertions alone cannot prove runtime behavior; pair them with full mocked control-flow tests.",
        "Mock Issue updatedAt behavior must include comment/label side effects or the close gate will be falsely green.",
        "A fake model that returns only valid JSON misses downgrade and leakage paths."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GIA-08",
      "title": "Update durable documentation and complete checker plus UAT gates",
      "phase": "docs-check",
      "order": 80,
      "dependsOn": ["GIA-05", "GIA-07"],
      "dependencies": ["GIA-05", "GIA-07"],
      "relation": "barrier",
      "files": [
        "AGENTS.md",
        "docs/architecture/overview.md",
        "docs/integrations/README.md",
        "docs/integrations/github-app-automation-setup.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md",
        "README.md",
        ".pi/skills/github-issue-triage/SKILL.md",
        ".pi/skills/submit-pr/SKILL.md",
        ".pi/skills/pr-review-handle/SKILL.md"
      ],
      "instructions": [
        "Rewrite architecture/setup/deployment/troubleshooting/module maps for opened-only analysis, v3 comment, four verdicts, read-only local evidence, strict close, migration/retirement, and minimal App permissions/events.",
        "Remove current-product instructions for Assignee, ypi:claimed, Owner commands, unattended/full agent, Contents/PR permissions, WorkTree/Session/publisher, and 30142. Keep clearly labeled historical PR handling only where operators still need it.",
        "Update AGENTS.md navigation/module entries without turning it into a detailed design document; keep WorkTree Check and GitHub analysis as separate boundaries.",
        "Document that App mutations use only installation identity; Links/PAT/gh remain unrelated. Document the local-checkout freshness and final-GET TOCTOU limitations honestly.",
        "Run every automated command, import/deletion scan, approved-prototype UI checklist, and safe projection privacy review in checks.md.",
        "Perform real GitHub UAT only with a dedicated test App/repo after user decisions are approved. Do not run auto-close UAT when state_reason, contradiction threshold, or local-snapshot authority remains unresolved.",
        "Record any unexecuted live UAT as a release blocker; do not mark it passed from mocked tests."
      ],
      "acceptance": [
        "Docs, Skills, AGENTS, API/component/module maps, and runtime describe the same analysis-only product.",
        "The UI passes the approved HTML comparison and all manual states/responsive checks.",
        "Focused tests, generic Studio/checker regressions, lint, tsc, and diff-check pass.",
        "Any real UAT not executed is explicitly listed as remaining risk/release blocker.",
        "No commit, push, merge, real PR, or production Issue mutation was performed outside approved UAT."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:worktree-check",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:package-assets",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check",
        "Run the reference/deletion scans in checks.md",
        "Complete the approved HTML manual checklist and dedicated test-App UAT or record blockers"
      ],
      "risks": [
        "Stale operator docs could cause customers to keep unnecessary Contents/PR permissions or expect old Owner commands.",
        "Mock-only green cannot validate live GitHub comment updatedAt and close behavior.",
        "Aggressive documentation cleanup must not erase historical audit/recovery guidance before v1 retirement is understood."
      ],
      "parallelizable": false,
      "member": "checker",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```
