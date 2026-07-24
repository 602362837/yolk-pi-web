# review — project/space session 列表性能优化

**Task:** `20260724-090218-排查并优化-session-列表与相关入口的加载性能-项目-设置-模型`  
**Reviewer:** checker（检查员）  
**Verdict:** **Pass**  
**Date:** 2026-07-24

## Scope reviewed

对照 `plan-review.md` / `prd.md` / `design.md` / `implement.md` / `checks.md`、用户批准的方案 B，以及实现员 PSI-01…07 交付物与当前工作区 diff。

本任务**不触发 UI HTML 原型门禁**（`ui.md`）：无 Sidebar 结构/字段/loading/stale/partial 变更。

## Check Complete

### Findings Fixed

1. **`message_end` / `agent_end` / fork 后只清全局 1s 缓存，未清 project-space 5s response snapshot**
   - 现象：`lib/rpc-manager.ts` 在摘要变化点调用 `invalidateSessionListSnapshots()`，而 space route 的 5s snapshot 挂在 `globalThis.__piProjectSpaceSessionListSnapshots`，仅由 `invalidateProjectSpaceSessionListCaches()` 清理。
   - 风险：热路径在 5s TTL 内可能返回旧 `messageCount/firstMessage/name`（stat fingerprint 仅在 snapshot 未命中时兜底）。
   - 修复：rpc-manager 改为调用 `invalidateProjectSpaceSessionListCaches()`（同时清全局 + space snapshot），并移除未再使用的 `invalidateSessionListSnapshots` 导入。
   - 文件：`lib/rpc-manager.ts`

### Remaining Findings

#### 阻塞

None.

#### 非阻塞 / 残余风险

1. **跨 space header 改绑的“对方 index best-effort upsert”未做**
   - 设计 §6.1：header 链接到其他 space 时，当前 index 移除 + 对方 best-effort upsert。
   - 实现：`validateCandidate` 对 `relinked_elsewhere` 仅 drop；重建后当前 space 的 complete index 不再含该项（正确），但不会主动写对方 index。
   - 影响：对方 space 通常仍可由 directed cwd / 低频 full reconcile / 下次 recovery 收敛；不会在当前 space 静默漏项或串 space。
   - 建议：可选 follow-up；不阻塞本任务验收。

2. **未做真实浏览器 main/worktree 切换 smoke**
   - 自动化覆盖 route 契约、lifecycle、scale fixture 与 bench；Sidebar 成功 body 未改。
   - 建议：合并前由主会话或人工做一次 Sidebar 切换/新建/fork/rename/archive 轻量 smoke。

3. **工作区混入无关 diff（Links GitHub OAuth 默认 Client ID）**
   - `lib/github-link-oauth.ts`、`docs/deployment/README.md`、`docs/integrations/README.md`、`scripts/test-links.mjs` 等与本任务无关。
   - 不计入本功能失败；提交/PR 时应拆分或排除，避免污染本任务变更集。

4. **`/api/models` 仍有 provider/runtime 冷启动噪声**
   - bench 已证明 session 列表并发不再带来 10s 级等待；models 隔离波动属 Phase 2（任务范围已声明）。

### Verification

| Command | Result |
| --- | --- |
| `npm run test:project-space-session-index -- --group all` | **54 passed, 0 failed** |
| `npm run test:session-title` | **passed** |
| `npm run test:studio-child-sessions` | **all passed** |
| `npm run lint` | **0 errors**（11 既有 warnings，与本任务无关） |
| `node_modules/.bin/tsc --noEmit` | **EXIT 0** |
| `npm run bench:project-space-sessions -- --samples 30 --warmup 1` | **All hard gates passed** |

#### Bench evidence（本机复跑）

Fixture: `totalSessions=320`, `totalChildren=180`, `targetRoots=22`, `targetChildren=60`, `uniqueTasks=3`  
Machine: darwin arm64, node v26.0.0

| Metric | Result | Gate |
| --- | --- | --- |
| warm P50 | 40.5ms | ≤ 500ms PASS |
| warm P95 | 57.4ms | ≤ 1.5s PASS |
| cold P95 | 44.3ms | ≤ 5s PASS |
| cold max | 48.9ms | < 10s PASS |
| inventoryGlobalCalls (warm/cold) | 0 | =0 PASS |
| studioProjectionCalls ≤ uniqueLinkedTasks | 90≤90 | PASS |
| concurrent recovery single-flight | recoveryRuns=1 | PASS |
| related web-config / models-config added P95 | ~0ms | no 10s-class PASS |
| related models added P95 | 负值（基线更冷） | no 10s-class PASS |

### Requirements coverage（checks.md 摘要）

| 项 | 结论 |
| --- | --- |
| R1 space 独立落点 main/worktree 各自 `.ypi/sessions/index.v1.json` | **Pass** — store + tests |
| R2 JSONL 真相不变、未迁移/重写 | **Pass** |
| R3 热路径定向读取，非全局 inventory | **Pass** — route 默认 `listSessionsForProjectSpace`；`inventoryGlobalCalls=0` |
| R4 完整性优先；无 partial 200；503 rebuilding | **Pass** — recovery tests + route mapping |
| R5 外部同 cwd 发现；legacy 仅 `includeLegacy=1` | **Pass** |
| R6 生命周期 create/fork/child/rename/archive/unarchive/delete/cwd cleanup/relink | **Pass** — hooks + lifecycle tests；message/agent end 已补 space snapshot 失效 |
| R7 Studio child 筛选后 batch、unique task 界 | **Pass** |
| R8 gitignore 仅 `/.ypi/sessions/` + 目录内 `*` | **Pass** |
| R9 single-flight / 锁 / 原子写 / 缓存失效 | **Pass**（含本轮 rpc-manager 修复） |
| R10 性能与 content-safe timing | **Pass** |
| R11 设置/模型无 10s 级间接阻塞 | **Pass**（models 独立冷启动 → Phase 2） |
| R12 旧 sidecar 只读停写 + feature flag 回滚 | **Pass** — `upsertProjectSessionIndexEntry` no-op；`PI_WEB_PROJECT_SPACE_SESSION_LIST` |
| UI 门禁 | **Pass** — 无可见结构/状态变更，无需 HTML 原型 |
| 文档 PSI-07 | **Pass** — overview/api/library/frontend/troubleshooting/AGENTS 已更新 |

### Architecture / safety notes

- Index 仅候选/摘要；每个返回项经 active-root containment、regular file、header id/project/space 校验。
- `sessionFile` 仅允许 agentDir-relative `sessions/.../*.jsonl`；拒绝 absolute / `..` / URL / archive。
- 旧 `pi-web-session-index.json` 只作 migration seed；新 mutation 不再双写。
- 回滚：`PI_WEB_PROJECT_SPACE_SESSION_LIST=0|false|off|legacy` → 旧 `listAllSessions()` 过滤路径；JSONL 无迁移。
- Chat top-bar `GET /api/sessions/:id/studio-children` 仍可用全局路径 — 与本 route 解耦，文档已区分。

## Verdict

**Pass**

方案 B 已完整落地：space-local index、定向热路径、完整性优先恢复、lifecycle 维护、筛选后 Studio batch projection、测试/基准与文档均满足验收门禁。检查员修复了一处低风险 snapshot 失效遗漏；无阻塞项。主会话可收尾任务（勿将无关 Links OAuth diff 一并混入本功能提交）。
