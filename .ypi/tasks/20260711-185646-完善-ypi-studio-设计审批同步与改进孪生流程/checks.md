# Checks - 第三版改进流程

## 自动验证

- `npm run test:studio-policy`
- `npm run test:studio-dag`
- `npm run lint`
- `node_modules/.bin/tsc --noEmit`

## 必须新增的契约检查

1. 默认成员初始化、Settings 固定排序和模型策略均包含 `improver`；未设置该成员时仍正确落到默认策略。
2. 旧 task 没有 improvements 字段仍可读取；不会自动写回或成为顶层任务。
3. 只能在 active 主任务 `review` 或 `user_acceptance` 创建改进项；未确认反馈、completed、archived、跨 cwd/context 均被拒绝。
4. 改进项 id 只能属于其主任务，目录只能在 `.ypi/tasks/<task>/improvements/<imp-id>/`；文件 API 拒绝 URL、绝对路径、`..` 和 symlink escape。
5. 创建改进项与主任务转 `waiting_for_improvements` 是同一锁内 mutation；重复请求不产生两项。
6. improver -> 必要 UI/计划批准 -> implementer -> checker -> 用户验收的非法跳转被拒绝；失败/取消/blocked 不被算作解决。
7. 任一未解决改进项会阻止主任务 completed/archive；最后一项被接受或明确 accepted_not_doing 后，主任务只回 review 并生成“再次验收”通知。
8. revision 修改时，同步材料不完整、需要 HTML 却缺 HTML、旧 revision grant 或错误 context 都不能进入实现。
9. detail/widget 只返回数量、状态、阻塞、下一步和有界 run 摘要；不返回完整反馈或 child transcript。

## 人工验收

1. 在主任务验收提出两条问题，确认 main 先在聊天确认，再创建两个改进项；顶层任务列表不增加条目。
2. 检查浮窗文字为“待处理改进 N 项”、具体阻塞和下一步；点击只进入详情。
3. 打开 `改进流程` Tab，验证列表卡和详情五个页签内容与 [ui.md](ui.md) 一致，窄屏和键盘可用。
4. 在 Settings -> Studio 检查改进师排在架构师后、UI 设计员前，可保存模型和思考强度；Members Tab 的“修改模型”定位到该行。
5. 让一项需要 UI 原型，一项为已批准范围内的小修；确认前者必须独立审批，后者显示继承依据。
6. 取消一项，确认主任务仍被阻塞；用户明确“接受不处理”后留下理由、时间和上下文，且全部结束后主任务回 review 而非 completed。
7. 修改改进计划后确认审批书、相关 Markdown 和 HTML（需要时）均为同一 revision，旧批准不可复用。

## 重点风险

- 多个改进项并发终态更新导致主任务错误完成。
- instance 文件边界、绑定上下文或子成员权限绕过主任务。
- 默认模板刷新覆盖用户自定义 member/workflow。
- 浮窗信息过长或把敏感反馈/transcript 放入轻量投影。
