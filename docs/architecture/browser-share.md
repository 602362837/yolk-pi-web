# Browser Share Architecture

Browser Share lets a user explicitly share the active Chrome tab with one selected ypi chat/session.

## Runtime model

- Chrome MV3 extension lives outside this package at `~/gitProjects/ypi-browser-share-extension` and is not imported into the ypi web npm package or Next.js build.
- ypi web exposes a localhost-only bridge under `app/api/browser-share/**`.
- The extension creates a short-lived one-time share code. The user enters that code in the target chat input to bind the page to that session.
- Agent tools are scoped to the current session id and never accept arbitrary `shareId` input.

## New Chat binding lifecycle

New Chat can bind Browser Share before the first user prompt:

1. `BrowserShareControl` is enabled when the chat has a valid `cwd` and is not disabled/archived/streaming.
2. Before binding from a New Chat with no real session id, the client calls `POST /api/agent/draft`.
3. `/api/agent/draft` validates/canonicalizes `cwd`, registers the allowed root, creates a real empty pi session, applies optional tool/model/thinking selections, and returns `{ success: true, sessionId }` without sending a prompt.
4. The share code is bound directly to that real session id through `POST /api/browser-share/sessions/[sessionId]/bind`.
5. The first user prompt reuses the precreated session through `POST /api/agent/[sessionId]` rather than creating another session via `/api/agent/new`.

This keeps Browser Share security session-scoped and ensures first-turn agent tools can see the bound page. The tradeoff is that a failed or abandoned New Chat bind can leave an empty pending session.

## Empty-session title lifecycle

Precreated Browser Share sessions start with a pending display label rather than a permanent `Untitled` name. After the first prompt is sent:

- the UI seeds `firstMessage`/display title from the first user message text;
- session list/current tab metadata is updated optimistically;
- manual `session.name` values remain authoritative and are not overwritten;
- later session reloads recover the title from the JSONL first user message.

The MVP does not write an automatic persistent generated `name` and does not run LLM title generation.

## Safety boundaries

- Default permission mode is `readonly`.
- In `readonly`, every action command requires one-time approval.
- In `interactive`, `type` and `navigate` still require one-time approval; `click` and `scroll` may be queued directly.
- Snapshots include URL/title, visible text, selection, and bounded interactive element summaries.
- Password, payment, token-like, and hidden field values are not collected by the extension and server snapshots are length-limited.
- Share codes expire before binding, are single-use, and are deleted when bound.
- `navigate` is limited to `http:` and `https:` URLs.

## Command lifecycle

Action tools (`click`, `type`, `scroll`, `navigate`) now wait for a terminal command state instead of returning only a queued command:

```text
agent tool
  -> BrowserShareManager.enqueueCommand(sessionId, type, payload)
  -> pending_approval or queued, depending on permission mode/action type
  -> tool emits live progress via onUpdate
  -> user approves/rejects once if required
  -> extension polls executable queued commands
  -> manager marks queued -> running
  -> extension executes against the bound tab
  -> extension posts result and optional fresh snapshot
  -> manager records succeeded/failed/rejected/timeout and wakes waiters
  -> tool returns compact terminal result with tab, lastSnapshotAt, and snapshot summary
```

The default action wait is 90 seconds. Terminal statuses are `succeeded`, `failed`, `rejected`, and `timeout`. Late extension results after a terminal state are ignored idempotently.

## Extension transport

The MVP keeps content-script execution plus an extension-initiated command channel:

- `GET /api/browser-share/shares/[shareId]/commands?waitMs=25000` is the primary long-poll path.
- The route updates heartbeat state, never returns pending-approval commands, and marks returned queued commands as `running`.
- The extension service worker keeps one guarded poll in flight per active share, retries with backoff on errors, and uses `chrome.alarms` to restart best-effort when MV3 suspends the worker.
- The popup is status/manual-control UI only; it is not required to stay open for command execution.
- Post-action snapshots are uploaded automatically when possible, with manual refresh remaining as a fallback.

## Debugger/CDP deferral

The MVP intentionally does not use Chrome `debugger` / CDP:

- ypi web and server-side agent tools cannot call `chrome.debugger`; execution would still have to go through the extension.
- Debugger/CDP could improve screenshot, coordinate input, navigation waiting, and DOM/AX inspection, but it adds high-risk `debugger` permission, user-visible debug prompts, DevTools conflicts, and larger privacy exposure.
- The extension manifest must not add `debugger` or `<all_urls>` for this MVP.
- A debugger-first mode should be treated as a future opt-in spike with separate product approval.

## API summary

- `POST /api/agent/draft`
- `GET /api/browser-share/health`
- `POST /api/browser-share/shares`
- `POST /api/browser-share/shares/[shareId]/snapshot`
- `GET /api/browser-share/shares/[shareId]/commands`
- `POST /api/browser-share/sessions/[sessionId]/bind`
- `DELETE /api/browser-share/sessions/[sessionId]/bind`
- `GET /api/browser-share/sessions/[sessionId]/state`
- `POST /api/browser-share/sessions/[sessionId]/commands`
- `POST /api/browser-share/sessions/[sessionId]/commands/[commandId]/approval`
- `POST /api/browser-share/commands/[commandId]/result`

## Agent tools

- `browser_share_status`
- `browser_share_snapshot`
- `browser_share_get_selection`
- `browser_share_click`
- `browser_share_type`
- `browser_share_scroll`
- `browser_share_navigate`
