# Implement

> 仅为获批后的执行计划；本阶段不修改生产代码。主会话必须先保存 implementationPlan、让用户审阅 `plan-review.md` 与 HTML 原型，并停在 `awaiting_approval`。

## 需先阅读

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `components/YpiStudioSessionWidget.tsx`
- `components/YpiStudioPanel.tsx`（`TaskApprovalTab`、`ImprovementPlanReviewPreview`、task-relative link helpers）
- `components/MarkdownBody.tsx`
- `components/AppShell.tsx`（`handleOpenFile` 与 widget props）
- `app/api/studio/tasks/[taskKey]/files/route.ts`
- `lib/ypi-studio-tasks.ts`（task/improvement relative file resolver）
- `lib/ypi-studio-types.ts`
- 本任务的 `ui.md`、`ui-prototype.html`、`checks.md`

## 人类可读子任务表

| ID | Phase | Order | 依赖 | 主要文件 | 工作 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| IMP-1 | implement | 1 | - | `lib/ypi-studio-task-preview.ts`（建议新增）、`components/YpiStudioPanel.tsx` | 抽取并复用 task-relative href/path helper，保持 Panel 行为不变 | 否 |
| IMP-2 | implement | 2 | IMP-1 | `components/YpiStudioPlanReviewModal.tsx`（新增）、`app/globals.css` | 实现按需读取、Markdown、链接、状态、焦点和响应式 modal | 否 |
| IMP-3 | implement | 3 | IMP-2 | `components/YpiStudioSessionWidget.tsx`, `components/AppShell.tsx` | 增加主任务/改进项入口并接入 modal/cwd/file viewer | 否 |
| IMP-4 | docs | 4 | IMP-3 | `docs/modules/frontend.md` | 更新组件职责和审批预览边界 | 可与测试准备并行 |
| IMP-5 | checks | 5 | IMP-3, IMP-4 | 相关生产文件与 `checks.md` | lint、tsc、Studio DAG 回归、浏览器桌面/移动验收 | 否 |

## 实现要点

1. 不把 `plan-review.md` 正文加入 widget projection；仅点击后 fetch。
2. 入口条件只使用语义状态值：主任务 `awaiting_approval`、改进项 `waiting_plan_approval`。
3. 每个改进入口携带稳定 `improvementId`；禁止以 first item 猜测用户目标。
4. Modal 请求 key 含 `cwd/taskKey/improvementId/retryToken`，effect cleanup abort；过期响应不得覆盖当前 target。
5. meaningful 判定与现有审批 Tab 一致；空/TBD 进入明确 empty state。
6. Markdown 相对链接共享现有解析逻辑；HTML 继续走 `mode=preview` CSP sandbox，改进项保留 improvement scope。
7. Modal 只读，不调用 task PATCH，不写 approval grant/revision/transition。
8. `TaskCard` 审批按钮阻止 pointer/click 冒泡；详情箭头、拖拽、收纳和移动 sheet 保持原行为。
9. 实现应对齐已审批的 [HTML 原型](./ui-prototype.html)，不得自行扩展批准操作。

