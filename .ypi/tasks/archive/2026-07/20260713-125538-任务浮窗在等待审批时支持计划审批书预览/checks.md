# Checks

## 需求覆盖

- [ ] 主任务只有 `awaiting_approval` 显示「计划审批书」；`planning/implementing/checking/review/completed` 不显示。
- [ ] 每个 `waiting_plan_approval` 改进项有独立 `IMP-xxx` 入口；其它改进状态无入口。
- [ ] 点击后渲染对应 task root / improvement root 的 `plan-review.md`，不串读。
- [ ] 弹窗明确“预览不会自动批准”，且没有批准/拒绝/PATCH 操作。
- [ ] 桌面展开浮窗和移动端任务 bottom sheet 都能进入预览。
- [ ] 详情箭头、拖拽、收纳球、排序、绑定过滤和原审批流程无回归。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

如增加纯 task-relative href helper，建议补充 focused Node 测试或现有测试脚本覆盖：合法 `prd.md`/`ui-prototype.html`，以及 scheme、绝对路径、`..`、反斜杠拒绝。

## API / 安全检查

使用一个绑定且授权的测试 cwd/task：

- [ ] `mode=read&path=plan-review.md` 返回主计划 Markdown。
- [ ] 加 `improvementId` 后只读取对应实例目录。
- [ ] 错误/未知 improvementId 不回退到主任务目录。
- [ ] `https://...`、`/abs/path`、`../task.json`、`..\\task.json` 被拒绝。
- [ ] symlink 逃逸被服务端拒绝。
- [ ] HTML 相对链接使用 `mode=preview`，响应保留 CSP sandbox、`nosniff`、`no-referrer`。
- [ ] 客户端错误文案不直接展示敏感绝对路径或堆栈。

## 浏览器手工验收

### 1. 主任务入口

1. 打开一个绑定当前 session 的 Studio 任务并使其进入 `awaiting_approval`。
2. 展开 360px 浮窗。
3. 确认卡片显示「计划审批书」，详情箭头仍可点击。
4. 点击预览，确认只在此时发起 task files `mode=read` 请求。
5. 确认标题、只读提示、Markdown 内容和源文件入口正确。
6. 关闭弹窗，确认仍在当前聊天；task 仍为 `awaiting_approval`，无 approvalGrant。
7. 将任务退回/推进至其它状态，确认入口消失。

### 2. 多改进项

1. 构造至少两个改进实例，其中两个为 `waiting_plan_approval`，另一个为其它状态。
2. 确认仅两个等待项显示入口，文案分别包含各自 `IMP-xxx`。
3. 分别打开，检查请求 URL 的 `improvementId` 与正文均对应实例。
4. 点击改进计划中的 Markdown/HTML 相对链接，确认保持同一 improvement scope。

### 3. 读取状态

逐项模拟或构造：

- [ ] 慢请求：显示 loading，可直接关闭，关闭后请求中止/响应不再更新 UI。
- [ ] 200：Markdown 标题、列表、表格、代码块、链接正常。
- [ ] 空文件/TBD：显示“尚未准备好”，不渲染为可审阅正文。
- [ ] 404：显示缺失状态和重试。
- [ ] 403/安全拒绝：显示安全访问失败和重试。
- [ ] 网络失败：显示读取失败；重试后可恢复。
- [ ] 快速先开任务 A 再开任务 B：A 的晚到响应不能覆盖 B。

### 4. 弹窗与可访问性

- [ ] `role=dialog`、`aria-modal=true`、标题关联正确。
- [ ] 打开时焦点进入关闭按钮/dialog；Tab/Shift+Tab 不逃到背景。
- [ ] Escape、右上角、遮罩均关闭；正文内点击不关闭。
- [ ] 关闭后焦点回到触发入口。
- [ ] loading/error 使用 live region，错误不只靠颜色。
- [ ] 长 Markdown 仅正文区滚动，header/只读提示/footer 保持可见。
- [ ] reduced-motion 下无不必要动画。

### 5. 桌面/移动与主题

- [ ] 浅色、深色下按钮、只读提示、正文和错误对比度可读。
- [ ] 360px 浮窗中 action row 不横向溢出；长任务名与多个按钮正常换行。
- [ ] 面板拖拽、收纳球轻点恢复、位置持久化正常。
- [ ] `<=640px`：Studio pill → bottom sheet → 计划预览路径可用。
- [ ] 移动 modal 接近全屏但保留关闭入口、滚动和 safe area。

## 代码审查重点

- [ ] widget projection 没有新增 plan-review 正文或完整 improvement feedback。
- [ ] 显隐基于状态 id，不基于中文 label 或 artifact 是否存在。
- [ ] 改进项 target 使用稳定 id，不靠数组首项猜测。
- [ ] fetch effect 有 AbortController、target/retry key 和 stale response 防护。
- [ ] Modal 不调用 PATCH、transition、record approval 等写 API。
- [ ] task-relative helper 抽取后 `YpiStudioPanel` 现有行为不变。
- [ ] 服务端仍是路径安全权威；客户端校验没有替代服务端 resolver。
- [ ] UI 与用户批准的 `ui-prototype.html` 一致，无未批准范围扩张。

## 回归风险

1. `TaskCard` 同时被桌面和移动端复用，事件冒泡修复必须两端一致。
2. Panel helper 抽取可能影响已有任务详情 plan-review 链接，应专项回归。
3. 多任务/多改进项会暴露 target 竞态，不能只测单任务 happy path。
4. 浏览预览不能被 input hook 视为用户批准；task.json 不应因打开/关闭而变化。

## 通过门槛

自动验证全部通过；浏览器主路径、错误路径、多改进项、键盘和移动端均有证据；checker 无阻塞发现，且确认没有绕过审批门禁。
