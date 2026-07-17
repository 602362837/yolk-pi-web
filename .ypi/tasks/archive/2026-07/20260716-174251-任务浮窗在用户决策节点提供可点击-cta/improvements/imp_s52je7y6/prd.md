# PRD：IMP-001 review 阶段「开始用户验收」CTA

## 目标

当主任务合法停在 `review` 且没有未解决改进时，会话浮窗给出明确主 CTA「开始用户验收」，把任务推进到现有 `user_acceptance`，再由用户完成既有主任务结果验收/归档。解决“卡在 review、却看不到下一步按钮”的体验断点。

## 用户价值

- 检查通过或改进全部解决回到 `review` 后，不必回聊天记文案或依赖主会话手动 transition。
- 保持两步语义：**进入验收** vs **确认验收完成**，降低误把 review 当 completed 的风险。

## 范围内

1. **服务端投影**  
   当且仅当：
   - 任务未归档；
   - `status === "review"`；
   - unresolved improvements 计数为 0（无 instances 或全部 `accepted` / `accepted_not_doing`）；  
   则在 `userActions[]` 投影一项：
   - `kind: "start_user_acceptance"`
   - `label: "开始用户验收"`
   - `role: "primary"`
   - `requiresConfirmation: true`
   - `expectedRevision`：使用稳定 CAS 值（推荐 `meta.planRevision ?? 1`，与现有 Phase 1 一致；写路径以 status/binding/unresolved 为权威，revision 仅 compare-and-set 防陈旧卡）
   - `targetLabel`：有界文案，如 `主任务 · {title}`

2. **显式写 action**  
   `PATCH /api/studio/tasks/{taskKey}` body：
   ```json
   { "cwd", "action": "start_user_acceptance", "contextId", "expectedRevision" }
   ```
   服务端单锁：
   - active、未归档；
   - 绑定 session context；
   - 当前 status 必须为 `review`；
   - unresolved improvements == 0；
   - expectedRevision CAS；
   - 合法 workflow 边 `review → user_acceptance`（已有，无 plan grant 要求）；
   - 原子 transition + 审计 event（`source=user-widget` / action kind）；
   - **禁止** `override` 出现在 body；
   - **禁止** 直接 `completed`。

3. **浮窗 UI**  
   - 仅渲染服务端 `userActions`，在既有决策区展示该主 CTA；
   - 确认框文案：将从 `review` 进入 `user_acceptance`；**不会** completed；之后仍需点「确认主任务已验收完成」；
   - 共用现有 in-flight 写锁、busy/aria、失败刷新；
   - 成功后刷新投影：决策 CTA 消失，主验收区按 `canAcceptMain` 出现。

4. **回归保全**  
   完整保留主任务 Phase 1 保全清单 A–F 与现有决策 kinds：
   - 8 站 WorkflowRail / 详情 / 壳层  
   - quickPreviews 只读  
   - 改进摘要 + 结果验收  
   - 主任务结果验收 + 确认并归档 + 归档徽章  
   - runtime / 子任务 / runs  
   - 写锁 + 聊天 `user-input`  
   - `approve_plan` / `request_plan_changes` / `approve_improvement_plan`

## 范围外

- `review` 上直接显示「确认主任务已验收完成」或合并两步为一键 completed  
- 自动从 `review` 静默进入 `user_acceptance`（除已有「最终改进验收后 reaccept」路径外，本期不扩展其它自动跳转）  
- planning/implementing/checking 伪继续按钮  
- Panel 第二套写入口、modal/document 内批准/验收控件  
- 修改 workflow JSON 状态图（边已存在）

## 验收标准

1. `review` + unresolved=0 + 已绑定：卡上出现唯一主 CTA「开始用户验收」；无次 CTA。  
2. 确认成功：status=`user_acceptance`，出现既有主验收按钮；`canAcceptMain === true`。  
3. 取消确认 / 空操作：零写入。  
4. `review` + 仍有 unresolved：不投影该 CTA（应显示改进流，不是主验收入口）。  
5. `user_acceptance` / `implementing` / `checking` / `awaiting_approval` / archived：不投影该 CTA。  
6. 错 context、stale status、stale revision、归档：409/安全错误，零部分写，前端刷新。  
7. 文案不与「确认主任务已验收完成」「批准并开始实现」「确认该改进任务已完成」混淆。  
8. 保全清单 A–F 与 Phase 1 三 action 行为无回退。  
9. 旧客户端忽略新 kind 后不崩溃；未知 kind 前端过滤丢弃。

## 非功能

- 审计不存任意 body；只记 allowlist action / task / revision / context / 时间。  
- 错误不暴露绝对路径或堆栈。  
- 不新增远程 UI 协议字段（无 endpoint/HTML message）。

## 审批需确认

1. 同意「开始用户验收」只做 `review → user_acceptance`，不跳过结果验收（推荐：同意）。  
2. 同意不把 `canAcceptMain` 扩到 `review`（推荐：同意）。  
3. 同意最小 UI 证据：在现有决策区样式上增加 `review` 场景即可（见 [ui.md](ui.md)）。
