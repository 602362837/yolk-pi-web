# Checks：YPI Studio 浮窗计划/原型入口、完整状态与改进验收

## 需求覆盖

- [x] 任务详情有主计划审批书与每个改进计划的同级快速只读入口。 *(代码：`YpiStudioPanel` 改进流程「快速预览」)*
- [x] 主/改进入口显式使用 `taskKey + optional improvementId + fileName`，多改进不串读。 *(代码 + DAG 测试)*
- [x] 浮窗计划审批书在批准后、实现、检查、验收、完成和归档阶段仍可见。 *(投影不依赖 awaiting_approval；DAG 覆盖批准后/归档)*
- [x] 计划和 HTML 原型状态同时使用图标、文字、颜色，revision 变化后恢复待确认。 *(widget tone + `revision_changed` 投影)*
- [x] HTML 原型点击新开页，使用现有 task-local `mode=preview` 与 CSP sandbox。 *(代码：`openStudioTaskHtmlPrototype`)*
- [x] 完整八站显示 Brief、Design、Implement、Checks、Review、User Acceptance、Completed、Archived。 *(代码：`WORKFLOW_RAIL_STAGES`)*
- [x] `waiting_user_acceptance` 改进项有浮窗验收按钮，其他状态无此按钮。 *(代码过滤)*
- [x] 验收前有明确确认；取消不写，确认调用既有 `transition_improvement → accepted`。 *(代码：AppPrompt + PATCH)*
- [x] 全部改进解决后主任务回 `review` 再验收，不自动完成。 *(状态机 + DAG 既有覆盖)*

> 注：以上 [x] 表示实现与自动/静态验收已覆盖契约；带 ⚠ 的浏览器项仍需人工在真实 UI 勾选。

## 安全与门禁

- [x] 计划/原型预览只发 GET，不 PATCH、不写 approvalGrant、不 transition。
- [x] `awaiting_approval` 与 `waiting_plan_approval` 仍只能由 Chat 明确用户输入产生审批证据。
- [x] 浮窗验收请求不带 `override`，服务端重新校验 task 绑定、improvementId、当前状态和合法 transition。
- [x] scheme、绝对路径、`..`、反斜杠、目录、symlink escape 仍被服务端拒绝。 *(既有 files resolver 未改坏)*
- [x] widget projection 不含 Markdown/HTML body、完整 feedback、prompt/output 或 transcript。
- [x] archived 卡片绝不显示验收/写状态按钮。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

DOC-01 执行结果（2026-07-14）：

- `npm run lint` — Pass（0 errors；无关文件 6 warnings）
- `node_modules/.bin/tsc --noEmit` — Pass
- `npm run test:studio-dag` — Pass

建议测试覆盖状态：

1. [x] quick preview descriptors 在审批前后、revision 清除、completed/archived 均稳定。
2. [x] 两个 waiting/accepted 改进项的 descriptor 与 improvementId 一一对应。
3. [~] workflow status 到八站状态映射主要在前端组件实现；服务端 DAG 不直接测 UI rail（人工/静态审查）。
4. [x] `waiting_user_acceptance → accepted` 记录 acceptance，并在最后一项完成后 reconcile parent 到 review。
5. [x] 非 waiting_user_acceptance、错误 improvementId、未绑定 context 的 PATCH 被拒绝（既有任务/DAG 路径）。

## 浏览器人工验收

### 桌面 360px、多任务与拖拽

- [ ] ⚠ 绑定至少两个任务；面板仍为 360px，任务排序、滚动、详情按钮和卡片隔离正常。
- [ ] ⚠ 拖动 header、收纳悬浮球、恢复面板；action 按钮点击不触发拖拽或 Detail。
- [ ] ⚠ 八站两行无水平滚动，长标题/多按钮合理换行。

### 审批前后与只读预览

- [ ] ⚠ awaiting_approval：计划和原型显示待审批/待确认。
- [ ] ⚠ Chat 批准并进入 implementing：入口不消失，显示已批准/已确认。
- [ ] ⚠ 修改计划 bump revision：入口保留但恢复需重审。
- [ ] ⚠ 计划 modal 的加载、空/TBD、错误、重试、关闭和焦点恢复正常；无编辑/批准按钮。
- [ ] ⚠ HTML 在新页打开；弹窗被浏览器阻止时有现有安全 fallback，不内联执行到主页面。

### 改进验收

- [ ] ⚠ 多个改进项中只有 `waiting_user_acceptance` 项显示验收按钮，按钮写明 IMP id/title。
- [ ] ⚠ 点击后对话框明确“改进结果验收，不是计划审批”；Escape/取消不发 PATCH。
- [ ] ⚠ 确认时按钮 busy/disabled，重复点击只产生一次有效 transition。
- [ ] ⚠ 成功后该项显示已验收，widget 与 drawer 同步刷新；仍有其他未解决项时主任务继续阻塞。
- [ ] ⚠ 最后一项成功后主任务显示需要再次验收；不自动 completed/archive。
- [ ] ⚠ 在确认期间由其他页面先改变状态，服务端拒绝后 UI 刷新并提示，不显示伪成功。

### 完成、归档与移动端

- [ ] ⚠ user_acceptance、completed、archived 均有对应站点，归档显示只读。
- [ ] ⚠ completed/archived 仍可打开历史计划和 HTML 原型。
- [ ] ⚠ `≤640px` bottom pill/sheet 保持相同入口、八站语义、确认对话和安全区；键盘与读屏标签完整。
- [ ] ⚠ `prefers-reduced-motion` 下无依赖动效的状态表达。

## 重点评审风险

1. 不得把 `checks.md` 存在误判为 runtime Checks 已完成。
2. 不得把“打开原型/计划”记为批准。
3. 不得只刷新 drawer 而留下 widget stale，或反之。
4. 不得将 main task acceptance 与 improvement acceptance 混为同一按钮/API。
5. 不得为了八站图改变服务端 workflow transition；它只是权威状态的展示映射。
