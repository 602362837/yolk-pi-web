# Checks

## 需求覆盖检查

- [ ] 窄侧栏下普通 Session 行不换行、不错位。代码已补齐 `minWidth: 0` / `overflow: hidden` / `whiteSpace: "nowrap"` / `textOverflow: "ellipsis"`，但未执行浏览器窄宽手工验收。
- [ ] 窄侧栏下 Studio child Session 行不换行、不不错位，标题优先显示 subtask 标题。代码路径已覆盖，但未执行浏览器窄宽手工验收。
- [x] 无 subtask 标题时 Studio child 标题回退为 `member · 主任务名称`。
- [ ] Archived Session 行在窄侧栏和 hover/delete confirm 下不换行、不改变行高。代码路径已覆盖，但未执行浏览器窄宽/hover/delete confirm 手工验收。
- [ ] 新 SDK child session 写入的 `session_info` 名称符合 subtask 优先规则。静态代码已满足；未触发真实新 child run 验证。
- [x] 历史 child session 不迁移但显示可通过投影修正。

## 自动验证

当前检查结论：UI 审批门禁已满足；`npm run lint` 与 `node_modules/.bin/tsc --noEmit` 已通过。浏览器窄宽回归与真实 SDK child run 命名核对仍建议补做，但在本轮作为非阻塞建议处理。

实现后至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议补充轻量验证（如实现员方便）：

- 对 `displayTitleForSession()` 构造本地样例，覆盖：有 subtask、有 taskTitle 无 subtask、只有 taskId、普通 session。
- 启动 `npm run dev` 后在浏览器手工缩窄侧栏检查布局。

## 手工验收

1. Session 侧栏宽度拖到约 160px 或更小。
2. 检查普通 session：标题、时间、msgs 不换行，行高稳定。
3. 检查 Studio child session：
   - 有 implementation subtask 的 child 显示 subtask 标题；
   - tooltip 可看到完整标题/详情；
   - Studio badge/detail 不撑高行。
4. 鼠标 hover session 行，rename/archive/delete 按钮出现时行高不变。
5. 进入 delete confirm 状态，确认/取消按钮不导致上下行覆盖。
6. 展开 Archived sessions，重复窄宽/hover/delete confirm 检查。
7. 触发一个新的 SDK Studio implementer child run，确认新 child session audit 名称不是单纯主任务名。

## 回归风险

- Session 列表 hover 操作区与多选 checkbox 同时出现时可用宽度更小，是重点回归点。
- 中文长标题、英文长单词、长 run id、长 WorkTree branch 都需检查。
- Studio task detail 不存在/归档/读取失败时，列表不能报错。

## 审批门禁

- [x] `ui-designer` 已产出 HTML 原型。
- [x] 用户/主会话已批准 HTML 原型。
- [x] 批准记录写入 `ui.md` 或任务事件后，才可进入实现。
