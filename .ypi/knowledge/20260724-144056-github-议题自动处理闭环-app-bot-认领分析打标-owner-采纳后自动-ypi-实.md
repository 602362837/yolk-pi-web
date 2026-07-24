# GitHub 议题自动处理闭环：App Bot 认领分析打标 + owner 采纳后自动 YPI 实现并提 PR

- Task: 20260723-151625-github-议题自动处理闭环-app-bot-认领分析打标-owner-采纳后自动-ypi-实
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260723-151625-github-议题自动处理闭环-app-bot-认领分析打标-owner-采纳后自动-ypi-实
- Archived at: 2026-07-24T06:40:56.590Z
- Tags: studio, feature-dev

## Summary
## 交付结论 P0–P2 代码与文档已按修订并批准的 plan 落地；**GHA-11 自动化验证全部通过**。 **真实 test-App / 公网 HTTPS / 可控 machine assignee 的 live UAT 未执行**，按 checks 为 **真实仓库 P1 启用前的 release blocker**，不伪造通过。 ## 分期结果 | 分期 | 状态 | 说明 | | --- | --- | --- | | P0 | 可独立发布（自动化） | App webhook、label+machine-assignee 完整认领、triage、owner intent；采纳只到 `accepted_waiting_automation` | | P1 | 默认关闭；自动化门禁通过 | owner-only + complete claim → full agent docs/small-bugfix → server App publisher 唯一 `Fixes #N` PR；不 auto-merge | | P2 | 自动化/代码审查通过 | PR lifecycle、safe status/config/job APIs、Settings 投影与 full-agent 常驻风险 warning | ## 关键验收（对照 checks） 1. **Claim**：成功 = `ypi:claimed` + Issue 回读 machine login assignee；2xx silent-ignore / credential 失败 → `blocked_claim_assignee`，不保留假 claimed。 2. **身份**：App 负责 mutation/publisher；本机 credential 仅解析 assignee；无 Links/PAT fallback。 3. **P1**：interactive Studio grant 不变；automation 用 internal policy grant；UI/高风险 fai…

## Reusable knowledge
### summary.md

# Summary：GitHub 议题自动处理闭环

## 交付结论

P0–P2 代码与文档已按修订并批准的 plan 落地；**GHA-11 自动化验证全部通过**。  
**真实 test-App / 公网 HTTPS / 可控 machine assignee 的 live UAT 未执行**，按 checks 为 **真实仓库 P1 启用前的 release blocker**，不伪造通过。

## 分期结果

| 分期 | 状态 | 说明 |
| --- | --- | --- |
| P0 | 可独立发布（自动化） | App webhook、label+machine-assignee 完整认领、triage、owner intent；采纳只到 `accepted_waiting_automation` |
| P1 | 默认关闭；自动化门禁通过 | owner-only + complete claim → full agent docs/small-bugfix → server App publisher 唯一 `Fixes #N` PR；不 auto-merge |
| P2 | 自动化/代码审查通过 | PR lifecycle、safe status/config/job APIs、Settings 投影与 full-agent 常驻风险 warning |

## 关键验收（对照 checks）

1. **Claim**：成功 = `ypi:claimed` + Issue 回读 machine login assignee；2xx silent-ignore / credential 失败 → `blocked_claim_assignee`，不保留假 claimed。
2. **身份**：App 负责 mutation/publisher；本机 credential 仅解析 assignee；无 Links/PAT fallback。
3. **P1**：interactive Studio grant 不变；automation 用 internal policy grant；UI/高风险 fail-closed。
4. **Full agent**：明确非 sandbox；App/machine secret 不主动注入；publisher server-only。
5. **PR**：固定 same-repo `Fixes #N`、无 force/main 直推、未知结果 remote reconcile、不自动 merge。
6. **UI**：App readiness ≠ assignee readiness；profile=文档+小 bugfix；execution=full agent；无 secret 输入/reveal。

## 验证命令（均 exit 0）

- `npm run test:github-automation` — 60 pass  
- `npm run test:github-unattended` — 17 pass  
- `npm run test:github-publish-policy` — 23 pass（附加）  
- `npm run test:github-unattended-runner` — 13 pass（附加）  
- `npm run test:studio-policy|dag|session-ownership|sdk-runner` — pass  
- `npm run test:links` — 84 pass  
- `npm run lint` — 0 errors（11 pre-existing warnings，与本功能无关）  
- `node_modules/.bin/tsc --noEmit` — pass  

## Live UAT（未跑 = blocker）

缺 owner 提供的：测试 App、测试 repo、可控 active machine 账号、公网 HTTPS webhook 入口。  
在补齐并完成 checks §4 人工验收前，**不得对真实 allowlist 仓库开启 P1

### handoff.md

