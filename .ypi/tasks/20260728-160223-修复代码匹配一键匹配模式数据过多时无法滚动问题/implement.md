# Implement — 代码匹配长列表滚动修复

## 1. 执行原则

- 当前只完成规划；用户批准 [HTML 原型](./code-match-scroll-prototype.html) 与计划前，不进入实现。
- 默认目标是 `components/FileViewer.tsx` 的共享符号匹配结果区；若用户提供的真实复现页面不同，先退回规划修订，不在错误页面实现。
- 保持最小 bugfix：不改 API/匹配算法/上限/排序/快捷键，不新增计数、关闭、拖拽、分页、筛选或虚拟化。
- 不重置工作树中无关用户改动；不 commit/push/merge；不直接运行 `next build`。
- 静态 focused test 只证明结构契约；“可以从首条滚到末条”必须由真实浏览器验收。

## 2. 实现前优先阅读

| 顺序 | 文件 | 目的 |
| ---: | --- | --- |
| 1 | [brief.md](./brief.md)、[prd.md](./prd.md)、[ui.md](./ui.md)、[design.md](./design.md)、[checks.md](./checks.md) | 确认范围、UI 审批与验收口径 |
| 2 | [code-match-scroll-prototype.html](./code-match-scroll-prototype.html) | 对齐结果区/编辑器独立滚动及响应式状态 |
| 3 | `AGENTS.md`、`docs/standards/code-style.md`、`docs/modules/frontend.md` | 项目边界、验证和文档入口 |
| 4 | `components/FileViewer.tsx` 的 `runSymbolSearch`、结果渲染、内容区 | 唯一生产改动入口与不变业务行为 |
| 5 | `components/MonacoFileEditor.tsx` | 确认手势/快捷键/内部滚动不被改动 |
| 6 | `app/globals.css` 的 file viewer/mobile 规则 | 接入稳定 class，避免与状态栏隐藏 scrollbar 规则串扰 |
| 7 | 三个 `app/api/files/{definitions,references,implementations}/route.ts` | 只读确认 80/120/50 上限与 schema 不变 |
| 8 | `package.json` 与现有 `scripts/test-*.mjs` 模式 | focused contract test 命名和脚本风格 |

## 3. 人类可读子任务表

| ID | Phase | Order | 标题 | dependsOn | 主要文件 | 并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| `CM-SCROLL-01` | frontend | 10 | 建立结果面板/唯一列表 scroller 与编辑器剩余高度链 | — | `components/FileViewer.tsx`, `app/globals.css` | 否 |
| `CM-SCROLL-02` | regression-docs | 20 | 增加 focused contract、文档并完成浏览器矩阵 | `CM-SCROLL-01` | `scripts/test-file-viewer-code-match-scroll.mjs`, `package.json`, `docs/modules/frontend.md` | 否 |

计划 `maxConcurrency=1`：两项修改同一 UI 契约，串行可避免测试在结构尚未稳定时固化错误实现。

## 4. 详细执行步骤

### CM-SCROLL-01 — 前端滚动与布局

1. 在 `FileViewer.tsx` 将当前单层匿名结果 div 改为：
   - `.code-match-results-panel`：受约束 flex item，`overflow:hidden`；
   - `.code-match-results-list`：唯一 `overflow-y:auto` 容器；
   - 结果按钮与空/error 内容保留现有 state 和 handler。
2. 结果 region 添加稳定 `aria-label`；`implementationLoading` 映射 `aria-busy`，不新增请求状态机。
3. 内容区增加 `.file-viewer-content` 并显式 `min-height:0`；保持 `flex:1`、`overflow:hidden` 和 Monaco/Preview/Diff 原行为。
4. 将结果布局从内联样式迁到 `app/globals.css`，避免内联/CSS 双来源；保留现有主题变量、11px 紧凑行、kind 色彩、ellipsis 和 title。
5. CSS 确保：
   - 短内容自然收缩；
   - 长内容受像素+父容器比例约束；
   - panel 不滚、list 才滚；
   - `scrollbar-gutter:stable`、`overscroll-behavior:contain`、touch 惯性；
   - 结果区不套用状态栏隐藏 scrollbar 的规则。
