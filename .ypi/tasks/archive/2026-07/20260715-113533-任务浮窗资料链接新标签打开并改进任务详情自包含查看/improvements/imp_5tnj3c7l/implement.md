# Implement — IMP-001 任务资料预览滚动

## 需先阅读

1. 本改进 `brief.md` / `prd.md` / `design.md` / `checks.md` / `ui.md` / HTML 原型  
2. `components/YpiStudioTaskDocumentView.tsx`  
3. `app/studio/task-document/page.tsx`  
4. `app/globals.css`（`.ypi-studio-task-document-*`）  
5. `components/YpiStudioPanel.tsx`（`TaskDetailShell`、`TasksTab` document 分支）  
6. `docs/modules/frontend.md` 中 task document 段落  

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 主要文件 | 可并行 |
| --- | ---: | ---: | --- | --- | --- | --- |
| IMP1-SCROLL-1 | css-page | 1 | Page 模式 100dvh flex 高度链 + body sole scroller | — | `app/globals.css`, `app/studio/task-document/page.tsx` | 否 |
| IMP1-SCROLL-2 | embedded | 2 | Document 打开时 shell/TasksTab lock overflow，embedded 单滚 | IMP1-SCROLL-1 | `components/YpiStudioPanel.tsx`, `app/globals.css` | 否 |
| IMP1-SCROLL-3 | polish | 3 | 焦点/触控微调、文档与回归验证 | IMP1-SCROLL-2 | `YpiStudioTaskDocumentView.tsx`, `docs/modules/frontend.md` | 否 |

## 执行步骤

### 1. Page 高度链

- `.ypi-studio-task-document-page`：`height/max-height:100dvh; display:flex; flex-direction:column; overflow:hidden; min-height:0`。  
- `.is-page`：填满 page（`flex:1; min-height:0; overflow:hidden`），保留 max-width 居中。  
- `.ypi-studio-task-document-body`：确保 `min-height:0; flex:1; overflow:auto; overscroll-behavior:contain`。  
- 验证 layout body flex 下 page 不依赖 window 滚动。

### 2. Embedded 单滚

- `TaskDetailShell` 支持 lock 模式；document 分支使用 lock。  
- `TasksTab` 在 `documentTarget` 存在时外层 `overflow:hidden` 并保持 flex 高度传递。  
- `.is-embedded`：`overflow:hidden; height:100%; min-height:0`。  
- 关闭 document 后 shell 恢复 auto 滚动。

### 3. 抛光与验证

- 评估 body `tabIndex`/focus：仅当 CSS 仍不足时启用；`preventScroll`。  
- 更新 `docs/modules/frontend.md` 一句说明 sole scroller。  
- `npm run lint` + `tsc --noEmit`；按 `checks.md` 人工滚轮验收。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "IMP-001 任务资料预览滚动修复",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "IMP1-SCROLL-1",
      "title": "Page 模式建立 viewport flex 高度链与 sole scroller",
      "phase": "css-page",
      "order": 1,
      "dependsOn": [],
      "files": [
        "app/globals.css",
        "app/studio/task-document/page.tsx"
      ],
      "instructions": [
        "将 .ypi-studio-task-document-page / .is-page 从仅 min-height 改为有界 height + flex 列 + overflow:hidden。",
        "保证 .ypi-studio-task-document-body 为 page 模式唯一 overflow:auto 容器（min-height:0）。",
        "Suspense fallback 使用同一高度类，避免首屏跳动。"
      ],
      "acceptance": [
        "新标签打开长 Markdown 后无需点击即可滚轮滚动",
        "页面仅正文区域出现纵向滚动，头部保持可见",
        "不出现 window 与 body 双滚动条"
      ],
      "validation": [
        "浏览器打开 /studio/task-document 长文档人工滚轮",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "100dvh 与移动浏览器工具栏",
        "min-height:240px 与短视口冲突"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP1-SCROLL-2",
      "title": "Embedded 文档打开时消除 TaskDetailShell 双层滚动",
      "phase": "embedded",
      "order": 2,
      "dependsOn": ["IMP1-SCROLL-1"],
      "files": [
        "components/YpiStudioPanel.tsx",
        "app/globals.css",
        "components/YpiStudioTaskDocumentView.tsx"
      ],
      "instructions": [
        "TaskDetailShell 增加 document lock 模式：overflow hidden + flex 高度填满。",
        "TasksTab 在 documentTarget 非空时锁外层 overflow，关闭后恢复。",
        "Embedded document root overflow hidden，body sole scroller；返回头固定。"
      ],
      "acceptance": [
        "详情内打开 Design 等资料后无需点击即可滚动正文",
        "返回按钮不被滚出视口",
        "关闭文档后普通详情 Tab 长列表仍可滚动"
      ],
      "validation": [
        "计划审批书 → Design → 滚动 → 返回 → 计划 Tab 再滚动",
        "npm run lint"
      ],
      "risks": [
        "误锁所有详情滚动",
        "高度链在 panel 根未传满导致 body 高度为 0"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP1-SCROLL-3",
      "title": "焦点/触控抛光、文档与回归",
      "phase": "polish",
      "order": 3,
      "dependsOn": ["IMP1-SCROLL-2"],
      "files": [
        "components/YpiStudioTaskDocumentView.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "仅当仍需点击才滚动时，为 body 增加可聚焦增强（preventScroll）；否则保持 CSS-only。",
        "更新 frontend 模块文档：document view 以 body 为 sole scroller。",
        "按 checks.md 覆盖 page/embedded/窄屏/popup 无关回归。"
      ],
      "acceptance": [
        "page 与 embedded 均无需先点击",
        "lint/typecheck 通过",
        "打开策略与只读语义无回归"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "checks.md 人工验收"
      ],
      "risks": [
        "焦点增强影响读屏",
        "文档描述与实现不一致"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ],
  "execution": {
    "mode": "serial",
    "maxParallel": 1,
    "groups": [
      { "id": "fix", "title": "滚动修复", "relation": "serial", "dependencies": [], "subtaskIds": ["IMP1-SCROLL-1", "IMP1-SCROLL-2", "IMP1-SCROLL-3"] }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

禁止 `next build` 作为日常验证。

## 检查门禁

- 用户批准 `plan-review.md` + HTML 原型后方可实现。  
- 不得改 files API 安全边界与审批写语义。  
- 检查员必须不点击正文直接验证滚轮。

## 回滚

还原 CSS 与 shell 条件分支；无迁移。
