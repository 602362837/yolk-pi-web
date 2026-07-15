# Brief — IMP-004 主任务验收弹窗增加「确认并归档」

## 反馈摘要

用户验收反馈（承接 IMP-003 主任务浮窗验收）：

- 当前主任务验收确认弹窗只有两档：
  - **确认主任务已完成** → `user_acceptance → completed`
  - **暂不验收** → 不写
- 用户希望在**同一确认弹窗**中再增加明确区分的第三档：**确认并归档**。
- 语义：在用户主动确认下，先完成主任务结果验收，再归档；不得削弱「只完成不归档」与「暂不验收」。

## 代码证据

1. **主任务验收写路径已存在（IMP-003）**
   - Projection：`canAcceptMain`（`user_acceptance && !archived && unresolved===0`）。
   - `components/YpiStudioSessionWidget.tsx` → `handleAcceptMainTask`：
     - AppPrompt 二次确认（`confirm` → `boolean`）。
     - 确认后 `PATCH { cwd, to:"completed", contextId, reason }`。
     - 文案明确「不会自动归档」。
   - 文档：`docs/modules/frontend.md` 写明 widget never archives the main task。

2. **AppPrompt 仅为双按钮**
   - `AppPromptProvider.confirm` → `Promise<boolean>`。
   - `AppPromptDialog` actions：取消 + 单一 primary 确认。
   - **没有** tertiary / secondary 确认按钮 API；Enter 键绑定 primary `onConfirm`。

3. **归档能力已存在，且要求先 completed**
   - `archiveYpiStudioTask`：
     - 拒绝已归档；
     - **`status !== "completed"` 拒绝**（“Only completed … can be archived”）；
     - 未解决改进拒绝；running subagent 拒绝；
     - 知识摘要：无 model 摘要时需 `allowFallbackKnowledge: true`，否则抛错。
   - HTTP：`isYpiStudioTaskArchiveBody` → `PATCH { action:"archive", cwd, reason?, contextId?, allowFallbackKnowledge?, … }`。
   - Studio 面板已有先例：`YpiStudioPanel.handleArchiveTask` 对 **已 completed** 任务二次确认后归档，并带 `allowFallbackKnowledge: true`（页面归档无法调聊天模型，用产物兜底摘要）。

4. **无服务端「completed+archive」原子 API**
   - 客户端必须串行：`transition → completed` 再 `action:"archive"`。
   - 中间失败需可解释（见风险）。

## 范围与目标

### 范围内

- 主任务验收确认 UI 增加第三动作「确认并归档」（与「确认主任务已完成」「暂不验收」同框、可区分）。
- 选择「确认主任务已完成」：行为与 IMP-003 完全一致（只 completed，不 archive）。
- 选择「确认并归档」：用户确认语义下 **先 completed，再 archive**（复用既有 transition + archive API；`allowFallbackKnowledge: true`）。
- 「暂不验收」：不发任何 PATCH。
- 成功/失败 toast 与刷新语义清晰（含 completed 成功但 archive 失败）。
- 若采用共享对话框扩展：最小、向后兼容的 AppPrompt multi-choice（或等价 secondary 确认）能力。
- 轻量测试 + 文档更新；HTML 原型与 plan-review。

### 非目标

- 不新增服务端原子 `complete_and_archive` API（除非实现中发现必须，需再审批）。
- 不改变 `canAcceptMain` 可见性门禁。
- 不在有 unresolved 改进时允许归档/完成。
- 不调用聊天模型生成归档知识（页面路径继续 fallback，与面板一致）；不强制用户手写 knowledgeMarkdown。
- 不改计划审批、改进验收、资料新标签行为。
- 不在详情面板重做归档控制台（面板既有归档保留）。
- 不把「确认并归档」做成默认主按钮或 Enter 默认动作。

## 风险与依赖

| 风险 | 缓解 |
| --- | --- |
| 误点归档（破坏性更强） | 归档按钮独立 danger/次强调样式；文案写明会移动任务目录并写 knowledge；Enter 只触发「只完成」 |
| completed 成功、archive 失败 | 分步 toast：已 completed，归档失败原因；刷新后状态为 completed，可再走面板归档 |
| 无 knowledge 摘要被拒 | 固定 `allowFallbackKnowledge: true` + reason，对齐面板 |
| 扩展 AppPrompt 破坏既有 `confirm(): boolean` | **新增** `choose`/secondary API，不改现有 `confirm` 返回类型 |
| 仅做局部自定义对话框导致体验分裂 | 优先最小共享 API；若审批拒绝扩展 AppPrompt，可降级为 widget 内专用三按钮对话框 |
| running subagent 阻塞归档 | 服务端错误透出；不乐观 archived |
| 与 IMP-003「不自动归档」承诺冲突 | 本改进是**显式用户选择**归档，不是自动；保留「只完成」路径 |

## 判断标记

- **需要 UI 原型？** **是** — 确认弹窗从 2 按钮变为 3 按钮，文案/主次/危险层级需可审。
- **需要计划审批？** **是** — 新增写路径（archive）与确认交互变化。
- **等待澄清？** **否** — 推荐方案足够实现；可选确认点见 plan-review（是否扩展 AppPrompt vs 局部对话框）。

## 推荐方案方向

1. **共享确认 API 最小扩展**（推荐）：`usePrompt().choose({ actions: [primary, secondary], cancel }) → "primary" | "secondary" | null`，或 confirm 可选 `secondaryConfirmLabel` 返回判别联合；**不**破坏现有 `confirm → boolean`。
2. `handleAcceptMainTask`：
   - `null/cancel` → return；
   - `primary` → 仅 PATCH completed（现逻辑）；
   - `secondary` → PATCH completed → 成功后再 PATCH archive（`allowFallbackKnowledge: true`，reason 标明 session widget complete+archive）。
3. 视觉：主按钮仍为「确认主任务已完成」（success）；次按钮「确认并归档」（danger/中性描边）；取消「暂不验收」。
4. 文档修正「widget never archives」为：仅在用户显式「确认并归档」时归档。