# Handoff：GHA-11 integrated validation complete

## Subtask

- **ID**: GHA-11  
- **Title**: Run integrated product, identity, security, UI, and rollback validation  
- **Role**: implementer (validation barrier only; no feature expansion)  
- **Git**: no commit / push / merge  

## What was done

1. Ran implement.md / checks required automated suites (plus related GHA publish/runner suites).  
2. No GHA-related failures; **no production code changes** in this barrier.  
3. Checker-style audit against checks.md / design (claim, identity, policy, full-agent risk, publisher, UI, rollback).  
4. Wrote `summary.md`, `review.md`, this `handoff.md`.  

## Validation results

| Command | Result |
| --- | --- |
| `npm run test:github-automation` | **pass** 60/60 |
| `npm run test:github-unattended` | **pass** 17/17 |
| `npm run test:github-publish-policy` | **pass** 23/23 (extra) |
| `npm run test:github-unattended-runner` | **pass** 13/13 (extra) |
| `npm run test:studio-policy` | **pass** |
| `npm run test:studio-dag` | **pass** |
| `npm run test:studio-session-ownership` | **pass** |
| `npm run test:studio-sdk-runner` | **pass** |
| `npm run test:links` | **pass** 84/84 |
| `npm run lint` | **pass** (0 errors; 11 pre-existing warnings, unrelated paths) |
| `node_modules/.bin/tsc --noEmit` | **pass** |
| Manual test-App webhook → claim → unmerged PR + Settings matrix | **NOT RUN** |

## Acceptance checklist (GHA-11)

| Criterion | Status |
| --- | --- |
| P0 independent; claim = `ypi:claimed` + machine assignee read-back | **Met** (automated) |
| P1 only after complete claim + owner auth; docs + small bugfix | **Met** (automated) |
| Full agent path; App publisher credentials server-owned | **Met** (automated + sentinel) |
| Product/docs/UI retain arbitrary command/network/hos

### review.md

# Check Complete — GitHub 议题自动处理闭环

**Auditor:** checker（YPI Studio member）  
**Date:** 2026-07-23  
**Task:** `20260723-151625-github-议题自动处理闭环-app-bot-认领分析打标-owner-采纳后自动-ypi-实`  
**Scope:** Full integrated review against prd / design / implement / checks / plan-review / ui / HTML prototype and approved product decisions.  
**Git:** no commit / push / merge; **no production code changes** in this checker pass.

## Findings Fixed

None. 自动化与静态审查未发现需要检查员当场修复的致命一致性缺陷。

## Remaining Findings

### Blocking for real-repo P1 enablement（产品/运维，非代码返工）

1. **Live UAT not run — RELEASE BLOCKER for production P1**  
   缺 owner 提供的：测试 GitHub App、测试 allowlist repo、可控 active machine `gh`/git credential（可 assign）、公网 HTTPS webhook 入口。  
   在 checks §4 人工矩阵完成前，**不得**对真实 allowlist 仓库设置 `unattended.enabled=true`。  
   这不否定代码/自动化门禁通过；它是启用前的发布门禁。

### Non-blocking

1. **Full agent residual host risk（产品已接受）**  
   full agent 可任意命令、联网、读取同 OS 用户可见文件并产生 diff 外副作用；WorkTree / final diff gate 不是 sandbox。文档、Settings、Skills、profile 均明确声明。推荐专用低权限 OS 账号/容器，但本期不声称 host isolation。

2. **Mocks vs real GitHub**  
   自动化大量使用 mocked GitHub / local remote；真实 branch protection、App permission 边界、credential helper 跨平台差异仍需 live UAT 覆盖。

3. **Pre-existing lint warnings**  
   `npm run lint` 0 errors / 11 warnings，均在无关路径（archive / ChatMinimap / OAuth credential transactions / model-prices test），与本功能无关。

## Audit against approved product decisions

