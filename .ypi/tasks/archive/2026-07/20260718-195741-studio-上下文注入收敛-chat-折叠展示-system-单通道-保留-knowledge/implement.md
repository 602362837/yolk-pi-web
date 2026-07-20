# Implement — Studio Context Integrity（SCI）

## 1. 执行原则

- **先 L0 纯函数 + UI，再 L1 extension**，或 L0/L1 在文件不重叠时可并行（maxConcurrency=2）
- **禁止**在未取得用户对 plan + HTML 原型批准前改生产代码（本文件仅规划）
- 实现员不得弱化审批、子代理、knowledge query
- 每项完成后跑对应 validation；全量结束后 lint + tsc + 相关 studio 测试

## 2. 优先阅读（实现前）

| 顺序 | 文件 | 原因 |
| --- | --- | --- |
| 1 | [design.md](design.md) / [prd.md](prd.md) / [checks.md](checks.md) / [ui.md](ui.md) | 契约与验收 |
| 2 | `sci-user-message-prototype.html` | UI 视觉与 DOM 结构 |
| 3 | `lib/ypi-studio-extension.ts`（`buildStudioState` / `startupContext` / `input` / `before_agent_start` / `buildMemberPrompt`） | L1 核心 |
| 4 | `components/MessageView.tsx`（`UserMessageView`） | L0 挂载点 |
| 5 | `lib/session-title.ts`、`hooks/useAgentSession.ts`（title seed） | 标题不污染 |
| 6 | `lib/ypi-studio-tasks.ts`（`recordYpiStudioUserApproval` / `getYpiStudioKnowledgeContextForPrompt`） | 勿改语义，只调用 |
| 7 | Pi `docs/extensions.md`（`input` / `before_agent_start`） | SDK 契约 |
| 8 | `docs/modules/library.md` / `frontend.md` / `architecture/overview.md` | 文档同步 |
| 9 | `scripts/test-ypi-studio-dag.mjs` 等 | 回归样板 |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 并行 |
| --- | --- | --- | --- | --- |
| SCI-01 | foundation | 抽取 strip/parse 纯函数模块 | — | 可与 SCI-02 规划并行，实现上先落地 |
| SCI-02 | L1 | extension：input continue + system 单通道 + prompt query + startup 去重 | SCI-01（仅若 title/shared 常量复用；逻辑上可并行，计划依赖 SCI-01 以共享标签常量） | 与 SCI-03 文件不重叠 → 可并行 |
| SCI-03 | L0 | UserMessageView + CSS compact tag | SCI-01 | 与 SCI-02 并行 |
| SCI-04 | polish | session title strip + 边界对齐 | SCI-01 | 可与 SCI-03 串/并：依赖 SCI-01 |
| SCI-05 | test | 单元/extension 自动化测试 | SCI-01, SCI-02 | 依赖 L1 与纯函数 |
| SCI-06 | docs+verify | 文档 + 全量验证 + 手工清单 | SCI-02, SCI-03, SCI-04, SCI-05 | 收尾 |

**建议并发：** maxConcurrency = 2  
**首轮可同时 claim：** SCI-01 单独先做；完成后 SCI-02 + SCI-03 并行；再 SCI-04（若未并入 SCI-03）/ SCI-05；最后 SCI-06。

## 4. 验证命令（全局）

```bash
npm run lint
node_modules/.bin/tsc --noEmit
# 新增（SCI-05 落地后）
npm run test:studio-message-display   # 或 node scripts/test-ypi-studio-message-display.mjs
# 既有回归
npm run test:studio-dag
npm run test:studio-widget-actions
npm run test:studio-policy
```

## 5. 回滚

- `git revert` 本任务相关提交
- 无数据迁移；回滚后历史 JSONL 仍可读（仅 UI 再显示脏气泡）

## 6. 评审门禁

- UI 实现对照 `sci-user-message-prototype.html`
- checks.md 自动化项全绿；人工 UAT 由主会话/用户勾选
- checker 关注：审批同轮、knowledge query、子代理未改、strip 边界

