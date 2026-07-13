# Review：任务浮窗在等待审批时支持计划审批书预览

## Check Complete

检查员对照 `prd.md` / `design.md` / `implement.md` / `checks.md` / `plan-review.md` / 获批 `ui-prototype.html`，审查实现 diff 与相关调用方，并重跑自动验证。

### Findings Fixed

- 入口按钮图标由实现中的 `▦` 改回与获批原型一致的 `▤`（`components/YpiStudioSessionWidget.tsx`）。
- 撤销无关的 `package-lock.json` typescript 版本钉死噪声（实现环境 `npm install` 副作用，不属于本需求）。

### Remaining Findings

#### 阻塞

- None。

#### 非阻塞 / 用户验收残留

1. **真实浏览器矩阵未在本检查会话完整点通**（当前主任务状态为 `checking`，入口按设计不显示；实现员也未擅自改状态构造 fixture）。代码与 API/helper 静态审查覆盖主干逻辑，但下列仍需主会话或用户在 UI 上确认：
   - 主任务 `awaiting_approval`：浮窗入口 → loading/success → 关闭后仍在绑定聊天，且 `task.json` 无 approval 写入。
   - 两个并存 `waiting_plan_approval` 改进项：独立 `IMP-xxx` 入口、请求 `improvementId` 与正文不串读。
   - 慢请求 / 404 / 403 / 网络失败 / 空 TBD / 快速切换 target 竞态。
   - Escape / 遮罩 / 焦点恢复 / 长内容滚动 / 浅深色 / 360px 换行 / `≤640px` pill → sheet → modal。
   - 详情箭头、拖拽、收纳球、排序、绑定过滤无回归。
2. **深色主题按钮色**仍用固定 amber `#b45309`（与浮窗既有 waiting 色一致），未单独做 `html.dark` 覆盖；对比度可在用户验收时目视确认。
3. **未新增 focused helper 自动化测试文件**（`checks.md` 为建议项）；已用 Node 探针覆盖合法/非法路径与 `improvementId` URL 构造。

### 需求与设计覆盖

| 验收点 | 结论 | 证据 |
| --- | --- | --- |
| R1 主任务仅 `awaiting_approval` 显示入口 | Pass | `planReviewEntriesForTask` 状态门控；非审批态无 action row |
| R2 每个 `waiting_plan_approval` 独立 `IMP-xxx` 入口 | Pass | 按 `instance.id` 建 target，无 first-item 猜测 |
| R3 按需 `mode=read` + `MarkdownBody`，不投影正文 | Pass | Modal effect 打开后 fetch；`session-link` projection 仅 status/ids |
| R4 dialog a11y / Escape / 遮罩 / 滚动 / 移动近全屏 | Pass（静态） | `role=dialog`、`aria-modal`、focus trap/restore、`globals.css` ≤640px sheet |
| R5 loading / empty-TBD / error+retry / 只读提示 | Pass | Modal 状态机与文案对齐原型；无批准按钮 |
| R6 task-local 相对链接安全 + improvement scope | Pass | 共享 `lib/ypi-studio-task-preview.ts`；HTML `mode=preview` + `improvementId` |
| R7 无回归：详情/拖拽/尺寸/绑定 | Pass（静态） | 按钮 `stopPropagation`；独立 action row；360px 未改；无 API/schema 变更 |
| 只读边界：不写 grant / PATCH / transition | Pass | Modal 仅 GET files；无 approve UI |
| UI 原型一致性 | Pass | 入口位置、文案、只读提示、状态卡、桌面/移动形态对齐；图标已修 |
| UI 原型审批门禁 | Pass | events 记录用户已批准 plan-review + HTML 原型后进入 implementing |

### 代码审查摘要

1. **`lib/ypi-studio-task-preview.ts`**  
   抽取路径校验、API URL、打开链接逻辑；注释明确服务端 resolver 为权威。Panel 删除重复实现并改为 import，改进项 scope 行为保持。

2. **`components/YpiStudioPlanReviewModal.tsx`**  
   集中 fetch/AbortController/`retryToken`/stale guard、meaningful 判定、错误脱敏、Markdown 链接、dialog 焦点与 portal。无写状态 API。

3. **`components/YpiStudioSessionWidget.tsx` + `AppShell.tsx`**  
   Props 传入授权 `cwd` 与 `handleOpenFile`；入口独立 flex-wrap row；desktop/mobile/ball 均挂载同一 modal；任务离开 session 或 cwd 丢失时清理 target。

4. **`docs/modules/frontend.md` / `library.md`**  
   记录 widget 入口、modal 只读/按需读取、helper 复用与安全边界，与实现一致。

5. **未改**  
   task schema、widget projection 正文、`/api/studio/tasks/.../files` 契约、approval gate/grant、浮窗宽度/拖拽模型。

### Verification

| Command / Check | Result |
| --- | --- |
| `npm run lint` | Pass |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run test:studio-dag` | Pass |
| Focused helper probe（合法 `prd.md` / `ui-prototype.html`；scheme / 绝对路径 / `..` / 反斜杠 / 目录拒绝；`improvementId` URL） | Pass |
| 静态审查：只读边界 / 状态门控 / 不串读 / 无投影正文 | Pass |
| 真实浏览器 checks 矩阵 | 未完整执行（见残留项） |

### Verdict

**Pass — 可进入用户验收（user_acceptance）**

代码与设计/PRD/获批原型一致，自动验证通过，只读审批边界与 improvementId 隔离成立，无阻塞缺陷。完整浏览器路径与多改进项实机串读验证留给用户验收；主会话不应因静态检查缺口回退 redesign，也不应在 modal 内追加批准按钮。

### 建议主会话动作

1. 将本任务推进到 **`review` → `user_acceptance`**（或工作流等价的用户验收态）。
2. 在验收时如需观察入口，可使用其它 `awaiting_approval` 任务，或临时构造双 `waiting_plan_approval` 改进 fixture（不要在生产路径写假 grant）。
3. 用户验收通过后再 `completed` / 归档；若浏览器发现焦点/移动/串读问题，再开 improvement，勿直接扩 scope 加 modal 批准。