6. `≤640px` 与低高度规则只调整结果行间距/列宽/最大高度，不引入横向 scroller；保留编辑器可操作空间。
7. 不修改 `runSymbolSearch`、`openResult`、`MonacoFileEditor` 或 API routes；实现后用 `git diff` 确认范围。

### CM-SCROLL-02 — 回归、文档与验收

1. 新增 `scripts/test-file-viewer-code-match-scroll.mjs`，按现有无框架脚本风格检查：
   - panel/list/content 稳定 class 均被生产组件使用；
   - panel 是 hidden、list 是唯一 vertical auto scroller；
   - list 有 `min-height:0`、scroll containment/gutter/touch；
   - content 有 `min-height:0`；
   - 结果仍是 button，并调用既有 `openResult`；
   - definitions/references/implementations 仍共用 `implementationResults` 渲染；
   - 不出现 scrollbar 隐藏或 API route 改造。
2. 在 `package.json` 增加 `test:file-viewer-code-match-scroll`；不新增依赖，不修改 lockfile。
3. 更新 `docs/modules/frontend.md` 的 `FileViewer` 条目，记录共享符号结果区的唯一 scroller、高度链、三类 endpoint 共用和 API 不变。
4. 启动现有 dev server 或复用可用实例，以真实浏览器构造/注入 6、50、80、120 条结果；验证 `scrollHeight > clientHeight` 且可到末条。
5. 浏览器矩阵：1440×900、1024×600、640×480、375×667；覆盖 wheel、trackpad（可用时）、touch emulation、滚动条、Tab/Enter/Space、首/中/末条打开。
6. 跑 focused test、lint、tsc 和 `git diff --check`；记录任何与本任务无关的既存失败，不能虚报通过。

## 5. 验证命令

