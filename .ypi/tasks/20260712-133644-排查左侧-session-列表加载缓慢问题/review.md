# Check Complete

## 审查范围

- 产物：`brief.md` / `prd.md` / `ui.md` / `design.md` / `implement.md` / `checks.md` / `plan-review.md` / `handoff.md` / `events.jsonl`
- 工作区实际代码 diff：
  - `lib/session-list-timing.ts`（新增）
  - `lib/session-reader.ts`（可选 timing 接入）
  - `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`（阶段计时与慢请求日志）
- 未改动但被需求覆盖的关键路径：`components/SessionSidebar.tsx`、`lib/project-session-index.ts`、create/fork/archive/unarchive/delete/rename 失效点、文档与 focused tests/benchmark

## Findings Fixed

None（按委托要求，本次检查未修改生产代码）。

## Remaining Findings

### 阻塞

1. **实现完成度严重不实；计划 7/7 与代码不符**
   - 事件显示多轮 implementer 以 `SDK child run finished without a captured final assistant message` 结束，但子任务仍被 claim 并最终切到 `checking`。
   - 实际只落地了 **PERF-001 的局部计时**；下列子任务均未实现：
     - `FE-001`：稳定请求身份 / 刷新合并 / `AbortController`
     - `BE-001`：single-flight + `path+mtime+size` 摘要缓存
     - `BE-002`：index 候选 + inventory/header 校验回退 + best-effort repair
     - `BE-003`：Studio task 投影按 `cwd+taskId` 去重、archive count 独立缓存
     - `INT-001`：专用查询接入与 create/fork/rename/archive/unarchive/delete 显式失效
     - `DOC-001`：文档、基准、回归门禁
   - **结论：不得按“实现完成”验收。**

2. **R2 请求去重/竞态未做（前端根因仍在）**
   - `SessionSidebar.loadSessions` 仍依赖整个 `projects` 数组：
     ```ts
     }, [projects, selectedProjectId, selectedSpaceId]);
     ```
   - 手动刷新仍并发触发：
     ```ts
     onClick={() => { void loadProjects(false); void loadSessions(false); }}
     ```
   - 仍只有 generation token，无 sessions 请求 `AbortController`，AbortError 处理也未接入。
   - 验收失败：一次刷新可产生重复 sessions 请求；快速切换仍让过期请求继续占用服务端扫描。

3. **R3/R4/R5 生命周期与性能主路径未做**
   - project-space route 仍调用全局 `listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true })` 后过滤。
   - 无文件级摘要缓存、无 inventory single-flight、无 index 候选加速、无 archive snapshot。
   - Studio projection 仍对每个 child 调 `projectStudioChildDisplay()`，内部仍可能重复读同一 task detail。
   - 无 mutation 失效入口；外部写入可见性也没有“缓存 + TTL/reconciliation”契约可验收。
   - 无 route contract / cache / index / lifecycle focused tests。

4. **R6 性能目标与 PERF-001 基线缺失**
   - 没有固定 fixture（>=500 sessions / 100 Studio children / 100MB）。
   - 没有 cold/warm P50/P95/P99、底层读取次数、并发 single-flight 证据。
   - 无 benchmark 脚本；不能宣称 warm P95 或 cold 降幅达标。

5. **类型检查失败（当前改动不可合并）**
   - `node_modules/.bin/tsc --noEmit`：
     ```
     app/api/projects/.../sessions/route.ts(88,65): error TS2739
     Type '{ cwds... }' is missing properties from type 'Promise<unknown>'
     ```
   - 根因：`scanArchivedCwds()` 是同步函数，却传入 `timing.measureAsync("archive", () => scanArchivedCwds())`；`measureAsync` 签名要求 `() => Promise<T>`。
   - 同段还连带产生 `archived`/`archivedCount` 为 `unknown` 的后续错误。