---

## Implementation Plan (machine-readable)

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "SCI: clean Chat user bubbles via strip/tag (L0) + single-channel system injection with event.prompt knowledge (L1); no child/widget regression; docs+tests.",
  "strategy": "Foundation pure functions first; then parallel L0 UI and L1 extension; title polish; automated tests; docs and full validation last. maxConcurrency=2.",
  "maxConcurrency": 2,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "SCI-01",
      "title": "Add ypi-studio message display pure functions (strip/parse/tag)",
      "phase": "foundation",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-message-display.ts",
        "scripts/test-ypi-studio-message-display.mjs",
        "package.json"
      ],
      "instructions": [
        "Create lib/ypi-studio-message-display.ts with parseYpiStudioUserMessage, stripYpiStudioInjections, formatYpiStudioMessageTag and known tag constants (ypi-studio-state|knowledge|context|first-reply).",
        "Only remove complete closed tags; preserve user text that merely mentions tag names; multi-block and adjacent knowledge+state; trim excess blank lines after strip.",
        "Parse status from state block: Status: no_task or Task: id (status); fallback context when injection present but status unknown.",
        "stripConfidence: full when only complete blocks removed cleanly; partial when incomplete open tags detected; none when no injection.",
        "Export types suitable for MessageView and session-title imports.",
        "Add a focused unit test script covering boundaries listed in checks.md; wire package.json script test:studio-message-display if needed.",
        "Do not modify extension or UI in this subtask beyond what is required for the test harness."
      ],
      "acceptance": [
        "Pure functions have no fs/network side effects.",
        "Unit tests cover: no tags, half tags, user text with similar literals, multi-block, knowledge+state, status parsing for no_task and implementing.",
        "tsc accepts the new module."
      ],
      "validation": [
        "npm run test:studio-message-display",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Over-aggressive regex could strip legitimate user HTML/XML samples."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "SCI-02",
      "title": "L1 extension: input continue + before_agent_start single channel with event.prompt",
      "phase": "L1",
      "order": 20,
      "dependsOn": ["SCI-01"],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-extension.ts"
      ],
      "instructions": [
        "In pi.on('input'): keep recordYpiStudioUserApproval(root, key, ev.text); remove buildStudioState transform; always return { action: 'continue' } for normal paths (including empty guard).",
        "In pi.on('before_agent_start'): read event.prompt (cast if needed); call buildStudioState(root, key, prompt); keep orchestration rule string.",
        "startupContext: remove duplicated knowledge fetch; keep first-reply notice, studio context rules, workspace line; still one-shot via startupKeys.",
        "Do not change buildMemberPrompt, tool registration, child guard YPI_STUDIO_SUBAGENT_CHILD, widget paths, or approval helpers.",
        "Ensure no_task path still injects summarizeWorkflowTriggers + create guidance via buildStudioState.",
        "Comment briefly why system is the sole injection channel (SCI) without large essays."
      ],
      "acceptance": [
        "New user messages are not transformed with studio state.",
        "Each agent turn systemPrompt includes buildStudioState with prompt query.",
        "Approval recording still runs on input before continue.",
        "Child sessions still skip main extension."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-dag",
        "Manual or scripted assertion on handler behavior if added in SCI-05"
      ],
      "risks": [
        "Missing event.prompt typing; empty prompt on edge sources.",
        "Removing user injection could regress models that relied on seeing state in user channel — mitigate via system injection parity."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "SCI-03",
      "title": "L0 UserMessageView clean bubble + Studio compact tag CSS",
      "phase": "L0",
      "order": 30,
      "dependsOn": ["SCI-01"],
      "relation": "serial",
      "files": [
        "components/MessageView.tsx",
        "app/globals.css",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "In UserMessageView: parse raw content via parseYpiStudioUserMessage; render displayText in MarkdownBody; show compact tag when hadInjection.",
        "Copy and Edit from here must use displayText; on parse failure fall back to raw full text.",
        "Match sci-user-message-prototype.html structure/classes: e.g. message-studio-tag pill near user bubble, not inside markdown body.",
        "Add light/dark-friendly CSS using existing variables (--accent, --bg-hover, --text-dim, --user-bg).",
        "Do not change assistant/tool message components.",
        "Keep accessibility: tag is text, not the only meaning; title attribute may show full status label."
      ],
      "acceptance": [
        "Dirty historical user messages show clean text + Studio · status tag.",
        "Clean messages unchanged.",
        "Copy/Edit use clean text per PRD.",
        "Visual alignment with approved prototype."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual UAT against prototype"
      ],
      "risks": [
        "Layout shift on long bubbles; narrow mobile width."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "SCI-04",
      "title": "Session title seed/display strip for studio injections",
      "phase": "polish",
      "order": 40,
      "dependsOn": ["SCI-01"],
      "relation": "serial",
      "files": [
        "lib/session-title.ts"
      ],
      "instructions": [
        "Apply stripYpiStudioInjections inside sessionTitleSeedFromUserMessage before truncate.",
        "Optionally strip in displayTitleForSession when using firstMessage so sidebar does not show raw tags.",
        "Do not rewrite stored session metadata files."
      ],
      "acceptance": [
        "Title seed from a dirty string does not begin with <ypi-studio-state>.",
        "Normal titles unchanged."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "Unit assertion in message-display or small title test if present"
      ],
      "risks": [
        "Over-strip could shorten legitimate titles that quote tags — acceptable."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": false,
        "reviewer": "checker"
      }
    },
    {
      "id": "SCI-05",
      "title": "Automated tests for strip functions and extension injection behavior",
      "phase": "test",
      "order": 50,
      "dependsOn": ["SCI-01", "SCI-02"],
      "relation": "serial",
      "files": [
        "scripts/test-ypi-studio-message-display.mjs",
        "scripts/test-ypi-studio-extension-sci.mjs",
        "package.json"
      ],
      "instructions": [
        "Expand pure function tests to full checks.md unit matrix.",
        "Add extension-level tests where practical: mock or import handler pieces to assert input returns continue without appending state; before_agent_start uses prompt in buildStudioState (may test via extracting helpers or lightweight harness).",
        "If full extension factory is hard to boot, test extracted pure paths and a minimal fake of the two handlers as recommended in design; document any gap as manual UAT.",
        "Keep existing studio-dag approval tests green."
      ],
      "acceptance": [
        "Unit matrix automated items pass.",
        "Extension behavior assertions cover: no transform, prompt query, approval still invoked (spy/mock).",
        "package.json scripts documented in checks.md."
      ],
      "validation": [
        "npm run test:studio-message-display",
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Extension factory requires heavy pi mock — prefer testing extracted logic."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "SCI-06",
      "title": "Docs update + full validation pass",
      "phase": "docs",
      "order": 60,
      "dependsOn": ["SCI-02", "SCI-03", "SCI-04", "SCI-05"],
      "relation": "serial",
      "files": [
        "docs/modules/library.md",
        "docs/modules/frontend.md",
        "docs/architecture/overview.md",
        "AGENTS.md"
      ],
      "instructions": [
        "Document SCI: system single-channel injection, Chat strip/tag, no JSONL migration.",
        "Update library map for ypi-studio-message-display.ts and extension behavior notes.",
        "Update frontend map for UserMessageView studio tag.",
        "Only touch AGENTS.md if top-level navigation needs a pointer; prefer docs modules.",
        "Run full validation commands; fix doc drift only."
      ],
      "acceptance": [
        "Docs match implemented behavior.",
        "lint + tsc + studio tests pass.",
        "checks.md automation section can be marked done by checker."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-message-display",
        "npm run test:studio-dag",
        "npm run test:studio-widget-actions",
        "npm run test:studio-policy"
      ],
      "risks": [
        "Doc overgrowth — keep concise."
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
