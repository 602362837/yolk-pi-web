# Design — Browser Share New Chat 绑定、标题刷新与 Tab 操作通道

## Evidence reviewed

- Project docs: `docs/architecture/browser-share.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`.
- ypi web code: `components/BrowserShareControl.tsx`, `hooks/useAgentSession.ts`, `components/ChatWindow.tsx`, `components/ChatInput.tsx`, `app/api/agent/new/route.ts`, `app/api/agent/[id]/route.ts`, `app/api/sessions/[id]/route.ts`, `lib/session-reader.ts`, `lib/browser-share-manager.ts`, `lib/browser-share-types.ts`, `lib/browser-share-extension.ts`.
- External extension code: `~/gitProjects/ypi-browser-share-extension/manifest.json`, `src/service-worker/service-worker.js`, `src/content/snapshot.js`, `README.md`.

Current behavior confirmed:

- New Chat has no session id until `/api/agent/new` creates one while sending the first prompt.
- `BrowserShareControl` disables itself without `sessionId`.
- Browser Share manager already has in-memory share/session/snapshot/command state, but action tools return queued command data immediately.
- Extension manifest currently uses `activeTab`, `scripting`, `storage` and localhost host permissions; no `debugger` permission.
- Extension command polling is lightweight/popup-triggered; README currently documents that limitation.
- Session list title is `session.name || session.firstMessage.slice(0, 50) || id`; `PATCH /api/sessions/[id]` writes manual session name via `appendSessionInfo`.

## Recommendation summary

1. **New Chat binding**: keep the previously recommended lazy real empty session. When the user binds Browser Share in New Chat, create a real pi session with no prompt, bind the share code to it, and use that same session for the first prompt.
2. **Title lifecycle**: after the first prompt is sent to a precreated session, seed/refresh the session display title from the first user message immediately and let subsequent session-list reloads recover the same first message from JSONL. Do not auto-write `session.name` unless explicitly confirmed; preserve manual renames.
3. **Action lifecycle**: keep session-scoped command queue and one-time approvals; tools wait up to 90s for terminal command state.
4. **Extension transport**: replace popup-driven sync with extension background **long-poll primary + short retry/backoff + MV3 alarms fallback**. This still is a command channel, but it is not user-visible popup polling.
5. **Debugger/CDP**: do not make debugger-first the MVP. It is technically feasible for screenshots/coordinate input/navigation/AX tree, but it adds a high-risk permission and still needs a command/result transport between ypi web and extension.

## Debugger API / CDP feasibility

### What debugger mode can do

With manifest `permissions: ["debugger"]`, the extension service worker can attach to the shared tab:

```js
await chrome.debugger.attach({ tabId }, "1.3");
await chrome.debugger.sendCommand({ tabId }, "Page.enable");
```

Useful CDP domains/commands include:

- `Page.captureScreenshot` for visual screenshots.
- `DOMSnapshot.captureSnapshot`, `DOM.getDocument`, `Accessibility.getFullAXTree` for DOM/layout/accessibility data.
- `Runtime.evaluate` to compute visible text, element bounds, or run a collector function in page context.
- `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText` for coordinate/key input.
- `Page.navigate` and lifecycle events for navigation.

This can reduce reliance on stale content-script element ids and can make visual verification stronger.

### What debugger mode does not solve

- ypi web cannot call `chrome.debugger`; only extension code can.
- Agent tools execute server-side, so ypi web still needs to send commands to extension and receive results.
- A stored tab coordinate/tabId is not enough; some extension-side process must attach, execute, collect result, and report back.
- User approval, permission matrix, session binding, command timeout, result retention, and snapshot sanitization still live in ypi web/extension protocol.
- CDP can expose more page data than the current collector; server-side and extension-side sanitization remains required.

### Debugger risks

| Risk | Impact | Mitigation if adopted later |
| --- | --- | --- |
| High-risk `debugger` permission | User trust and install/update friction | Separate opt-in mode, clear UI copy, off by default. |
| DevTools/other debugger conflict | Attach fails or interrupts workflow | Detect attach failure, detach cleanly, fall back to content-script mode. |
| Browser debug infobar | User-visible disruption | Attach only during command/snapshot, detach after settle when possible. |
| Larger data exposure | Privacy risk | Keep bounded snapshot schema and sanitizers; never expose raw DOM/AX tree to agent by default. |
| More complex lifecycle | Stale attachments, crashed targets | Central attach/detach manager with finally cleanup and tab-close handling. |

### Future debugger-first shape, if later approved