| Decision | Verdict | Evidence |
| --- | --- | --- |
| 1. 认领 = `ypi:claimed` + 本机 gh/git 凭据 assignee **回读** | **Pass** | `isCompleteClaimFacts` requires login + assigneeReadBack + labelReadBack + triage comment; assign 2xx silent-ignore → `blocked_claim_assignee`; incomplete removes Bot-managed claimed / may set `ypi:claim-blocked` (`lib/github-issue-triage-runner.ts`, `l

### checks.md

# Checks：GitHub议题自动处理闭环

## 1. 需求覆盖检查

### App / webhook / identity

- [ ] webhook、评论、labels、assignment mutation、push、PR均为GitHub App installation身份。
- [ ] 本机active `gh`/git credential用户只作为assignee；个人credential不作为App失败fallback。
- [ ] resolver优先active `gh`，fallback只到固定github.com credential + canonical `/user`；不从git name/email猜login。
- [ ] personal/App credential均不进入argv、日志、store、task/session、agent env或UI。
- [ ] raw body在parse前验签；repo按immutable id allowlist；webhook快速202。

### 完整认领 / triage / owner

- [ ] `claimed`同时要求`ypi:claimed`和Issue回读含machine login assignee；lease/comment是审计与幂等证据。
- [ ] App bot不被描述为assignee；评论清楚区分“App处理”和“@machine-login认领展示”。
- [ ] assign 2xx后必须回读；GitHub静默忽略不能算成功。
- [ ] credential缺失/失效、多账号无active、不可assign或权限不足进入`blocked_claim_assignee`。
- [ ] incomplete claim不保留Bot管理的`ypi:claimed`，可用`ypi:claim-blocked`，且不进入owner采纳/实现。
- [ ] retry先reconcile assignee/label/comment，最终无重复或假成功。
- [ ] labels只管理批准catalog；不删除用户labels。
- [ ] 只有owner actor id + 明确肯定语义触发；非owner、bot、quote/code、否定、暂缓、疑问均不触发。

### Studio policy / scope

- [ ] automation使用internal-only policy evidence，不伪造interactive grant。
- [ ] grant绑定完整claim、repo/issue/owner comment/policy/plan/scope/expiry；revision变化失效。
- [ ] 允许范围明确为文档 + 小bugfix，不再是docs-only。
- [ ] 小bugfix要求目标清晰、局部、低风险、无需新产品决策、在文件/行数上限内且有针对性验证。
- [ ] UI/交互、大重构、workflow/release、secret/auth、dependency/lockfile、infra、跨repo、binary/symlink/submodule、超限/不确定范围blocked。
- [ ] UI工作仍转interactive HTML审批；full agent不绕过该门禁。

### WorkTree / full agent

- [ ] root只来自config + Project Registry，不来自webhook/Issue。
- [ ] owner授权、完整claim、repo allowlist和pre-policy均在full agent启动前通过。
- [ ] 使用标准full agent，不把restricted runtime作为发布硬门禁。
- [ ] App key/JWT/token、webhook secret和machine credential不主动注入agent prompt/context/task/session/env。
- [ ] agent拿不到server publisher capability；b

### design.md

# Design：GitHub App Bot → 完整认领 → Owner采纳 → Full Agent → PR

## 1. 方案摘要

```text
GitHub App webhook
  → raw HMAC / repo allowlist / delivery store
  → durable scheduler + per-Issue lease
  → P0 claim readiness
      ├─ local credential resolver → machine GitHub login
      ├─ App assign(login) + read-back
      ├─ ensure ypi:claimed
      └─ App triage labels + 中文comment
  → owner actor + affirmative intent
  → internal policy authorization
  → P1 WorkTree + durable Studio + full agent
  → plan/final policy + checker/validation
  → server-owned App commit/push/PR
  → Fixes #N → P2 PR lifecycle/reviewer closure
```

身份分工：

| 身份 | 允许职责 | 禁止职责 |
| --- | --- | --- |
| GitHub App installation | webhook、labels、评论、assign API、push、PR | 冒充owner批准、自动merge/release |
| 本机active GitHub用户 | 作为Issue Assignee显示；凭据仅用于解析/验证login | Bot评论、push/PR fallback、把token交给LLM |
| owner actor | 用评论授权是否开始实现 | 直接提供路径/命令/policy/token |
| full agent | 在WorkTree中规划、实现、检查文档与小bugfix | 直接取得App publisher capability；是否发布仍由server gate决定 |

## 2. GitHub App、机器assignee与最小权限

### 2.1 Server-only App配置

- `YPI_GITHUB_APP_ID`
- `YPI_GITHUB_APP_PRIVATE_KEY_FILE`（0600）
- `YPI_GITHUB_APP_WEBHOOK_SECRET`
- 可选 `YPI_GITHUB_APP_SLUG`

App key/secret不进`pi-web.json`、Links、task/session或浏览器。App JWT与installation token只在server内存/短期askpass channel。

### 2.2 Assignee身份解析

不创建新的“展示机器号”绑定流程。每个仓库在readiness/retry时解析本机已绑定GitHub用户：

1. 优先固定执行`gh api user --jq .login`（active account）；用`gh auth status`区分未登录、多账号无active、host错误。
2. 若`gh`不可用，可对固定`https://github.com`执行`git credential fill`，只在内存读取username/password，使用credential临时调用固定`GET https://api.github.com/user`解析canonical login。
3. 禁止把`git config user.name`、email或credential username直接当canonical login。
4. token/password不写argv、日志、store、task/session或agent env；resolver完成后清除buffer。只允许持久化安全login、

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