```bash
npm run test:file-viewer-code-match-scroll
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

浏览器验证（实现后，按本机可用工具执行）：

```text
npm run dev  # 仅在没有可复用实例时；http://localhost:30141
```

- 不运行 `next build`；发布验证才使用 `npm run build`。
- 若自动浏览器无法稳定构造长结果，使用受控 fixture/mock 记录 `clientHeight / scrollHeight / scrollTop`，并保留人工末条点击证据。

## 6. 检查门禁

- **范围门禁**：生产 diff 不应包含三个 API route、`MonacoFileEditor.tsx`、Settings/config 或依赖变更。
- **滚动门禁**：panel 不得设置纵向 auto/scroll；list 必须是结果区唯一 vertical scroller。
- **高度门禁**：内容区 `min-height:0`；低高度下 Monaco 仍可操作，结果区不覆盖 toolbar/editor。
- **交互门禁**：三类 endpoint、工具栏/点击/快捷键路径都进入同一结果区；首/中/末条打开正确。
- **可访问性门禁**：region 名称、aria-busy、原生 button、focus-visible、Tab 离屏滚入视图。
- **兼容门禁**：滚动条不被隐藏；不依赖 `scrollbar-gutter` 才能滚；375px 无横向结果滚动。
- **审批门禁**：实现必须匹配用户批准的 HTML；原型未批准不得派 implementer。

## 7. 回滚

1. 回滚 `FileViewer` panel/list/content class 结构；
2. 删除 `app/globals.css` 对应结果区规则；
3. 删除 focused script/npm script 并恢复 frontend 文档；
4. 不改 API、配置、用户文件或数据，无迁移与清理步骤；
5. 不以降低 API 结果上限或隐藏下方数据作为回滚/止血方案。

## 8. Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Fix the FileViewer symbol-match result panel so long definition, reference, and Java implementation lists have one reliable internal vertical scroller while Monaco keeps independent remaining-space scrolling.",
  "strategy": "Apply a minimal frontend-only layout fix using a constrained panel, a sole scrollable list, and an explicit min-height flex chain; then add a focused source contract, module documentation, and real-browser long-list validation. Keep APIs, search behavior, shortcuts, result ordering, and product scope unchanged.",
  "maxConcurrency": 1,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "CM-SCROLL-01",
      "title": "建立代码匹配结果面板的唯一滚动容器与稳定高度链",
      "phase": "frontend",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "components/FileViewer.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "Replace the current anonymous single-layer result container with code-match-results-panel and code-match-results-list while preserving existing React state and handlers.",
        "Make the panel a constrained non-scrolling flex item and the list the only vertical scroller with min-height zero, overflow-y auto, overscroll containment, stable gutter, and touch scrolling.",
        "Add file-viewer-content with an explicit min-height zero so Monaco, Diff, and Preview retain the remaining independent scroll area.",
        "Keep short empty and error states naturally sized, preserve result button content, title, kind colors, ellipsis, and openResult behavior.",
        "Add low-height and narrow-screen rules without horizontal result scrolling or a second vertical scroller.",
        "Do not modify symbol request orchestration, Monaco shortcuts, API routes, limits, ordering, schema, settings, or dependencies."
      ],
      "acceptance": [
        "A 50, 80, or 120 row result list is constrained and can scroll internally from the first row to the last row.",
        "The panel itself does not scroll and does not cover the status bar or editor.",
        "The editor remains visible and independently scrollable at desktop, low-height, and 375px viewports.",
        "Definitions, references, and implementations plus all existing trigger paths reuse the same result structure.",
        "Empty, error, loading, file-switch cleanup, and result navigation semantics are unchanged."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "git diff --check"
      ],
      "risks": [
        "Incorrect flex min-size handling could still clip the list or collapse Monaco.",
        "A broad scrollbar selector could hide the result scrollbar on narrow screens.",
        "Both panel and list becoming scrollable would create nested scroll traps."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": "Verify the sole-scroller topology, flex min-height chain, unchanged search/navigation behavior, and approved prototype alignment."
      }
    },
    {
      "id": "CM-SCROLL-02",
      "title": "补齐代码匹配滚动契约测试、文档与真实浏览器矩阵",
      "phase": "regression-docs",
      "order": 20,
      "dependsOn": [
        "CM-SCROLL-01"
      ],
      "relation": "serial",
      "files": [
        "scripts/test-file-viewer-code-match-scroll.mjs",
        "package.json",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Add a focused no-framework source contract test for the panel/list/content class topology and critical overflow, min-height, containment, gutter, touch, button, and shared-result wiring.",
        "Register test:file-viewer-code-match-scroll without adding dependencies or changing lockfiles.",
        "Document the shared FileViewer symbol-result scrolling boundary and unchanged API behavior in the frontend module map.",
        "Use the running application or a controlled browser fixture to validate 6, 50, 80, and 120 rows at 1440x900, 1024x600, 640x480, and 375x667.",
        "Record wheel, scrollbar, touch emulation, keyboard focus-to-offscreen-row, and first/middle/last result navigation evidence.",
        "Treat static assertions as contract checks only; do not claim browser scrolling fixed without real scrollHeight, scrollTop, and last-row evidence."
      ],
      "acceptance": [
        "The focused test detects removal of the sole-scroller structure or min-height chain.",
        "Real-browser evidence shows scrollHeight greater than clientHeight and the last returned row reachable at every required viewport.",
        "Keyboard focus reveals offscreen result buttons and Enter or Space opens the expected file and line.",
        "No API, Monaco shortcut, settings, dependency, or unrelated documentation changes are introduced.",
        "Focused test, lint, TypeScript, and diff checks pass or pre-existing unrelated failures are explicitly evidenced."
      ],
      "validation": [
        "npm run test:file-viewer-code-match-scroll",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "Static source assertions can pass while computed layout remains broken, so browser evidence is mandatory.",
        "OS overlay-scrollbar policy may hide an idle scrollbar even when scrolling works; CSS must not force or hide system policy.",
        "A mock that does not use production classes could provide false confidence."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": "Verify the focused test is not a substitute for browser evidence and that all PRD viewport/input/state cases are covered."
      }
    }
  ]
}
```

主会话在用户批准后应把该 plan 保存为任务 `implementationPlan`，再合法进入 `implementing`；本架构师运行不写 `task.json` 状态，也不派实现员。