- Extension manifest adds `debugger` only behind an explicit product decision.
- User share flow clearly says “启用调试控制此标签页”。
- Active share stores `{ shareId, tabId, debuggerAttached?, attachMode }` locally.
- Commands execute through CDP where useful:
  - `navigate`: `Page.navigate` + lifecycle wait;
  - `click/scroll`: coordinate lookup via DOM/AX/Runtime + `Input.dispatchMouseEvent`;
  - `type`: focus/click target + `Input.insertText` or JS fallback;
  - snapshot: screenshot + bounded text/element summary.
- Content-script collector remains fallback for pages/CDP gaps and for lower-permission mode.

## New Chat session lifecycle

### Flow

```text
New Chat, no session id
  user opens Browser Share bind panel
  user enters syntactically valid share code
    -> ensureBrowserShareSession()
       POST /api/agent/draft { cwd, toolNames, model, thinkingLevel }
       start real pi session with no prompt
       onSessionCreated({ messageCount: 0, firstMessage: "(no messages)", titlePending: true })
    -> POST /api/browser-share/sessions/[sessionId]/bind { shareCode }
    -> BrowserShareControl displays bound tab
  user sends first prompt
    -> handleSend detects effectiveSessionId
    -> POST /api/agent/[effectiveSessionId] { type: "prompt", message, images }
    -> optimistic UI updates selected session:
       messageCount = 1
       firstMessage = first text block / first sentence truncated
       modified = now
       titlePending = false
    -> SSE streams from same session id
    -> on agent end, sessions reload confirms firstMessage from JSONL
```

### `/api/agent/draft`

Purpose: create a real pi session without sending a prompt.

Request:

```ts
{
  cwd: string;
  toolNames?: string[];
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}
```

Response:

```ts
{ success: true; sessionId: string }
```

Behavior:

- Reuse `/api/agent/new` cwd validation/canonicalization, allowed root registration, model/tool/thinking application.
- Call `startRpcSession(tempKey, "", canonicalCwd, toolNames)` or equivalent safe empty-session start.
- Send no prompt command and append no user message.
- Return the real session id.

### Title refresh rules

- MVP title seed is the first user message text, truncated consistently with existing session-list behavior.
- Do **not** call `PATCH /api/sessions/[id]` automatically unless a future product decision wants persistent generated `name`; otherwise auto-name could override manual rename semantics.
- Existing manual `session.name` always wins over firstMessage.
- UI should avoid showing permanent Untitled for precreated sessions; before first prompt, show a temporary state such as “Browser Share 已绑定，待首条消息命名”.
- After first prompt, update selected session/session list optimistically and refresh list after agent end.

## Browser Share command lifecycle

Terminal statuses: `succeeded`, `failed`, `rejected`, `timeout`.

```text
agent tool -> manager.enqueueCommand(sessionId, type, payload)
  pending_approval or queued
  -> tool emits onUpdate
  -> UI approve/reject if needed
  -> extension long-polls executable commands
  -> manager marks queued -> running and notifies waiters
  -> extension executes with content script
  -> extension posts result + snapshot
  -> manager records terminal state and notifies waiters
  -> tool returns terminal result or timeout after 90s
```

Manager additions:

- `waitForCommand(commandId, { timeoutMs: 90000, signal })`.
- `notifyCommandChanged(commandId)` used by enqueue, approve/reject, running, result, timeout, unbind.
- Heartbeat fields: `lastSeenAt`, `lastCommandPollAt`, `lastSnapshotAt`, `lastResultAt`.
- `recentCommands` projection for bounded terminal command history.
- Retention cap/TTL for completed commands.
- Active command cleanup on unbind/share replacement.

## Extension transport design

### Recommended MVP transport

Use extension-initiated background transport, not ypi-web-initiated tab control.

- Primary: `GET /api/browser-share/shares/[shareId]/commands?waitMs=25000` long-poll.
  - If command exists, return immediately.
  - If none, hold until command changes or `waitMs` elapses.
  - Return empty list on timeout; extension immediately loops while active.
- Backoff: on network errors, retry with increasing delay, but keep user-visible stale/offline state.
- Fallback: `chrome.alarms` wakes MV3 service worker periodically to restart polling if suspended.
- Popup: status/manual controls only; not required for command execution.

This is still technically polling/long-polling, but it is the minimum-complexity command channel compatible with MV3 and local Next API routes.

### Transport alternatives considered

