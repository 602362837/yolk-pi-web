# Implement — IMP-001 Studio tag 注入预览

## 1. 执行原则

- **先纯函数 + 单测，再 UI**（文件可串行；maxConcurrency=1 足够，UI 依赖 API）
- **禁止**在用户批准 plan + HTML 前改生产代码
- **禁止**修改 `lib/ypi-studio-extension.ts` L1 路径
- 不放宽 partial 的 showTag 条件

## 2. 优先阅读

| 顺序 | 文件 |
| --- | --- |
| 1 | [prd.md](prd.md) / [design.md](design.md) / [checks.md](checks.md) / [ui.md](ui.md) |
| 2 | [sci-injection-preview-prototype.html](sci-injection-preview-prototype.html) |
| 3 | `lib/ypi-studio-message-display.ts` |
| 4 | `components/MessageView.tsx` → `UserMessageView` |
| 5 | `app/globals.css` → `.message-studio-tag*` |
| 6 | 主任务 SCI `ui.md` / 已交付原型（类名兼容） |
| 7 | `scripts/test-ypi-studio-message-display.mjs` |

## 3. 子任务表

| ID | Phase | 标题 | dependsOn | 并行 |
| --- | --- | --- | --- | --- |
| IMP1-01 | foundation | parse 导出 injectionBlocks / injectionText + 截断 helper + 单测 | — | 先做 |
| IMP1-02 | L0 UI | UserMessageView button tag + popover + CSS | IMP1-01 | 串行 |
| IMP1-03 | docs+verify | 文档一句 + 全量相关验证 | IMP1-01, IMP1-02 | 收尾 |

**maxConcurrency = 1**（UI 强依赖 API；避免半开交互）

## 4. 验证命令

```bash
npm run test:studio-message-display
node_modules/.bin/tsc --noEmit
npm run lint
# 回归 SCI 不回退
npm run test:studio-extension-sci
npm run test:studio-dag
```

## 5. 回滚

- git revert 本改进相关提交  
- 无数据迁移  

## 6. 评审门禁

- 对照 HTML 原型  
- checks 自动项全绿  
- checker：确认 extension 无行为 diff；Copy 三数据源；partial 无成功 tag  

---

## Implementation Plan (machine-readable)

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "IMP-001: export stripped injection blocks from parse API; make Studio tag open a read-only popover for historical dirty user messages; copy injection/raw; no L1/child changes.",
  "strategy": "Pure parse/API first with unit tests; then UserMessageView interactive tag + popover/CSS; docs and validation last. maxConcurrency=1.",
  "maxConcurrency": 1,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "IMP1-01",
      "title": "Export injectionBlocks/injectionText from parse + unit tests",
      "phase": "foundation",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-message-display.ts",
        "scripts/test-ypi-studio-message-display.mjs"
      ],
      "instructions": [
        "Extend YpiStudioUserDisplayContent with injectionBlocks (tag/body/raw/start/end) and injectionText (joined full raw blocks).",
        "Collect complete closed whitelist blocks in document order while preserving existing displayText/status/stripConfidence behavior (U1–U14 must stay green).",
        "Add formatYpiStudioInjectionPreview (or equivalent) with 64KiB display truncation helper; export constant.",
        "Empty string / no tags → empty blocks and injectionText; multi state+knowledge order stable.",
        "Do not change MessageView or extension in this subtask."
      ],
      "acceptance": [
        "Existing SCI unit cases still pass.",
        "New cases assert blocks content and order for state+knowledge, multi-block, no-tag empty, half-open not listed as complete block.",
        "Module remains pure (no fs/network)."
      ],
      "validation": [
        "npm run test:studio-message-display",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Regressing tidyDisplayText or status parsing while adding match indices."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "IMP1-02",
      "title": "Interactive Studio tag + read-only injection popover UI",
      "phase": "ui",
      "order": 20,
      "dependsOn": ["IMP1-01"],
      "relation": "serial",
      "files": [
        "components/MessageView.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "When showStudioTag conditions match SCI (hadInjection && full && status): render button.message-studio-tag with data-interactive=true, aria-expanded, aria-controls.",
        "Click toggles popover anchored to meta-row; content is formatYpiStudioInjectionPreview(injectionText); show historical≠live-system note.",
        "Actions: Copy injection (injectionText), optional Copy full raw (rawText), Close; Esc and outside click dismiss; return focus to tag on Esc/Close.",
        "Keep bubble Copy/Edit on displayText; parse failure fail-open raw with no tag.",
        "CSS: interactive cursor/focus-visible; popover panel styles using existing tokens; do not apply pointer-events:none when interactive true.",
        "Match sci-injection-preview-prototype.html structure/classes as closely as practical (message-studio-injection-popover etc.).",
        "Do not modify ypi-studio-extension.ts or child paths."
      ],
      "acceptance": [
        "Dirty full messages: click tag shows stripped injection blocks only.",
        "Clean messages unchanged.",
        "Copy paths use correct sources.",
        "partial still has no success clickable tag."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual UAT vs HTML prototype"
      ],
      "risks": [
        "z-index/clipping in Chat scroll container; outside-click races with hover actions."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "IMP1-03",
      "title": "Docs note + regression validation",
      "phase": "docs",
      "order": 30,
      "dependsOn": ["IMP1-01", "IMP1-02"],
      "relation": "serial",
      "files": [
        "docs/modules/library.md",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Update library.md SCI L0 blurb: parse also exposes injectionBlocks/injectionText for debug preview.",
        "Update frontend.md UserMessageView: tag is interactive popover for historical stripped injection; not live system prompt.",
        "Do not expand AGENTS.md unless navigation truly needs it.",
        "Run message-display + extension-sci + tsc; fix only doc drift / test gaps from this improvement."
      ],
      "acceptance": [
        "Docs match behavior and capability boundary.",
        "SCI extension tests still pass (no L1 regression)."
      ],
      "validation": [
        "npm run test:studio-message-display",
        "npm run test:studio-extension-sci",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "Doc overclaiming live system preview."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```
