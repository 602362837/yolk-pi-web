# Implement — Browser Share New Chat 绑定、标题刷新与 Tab 操作通道

> 本文只规划实施，不实现代码。主会话仍需确认：本轮 MVP 不启用 debugger-first；首条消息标题使用第一条用户消息截断而非 LLM 语义标题。

## 已纳入决策

- New Chat 绑定时可懒创建真实空 pi session。
- 该预创建 session 在用户发送第一句话后必须刷新显示标题，避免长期 Untitled/空标题。
- Browser Share action tools 默认等待 terminal 结果，超时 90 秒。
- Chrome `debugger` API/CDP 可行但不推荐进本轮 MVP；它不能消除 ypi web ↔ extension 命令通道。
- MVP 推荐 content-script snapshot/action + extension 后台 long-poll/alarms transport。

## 执行原则

- ypi web 与 Chrome extension 独立修改、独立验证。
- 不让 agent tool 参数接受 `shareId`。
- 默认 readonly，一次性批准，不做永久授权。
- MVP manifest 不新增 `debugger` 或 `<all_urls>`。
- 代码实现后同步更新 docs。

## 需先阅读的文件

### ypi web

- `docs/architecture/browser-share.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `app/api/agent/new/route.ts`
- `app/api/agent/[id]/route.ts`
- `app/api/sessions/[id]/route.ts`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/ChatInput.tsx`
- `components/BrowserShareControl.tsx`
- `components/SessionSidebar.tsx`
- `lib/session-reader.ts`
- `lib/browser-share-manager.ts`
- `lib/browser-share-types.ts`
- `lib/browser-share-extension.ts`
- `app/api/browser-share/**`

### external extension

- `~/gitProjects/ypi-browser-share-extension/manifest.json`
- `~/gitProjects/ypi-browser-share-extension/README.md`
- `~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
- `~/gitProjects/ypi-browser-share-extension/src/content/snapshot.js`
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.js`
- `~/gitProjects/ypi-browser-share-extension/scripts/validate.mjs`

## 建议实施顺序

1. Web session lifecycle：新增 `/api/agent/draft`。
2. Hook/UI plumbing：`effectiveSessionId`、首条 prompt 复用、首条消息后标题 seed。
3. Browser Share UI：New Chat 可绑定、状态/approval 展示。
4. Manager/routes/tools：waiter、heartbeat、long-poll、terminal result。
5. Extension transport：service worker long-poll + alarms，popup 不再必需。
6. Extension execution：content script action/snapshot 稳健性。
7. Docs/validation：更新 web docs 与 extension README，完成自动和手工验证。

## Debugger 相关实施边界

本轮不实现 debugger-first。若主会话改变决策，应先单独增加 feasibility spike，验证：

- `debugger` permission 用户提示是否可接受；
- attach/detach 与 DevTools 冲突处理；
- CDP screenshot/DOM/AX/coordinate click/type/navigate 能力；
- 数据脱敏与 raw DOM/AX tree 不暴露给 agent；
- 与现有 command transport 的兼容方式。

## Implementation Plan

### 人类可读子任务表

| id | phase | order | title | dependsOn | parallelizable |
| --- | --- | ---: | --- | --- | --- |
| `web-agent-draft-api` | web-session | 10 | 新增空 session 创建 API | — | true |
| `web-effective-session-plumbing` | web-session | 20 | 接入 effective session、首条 prompt 复用与标题刷新 | `web-agent-draft-api` | false |
| `web-browser-share-new-chat-ui` | web-ui | 30 | New Chat Browser Share 绑定与状态 UI | `web-effective-session-plumbing` | false |
| `web-manager-command-lifecycle` | web-command | 40 | BrowserShareManager wait/heartbeat/timeout/retention | — | true |
| `web-browser-share-routes` | web-command | 50 | Browser Share routes 状态转移与 long-poll | `web-manager-command-lifecycle` | false |
| `web-agent-tools-wait` | web-command | 60 | action tools 校验、等待 terminal、onUpdate | `web-browser-share-routes` | false |
| `extension-command-transport` | extension | 70 | service worker long-poll/alarms command transport | `web-browser-share-routes` | true |
| `extension-content-script-actions` | extension | 80 | content script 执行与自动快照稳健性 | `extension-command-transport` | false |
| `extension-popup-docs` | extension | 90 | popup 状态化与 extension README/manifest | `extension-command-transport` | true |
| `docs-validation-handoff` | validation | 100 | 文档同步、自动验证、手工验收记录 | all above | false |