| Option | Pros | Cons | MVP decision |
| --- | --- | --- | --- |
| Short polling | Simple | Latency or wasted requests | Use only as fallback/backoff. |
| Long-poll HTTP | Simple local API, low latency, no custom socket server | Still extension-initiated; MV3 can suspend | Recommended MVP primary. |
| WebSocket from extension to ypi | Lowest latency, bidirectional | Next route/server support complexity, reconnect/lifecycle complexity | Future option. |
| SSE/fetch streaming | Server push over HTTP | Service worker streaming reliability varies; still client-initiated | Future option. |
| Offscreen document | Can keep WebSocket/DOM context alive | Extra permission and policy/lifecycle complexity | Future option only if needed. |
| Native messaging | Robust local bridge | Requires native host install/config; much larger distribution burden | Out of scope. |
| externally_connectable + ypi page mediator | Web UI can message extension | Requires ypi page open/extension id handshake; agent tools still server-side | Not MVP. |

## ypi web module design

### `hooks/useAgentSession.ts`

Add:

- `precreatedSessionId` state/ref.
- `effectiveSessionId = session?.id ?? precreatedSessionId ?? null`.
- `ensureBrowserShareSession(): Promise<string | null>` with duplicate-call locking.
- First-send routing: if `effectiveSessionId` exists, send prompt to `/api/agent/[id]`; call `/api/agent/new` only when no effective id exists.
- Title seed update after first prompt for precreated session: update selected session metadata via existing callback or a new `onSessionUpdated` callback.
- After draft exists, model/tool/thinking changes apply to that real session.

### `components/BrowserShareControl.tsx`

- Enable New Chat binding when `cwd` exists and not disabled.
- Before creating draft session, reject empty/obviously invalid share code.
- If no `sessionId`, call `ensureBrowserShareSession()` before bind.
- Display temporary title/status copy for empty precreated sessions.
- Display connection, last snapshot, active commands, pending approvals, recent terminal commands.

### `lib/browser-share-extension.ts`

- Keep tool schemas without `shareId`.
- Validate command-specific inputs before enqueue.
- Enqueue through current session context only.
- Emit onUpdate progress for status transitions.
- Wait 90s for terminal status.
- Return compact terminal result; `browser_share_snapshot` remains the full bounded snapshot tool.

## External extension design

### Manifest

MVP:

- Add `alarms` permission if alarms fallback is implemented.
- Keep `activeTab`, `scripting`, `storage`.
- Keep host permissions limited to localhost/127.0.0.1.
- Do **not** add `debugger` or `<all_urls>` in this iteration.

### Service worker

- Maintain `activeShare` with `shareId`, `tabId`, `baseUrl`, `permissionMode`, `tab`, `lastPollAt`, `lastSnapshotAt`, `lastCommandStatus`.
- Start command loop after create share, refresh snapshot, startup/onInstalled/onStartup if active share exists, and alarms.
- Use guarded long-poll loop with `pollInFlight` and abort/timeout cleanup.
- Execute returned commands and always POST result for success/failure.
- Upload post-action snapshot after settle/navigation.
- Handle tab update/close/inaccessible states with clear failures.

### Content script

- Keep bounded sanitized snapshot collector.
- Improve element lookup so summary and DOM mapping are built in one pass.
- Refuse sensitive fields.
- Dispatch input/change events for type.
- Wait small settle delay after action before snapshot.
- Navigation preferably handled by service worker/tab API; content fallback allowed.

## Compatibility and migration

- No persisted Browser Share migration; state remains in-memory.
- Existing non-Browser-Share New Chat flow remains `/api/agent/new`.
- Existing sessions keep normal bind/unbind behavior.
- Extension reload is required if manifest adds `alarms`.
- Debugger mode is deferred; no new debugger permission prompt in MVP.

## Files likely changed

### ypi web

- `app/api/agent/draft/route.ts`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/ChatInput.tsx`
- `components/BrowserShareControl.tsx`
- `lib/browser-share-types.ts`
- `lib/browser-share-manager.ts`
- `lib/browser-share-extension.ts`
- `app/api/browser-share/shares/[shareId]/commands/route.ts`
- `app/api/browser-share/commands/[commandId]/result/route.ts`
- `app/api/browser-share/sessions/[sessionId]/commands/[commandId]/approval/route.ts`
- `app/api/browser-share/sessions/[sessionId]/state/route.ts`
- Docs: `docs/architecture/browser-share.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`

### External extension

- `~/gitProjects/ypi-browser-share-extension/manifest.json`
- `~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
- `~/gitProjects/ypi-browser-share-extension/src/content/snapshot.js`
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.js`
- `~/gitProjects/ypi-browser-share-extension/README.md`

## Rollback plan

- Re-disable New Chat bind until a session id exists.
- If title seed logic regresses, keep firstMessage-derived title from session reload and remove optimistic update.
- If long-poll transport is unreliable, fall back to short polling + manual popup refresh while keeping manager/tool lifecycle.
- Debugger mode is not in MVP, so no debugger rollback is needed.
