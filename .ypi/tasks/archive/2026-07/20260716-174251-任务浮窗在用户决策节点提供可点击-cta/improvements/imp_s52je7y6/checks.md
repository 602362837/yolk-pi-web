# Checks：IMP-001 start_user_acceptance

## 需求覆盖

- [ ] 仅服务端 `userActions` 投影「开始用户验收」；组件不按 `review` 硬编码第二套按钮（allowlist 渲染除外）。
- [ ] `review` + unresolved=0 → 恰好 1 个 primary CTA。
- [ ] `review` + unresolved>0 → 无该 CTA。
- [ ] 成功后 status=`user_acceptance`，**不** completed。
- [ ] `canAcceptMain` 仍仅在 `user_acceptance` 为 true；main-accept 测试 `review` 保持 false。
- [ ] 最终改进验收后的自动 reaccept 路径仍可用。
- [ ] Phase 1 三 kind 行为与投影不变。
- [ ] 保全清单 A–F：8 站 rail、quickPreviews、改进结果验收、主验收/归档、runtime、写锁/聊天路径。

## 自动验证

```bash
npm run test:studio-widget-actions
npm run test:studio-main-accept
npm run test:studio-dag
npm run test:studio-task-preview
npm run test:studio-session-ownership
npm run lint
node_modules/.bin/tsc --noEmit
```

### 建议新增用例（widget-actions / dag）

- [ ] 投影：`review` clean → `[{ kind: start_user_acceptance, role: primary }]`
- [ ] 投影：`review` + waiting_user_acceptance instance → `[]` for this kind
- [ ] 投影：`user_acceptance` / `implementing` / archived → 不含该 kind
- [ ] 写：bound review → `user_acceptance`；event 含 user-widget / action
- [ ] 写：wrong context / stale revision / status implementing → 拒绝零写
- [ ] 写：body 带 override → 拒绝
- [ ] 回归：awaiting_approval 仍两键；improvement plan 仍第一项

## 手工 UI

- [ ] `review` 卡：决策区主按钮文案「开始用户验收」；确认框说明不 completed。
- [ ] 成功后出现「确认主任务已验收完成」；两步都需用户操作才能 completed。
- [ ] 有 review_ready 提示时 CTA 与提示并存，不替换。
- [ ] busy / 409 刷新 / 移动 44px / focus / reduced-motion 沿用决策区。
- [ ] 取消确认零网络写（或零 mutation）。

## 回归风险

- [ ] 未把 `canAcceptMain` 扩到 review。
- [ ] 未删除 `handleAcceptMainTask` / `acceptableImprovementsForTask` / Phase 1 handlers。
- [ ] preview/modal 仍只读。
- [ ] 不修改 workflow JSON 硬塞伪状态。

## 规划产物自检

```bash
for f in brief.md prd.md ui.md design.md implement.md checks.md plan-review.md; do
  test -s ".ypi/tasks/20260716-174251-任务浮窗在用户决策节点提供可点击-cta/improvements/imp_s52je7y6/$f"
done
rg -n 'start_user_acceptance|schemaVersion' \
  ".ypi/tasks/20260716-174251-任务浮窗在用户决策节点提供可点击-cta/improvements/imp_s52je7y6"
```
