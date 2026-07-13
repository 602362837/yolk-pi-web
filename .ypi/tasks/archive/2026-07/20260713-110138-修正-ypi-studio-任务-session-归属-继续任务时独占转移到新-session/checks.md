# Checks

## 需求覆盖

- [ ] create@s1：A 只含 s1 session context，s1 session-link 有 A。
- [ ] bind@s2：A 只含 s2 session context；s1 `tasks[]` 无 A，s2 有 A。
- [ ] s1 transcript 历史提及仅进入 diagnostics，不恢复 widget。
- [ ] 重复 bind@s2 幂等，不重复 event/owner。
- [ ] session 可同时显示多个不同 task 的 multi-task 行为不回归。
- [ ] archived task bind 仍拒绝；无 context task 首次 bind 正常。

## 自动测试建议

增加 focused test（建议 `scripts/test-ypi-studio-session-ownership.mjs` + npm script），使用临时 workspace：

1. create、bind transfer、重复 bind。
2. `pi_`、`pi_transcript_`、`pi_process_` 全部被替换；未知非 session context 保留。
3. removed pointer 仅在指向该 task 时删除；指向其他 task 时保留；新 pointer 写入。
4. 旧累积任务经一次 bind 惰性归一化。
5. session-link exact keys 在 transfer 前后返回正确 `tasks[]`。
6. awaiting_approval 有旧 grant 时 transfer 清 grant；旧 context approval/implement transition 失败，新 context未明确批准也失败，新 context明确批准后成功。
7. artifact/transition/plan/claim/update/improvement mutation 从非 owner context 拒绝且不修改 `contextIds`。
8. 两个并发 bind 最终只有一个 session owner，task JSON 可解析且事件顺序一致。

运行：

```bash
npm run test:studio-session-ownership
npm run test:studio-dag
npm run lint
node_modules/.bin/tsc --noEmit
```

若未增加 npm script，至少直接运行对应 Node test 文件。

## 人工验收

1. session1 创建 A，确认浮窗出现。
2. session2 在 Studio 面板点击现有“绑定/继续”入口，确认成功文案不变且浮窗出现。
3. 切回 session1，等待 session-task recheck 或刷新，确认 A 浮窗消失。
4. 在 awaiting_approval 场景转移：session1 的批准不生效；session2 必须重新明确批准后才能实现。
5. 查看 task detail：只保留当前 session key（以及预置的非 session metadata，如测试 fixture）；event 有 transfer 审计。
6. 验证 archived task 无绑定按钮/接口仍报错。

## 质量与回归风险

- [ ] 所有 `contextIds.push` 均已列举并消除旁路；使用 `rg "contextIds\\.push" lib/ypi-studio-tasks.ts` 验证仅允许 create 初始化或统一 helper 内出现。
- [ ] transfer 和 owner guard 均在 task lock 内。
- [ ] runtime pointer 删除采用 compare-before-unlink。
- [ ] approval gate、improvement approval、claim/subagent scope 没有放宽。
- [ ] docs 更新 `docs/modules/library.md`、`docs/modules/api.md`、`docs/architecture/overview.md`，明确“task 单 session owner / session 可多 task”。
- [ ] 无 UI 结构/文案变化；若发生则阻塞并补 UI HTML 原型审批。

## 阻断条件

- 非 owner mutation 仍能隐式 append/reclaim。
- transfer 后旧 session 仍作为 bound candidate。
- transfer 复用旧 session approval grant。
- 多任务 session widget 被误改为单任务。
- 并发 bind 导致多个 owner 或损坏 task.json。
