# Review：侧栏 session 列表热路径移除归档读取与展示

**Reviewer:** checker（检查员）  
**Subtask:** REV-01  
**Date:** 2026-07-13  
**Verdict:** **Pass**

## Scope Reviewed

对照 `plan-review.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / HTML 原型，审阅工作区 diff：

| File | Change summary |
| --- | --- |
| `app/api/projects/.../sessions/route.ts` | 移除 `scanArchivedCwds` import、archive timing/count、`archivedCounts` 响应字段 |
| `app/api/sessions/route.ts` | 移除 archive 扫描；响应收敛为 `{ sessions }` |
| `components/SessionSidebar.tsx` | 删除 archived state/loader/effect/section/`ArchivedSessionItem`/unarchive；保留 archive 写动作 |
| `docs/modules/api.md` | 契约与诚实性能边界已更新 |
| `docs/modules/frontend.md` | Sidebar 无归档浏览入口已更新 |
| `docs/architecture/overview.md` | Archive path 与 active/explicit 分离已更新 |
| `package-lock.json` | **无关** typescript 版本钉死（见 low） |

未改：`lib/session-reader.ts` archive helpers、archive/unarchive/archive-all/archived routes、Usage `includeArchived` 实现。

## Requirements Coverage

| FR / 验收点 | 结论 |
| --- | --- |
| FR-1 热路径零归档扫描 | **Pass** — project-space 与 global list 均不再 import/call `scanArchivedCwds`；响应无 `archivedCounts`/`archivedCwds` |
| FR-2 侧栏只展示 active | **Pass** — 无“已归档 (N)”区块、归档行、恢复入口；空态仅看 `filteredSessions.length === 0` |
| FR-3 归档动作可用 | **Pass** — single/batch/archive-all 仍 POST 既有 API；成功后仅 `loadSessions(false)`；archive-all 计数为 `filteredSessions.length` |
| FR-4 低频归档能力保留 | **Pass** — routes/helpers/Usage 路径仍在；`scanArchivedCwds` 函数保留于 `session-reader` |
| FR-5 文档与验证 | **Pass** — 三份模块/架构文档与实现一致；lint/tsc 通过；目标符号检索干净 |
| 不扩 scope 改 active inventory | **Pass** — 仍 `listAllSessions()` 后 filter；无 index/cache/定向扫描重构 |
| UI 原型一致性 | **Pass（小差异见 low）** — 信息结构删除与计数口径一致；确认框第二句文案略短于原型 |

## Code Review Notes

### API

- Project-space body 现为 `{ sessions, legacyUnassigned, studioChildrenByParentSessionId }`，**不保留**空 `archivedCounts` 兼容壳，符合设计。
- Global `GET /api/sessions` 仅 `{ sessions }`；仓内 `bin/ypic.js` 只读 `body.sessions`，兼容。
- Active 过滤、legacy、Studio child 嵌套逻辑未被动到。

### Frontend

- 归档展示相关 state/effect/component 一次性删除，无半删除残留。
- `rg`：`components`/`hooks` 无 `/api/sessions/archived` 调用。
- archive 写路径：`handleArchiveSession` / batch / all 均成功后 `loadSessions(false)`。
- archive-all 文案：`确认归档 N 个当前会话？`，N=`filteredSessions.length`，不再加已有归档数。

### Docs

- 明确 Sidebar 无归档浏览、global 字段删除、active 全量扫描仍存在；保留显式 archive/Usage 能力说明。
- `docs/research/session-archive-design.md` 仍含旧字段描述——属研究档案，设计允许不改。

### Non-goals / boundary

- **不因** active `listAllSessions()` 全量扫描残余长尾判 fail。
- 本变更只保证去掉 archive 热路径 I/O 与侧栏归档投影。

## Findings Fixed

None（检查员未改生产代码，按任务要求只 review）。

## Remaining Findings

### Blocker

None.

### High

None.

### Medium

None.

### Low

1. **Archive-all 确认文案与 HTML 原型略有差异**  
   原型/ design 建议：`确认归档 N 个当前会话？归档后仍可通过保留的 API/已知链接恢复。`  
   实现：`确认归档 N 个当前会话？`  
   计数口径正确，不暗示处理已有归档；不阻塞。若要像素级对齐原型可补第二句（不得承诺侧栏恢复入口）。

2. **`package-lock.json` 无关变更**  
   `typescript` 从 `^5.9.3` 钉为 `5.9.3`。与本任务无关，提交前建议还原或单独处理，避免污染本功能 diff。

## Capability Regression Check

| Capability | Status |
| --- | --- |
| `POST /api/sessions/archive` | 保留；Sidebar 仍调用 |
| `POST /api/sessions/archive-all` | 保留；Sidebar 仍调用 |
| `POST /api/sessions/unarchive` | 路由保留；Sidebar 不再暴露 UI（产品取舍） |
| `GET /api/sessions/archived` | 路由保留；Sidebar 不调用 |
| `GET /api/sessions/[id]` archived detail | 未改；docs 仍说明只读详情 |
| `scanArchivedCwds` / `listArchivedSessionsForCwd` / `listAllArchivedSessions*` | `lib/session-reader.ts` 保留 |
| Usage `includeArchived` | `lib/usage-stats.ts` + settings/API 未改 |
| Active inventory / project-session index | 未重构 |

## Verification

| Check | Result |
| --- | --- |
| `npm run lint` | Pass |
| `node_modules/.bin/tsc --noEmit` | Pass (`tsc_exit=0`) |
| 热路径 `rg archivedCounts\|archivedSessions\|loadArchivedSessions\|ArchivedSessionItem` | 仅 project-space 注释命中 `archivedCounts` |
| `rg /api/sessions/archived` in `components`/`hooks` | 无命中 |
| `rg scanArchivedCwds` in `app/api` | 无命中（仅 `lib/session-reader.ts` 定义） |
| 保留能力 `listArchivedSessionsForCwd` / Usage includeArchived | 仍存在 |
| `git diff` 范围 | 无 session-reader / archive routes / usage 误伤 |
| Live API smoke on `:30141` | **不可作为本 worktree 证据**：该进程 cwd 为全局包 `/opt/homebrew/lib/node_modules/@alan-zhao/yolk-pi-web`（`ypi`），非本 worktree；磁盘源码已正确收敛响应 |

说明：浏览器 Network 手工 smoke（切空间/归档动作）依赖本 worktree 的 `npm run dev`；静态与源码证据已充分覆盖 FR。若主会话尚未在本 worktree dev 上做 Network 确认，建议合并前补一次，但**不作为 blocker**（源码路径上已无 archived list 请求点）。

## UI Gate

- HTML 原型已交付：`session-sidebar-without-archive-prototype.html`
- 实现与批准范围一致：无归档区块、空态 active-only、archive 写入口保留、archive-all 仅计 active
- 小文案差异见 Low-1

## Verdict

**Pass**

实现完整覆盖批准范围：侧栏/list 热路径剥离 archive 扫描与展示，归档写与显式读/Usage 能力未误伤，未扩 scope 到 active inventory 重构。文档与 lint/tsc 达标。

### REV-01

可标 **done**。实现计划 7/7 可视为完成（在主会话完成 artifact/状态机收尾后）。

## Handoff for Main Session

- **Artifacts produced:** 本 `review.md`
- **Production code changed by checker:** none
- **Validation run:** lint pass, tsc pass, targeted rg pass
- **Remaining risks:** global `/api/sessions` 字段删除可能影响未记录外部客户端（计划已披露）；active 全量扫描长尾仍在（范围外）
- **Decisions needed:** 无产品决策。可选：是否补齐 archive-all 第二句文案；是否从本任务 diff 剔除 `package-lock.json`
- **Next:** 主会话可将 REV-01 → done，任务进入 completed / 用户验收；不要 commit（本成员模式禁止）
