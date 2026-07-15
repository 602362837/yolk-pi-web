# Implement

## 需先阅读

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/standards/code-style.md`
- 本任务再次审批后的 `brief.md`、`prd.md`、`ui.md`、`design.md`、`checks.md`
- `tech-action-tags-prototype.html`
- `components/AppShell.tsx`：`sidebarContent` 和 app top bar 的 inline SVG
- `components/BranchNavigator.tsx`：inline trigger / dropdown anchor
- `app/globals.css`：主题 token、mobile top bar、reduced-motion

## 人类可读实施计划

| ID | 阶段 | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | --- | --- | --- | --- |
| IMP-01 | Implement | 建立圆角/action-tag CSS 与共享 SVG icon-flow primitive | 无 | `app/globals.css`, `components/ActionFlowIcon.tsx` | 否 |
| IMP-02 | Implement | 接入侧栏底部和 AppShell 顶栏图标线条流动 | IMP-01 | `components/AppShell.tsx` | 否 |
| IMP-03 | Implement | 对齐 Branches trigger、响应式、状态和兼容降级 | IMP-01, IMP-02 | `components/BranchNavigator.tsx`, `app/globals.css` | 否 |
| DOC-01 | Implement | 更新前端文档并记录实现验证 | IMP-03 | `docs/modules/frontend.md`, `handoff.md` | 否 |
| CHK-01 | Checks | 独立检查原型一致性、静态质量和浏览器回归 | DOC-01 | diff, `checks.md` | 否 |

## 实现要点

1. 新增低 specificity radius/action-tag token；tag 的 border/background 始终静态，禁止恢复已作废的边框沿边动画。
2. 共享 `ActionFlowIcon` 用同一几何渲染 base stroke 和 gradient overlay stroke；per-instance gradient id，overlay 只通过 dash offset 沿图标线条移动。
3. 保持所有 `onClick`、disabled、active panel、badge、aria、ref 和 dropdown 契约；只改视觉 class/state wiring 和 SVG 呈现。
4. 侧栏可用图标 ambient 低频错峰；顶栏默认静态，仅 hover/focus/active；disabled/reduced-motion 隐藏动态 overlay。
5. 220px 侧栏按已批准原型改为 2×2；260px 单行。移动 overlay 不应误触发 220px 桌面规则。
6. 删除目标按钮内联 hover 改色，避免 CSS 与 DOM style 竞争；active/open 由静态边框、表面和文字多重表达。
7. 全局圆角基线不使用 `!important`；先盘点圆形/分段/特殊控件。
8. BranchNavigator 保持外层高度和 anchor 计算，验证 dropdown `top/left/width`。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

浏览器验收严格执行 `checks.md`；常规开发不要运行 `next build`。

## 评审门禁与回滚

- 实现前：用户再次批准 `plan-review.md` 中修订后的决策 1、2；决策 3、4 已确认。
- 实现后：lint/typecheck 通过，并完成深浅主题、220/260px、mobile、键盘、reduced-motion、Safari/Chromium SVG dash/gradient 验证。
- 检查后：无 blocker/high finding 才可进入完成态。
- 回滚：恢复三个现有生产文件并删除新增 icon primitive；无数据迁移。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-15T01:15:49.000Z",
  "sourceArtifact": "implement.md",
  "summary": "按修订原型建立静态 action-tag 与共享 SVG icon-flow primitive，让亮色段沿图标线条流动，并接入 AppShell 与 BranchNavigator。",
  "strategy": "串行实施，先固化 SVG/base-overlay 与 CSS 契约，再接入目标组件并做兼容验证。",
  "maxConcurrency": 1,
  "scheduler": { "mode": "dag", "strategy": "ready_fifo", "failFast": true, "defaultFailurePolicy": "block_dependents" },
  "subtasks": [
    {
      "id": "IMP-01",
      "title": "建立圆角/action-tag CSS 与共享 SVG icon-flow primitive",
      "phase": "implement",
      "order": 1,
      "dependsOn": [],
      "files": ["app/globals.css", "components/ActionFlowIcon.tsx"],
      "relation": "serial",
      "instructions": [
        "新增低 specificity radius/motion/color token 和静态 action-tag 状态；按钮 border/background 不做持续动画。",
        "新增共享 inline SVG primitive，以同一几何渲染 currentColor base stroke 和 gradient dashed overlay，使用 per-instance gradient id。",
        "disabled、data off 和 prefers-reduced-motion 隐藏 overlay 并取消动画；base stroke 必须独立可读。"
      ],
      "acceptance": [
        "亮色段只沿 SVG 可见线条移动，不出现在按钮边框或背景",
        "gradient id 在多实例与 SSR/hydration 下稳定且不冲突",
        "disabled/reduced-motion 无持续动画，降级时 base stroke 完整",
        "普通按钮圆角基线不破坏圆形、pill、分段或特殊控件"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "浏览器检查 SVG gradient/dash、fallback 和 reduced-motion"],
      "risks": ["SVG gradient URL 兼容", "重复几何漂移", "不同 path 长度节奏不一致", "全局基线破坏显式形状"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP-02",
      "title": "接入侧栏底部和 AppShell Chat 顶栏 icon-flow action tags",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["IMP-01"],
      "files": ["components/AppShell.tsx"],
      "relation": "serial",
      "instructions": [
        "将 Models/Usage/Skills/Settings、侧栏/主题、Export/System/Subagents/Git/Terminal 接入共享 tag 与 ActionFlowIcon。",
        "删除重复内联 hover 视觉，保留事件、顺序、disabled、aria 和 badge 计算。",
        "侧栏使用 ambient 低频错峰；顶栏使用 interactive，默认静态，仅 hover/focus/active 流动。"
      ],
      "acceptance": [
        "所有目标按钮功能与顺序不变",
        "图标线条流动符合原型，按钮边框无持续动画",
        "open/active 使用静态边框、表面、文字多重信号",
        "220px 侧栏 2×2、260px 单行，移动 top bar 保持 36px 和横向滚动",
        "badge 不被 SVG overlay 遮挡或裁切"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "按 checks.md 验证主题、状态、布局和图标动效"],
      "risks": ["内联样式覆盖 class", "badge 层级冲突", "高密度动效噪声", "top bar 被挤压"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP-03",
      "title": "对齐 Branches trigger 与响应式/兼容细节",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["IMP-01", "IMP-02"],
      "files": ["components/BranchNavigator.tsx", "app/globals.css"],
      "relation": "serial",
      "instructions": [
        "将 inline Branches trigger 接入同一 tag 与 SVG icon-flow，保持 containerRef/topBarRef dropdown anchor。",
        "补齐 icon-only aria、focus、mobile、badge/viewBox 裁切、Safari/Chromium fallback 和 reduced-motion 细节。"
      ],
      "acceptance": [
        "Branches 与其余顶栏按钮视觉/动效一致，默认静态且交互态线条流动",
        "dropdown 定位和宽度无回归",
        "键盘焦点、Enter/Space 与 aria 正常",
        "320/390/640px 无不可达操作或 SVG 裁切",
        "高级 overlay 失败时 base stroke 仍完整"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "浏览器验证 Branches、移动滚动、reduced-motion 和 SVG fallback"],
      "risks": ["wrapper/padding 改变锚点", "focus/badge 被裁切", "渐变 id 浏览器差异", "移动按钮缺少可访问名称"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "DOC-01",
      "title": "更新前端文档并记录实现验证",
      "phase": "implement",
      "order": 4,
      "dependsOn": ["IMP-03"],
      "files": ["docs/modules/frontend.md", ".ypi/tasks/20260715-085126-操作按钮科技感-流动-tag-化与全局圆角/handoff.md"],
      "relation": "serial",
      "instructions": [
        "记录 action-tag、ActionFlowIcon、全局圆角例外、SVG fallback 和 reduced-motion 复用边界。",
        "在 handoff 写明修改、命令结果、实际人工验收和已知偏差。"
      ],
      "acceptance": ["文档与实际 class/token/component 一致", "handoff 包含完整验证证据", "不夸大未执行的浏览器检查"],
      "validation": ["审阅文档链接与 git diff", "复核验证命令和浏览器证据"],
      "risks": ["文档命名与实现漂移", "遗漏 SVG 兼容或人工验收失败项"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```
