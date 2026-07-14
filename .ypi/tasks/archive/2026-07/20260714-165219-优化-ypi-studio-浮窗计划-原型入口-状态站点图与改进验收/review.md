# Review / 验收记录

Task: 优化 YPI Studio 浮窗计划/原型入口、状态站点图与改进验收  
Checker: 检查员（checker）  
Date: 2026-07-14  
Verdict: **Pass（代码/契约门禁通过；建议进入 review / 用户验收）**

## 审查范围

对照 `prd.md`、`design.md`、`implement.md`、`checks.md`、`ui.md`、HTML 原型与当前工作区 diff，审查 DATA-01 / UI-01 / FLOW-01 / DOC-01 实现与文档。

审查文件（生产改动）：

- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-session-link.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-task-preview.ts`
- `components/YpiStudioSessionWidget.tsx`
- `components/YpiStudioPanel.tsx`
- `components/YpiStudioPlanReviewModal.tsx`
- `components/AppShell.tsx`
- `app/globals.css`
- `scripts/test-ypi-studio-dag.mjs`
- `docs/modules/frontend.md` / `api.md` / `library.md` / `docs/architecture/overview.md`

未改生产代码；本检查仅写验收结论。

## Findings Fixed

None（检查阶段未发现需当场修复的阻塞缺陷）。

## Remaining Findings

### 阻塞

None。

### 非阻塞 / 残留风险

1. **浏览器人工清单仍为 ⚠**  
   `checks.md` 中桌面 360px 多任务/拖拽、审批前后态、HTML 新开页、多改进验收确认/取消/竞态、completed/archived 历史入口、`≤640px` 与 `prefers-reduced-motion` 尚未在真实 `npm run dev` 下逐项勾选。  
   **影响**：不阻断代码门禁，但用户验收前应走一遍真实 UI。

2. **八站映射是展示层**  
   依赖 `YpiStudioSessionWidget` 内 workflow/status evidence；未来 workflow 新增状态需同步 rail，不得反向改状态机。当前实现已用 `POST_CHECKS_STAGE_IDS` 避免 `checks.md` 等规划文件误标后段完成。

3. **刷新同步依赖同一 `studioSessionTaskRefreshKey`**  
   AppShell 中 widget 与 Studio drawer 共用 refresh key；drawer 关闭时 panel 的 `refreshKey` 为 0。验收成功路径会 `onTaskChanged` 递增 key，widget 会刷新；drawer 若关闭后再打开需依赖后续 load。残留 stale 风险低，但竞态场景仍建议人工点验。

4. **任务详情改进计划入口启发式**  
   `improvementHasPlanReview()` 在部分状态即使 registry 暂无文件也会显示入口；modal 处理 404/空/TBD。属体验兜底，不是串读（仍强制 `improvementId`）。

## 需求覆盖核对

| 验收点 | 结论 | 证据 |
| --- | --- | --- |
| R1 改进计划快速只读预览（taskKey+improvementId，无编辑/批准） | Pass | `YpiStudioPanel`「快速预览」同级主计划 + `改进计划 · IMP-xxx`；target 显式带 `improvementId`/`fileName`；`YpiStudioPlanReviewModal` 仅 GET `mode=read`，文案只读且无批准/transition |
| R2 计划审批书常驻与审批态 | Pass | `buildWidgetQuickPreviews()` 由完整 artifact registry / 磁盘存在性驱动，不依赖 `awaiting_approval`；态来自 `meta.approvalGrant` / revision / archived→readonly |
| R3 HTML 原型新开页 + 安全边界 | Pass | `openStudioTaskHtmlPrototype` → files API `mode=preview` + `noopener,noreferrer`；投影仅文件名；服务端 resolver 未改坏 |
| R4 八站图（含 UA/Completed/Archived），无规划 md 误标 | Pass | `WORKFLOW_RAIL_STAGES` 八站；`POST_CHECKS_STAGE_IDS` + status-first；CSS `is-eight-station` 4×2 grid 于 360px |
| R5 浮窗改进验收 | Pass | 仅 `status === "waiting_user_acceptance"`；AppPrompt 明确“结果验收≠计划审批”；PATCH `transition_improvement`/`to:accepted`/`contextId`，无 `override`；失败 toast+刷新，不乐观完成；文案/状态机 reconcile 回 review |
| 不写 approval grant；360px / session-bound | Pass | 预览路径无 PATCH；widget `width: 360`；AppShell 仍按 session context 绑定多任务 |
| 文档与自动验证 | Pass | frontend/api/library/overview 已同步 additive contract；lint/tsc/studio-dag 通过 |

## 安全与门禁复核

- 计划/原型预览：GET-only，不写 grant、不 transition。
- 计划批准仍仅由 Chat 明确用户输入 + 服务端 grant。
- 浮窗验收：服务端 `waiting_user_acceptance → accepted` 二次校验；archived/completed 不渲染验收按钮。
- widget projection：`quickPreviews` 与 improvement 实例不含 body / 完整 feedback / transcript。
- HTML：不注入 React DOM；继续 CSP sandbox 预览页。

## 自动验证（检查员复跑 2026-07-14）

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

| Command | Result |
| --- | --- |
| `npm run lint` | Pass — 0 errors；6 pre-existing warnings（archive/test 无关文件） |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run test:studio-dag` | Pass — `ypi-studio DAG scheduler tests passed` |

DAG 覆盖（节选）：quickPreviews 审批前/后/revision_changed/archived；多改进显式 `improvementId`；无 HTML 不投影 prototype；`canAccept` 仅 waiting_user_acceptance；accepted reconcile parent → review。

## 与 UI 原型一致性（静态）

- 常驻计划/HTML 按钮 + 待审批/已批准（已确认）tone：一致。
- 八站两行：一致。
- 改进验收确认文案区分计划审批：一致。
- 归档只读徽章与历史入口：一致。
- 真实浏览器场景切换与焦点/Escape 未在本轮实机勾选（见残留风险 1）。

## Verdict

**Pass** — 实现完整覆盖 PRD R1–R5 与 Design 契约；无阻塞缺陷；自动验证通过。

### 建议 next

1. 主会话将任务 **transition → `review`（用户验收）**。
2. 用户在 `npm run dev` 下按 `checks.md` 浏览器 ⚠ 清单走通后，再决定 completed/archive。
3. 不需要 improvement；若人工验收发现交互回归，再开 improvement 实例。
4. 检查员未执行 git commit / push / merge；未改生产代码。
