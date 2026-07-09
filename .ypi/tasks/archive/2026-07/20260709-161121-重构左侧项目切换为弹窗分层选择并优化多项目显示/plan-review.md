# plan review

## 审批请求

请审阅并确认本计划：将左侧项目/空间切换从窄 sidebar dropdown 重构为“左侧顶部切换按钮 + 分层选择弹窗”。该改动涉及用户可见交互，必须先确认 HTML 原型，确认前不进入实现。

## 审阅材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 说明](ui.md)
- [HTML 原型：project-switch-modal-prototype.html](project-switch-modal-prototype.html)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)

## PRD 摘要

- 取消当前左侧项目选择 dropdown。
- 左侧顶部改为可点击切换按钮，展示当前项目/空间摘要。
- 点击打开 modal/dialog；弹窗按“先项目、再项目空间”分层选择。
- 优化项目很多时的显示：独立滚动、搜索、长文本省略、当前状态高亮。
- 覆盖新环境无项目：弹窗空状态直接提供添加第一个项目入口。
- 不改变 Project Registry、session JSONL、WorkTree 后端语义。

## UI 摘要

- 原型路径与交互验证：[`project-switch-modal-prototype.html`](project-switch-modal-prototype.html)。已升级为支持多维度交互的原型，可用于模拟大量项目独立滚动、搜索过滤、互斥表单和零项目 onboarding 等流程。
- 门禁状态：UI 设计员已确认原型。待用户确认。未确认前不得进入实现。

## Design 摘要

- 首选新增 `components/ProjectSpaceSwitchDialog.tsx`，由 `SessionSidebar.tsx` 传入项目数据、当前选择和现有 add/switch callbacks。
- 复用现有 API：`/api/projects?sync=missing`、`/api/projects`、`/api/projects/select-directory`、`/api/projects/git-clone`、`/spaces/[spaceId]/sessions`。
- 选择空间仍执行 `setSelectedProjectId` + `setSelectedSpaceId` + `setSelectedCwd`，复用现有 effects 重新加载 sessions/Git/file explorer。
- 空状态仍坚持 Project Registry 是唯一顶层项目来源，不扫描 sessions 合成项目。

## Implement 摘要

1. 抽离/替换 `SessionSidebar` 的旧 dropdown 状态和触发入口。
2. 实现 `ProjectSpaceSwitchDialog` 的项目列表、空间列表、搜索、空状态和添加项目表单。
3. 迁移现有注册目录、手动路径、Git clone、默认目录流程。
4. 保持 WorkTree、missing、metadata、session reload 和 AppShell title 联动。
5. 更新前端模块文档并运行 lint/tsc。

完整实现计划见 [Implement](implement.md)。

## Checks 摘要

- 自动验证：`npm run lint`、`node_modules/.bin/tsc --noEmit`。
- 手工重点：50+ 项目显示、空 registry 首次添加、WorkTree 右键、missing 禁用、Git clone 失败不切换、键盘关闭/焦点。

## 等待确认的问题

1. 搜索行为是否接受首版推荐：搜索过滤项目并在右侧过滤当前项目空间，但不把空间提升为顶层结果？
2. 点击空间是否接受“立即切换并关闭”的交互？
3. HTML 原型是否可作为实现基准？

规划材料齐备后，主会话可切到 `awaiting_approval` 并以本文件请求用户确认；获得用户明确批准后再派实现员。
