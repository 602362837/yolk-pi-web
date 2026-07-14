# Implement：YPI Studio 浮窗计划/原型入口、完整状态与改进验收

## 先读文件

1. `docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/standards/code-style.md`
2. `components/YpiStudioSessionWidget.tsx`
3. `components/YpiStudioPanel.tsx`、`components/YpiStudioPlanReviewModal.tsx`
4. `lib/ypi-studio-session-link.ts`、`lib/ypi-studio-types.ts`、`lib/ypi-studio-task-preview.ts`
5. `app/api/studio/tasks/[taskKey]/route.ts`、`lib/ypi-studio-tasks.ts`
6. [UI 规范](ui.md) 与 [HTML 原型](ypi-studio-widget-state-prototype.html)

## 人类可读子任务表

| ID | 阶段 | 内容 | 依赖 | 主要文件 | 可并行 |
| --- | --- | --- | --- | --- | --- |
| DATA-01 | Data/API | 增加有界 quick-preview/approval descriptor，补测试夹具 | — | types、session-link、Studio DAG test | 否 |
| UI-01 | UI read-only | 任务详情和浮窗常驻计划/HTML 入口，参数化只读预览 | DATA-01 | Panel、Widget、Modal、preview helper、CSS | 否 |
| FLOW-01 | UI mutation | 八站 rail 与确认式改进验收，复用既有 PATCH/状态机并刷新 | DATA-01 | Widget、AppShell、CSS | 可与 UI-01 局部并行，但建议同一 writer 串行 |
| DOC-01 | Docs/check | 文档、自动验证和浏览器人工验收 | UI-01、FLOW-01 | docs、测试脚本/夹具 | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "DATA-01",
      "title": "扩展有界浮窗预览与审批态投影",
      "phase": "data-api",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-session-link.ts",
        "lib/ypi-studio-tasks.ts",
        "scripts/test-studio-dag.ts"
      ],
      "instructions": "为 widget 增加 additive quick preview descriptors，只投影主/改进 plan-review、HTML 文件名、显式 improvementId 和服务端审批态；不投影正文。审批态必须绑定当前 revision。补充纯逻辑测试覆盖批准前、批准后、revision 失效、归档和多改进显式寻址。",
      "acceptance": [
        "计划/原型 descriptor 不依赖 awaiting_approval 或 waiting_plan_approval 才存在",
        "所有改进 descriptor 都携带明确 improvementId",
        "projection 不含 Markdown/HTML body、完整反馈或 transcript",
        "旧任务和无 HTML 任务保持兼容"
      ],
      "validation": [
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "审批 revision 误判",
        "widget payload 膨胀",
        "归档路径 scope 错误"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "UI-01",
      "title": "实现任务详情与浮窗常驻只读计划和原型入口",
      "phase": "frontend-readonly",
      "order": 2,
      "dependsOn": ["DATA-01"],
      "files": [
        "components/YpiStudioPanel.tsx",
        "components/YpiStudioSessionWidget.tsx",
        "components/YpiStudioPlanReviewModal.tsx",
        "lib/ypi-studio-task-preview.ts",
        "app/globals.css"
      ],
      "instructions": "按批准原型增加同级快速预览区；计划 modal 支持主/改进文案，保持 GET-only；HTML 使用现有 mode=preview 新开页。按钮常驻并用图标、文字和 tone 表示待审/已批准/revision changed。保持 360px、多任务、拖拽和详情点击边界。",
      "acceptance": [
        "批准前后计划与 HTML 入口均可见，批准后仅变态不消失",
        "改进计划快速入口显式读取对应实例 plan-review.md",
        "HTML 通过新页面和 CSP sandbox 打开",
        "预览没有 PATCH、批准、编辑或 transition 控件",
        "键盘、Escape、焦点恢复和 reduced-motion 行为通过"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器检查桌面与 <=640px"
      ],
      "risks": [
        "modal 固定文案残留",
        "点击冒泡触发拖拽或详情",
        "多任务卡片高度增加"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FLOW-01",
      "title": "补齐八站状态图并接入改进用户验收",
      "phase": "frontend-state-machine",
      "order": 3,
      "dependsOn": ["DATA-01"],
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "components/AppShell.tsx",
        "app/globals.css",
        "app/api/studio/tasks/[taskKey]/route.ts",
        "lib/ypi-studio-tasks.ts"
      ],
      "instructions": "扩展 rail 为 Brief/Design/Implement/Checks/Review/User Acceptance/Completed/Archived，并以 workflow/status evidence 驱动。仅对 waiting_user_acceptance 改进显示验收按钮；通过 AppPrompt 明确确认后调用既有 transition_improvement -> accepted，携带当前绑定 contextId，成功刷新 widget/detail，失败刷新并提示。不要添加 override 或旁路 grant。",
      "acceptance": [
        "review、user_acceptance、completed、archived 都有正确站点显示",
        "八站在 360px 内两行显示且无横向溢出",
        "验收按钮只在 waiting_user_acceptance 出现",
        "取消确认不发请求；确认使用现有 API/状态机",
        "全部改进验收后主任务回 review 而非自动 completed",
        "竞态或服务端拒绝不产生本地伪完成"
      ],
      "validation": [
        "npm run test:studio-dag",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器执行等待验收、成功、取消、竞态失败、多改进流程"
      ],
      "risks": [
        "contextId 与独占绑定不一致",
        "状态 evidence 把规划文件误判为运行完成",
        "验收成功后多个 UI 缓存不同步"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-01",
      "title": "完成文档、回归验证与人工验收记录",
      "phase": "checks-docs",
      "order": 4,
      "dependsOn": ["UI-01", "FLOW-01"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        ".ypi/tasks/20260714-165219-优化-ypi-studio-浮窗计划-原型入口-状态站点图与改进验收/review.md"
      ],
      "instructions": "更新组件、projection 和既有 PATCH 使用说明；运行全套最小验证；用真实浏览器按 HTML 原型覆盖审批前后、改进验收、完成/归档、移动端、多任务和安全拒绝，并记录证据。",
      "acceptance": [
        "模块文档与最终 contract 一致",
        "lint、tsc、Studio DAG 测试通过",
        "人工验收覆盖计划只读、HTML 新开页、八站、确认验收和门禁不绕过",
        "无无关生产文件改动"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-dag"
      ],
      "risks": [
        "仅静态阅读而未验证真实用户流程",
        "文档遗漏 additive wire 字段"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "g1", "mode": "serial", "subtaskIds": ["DATA-01"] },
      { "id": "g2", "mode": "serial", "subtaskIds": ["UI-01", "FLOW-01"] },
      { "id": "g3", "mode": "serial", "subtaskIds": ["DOC-01"] }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

不得直接运行 `next build`。浏览器验收应启动/复用 `npm run dev`，按 [checks.md](checks.md) 执行。

## 回滚

删除 additive projection/UI 接线并恢复五站 rail；保留现有 files API、审批门禁和 improvement 状态机。通过该 UI 已产生的 `accepted` 是合法用户验收记录，不回滚或重写历史 task/event 文件。
