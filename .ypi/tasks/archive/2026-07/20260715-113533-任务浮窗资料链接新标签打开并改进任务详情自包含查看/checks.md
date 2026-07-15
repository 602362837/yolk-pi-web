# Checks — IMP-003 主任务浮窗验收

## 需求覆盖

- [ ] `user_acceptance` 且无未解决改进、未归档时，浮窗显示「确认主任务已验收完成」。
- [ ] 有 unresolved 改进时不显示主任务按钮。
- [ ] `review` / `review_ready` / `ready` / `waiting_for_improvements` / `completed` / archived 不显示。
- [ ] 点击后 AppPrompt 二次确认；取消无 PATCH。
- [ ] 确认后 PATCH `to=completed` + `contextId` + 非空 `reason`。
- [ ] 成功 toast + 刷新；按钮消失；任务为 completed。
- [ ] 失败 toast + 刷新；无乐观 completed。
- [ ] 缺 contextId / cwd 不发请求并提示。
- [ ] 与改进验收文案/色调可区分；改进路径无回归。
- [ ] 不写 approval grant、不 archive、不改 improvement 状态。

## 自动验证

```bash
npm run test:studio-main-accept   # 实现时注册
npm run lint
node_modules/.bin/tsc --noEmit
```

纯函数真值表：

| status | archived | unresolved | canAcceptMain |
| --- | --- | ---: | --- |
| user_acceptance | false | 0 | true |
| user_acceptance | false | 1 | false |
| user_acceptance | true | 0 | false |
| waiting_for_improvements | false | 1 | false |
| review | false | 0 | false |
| ready | false | 0 | false |
| completed | false | 0 | false |

## 人工验收

### 桌面浮窗

1. 准备/找到 `user_acceptance` 且无未解决改进的绑定任务（可用测试任务或验收后的路径）。
2. 展开浮窗，确认主任务按钮可见、改进橙按钮不可见。
3. 点按钮 → 取消：网络无 PATCH，状态不变。
4. 再点 → 确认：任务变 `completed`，toast 成功，按钮消失，rail 反映完成。
5. 在有 `waiting_user_acceptance` 改进的任务上：只见改进按钮，不见主任务按钮。
6. `review_ready` 提示存在时：无主任务 completed 按钮。
7. 未绑定会话（若可模拟）：提示无法验收，不发成功 transition。

### 回归

- 改进「确认该改进任务已完成」仍可用；全部改进 accepted 后主任务 **不会** 自动 completed。
- 资料新标签 / HTML preview 行为不变。
- 计划审批 quick action 仍只读。

### 可访问性

- Tab 可达主任务按钮；aria-label 含「主任务」。
- 确认框键盘可操作。

## 审批门禁

- [x] brief / prd / design / implement / checks / ui / plan-review 已写。
- [x] HTML 原型已提供。
- [ ] 用户明确批准计划与原型。
- [ ] 批准后方可实现。