```json ypi-implementation-plan
{
  "version": 1,
  "subtasks": [
    {
      "id": "IMP-1",
      "title": "共享任务本地预览链接逻辑",
      "phase": "implement",
      "order": 1,
      "dependsOn": [],
      "files": ["components/YpiStudioPanel.tsx", "lib/ypi-studio-task-preview.ts"],
      "instructions": "将 YpiStudioPanel 中 taskRelativeFilePath、resolveTaskRelativeHref 及主任务/改进项链接所需的纯逻辑抽为 client-safe 共享 helper，并让现有 Panel 调用共享实现。保持 HTML sandbox、非法路径提示、改进项 scope 与当前行为一致；服务端 resolver 仍是安全权威。",
      "acceptance": ["Panel 现有主计划和改进计划链接行为不变", "客户端拒绝 scheme、绝对路径、.. 和反斜杠", "改进项链接始终保持 improvementId scope"],
      "validation": ["静态审查所有旧 helper 调用方", "对合法 Markdown/HTML 与非法路径做 focused helper 检查"],
      "risks": ["抽取时改变现有 Panel 文件路径", "客户端校验被误当成服务端安全边界"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-2",
      "title": "实现只读计划审批书模态预览",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["IMP-1"],
      "files": ["components/YpiStudioPlanReviewModal.tsx", "components/MarkdownBody.tsx", "app/globals.css"],
      "instructions": "新增专用 modal：打开后调用既有 task files mode=read；支持主任务与 improvementId；用 MarkdownBody 渲染并接入共享相对链接；实现 loading、success、empty/TBD、error/retry、AbortController、长内容滚动、Escape/backdrop/关闭、focus trap/restore 和移动端布局。不得增加批准或状态写操作。",
      "acceptance": ["只在打开后请求正文", "所有读取状态有明确反馈", "预览固定提示不会自动批准", "dialog 键盘与焦点行为可用", "Markdown/HTML 相对链接遵循 task-local 安全契约"],
      "validation": ["模拟 200/404/403/网络失败/空内容", "快速切换 target 验证旧响应不覆盖", "键盘与移动视口手工检查"],
      "risks": ["请求竞态", "焦点逃逸", "长 Markdown 撑破视口", "错误信息泄露服务端绝对路径"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-3",
      "title": "在 Studio 任务浮窗接入审批入口",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["IMP-2"],
      "files": ["components/YpiStudioSessionWidget.tsx", "components/AppShell.tsx", "lib/ypi-studio-types.ts"],
      "instructions": "TaskCard 根据主任务 awaiting_approval 和每个 improvement waiting_plan_approval 生成独立入口；widget 保存 preview target 并渲染 modal；AppShell 传入授权 cwd 与现有 handleOpenFile。入口放入独立 flex-wrap action row，阻止事件冒泡，桌面与移动端共用。仅在确有必要时调整类型，禁止加入正文投影。",
      "acceptance": ["主任务入口显隐准确", "多个改进项可分别打开且不串读", "非审批态无入口", "详情箭头、拖拽、收纳球、排序、绑定过滤和移动 sheet 无回归"],
      "validation": ["构造主 awaiting_approval 与非审批态", "构造两个 waiting_plan_approval 改进项", "桌面拖拽/收纳与移动 sheet smoke"],
      "risks": ["360px 卡片拥挤", "按钮事件触发拖拽或详情", "session 切换后保留旧 modal"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-4",
      "title": "更新前端模块文档",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["IMP-3"],
      "files": ["docs/modules/frontend.md"],
      "instructions": "记录 YpiStudioSessionWidget 的等待审批入口、YpiStudioPlanReviewModal 的按需读取/只读边界、主任务与改进项状态条件，以及对现有 task-local files API/MarkdownBody 的复用。",
      "acceptance": ["文档与最终实现一致", "明确预览不授予审批且不嵌入 widget 正文"],
      "validation": ["人工对照代码与 API 文档"],
      "risks": ["文档声称未实现能力"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "IMP-5",
      "title": "执行自动与用户路径验收",
      "phase": "checks",
      "order": 5,
      "dependsOn": ["IMP-3", "IMP-4"],
      "files": ["components/YpiStudioSessionWidget.tsx", "components/YpiStudioPlanReviewModal.tsx", "components/YpiStudioPanel.tsx", "components/AppShell.tsx", "app/globals.css", "docs/modules/frontend.md"],
      "instructions": "执行 lint、TypeScript 和 Studio DAG 回归；按 checks.md 在真实浏览器验证主任务/多改进项入口、Markdown/HTML 链接、所有读取状态、焦点、桌面/移动和原浮窗交互。checker 需对照获批 HTML 原型独立审查。",
      "acceptance": ["自动验证通过", "浏览器主路径和错误路径通过", "无审批门禁写入或浮窗回归", "checker 记录原型一致性结论"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "npm run test:studio-dag", "checks.md 浏览器矩阵"],
      "risks": ["静态检查无法覆盖 dialog 焦点和移动布局", "仅单一任务样本漏掉多改进项串读"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

不得直接运行 `next build`。浏览器验收按 `checks.md` 执行。

## 检查门禁

- 用户明确批准 `plan-review.md` 与 `ui-prototype.html` 后，主会话才可进入 `implementing`。
- 实现员必须逐子任务执行；checker 独立验证 UI 原型一致性、安全链接、审批只读边界和回归。
- 若实现需要在 modal 内新增批准按钮、改变 task API/schema 或改变浮窗尺寸，必须停止并退回用户重新审批。

## 回滚

删除新增 modal、widget 入口与 AppShell props，并恢复 Panel helper 抽取即可。没有 API/schema/数据迁移，历史任务无需处理。
