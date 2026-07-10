# Implement

## 前置门禁

先完成 [UI](./ui.md) 要求的 `ui-prototype.html`。主会话随后可保存本计划并转入 `awaiting_approval` 请求用户确认；在用户审批记录存在前不得修改生产代码。

## 先阅读

1. `docs/modules/frontend.md`
2. `docs/standards/code-style.md`
3. `components/YpiStudioSessionWidget.tsx`（`WorkflowRail`、dragging/mobile 分支）
4. `app/globals.css`（workflow rail、widget dragging、reduced-motion 规则）

## 子任务

| ID | 阶段 | 顺序 | 内容 |
| --- | --- | ---: | --- |
| `ui-rail-flow-prototype` | UI | 1 | UI 设计员交付五站流动/静止/reduced-motion HTML 原型并由用户审批。 |
| `rail-flow-presentation` | Implement | 2 | 给既有活动出站线添加表现 class 和受限 shimmer CSS，不改阶段语义。 |
| `rail-flow-regression` | Checks | 3 | 自动检查与多状态、拖拽、窄屏/减少动态人工回归。 |

```json ypi-implementation-plan
{"schemaVersion":1,"tasks":[{"id":"ui-rail-flow-prototype","title":"交付并审批五站轨道流动 HTML 原型","phase":"ui","order":1,"dependsOn":[],"files":[".ypi/tasks/20260710-123538-为-ypi-studio-任务悬浮卡片站点进度图增加流动效果/ui.md",".ypi/tasks/20260710-123538-为-ypi-studio-任务悬浮卡片站点进度图增加流动效果/ui-prototype.html"],"instructions":"ui-designer 按 ui.md 基于现有 360px 卡片交付独立 HTML；主会话取得用户审批并记录。","acceptance":["展示活动出站 shimmer、四类静止状态、多任务、移动 bottom sheet、dragging 和 reduced-motion","用户审批记录存在"],"validation":["浏览器预览 ui-prototype.html"],"risks":["未经审批改变等待或异常的动态含义"],"parallelizable":false,"localReview":false},{"id":"rail-flow-presentation","title":"实现受限的五站连线 shimmer","phase":"implement","order":2,"dependsOn":["ui-rail-flow-prototype"],"files":["components/YpiStudioSessionWidget.tsx","app/globals.css","docs/modules/frontend.md"],"instructions":"仅从既有 station/task/runtime 信息派生 is-flowing 表现 class；只给 current 活动阶段的非末站出站线增加低频渐变流动。用 line 伪元素背景位移，不改 workflow/artifact 映射、props、API、点击、移动端或拖拽 shell transform；panel dragging 和 prefers-reduced-motion 必须冻结动画。","acceptance":["活动 current 出站线单向流动","awaiting approval、attention、failed、blocked、done、unknown、ready/completed 与末站静止","无 API/type/task JSON 变更","Detail、drawer focused、ball 和多任务行为未改变"],"validation":["npm run lint","node_modules/.bin/tsc --noEmit"],"risks":["条件过宽导致等待状态看似运行","伪元素在窄轨道溢出","与拖动动画冲突"],"parallelizable":false,"localReview":true},{"id":"rail-flow-regression","title":"回归验证五站轨道视觉和交互","phase":"checks","order":3,"dependsOn":["rail-flow-presentation"],"files":["components/YpiStudioSessionWidget.tsx","app/globals.css"],"instructions":"执行 checks.md；用真实或 fixture 任务覆盖活动、审批等待、注意、失败/阻塞、完成、多卡、移动、drawer focused、Detail-only、收纳球和 reduced-motion。","acceptance":["所有检查通过","没有状态语义或既有 widget 行为回归"],"validation":["npm run lint","node_modules/.bin/tsc --noEmit","git diff --check"],"risks":["视觉问题只能在浏览器和 OS reduced-motion 中发现"],"parallelizable":false,"localReview":true}]}
```

## 建议实现顺序

UI 审批后，先以小型纯函数/局部布尔值确定是否附加 class，再写 CSS 伪元素与暂停规则，最后更新 frontend 模块文档。不要重构 `WorkflowRail` 的状态推导。

## 回滚

回滚上述三文件中的 presentation-only 改动即可；不涉及数据或配置恢复。