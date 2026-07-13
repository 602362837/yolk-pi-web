# Checks

## 需求覆盖

- [ ] notice、confirm、prompt API 与返回值符合 PRD。
- [ ] 13 个 `window.confirm` 和 1 个 `window.prompt` 全部迁移。
- [ ] 取消路径不执行原操作；确认路径只执行一次。
- [ ] 账户备注区分 `null` 取消、`""` 清除和非空更新。
- [ ] toast 是否纳入与用户决策一致；若纳入，ModelsConfig 局部实现已迁移。
- [ ] 复杂业务 modal 未被无关重构。

## 状态与并发

- [ ] 两个以上请求同时发起时 FIFO 展示。
- [ ] 每个 Promise 只 resolve 一次，重复点击和 Escape 不重复结算。
- [ ] Provider 卸载时 active/queued 请求均按取消语义结算。
- [ ] prompt 切换请求后草稿和错误重置。
- [ ] toast timer 在关闭、替换和卸载时清理。
- [ ] React Strict Mode 下无重复弹窗、重复 resolve 或遗留 body scroll lock。

## 无障碍与键盘

- [ ] dialog 有正确 role、`aria-modal`、标题和描述关联。
- [ ] confirm 初始焦点在取消；prompt 初始焦点在输入；notice 在确认。
- [ ] Tab/Shift+Tab 不离开弹窗。
- [ ] Escape 按契约取消；busy 时不能误关闭。
- [ ] Enter 仅在合法状态提交；IME composition 不误提交。
- [ ] 关闭后焦点回到仍存在的触发元素。
- [ ] 背景不可交互且页面滚动锁定；嵌套 modal 不产生双重 Escape。
- [ ] toast 使用合适 live region，不抢焦点、不重复播报。

## 响应式与视觉

- [ ] 浅色/深色主题均使用现有 CSS variables。
- [ ] 375px 宽度无横向溢出、文字遮挡或按钮截断。
- [ ] 长标题、长正文、中英文长词、校验错误均可读。
- [ ] 小高度视口正文可滚动，标题和操作区仍可用。
- [ ] danger 不只依赖颜色传达，按钮顺序与获批原型一致。
- [ ] reduced-motion 下无非必要动画。
- [ ] Settings、Studio drawer、Terminal dock、文件编辑器上方 z-index 正确。

## 业务回归

- [ ] Codex 重置机会确认与刷新锁修复。
- [ ] 删除会话、两个入口归档项目。
- [ ] Studio 任务归档和默认模板覆盖。
- [ ] 删除凭据、额度重置、账户备注。
- [ ] 跨 workspace 打开终端、关闭 dock、关闭最后 tab。
- [ ] 放弃未保存编辑并重载。

## 自动验证

```bash
rg -n '\bwindow\.(alert|confirm|prompt)\s*\(' app components hooks lib --glob '*.{ts,tsx}'
npm run lint
node_modules/.bin/tsc --noEmit
```

期望第一条无输出。注意 `session.prompt()`、extension UI 的 `confirm` 类型声明不是浏览器原生调用，不应误判。

## 审批门禁

- [ ] `ui-designer` 已交付任务本地 `.html` 原型。
- [ ] `ui.md` 链接原型并记录交付状态。
- [ ] 用户已审批 HTML 原型。
- [ ] 用户已审批 `plan-review.md` 和 implementation plan。
- [ ] 未满足以上四项时不得进入实现。

## 剩余风险

项目目前没有通用前端组件测试框架，焦点、读屏、嵌套层级和移动端主要依赖人工验收。建议实现时增加轻量 DOM 测试能力的成本需单独评估，不能为了本任务仓促引入大型测试栈。
