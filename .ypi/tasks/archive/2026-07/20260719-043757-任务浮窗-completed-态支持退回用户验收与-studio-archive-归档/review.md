# review

## Verdict

**Pass**

Completed 浮窗双 CTA 实现覆盖 PRD/Design/Implement 硬契约：退回走显式 PATCH + 清 `completedAt`，归档走 `onComposeSend("/studio-archive")`，无浮窗 silent archive 主路径，无视觉 CSS 改版，既有 approve/accept/continue 矩阵保全。自动验证通过。

## Findings Fixed（检查员修复）

1. **Domain helper 单测缺口**：`returnYpiStudioToUserAcceptanceFromWidget` 原先仅有 body guard/投影测，缺成功路径与错误路径（wrong status / unbound / revision / 清 `completedAt` / event audit）。已补入 `scripts/test-ypi-studio-widget-actions.mjs`，并在 live projection 段断言 completed 两 CTA 且 `canAcceptMain !== true`。
2. **Continue 矩阵**：`scripts/test-ypi-studio-widget-continue.mjs` 补 `return_to_user_acceptance` / `studio_archive` → `needsChatContinue === false`。
3. **A11y 文案**：decision 按钮 `aria-label` 区分「退回验收（非归档）」与「Chat 归档（非静默）」（对照 ui.md §7）。

## Remaining Findings

### 非阻塞

1. **缺边 HTTP 状态码**：Design 表写 missing workflow edge → 422；现网 `mapWidgetDecisionError` 将 `Invalid Studio transition` 映射为 **400**（与既有 transition 错误一致）。行为正确（零部分写），仅文档/表与实现差 1 档；若产品要严格 422 可后续微调 mapper。
2. **手工 checklist 未跑**：ui.md §6 / checks §3（浮窗确认框、Chat transcript `/studio-archive`、busy 灰显、Panel/主验收「确认并归档」回归）需主会话或真人浏览器验收。
3. **他仓 workflow 缺边**：代码默认 + 本仓 JSON 已同步；外部工作区磁盘 workflow 无 `completed→user_acceptance` 时退回 400/明确错误，归档不受影响——与 PRD Q3 一致，仍需文档/用户侧补边或 `studio-init overwriteDefaults`。

### 阻塞

None。

## 需求对照

| ID | 结论 |
| --- | --- |
| R1 投影退回+归档 | Pass — `buildWidgetUserActions` completed 分支 primary `studio_archive` + secondary `return_to_user_acceptance`；`supportsReturnToUserAcceptance===false` 仅 archive；archived → `[]` |
| R2 退回原子写 | Pass — `returnYpiStudioToUserAcceptanceFromWidget` 单锁 binding/status/revision/unresolved/边；`status=user_acceptance`；`completedAt=null`；event `source=user-widget` |
| R3 归档 Chat slash | Pass — Widget `onComposeSend("/studio-archive")`；AppShell `composeSendRef` → ChatWindow `handleSend` |
| R4 禁止 silent archive 主路径 | Pass — completed CTA 无 `PATCH action=archive`；主验收「确认并归档」与 Panel `allowFallbackKnowledge` 按 Q2 保留 |
| R5 busy/confirm/context | Pass — `agentRunning`/`acceptingInFlight` 禁用 + confirm 后 `agentRunningRef` 二次检查 |
| R6 archived 只读 | Pass — projection 单测 |
| R7 保全 | Pass — continue 仅三 kind；main-accept 测通过；approve 路径未改契约 |
| R8 workflow 边 | Pass — BASE_TRANSITIONS + feature-dev/bugfix/ui-change JSON；review-only 仅 `completed→archived` |
| R9 docs | Pass — frontend/api/library/overview 已写六 kind 与 Hybrid B / completed CTA |

## 设计边界

- 投影 advisory；写路径服务端权威。
- 新 kind **未**进入 `ypiStudioWidgetActionNeedsChatContinue`。
- Route 在 loose transition 前匹配 `return_to_user_acceptance`。
- 无 `app/globals.css` 视觉改动。
- UI 门禁：任务声明无 HTML 视觉稿；交互 checklist + 生产组件权威——符合本任务约定。

## Verification

| Command | Result |
| --- | --- |
| `npm run test:studio-widget-actions` | Pass（含投影、body guard、return helper domain） |
| `npm run test:studio-widget-continue` | Pass（含新 kind false） |
| `npm run test:studio-main-accept` | Pass（13 cases） |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run lint` | 未作为本任务回归门禁重跑全仓；现存 Trellis 等无关 error 与本 diff 无关。本 diff 相关文件 tsc 干净 |

## 检查员改动文件

- `scripts/test-ypi-studio-widget-actions.mjs`
- `scripts/test-ypi-studio-widget-continue.mjs`
- `components/YpiStudioSessionWidget.tsx`（aria-label only）
- 本文件 `review.md`

## 主会话下一步（检查员不 transition / 不 commit）

1. 可选：浏览器跑 ui.md checklist。
2. 用户验收通过后由主会话 archive / 收尾。
3. 不需为实现缺口返工实现员，除非手工发现 silent archive 或按钮缺失。
