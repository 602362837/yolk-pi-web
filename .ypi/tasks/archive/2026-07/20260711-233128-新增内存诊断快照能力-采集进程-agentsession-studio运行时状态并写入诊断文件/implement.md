# Implement

> 本文是待审批实施计划。主会话保存 implementationPlan 并进入 `awaiting_approval` 后必须停止；只有后续用户明确批准才能进入 `implementing` 和派发 implementer。

## 先阅读

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/modules/frontend.md`
- `docs/operations/troubleshooting.md`
- `docs/standards/code-style.md`
- `lib/rpc-manager.ts`
- `lib/pi-types.ts`
- `lib/ypi-studio-subagent-runtime.ts`
- `lib/session-reader.ts`
- `lib/session-file-changes.ts`
- `lib/browser-share-manager.ts`
- `lib/terminal-manager.ts`
- `components/SettingsConfig.tsx`
- `components/AppShell.tsx`（Settings 打开入口）
- `app/api/agent/[id]/events/route.ts`
- 任务目录 `ui.md`、`ui-prototype.html`
- `node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.d.ts`（只确认公开 getter）

## 人类可读子任务表

| # | 子任务 | 阶段 | 依赖 | 主要结果 |
| --- | --- | --- | --- | --- |
| 1 | Runtime owner 有界投影 | implementing | 无 | RPC/Studio/cache/Browser/Terminal/file-change 只读 projection |
| 2 | 快照编排、落盘与 API | implementing | 1 | schema v1、deadline/limits/findings/互斥/原子写、POST route、tests |
| 3 | Settings 诊断按钮 UI | implementing | 2 | diagnostics section、状态反馈、元数据展示、隐私提示 |
| 4 | 文档与完整检查 | checking | 3 | docs + 自动/人工验收证据 |

## Implementation Plan

```ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-11T16:05:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "Add bounded read-only memory diagnostic snapshots via POST API and a Settings Diagnostics button.",
  "strategy": "Expose owner projections, compose under deadline/size budget, add API, then minimal Settings UI and docs.",
  "maxConcurrency": 1,
  "scheduler": {
    "mode": "dag",
    "failurePolicy": "stop_on_failure"
  },
  "execution": {
    "mode": "serial",
    "maxParallel": 1,
    "groups": [
      {
        "id": "runtime-projections",
        "title": "Runtime owner projections",
        "relation": "serial",
        "subtaskIds": ["memory-runtime-projections"]
      },
      {
        "id": "snapshot-api",
        "title": "Snapshot collector and API",
        "relation": "serial",
        "dependencies": ["runtime-projections"],
        "subtaskIds": ["memory-snapshot-api"]
      },
      {
        "id": "settings-ui",
        "title": "Settings diagnostics UI",
        "relation": "serial",
        "dependencies": ["snapshot-api"],
        "subtaskIds": ["memory-settings-ui"]
      },
      {
        "id": "validation-docs",
        "title": "Validation and documentation barrier",
        "relation": "barrier",
        "dependencies": ["settings-ui"],
        "subtaskIds": ["memory-diagnostics-validation"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "memory-runtime-projections",
      "title": "Add bounded read-only projections at runtime ownership boundaries",
      "phase": "implementing",
      "description": "Expose safe counts, aggregates and bounded samples without leaking content or mutating runtime containers.",
      "order": 1,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/rpc-manager.ts",
        "lib/pi-types.ts",
        "lib/ypi-studio-subagent-runtime.ts",
        "lib/session-reader.ts",
        "lib/session-file-changes.ts",
        "lib/browser-share-manager.ts",
        "lib/terminal-manager.ts"
      ],
      "instructions": [
        "Define small shared diagnostic limit/deadline input shapes without creating circular imports; runtime owners should accept limits and now/deadline from the collector.",
        "In rpc-manager, project registry/start-lock totals and each wrapper's safe state. Count branch entries/messages/content lengths with index loops and per-session caps; never slice/copy content or return content, args, results or systemPrompt.",
        "Query the public OpenAI Codex per-session debug getter only for known active openai-codex sessions and retain only numeric/boolean fields. Name coverage as known-session stats, not total private-map size.",
        "In Studio runtime, aggregate child runs and all continuation containers; omit result, promise, callback, summary and progress text/items.",
        "Add pure owner projections for session path cache, Browser Share and Terminal private maps. Browser projection must not call cleanupExpired; terminal projection counts buffer bytes without joining text.",
        "For session-file-change, stat and parse only capped active-session sidecars and return file/pending counts; skip oversized files and never return diff/snapshot text."
      ],
      "acceptance": [
        "Every target runtime container has totals/aggregates and bounded sample metadata",
        "Unique secret/content markers never appear in projections",
        "Projection calls leave runtime ids, statuses and container sizes unchanged",
        "All potentially large loops cooperatively check the deadline and caps",
        "Missing SDK/private optional fields degrade to null/error rather than throwing the whole snapshot"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "focused memory diagnostic projection tests"
      ],
      "risks": [
        "SDK internal state shapes may change",
        "Accidental content copying can amplify memory",
        "Calling cleanup helpers would violate strict read-only behavior"
      ],
      "parallelizable": false,
      "priority": 1,
      "failurePolicy": "stop",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "memory-snapshot-api",
      "title": "Implement snapshot orchestration, atomic persistence and POST API",
      "phase": "implementing",
      "description": "Compose process and runtime diagnostics into schema v1 under timeout/size budgets, atomically persist JSON, and expose a metadata-only trigger API.",
      "order": 2,
      "dependsOn": ["memory-runtime-projections"],
      "relation": "serial",
      "files": [
        "lib/memory-diagnostics.ts",
        "app/api/diagnostics/memory-snapshot/route.ts",
        "scripts/test-memory-diagnostics.mjs",
        "package.json"
      ],
      "instructions": [
        "Create schemaVersion 1 snapshot contracts, default limits, process/resource/V8 collection, section error isolation, cooperative 5 second deadline and heuristic findings.",
        "Record memory usage before and after collection. Keep findings threshold logic pure and explicitly heuristic.",
        "Serialize once under normal limits. If above 5 MiB, remove item samples while retaining totals/aggregates/errors/truncation and retry; fail safely if compact form is still too large.",
        "Write under getAgentDir()/diagnostics with safe generated filename, same-directory tmp plus rename, best-effort 0700/0600 and tmp cleanup on failure.",
        "Add a process-global in-progress guard. POST without a body returns 201 metadata; concurrent POST returns 409; all responses use Cache-Control no-store and never return full snapshot.",
        "Add focused tests for schema, marker exclusion, caps/deadline, section failure, findings boundaries, compact fallback, atomic write cleanup and concurrent lock release. Add test:memory-diagnostics script."
      ],
      "acceptance": [
        "POST creates a parseable diagnostic JSON in the configured agent diagnostics directory",
        "Response includes only file metadata and bounded summary",
        "Snapshot contains all required sections or explicit section errors/partial markers",
        "Concurrent triggers cannot run two collectors",
        "No formal file remains after write/size failure and lock always releases",
        "No business state is changed by successful or failed collection"
      ],
      "validation": [
        "npm run test:memory-diagnostics",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "curl -i -X POST http://localhost:30141/api/diagnostics/memory-snapshot"
      ],
      "risks": [
        "Synchronous loops cannot be preempted unless every helper cooperates with deadline checks",
        "JSON serialization can create a second in-memory representation",
        "Route runtime or package subpath imports may differ between dev and production bundling"
      ],
      "parallelizable": false,
      "priority": 2,
      "failurePolicy": "stop",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "memory-settings-ui",
      "title": "Add Settings Diagnostics section and memory snapshot button",
      "phase": "implementing",
      "description": "Minimal Settings UI entry matching the approved HTML prototype: trigger POST, show loading/success/error/409, metadata and privacy callout.",
      "order": 3,
      "dependsOn": ["memory-snapshot-api"],
      "relation": "serial",
      "files": [
        "components/SettingsConfig.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "Follow ui.md and ui-prototype.html. Add SettingsSection value diagnostics and a left-nav item 诊断 / Diagnostics.",
        "Render a diagnostics card with primary button 生成内存诊断快照. On click POST /api/diagnostics/memory-snapshot with no body.",
        "Implement idle/loading/success/error/busy states. Disable the button while loading. Map 201 to success metadata, 409 to busy copy, other failures to error message.",
        "Success UI shows filePath (copyable), bytes, durationMs, schemaVersion and partial flags. Never fetch or render the full diagnostic JSON.",
        "Include privacy callout about local paths and share-before-review. Optionally show curl as secondary help text.",
        "Reuse existing Settings panel styles and CSS variables; avoid inventing a new visual system. Keep changes out of the main chat path."
      ],
      "acceptance": [
        "Settings exposes a Diagnostics section with a working trigger button",
        "UI states cover idle/loading/success/error/409",
        "Success shows metadata only and supports path copy",
        "Privacy callout is always visible in the section",
        "No full JSON preview or diagnostics file browser is introduced"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "manual Settings click smoke against running dev server"
      ],
      "risks": [
        "Settings section type unions must stay exhaustive",
        "Long absolute paths may overflow layout without wrap/copy affordance",
        "Users may expect a file list; keep scope to single-shot capture"
      ],
      "parallelizable": false,
      "priority": 3,
      "failurePolicy": "stop",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "memory-diagnostics-validation",
      "title": "Document contracts and complete security/performance validation",
      "phase": "checking",
      "description": "Update project maps and troubleshooting runbook, then execute all automatic and manual checks with evidence.",
      "order": 4,
      "dependsOn": ["memory-settings-ui"],
      "relation": "barrier",
      "files": [
        "AGENTS.md",
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/modules/frontend.md",
        "docs/operations/troubleshooting.md",
        ".ypi/tasks/20260711-233128-新增内存诊断快照能力-采集进程-agentsession-studio运行时状态并写入诊断文件/handoff.md"
      ],
      "instructions": [
        "Document API response/statuses, schema and privacy boundary, output directory, Settings entry, curl usage, multi-snapshot comparison, manual deletion and known limitation of per-known-session OpenAI stats.",
        "Update AGENTS module entry navigation for the new diagnostics collector/route/UI without adding detailed prose there.",
        "Run focused tests, lint and typecheck. Manually collect via Settings and curl; verify jq parsing and marker absence.",
        "Write handoff.md with files changed, validation evidence, residual risks and rollback. Do not run next build for routine validation."
      ],
      "acceptance": [
        "Documentation matches implemented contract and explicitly warns that files contain local paths",
        "All checks in checks.md have pass/fail evidence",
        "Lint, typecheck and focused tests pass",
        "Manual Settings and API smoke prove file production without known markers",
        "No unrelated files or dependency versions are changed"
      ],
      "validation": [
        "npm run test:memory-diagnostics",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "manual Settings + API smoke from checks.md",
        "git diff --check"
      ],
      "risks": [
        "Manual smoke without long-running state may not demonstrate suspected growth",
        "Diagnostic files accumulate on disk until manually deleted"
      ],
      "parallelizable": false,
      "priority": 4,
      "failurePolicy": "stop",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 验证命令

```bash
npm run test:memory-diagnostics
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

人工 smoke：

```bash
# Settings → 诊断 → 生成内存诊断快照
curl -i -X POST http://localhost:30141/api/diagnostics/memory-snapshot
jq . ~/.pi/agent/diagnostics/<API 返回的 fileName>
```

## 实现与评审门禁

- 未获用户对 `plan-review.md`（含 HTML 原型）的明确批准前，不进入 implementing，不派发 implementer。
- 每个实现子任务完成后执行 local checker review。
- 最终 checker 必须按 `checks.md` 验证 marker 排除、只读性、deadline/size fallback、并发锁、原子写失败路径和 Settings 状态。
- 不运行 `next build`。

## 回滚

删除 additive route、collector、owner projection exports、Settings diagnostics section、测试脚本和文档条目。诊断 JSON 与业务数据无耦合。
