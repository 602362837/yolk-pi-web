# Design — IMP-001 任务资料预览滚动

## 方案摘要

把「任务资料文档视图」收敛为**单一、有界高度的滚动容器**（`.ypi-studio-task-document-body`）：

- **Page**：viewport → page → document root 建立 `height:100dvh`（或等价 `100%`）flex 列；头/只读条 `flex:none`；body `flex:1; min-height:0; overflow:auto`。  
- **Embedded**：document 打开时，详情 shell 与必要时的 TasksTab 外层改为 `overflow:hidden` + 传满可用高度；同一 body 规则成为 sole scroller。  
- 普通详情 Tab 保持现有 shell `overflowY:auto`，避免回归。

## 影响模块

### `app/globals.css`（主）

建议调整（名称可微调，语义固定）：

```css
.ypi-studio-task-document-page {
  height: 100dvh;          /* was min-height only */
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;        /* prevent window dual-scroll */
}

.ypi-studio-task-document.is-page {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;            /* fill page */
  max-width: 920px;
  /* keep horizontal padding; avoid unbounded growth */
  overflow: hidden;
}

.ypi-studio-task-document.is-embedded {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;        /* shell scrolls never; body does */
}

.ypi-studio-task-document-body {
  flex: 1 1 auto;
  min-height: 0;           /* critical for flex child scroll */
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  /* remove or soften min-height:240px if it fights flex in short viewports */
}
```

可选：page 头 `position: sticky; top: 0; background; z-index` 作为防御，但优先 flex 固定头。

### `app/studio/task-document/page.tsx`

- 确保 `<main className="ypi-studio-task-document-page">` 在 layout 的 flex body 下可 `flex:1` 或自身 `height:100dvh`。  
- Suspense fallback 使用同一 page 高度类，避免首屏高度跳动。

### `components/YpiStudioTaskDocumentView.tsx`

- Root 已有 `is-page` / `is-embedded` class；确认无额外撑开高度的 inline style。  
- 可选增强（推荐，小改动）：  
  - `bodyRef` 容器加 `tabIndex={0}`（或 `-1` + 进入时 `focus({preventScroll:true})`），使 wheel 默认目标为 body。  
  - **不要**在 page 模式抢焦点打断读屏；embedded 可在 focus 返回按钮之后，将「后续 wheel」仍落到 body（CSS 高度链优先，焦点为辅）。  
- 保持 AbortController / 链接策略不变。

### `components/YpiStudioPanel.tsx`

- `TaskDetailShell` 增加可选 prop，例如 `scrollMode: "auto" | "lock"`：  
  - 默认 `auto`：现有 `overflowY:auto`（普通 Tab）。  
  - document 打开：`lock` → `overflow:hidden` + `display:flex; flexDirection:column; minHeight:0; flex:1`，children 吃满高度。  
- `TasksTab` 在 `documentTarget != null` 时，外层容器由 `overflowY:auto` 改为 `overflow:hidden` 并保证 `flex:1; minHeight:0` 链从 panel 根传到 shell。  
- 关闭 document 后恢复原 overflow，无需改 Tab 内容结构。

## 数据流 / 接口

无 API 变更。仍：

`GET /api/studio/tasks/[taskKey]/files?mode=read|preview&...`

## 兼容性

- 归档任务、improvementId 路径、只读文案、嵌套链接替换 target 行为不变。  
- Legacy `YpiStudioPlanReviewModal` 不在本改进范围（其自身已有 max-height + overflow）。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 锁 shell overflow 后普通 Tab 不能滚 | 仅 documentTarget 分支 lock |
| `height:100dvh` 与移动浏览器工具栏 | 优先 `100dvh`，短视口用 `min-height:0` + flex；人工验 iOS/窄屏 |
| min-height:240px 导致短屏双滚 | 改为 `min-height:0` 或仅 empty/error 状态保留最小高度 |
| focus 策略干扰 a11y | 高度链为主；焦点增强可关或仅 embedded |
| 外层 TasksTab 仍吃 wheel | document 打开时同步 lock 外层 |

## 回滚

还原 CSS 与 shell 条件分支即可；无数据迁移。
