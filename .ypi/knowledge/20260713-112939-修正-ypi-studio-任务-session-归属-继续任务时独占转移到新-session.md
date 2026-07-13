# 修正 YPI Studio 任务 session 归属：继续任务时独占转移到新 session

- Task: 20260713-110138-修正-ypi-studio-任务-session-归属-继续任务时独占转移到新-session
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260713-110138-修正-ypi-studio-任务-session-归属-继续任务时独占转移到新-session
- Archived at: 2026-07-13T03:29:39.471Z
- Tags: bugfix, ypi-studio, session-binding, ownership, feature-dev, studio

## Summary
YPI Studio 任务 session 归属改为 exclusive transfer：显式 bind/continue 时只保留一个 session owner，旧 session 不再显示浮窗；普通 mutation 不得 append/抢占；跨 session 清 approval grant；runtime pointer compare-before-unlink；存量多 owner 惰性修正。

## Reusable knowledge
# Summary

修正 YPI Studio 任务与 chat session 的归属语义。根因是 `contextIds` 只去重追加、session-link 又把 exact context 命中视为 bound，导致 session2 继续任务 A 后 session1 仍显示浮窗。修复后 active task 只有一个 session-class owner；显式 bind/continue 在 task lock 内做 exclusive transfer。

# Reusable knowledge

1. **写入权威，不要在 session-link 猜 owner**：`resolveYpiStudioTaskForSession` 只认 exact `contextIds`；修复多 owner 必须改 bind/mutation 写入语义，不要按 updatedAt/数组末项过滤。
2. **bind ≠ append**：`bindYpiStudioTaskToContext` 应 `replaceTaskSessionContext`——保留非 session metadata，移除 `pi_*` / `pi_transcript_*` / `pi_process_*`，写入唯一 next；同 sole owner 幂等只刷 pointer。
3. **普通 mutation 禁止隐式 takeover**：create 初始化 owner；其余带 context 路径用 `assertTaskBoundToContext`，禁止 `contextIds.push` 旁路。
4. **审批不跨 session**：transfer 清除异 context 的 `meta.approvalGrant`；`assertYpiStudioImplementationApproved` 继续 exact bound + grant 匹配。
5. **runtime pointer compare-before-unlink**：仅当旧 pointer 仍指向当前 task 才删除，避免误删已指向其他 task 的 pointer。
6. **基数约束**：一个 task 单 session owner；一个 session 仍可绑定多个不同 task（multi-task widget 不变）。
7. **兼容**：存量多 owner 不做启动/只读自动迁移；下一次显式 bind 惰性归一化。archived 不可 rebind。
8. **回归**：`npm run test:studio-session-ownership`（create→transfer、resolver、pointer、approval、mutation guard、concurrency、multi-task）。

# Source artifacts

- brief.md / prd.md / design.md / implement.md / checks.md / plan-review.md
- handoff.md / review.md / summary.md
- lib/ypi-studio-tasks.ts, lib/ypi-studio-session-link.ts
- scripts/test-ypi-studio-session-ownership.mjs
- docs/architecture/overview.md, docs/modules/library.md, docs/modules/api.md

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