6. **R1 可观测性只部分落地，且 total 语义有误**
   - 已有 content-safe collector 与慢请求/debug 日志门控，方向正确。
   - 但 route 同时计 `listAll`，reader 再计 `inventory`/`header`/`studioProjection`，`snapshot().totalMs` **按 stage 求和会双重计数**，可能误触发慢请求阈值或误导主导阶段判断。
   - 无 cache-hit / index-hit 计数（因无缓存/index 路径）。
   - 无固定 fixture 下“能定位主导阶段”的验证记录。

### 非阻塞

1. **ESLint warning**：route 中 `eslint-disable-next-line no-console` 被报告为 unused。
2. **route 文件末尾缺换行**。
3. **debug serialize 探测**对 body 执行了两次 `JSON.stringify`；若保留，应复用一次结果。
4. **`SyncOrAsync` 类型导出未使用**；`measureAsync` 未接受同步函数，导致本次 tsc 失败。
5. **`studioChildDisplay` 条件从** `includeStudioChildDisplay ? project...(cwd, studioChild)` **收紧为** 同时要求 `studioChild`；因 `projectStudioChildDisplay` 在无 taskId 时本就返回 `undefined`，行为基本等价，但应在回归契约中显式覆盖。
6. **文档未更新**：`docs/modules/{api,frontend,library}.md`、`docs/architecture/overview.md` 未记录 timing/缓存/index 真相边界。
7. **流程风险**：实现员失败后仍推进到 checking；后续需主会话纠正进度状态，避免“假完成”。

## 需求覆盖对照

| 需求 | 结果 |
| --- | --- |
| R1 可观测性 | 部分：有 collector/日志门控；无基线、total 双重计数、无 cache/index 计数 |
| R2 请求去重与竞态 | 失败：前端未改 |
| R3 扫描与缓存 | 失败：无 single-flight/增量缓存 |
| R4 索引安全 | 失败：index 仍未进入读取链路 |
| R5 行为兼容 | 未验证：无契约测试；核心列表逻辑基本未改，但整体优化未交付 |
| R6 性能目标 | 失败：无 fixture/benchmark |
| UI 门禁 | 通过：当前 diff 不改变可见加载交互；仍无 HTML 原型需求 |

## Verification

| 命令 | 结果 |
| --- | --- |
| `node_modules/.bin/tsc --noEmit` | **Fail** — route.ts archive `measureAsync` 类型错误及连锁 `unknown` |
| `npx eslint lib/session-list-timing.ts lib/session-reader.ts app/api/projects/.../sessions/route.ts` | Warning — unused `eslint-disable` for `no-console` |
| `npm run lint`（全量） | 超时未完成（>120s）；已用 focused eslint 覆盖改动文件 |
| focused tests（cache/index/route/frontend） | **缺失** |
| fixed fixture benchmark | **缺失** |
| 人工 Network/lifecycle smoke | 未执行；实现未达可验收状态 |

## Verdict

**Needs work**

原因：任务被标为 checking/7/7，但生产改动仅覆盖 PERF-001 的局部计时，且该改动本身导致 `tsc` 失败；R2–R6 及生命周期失效、index 安全、基准与文档均未交付。应退回 **implementing**，先修复 timing 类型/total 语义，再按 `implement.md` 重新完成 FE-001 → BE-001 → BE-002/BE-003 → INT-001 → DOC-001，并保留真实验证证据后再进入检查。

## 建议返工顺序（不重新设计）

1. 主会话把实现进度改回真实状态（至少 PERF-001 partial；其余 todo）。
2. 实现员修复 `measureAsync`/`measureSync` 用法与 `totalMs` 双重计数；补 timing 单测。
3. 按原 DAG 完成前端 abort/去重、服务端 cache/single-flight、index 候选回退、Studio/archive 去重缓存、mutation 失效。
4. 补契约测试 + fixture benchmark + lint/tsc + 人工 smoke，再重新派检查员。

## 主会话需决策

- 是否确认当前状态应回退到 `implementing`（推荐：是）。
- 失败的 async implementer 运行是否需要改为同步/可观察执行，避免再次“无最终消息却标记完成”。
- 性能绝对值是否仍按原审批作为首期非阻塞报告项（推荐维持；但至少要有同 fixture 前后对比数据）。