### 机器可读计划

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "taskId": "20260706-103256-优化-browser-share-new-chat-绑定与-chat-直接操作-tab-交互",
  "summary": "Enable Browser Share binding before the first New Chat prompt by lazily creating a real empty pi session, refresh its title after the first user message, and complete direct tab action lifecycle through approval, extension transport, result waiting, and automatic snapshots. MVP keeps content-script execution plus background long-poll/alarms transport; debugger-first is deferred.",
  "subtasks": [
    {
      "id": "web-agent-draft-api",
      "title": "Add empty pi session creation API",
      "phase": "web-session",
      "order": 10,
      "dependsOn": [],
      "files": ["app/api/agent/draft/route.ts", "app/api/agent/new/route.ts", "docs/modules/api.md"],
      "instructions": "Create POST /api/agent/draft. Reuse cwd validation/canonicalization and allowed-root registration from /api/agent/new. Start a real pi session with a one-time temp key and no prompt. Apply toolNames, provider/modelId, and non-auto thinkingLevel before returning. Do not append a user message.",
      "acceptance": ["Valid cwd returns a real sessionId without sending a prompt.", "Invalid/missing cwd returns 400 with clear error.", "Selected tool/model/thinking options are applied.", "docs/modules/api.md lists the route."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual API call with valid and invalid cwd"],
      "risks": ["Empty session file creation is accepted MVP behavior.", "Duplicated /api/agent/new logic should stay small or be factored carefully."],
      "parallelizable": true,
      "localReview": ["Confirm no prompt command is sent.", "Confirm cwd validation is not bypassed."]
    },
    {
      "id": "web-effective-session-plumbing",
      "title": "Wire effectiveSessionId, first prompt reuse, and title refresh",
      "phase": "web-session",
      "order": 20,
      "dependsOn": ["web-agent-draft-api"],
      "files": ["hooks/useAgentSession.ts", "components/ChatWindow.tsx", "components/AppShell.tsx", "components/SessionSidebar.tsx"],
      "instructions": "Add precreatedSessionId/effectiveSessionId and ensureBrowserShareSession() with duplicate-call locking. If effectiveSessionId exists, first prompt must POST to /api/agent/[id] instead of /api/agent/new. After sending the first prompt to a precreated session, optimistically update selected/session-list metadata with messageCount=1, firstMessage/title seed from the first user text, modified=now, and titlePending=false. Preserve manual session.name and let normal session reload confirm firstMessage from JSONL.",
      "acceptance": ["Binding flow gets a real session id before any message.", "First prompt after precreation uses the same session id.", "Precreated session title changes from pending/empty to first-message-derived title immediately after first send.", "Ordinary New Chat without precreation still uses /api/agent/new.", "Double-click ensure does not create duplicate sessions."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual first-send path with and without precreated session"],
      "risks": ["React state race between session prop null and precreated id.", "Auto title seed must not overwrite manual names."],
      "parallelizable": false,
      "localReview": ["Search for session?.id paths that should use effectiveSessionId.", "Confirm sidebar/title display no longer stays Untitled after first prompt."]
    },
    {
      "id": "web-browser-share-new-chat-ui",
      "title": "Enable BrowserShareControl in New Chat and show richer state",
      "phase": "web-ui",
      "order": 30,
      "dependsOn": ["web-effective-session-plumbing"],
      "files": ["components/ChatWindow.tsx", "components/ChatInput.tsx", "components/BrowserShareControl.tsx", "docs/modules/frontend.md"],
      "instructions": "Pass effectiveSessionId and ensureBrowserShareSession through ChatWindow/ChatInput. Enable the control when cwd exists and not disabled. Validate share code pattern before creating a draft session. Add copy explaining New Chat bind creates the chat. Display bound tab, permission mode, last snapshot, connection, pending approvals, queued/running commands, and recent terminal commands.",
      "acceptance": ["New Chat Browser Share button is clickable before first message.", "Binding a valid code creates/binds a session and displays tab state.", "Pending approval cards support allow once/reject.", "Polling cadence accelerates while commands are active."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual UI walkthrough"],
      "risks": ["Valid-looking expired share code can still leave an empty session.", "Toolbar may become crowded."],
      "parallelizable": false,
      "localReview": ["Check archived/streaming disabled states.", "Check copy accurately describes empty session creation and pending title."]
    },
    {
      "id": "web-manager-command-lifecycle",
      "title": "Add BrowserShareManager waiters, heartbeat, timeout, and retention",
      "phase": "web-command",
      "order": 40,
      "dependsOn": [],
      "files": ["lib/browser-share-manager.ts", "lib/browser-share-types.ts", "docs/modules/library.md"],
      "instructions": "Extend command status with timeout and add connection/recent command fields. Implement waitForCommand(commandId,{timeoutMs,signal}), notifyCommandChanged, heartbeat fields, terminal timeout marking, active command handling on unbind/share replacement, recent command projection, and bounded completed-command retention.",
      "acceptance": ["waitForCommand resolves for succeeded/failed/rejected/timeout.", "Approval/result/running transitions notify waiters.", "State distinguishes active commands from recent terminal commands.", "Completed commands do not grow unbounded."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual route flow"],
      "risks": ["Timer cleanup leaks.", "Late extension result after timeout must be idempotent."],
      "parallelizable": true,
      "localReview": ["Review terminal-state idempotency.", "Confirm cleanup notifies active waiters."]
    },
    {
      "id": "web-browser-share-routes",
      "title": "Update Browser Share routes and add long-poll support",
      "phase": "web-command",
      "order": 50,
      "dependsOn": ["web-manager-command-lifecycle"],
      "files": ["app/api/browser-share/shares/[shareId]/commands/route.ts", "app/api/browser-share/commands/[commandId]/result/route.ts", "app/api/browser-share/sessions/[sessionId]/commands/[commandId]/approval/route.ts", "app/api/browser-share/sessions/[sessionId]/state/route.ts", "docs/modules/api.md"],
      "instructions": "Make commands route update heartbeat, support waitMs long-poll, return executable queued commands only, and mark queued->running. Result route records terminal result, updates snapshot, and notifies waiters. Approval route sets queued/rejected and notifies waiters. State route returns connection and recentCommands projection.",
      "acceptance": ["Polling/long-polling a queued command moves it to running.", "Approve/reject state transitions are correct.", "Posting result moves command to succeeded/failed and updates snapshot.", "State endpoint exposes active/recent command projections."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual route calls"],
      "risks": ["Long-held requests need bounded waitMs and cleanup.", "Pending approval commands must not be sent to extension by default."],
      "parallelizable": false,
      "localReview": ["Confirm route errors are user actionable.", "Confirm no agent-facing route requires shareId input." ]
    },
    {
      "id": "web-agent-tools-wait",
      "title": "Make Browser Share action tools validate and wait for terminal result",
      "phase": "web-command",
      "order": 60,
      "dependsOn": ["web-browser-share-routes"],
      "files": ["lib/browser-share-extension.ts", "lib/browser-share-manager.ts", "lib/browser-share-types.ts"],
      "instructions": "Update click/type/scroll/navigate tools with command-specific validation and http/https navigation checks. Enqueue by current session context only. Emit onUpdate for status changes. Wait up to 90 seconds for terminal status. Return compact final result with command status, message/error, tab, lastSnapshotAt, and snapshot summary.",
      "acceptance": ["Tool schemas do not include shareId.", "Invalid inputs fail before enqueue.", "Tools wait for terminal result or timeout.", "Readonly/interactive permission matrix remains correct."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual agent calls for click/type/scroll/navigate"],
      "risks": ["onUpdate typing must match pi SDK expectations.", "Full snapshots may bloat context; return compact summaries."],
      "parallelizable": false,
      "localReview": ["Inspect registered parameters for accidental shareId.", "Confirm timeout messaging is clear."]
    },
    {
      "id": "extension-command-transport",
      "title": "Implement extension long-poll/alarms command transport",
      "phase": "extension",
      "order": 70,
      "dependsOn": ["web-browser-share-routes"],
      "files": ["~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js", "~/gitProjects/ypi-browser-share-extension/manifest.json"],
      "instructions": "Replace popup-driven command sync with service-worker activeShare transport. Use guarded long-poll to /commands?waitMs=25000 while active, short retry/backoff on failures, and chrome.alarms fallback to restart when MV3 suspends. Start/restart loop on share create, refresh, startup/onInstalled/onStartup, and alarm. Do not add debugger or all_urls permissions; add alarms only if used.",
      "acceptance": ["Commands execute best-effort when popup is closed.", "No concurrent polls for the same share.", "Success and failure results are posted back.", "Manifest does not include debugger or all_urls."],
      "validation": ["cd ~/gitProjects/ypi-browser-share-extension && npm run build", "Manual command execution with popup closed"],
      "risks": ["MV3 service worker may still sleep between alarms.", "Network failures to localhost must not crash the loop."],
      "parallelizable": true,
      "localReview": ["Review permissions in manifest.", "Check backoff and pollInFlight behavior."]
    },
    {
      "id": "extension-content-script-actions",
      "title": "Improve content command execution and automatic post-action snapshots",
      "phase": "extension",
      "order": 80,
      "dependsOn": ["extension-command-transport"],
      "files": ["~/gitProjects/ypi-browser-share-extension/src/content/snapshot.js", "~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js"],
      "instructions": "Refactor element lookup to build summary and DOM mapping once. Keep sensitive target refusal. Add settle delay after click/type/scroll before snapshot. Prefer service-worker navigation with chrome.tabs.update and load wait. Return clear {ok:false,message,snapshot?} failures.",
      "acceptance": ["Element lookup avoids repeated collectElements calls.", "Sensitive fields are refused.", "Post-action snapshots reflect DOM updates/navigation when possible.", "Missing elements return clear failure with fresh snapshot."],
      "validation": ["cd ~/gitProjects/ypi-browser-share-extension && npm run build", "Manual click/type/scroll/navigate success and failure cases"],
      "risks": ["Dynamic pages may change element ids.", "Navigation timing can be flaky; use bounded waits."],
      "parallelizable": false,
      "localReview": ["Inspect sensitive detection patterns.", "Check async sendResponse handling." ]
    },
    {
      "id": "extension-popup-docs",
      "title": "Update extension popup status and README",
      "phase": "extension",
      "order": 90,
      "dependsOn": ["extension-command-transport"],
      "files": ["~/gitProjects/ypi-browser-share-extension/src/popup/popup.js", "~/gitProjects/ypi-browser-share-extension/src/popup/popup.html", "~/gitProjects/ypi-browser-share-extension/src/popup/popup.css", "~/gitProjects/ypi-browser-share-extension/README.md"],
      "instructions": "Make popup show active share, last poll, last snapshot, and last command state. Keep manual refresh/stop/share controls. Update README to document background best-effort long-poll/alarms behavior, safety gates, debugger not used in MVP, and validation command.",
      "acceptance": ["Popup is status/manual-control UI, not required for command polling.", "README no longer tells users to keep popup open for actions.", "README documents MV3 best-effort limitations and no debugger permission."],
      "validation": ["cd ~/gitProjects/ypi-browser-share-extension && npm run build", "Manual popup status check"],
      "risks": ["Popup may show stale storage if background failed; label status as best-effort."],
      "parallelizable": true,
      "localReview": ["Check README/UI copy does not overpromise background reliability."]
    },
    {
      "id": "docs-validation-handoff",
      "title": "Update docs and complete validation/handoff",
      "phase": "validation",
      "order": 100,
      "dependsOn": ["web-agent-draft-api", "web-effective-session-plumbing", "web-browser-share-new-chat-ui", "web-manager-command-lifecycle", "web-browser-share-routes", "web-agent-tools-wait", "extension-command-transport", "extension-content-script-actions", "extension-popup-docs"],
      "files": ["docs/architecture/browser-share.md", "docs/modules/api.md", "docs/modules/frontend.md", "docs/modules/library.md", "~/gitProjects/ypi-browser-share-extension/README.md"],
      "instructions": "Synchronize architecture/module docs with implemented behavior. Run web lint/typecheck and extension build. Complete manual checks for New Chat bind, first-turn tools, title refresh, permission matrix, command results, transport with popup closed, and error cases.",
      "acceptance": ["Docs describe /api/agent/draft, title refresh, long-poll command lifecycle, and debugger deferral.", "Web validation passes.", "Extension validation passes.", "Manual checklist in checks.md is completed or blockers reported."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "cd ~/gitProjects/ypi-browser-share-extension && npm run build"],
      "risks": ["Manual Chrome validation requires reloading unpacked extension after manifest changes.", "MV3 timing issues may only reproduce after Chrome idles."],
      "parallelizable": false,
      "localReview": ["Confirm extension code is not imported into ypi web package.", "Confirm checks.md error scenarios have outcomes." ]
    }
  ]
}
```

## 验证命令

ypi web repo:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

External extension repo:

```bash
cd ~/gitProjects/ypi-browser-share-extension
npm run build
```

不要用 `next build` 做常规开发验证。

## 检查门禁

- New Chat 首条消息前可以绑定，且首条消息复用同一 session。
- 预创建 session 首条消息后标题刷新为第一条用户消息截断，不长期 Untitled/空标题。
- 首轮 Browser Share tools 可见绑定。
- Action tools 返回 terminal 状态，不只是 queued。
- Extension popup 关闭时 command 仍 best-effort 执行并回传 snapshot。
- `readonly` / `interactive` 权限矩阵正确。
- 拒绝、超时、离线、tab 关闭、敏感字段、元素不存在、非法 URL 都有明确反馈。
- Tool schemas 和 prompt snippets 不暴露 `shareId`。
- MVP manifest 无 `debugger`、无 `<all_urls>`。
