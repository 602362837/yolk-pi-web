# Browser Tab Share to pi-web — Research Notes

## Current pi-web integration surface

Relevant project files:

- `components/ChatInput.tsx`
  - `ChatInputHandle` exposes `insertText`, `insertIfEmpty`, `addImages`, `addFiles`, `addFileReference`.
  - Images are converted with `FileReader.readAsDataURL` and kept as `{ data, mimeType, previewUrl }`.
  - Non-image files are uploaded immediately to `/api/files/upload`, then rendered in the final prompt as `📎 name — /absolute/path`.
- `hooks/useAgentSession.ts`
  - `handleSend(message, images)` sends to `/api/agent/new` for a new chat or `/api/agent/[id]` for an existing chat.
  - Existing commands are `{ type: "prompt", message, images? }`; during streaming also `{ type: "steer" }` / `{ type: "follow_up" }`.
- `app/api/agent/new/route.ts`
  - Requires `cwd`, starts a pi RPC session, optionally applies model/thinking/tools, then sends the prompt command.
- `app/api/agent/[id]/route.ts`
  - Sends arbitrary JSON command to a live/revived pi session.
- `app/api/files/upload/route.ts`
  - Accepts multipart `file`, stores under `~/.pi/agent/uploads/<id>/`, max 200 MB per file, lazy retention cleanup.

Important gap: the active selected chat/session is only known inside React state. External callers need either:

1. a page-level bridge that runs in the pi-web tab and can call the existing React handlers, or
2. an explicit API/session selection model for extensions.

## Chrome extension capability model

For a Chrome-only MVP, a Manifest V3 extension can use:

- `activeTab` + `scripting`: access the current page after a user gesture, inject a content script, read URL/title/selection/body text/metadata.
- `tabs`: query active tab URL/title and focus states.
- `captureVisibleTab`: screenshot the visible viewport, usually requiring user gesture/activeTab/tabs depending implementation.
- Host permissions: broader persistent access to pages, but higher security review burden.
- `debugger`: attach Chrome DevTools Protocol to tabs; powerful and invasive, triggers Chrome debugging warning and is overkill for simple share-to-chat.
- `storage`: save local pi-web origin/token/port settings.

## OpenClaw findings

Sources inspected locally:

- `https://github.com/openclaw/openclaw`
- `https://github.com/Unayung/openclaw-browser-relay`
- `https://github.com/imjszhang/js-eyes` exists and describes itself as a browser extension for AI agents like OpenClaw, but was not deeply inspected in this pass.

OpenClaw browser docs:

- `docs/tools/browser.md` describes an OpenClaw-managed browser plugin.
- It can run a separate browser profile (`openclaw`) and also has a `user` profile for attaching to a real signed-in Chrome session via Chrome MCP/existing-session.
- CLI examples include `openclaw browser start`, `open`, `tabs`, `snapshot`, `screenshot`, click/type/navigation, etc.
- The default browser tool is a bundled plugin registered behind OpenClaw Gateway method `browser.request`.

OpenClaw Browser Relay extension:

- Manifest V3 extension named `OpenClaw Browser Relay`.
- Permissions: `debugger`, `tabs`, `activeTab`, `storage`, `alarms`; host permissions for `http://127.0.0.1/*` and `http://localhost/*`.
- Options store a relay port, default `18792`, and gateway token.
- On toolbar click, it attaches `chrome.debugger` to the active tab.
- It opens `ws://127.0.0.1:<port>/extension?token=...` to a local relay/gateway.
- It forwards CDP events as JSON messages like `{ method: "forwardCDPEvent", params: ... }`.
- It receives commands like `{ id, method: "forwardCDPCommand", params: { method, params, sessionId? } }`, then calls `chrome.debugger.sendCommand`.
- This is a remote-control bridge, not a simple share-page-context extension.

pi compatibility assessment:

- The OpenClaw repo uses some `@earendil-works/pi-tui` UI dependency, but the inspected package metadata did not show `@earendil-works/pi-coding-agent`.
- OpenClaw's runtime model is a Gateway/plugin/control-plane architecture, not the same as pi-agent-web's Next.js API + pi AgentSession wrapper.
- Direct runtime reuse is therefore unlikely. Reusing concepts or extension code patterns is feasible; drop-in integration is not.

## Options

### Option A — Native pi-web share extension + in-page bridge (recommended MVP)

Flow:

1. User opens pi-web in one Chrome tab and a target page in another tab.
2. Extension action reads target active tab context after user gesture.
3. Extension finds/opens a pi-web tab and sends a Chrome runtime message to a content script running on pi-web.
4. The pi-web content script dispatches a DOM `CustomEvent` or `window.postMessage` into the page.
5. pi-web React listens in `ChatWindow`/`AppShell`, maps payload to `ChatInputHandle` methods, and optionally prompts user before sending.

Payload examples:

```ts
type BrowserSharePayload = {
  source: "pi-web-chrome-extension";
  mode: "insert" | "attach" | "send";
  tab: { url: string; title?: string; favIconUrl?: string };
  selection?: string;
  text?: string;
  html?: string;
  screenshot?: { mimeType: "image/png"; dataUrl: string };
  capturedAt: string;
};
```

Pros:

- Reuses existing `ChatInput` staging and user confirmation model.
- Avoids exposing broad unauthenticated HTTP APIs to extensions.
- Keeps active-session resolution inside the web UI where it already exists.
- Does not need `debugger` permission.

Cons:

- Requires pi-web tab to be open or must open one.
- Extension-to-page bridge needs careful origin checks.
- Auto-send needs a new `ChatInputHandle.send` or `ChatWindow` handler; otherwise MVP can insert/stage only.

### Option B — Extension calls pi-web local HTTP API directly

Flow:

1. Extension reads current tab context.
2. Extension calls `POST /api/files/upload` for files/screenshots if needed.
3. Extension calls `POST /api/agent/[id]` or `/api/agent/new`.

Pros:

- Works even if pi-web UI tab is not currently open.
- Can support one-click send/new-session flows.

Cons:

- Extension must know active session id and cwd, which pi-web does not currently expose externally.
- Existing `/api/agent/[id]` accepts arbitrary commands; extension access needs a narrower API and auth/CSRF protection.
- Cross-origin/localhost permissions and user trust model need design.

Better version: add a dedicated route like `POST /api/browser-share` that only accepts a validated share payload and targets the current UI-registered session or creates a new session based on explicit settings. This still needs auth/token.

### Option C — Adopt/adapt OpenClaw Browser Relay/CDP control

Flow:

1. User installs OpenClaw Browser Relay.
2. pi-web implements enough of the OpenClaw relay/gateway CDP protocol, or runs OpenClaw Gateway alongside pi-web.
3. Agent gets browser automation/snapshot actions instead of just pasted context.

Pros:

- Powerful: current tab control, DOM snapshots, screenshots, click/type/navigation.
- Existing relay extension has reconnect and MV3 lifecycle hardening.
- Useful if the product direction is agent-operated browser automation.

Cons:

- Requires `debugger`, a high-risk permission and scary UX warning.
- Protocol is CDP/control oriented, not chat-share oriented.
- Would require building/embedding a CDP relay/control service and tool surface in pi-agent-web/pi runtime.
- OpenClaw runtime is not a drop-in pi runtime based on current evidence.

### Option D — Use browser automation tool outside the user's actual tab

Flow: add a browser tool to pi runtime that opens pages in a managed browser or Playwright/Chrome profile.

Pros: good for agent automation and reproducibility.
Cons: does not solve the user's immediate "I am looking at this tab, share it to chat" need, especially for logged-in/intranet tabs.

## Recommendation

Build Option A first: a small Chrome MV3 extension plus a pi-web in-page bridge.

MVP scope:

- Extension permissions: `activeTab`, `scripting`, `tabs`, `storage`; avoid `debugger`.
- Capture: URL, title, selected text, readable `document.body.innerText` clipped by size, optional visible screenshot.
- pi-web behavior: insert a formatted context block into the current chat input and attach screenshot as an image if selected.
- User control: default to staging in input, not auto-send.
- Add origin allowlist + random bridge token stored in pi-web settings/localStorage and extension options before allowing external messages.

Example inserted prompt:

```md
Browser tab context:
Title: ...
URL: ...
Captured: 2026-06-29T...

Selected text:
...

Page text excerpt:
...
```

Follow-up phases:

1. Add direct send/new-session once auth/session selection is designed.
2. Add page artifact upload (`page.md` or `page.html`) using existing `/api/files/upload` with size limits.
3. Add optional CDP/OpenClaw-style control only if the product needs browser automation, not just sharing.

## Risks and guardrails

- Local API trust: do not let arbitrary web pages call pi-web prompt APIs. Use origin checks, extension id checks when possible, and a user-generated token.
- Prompt injection: page text is untrusted. Wrap it as quoted context and warn the agent/user not to execute page instructions blindly.
- Sensitive data: current tabs may include secrets; default to preview/stage before send.
- Size limits: cap DOM text and screenshot sizes before passing to React/API.
- Permissions: avoid `debugger` unless the feature explicitly becomes browser control.
- Upload retention: uploaded files are cleaned after 7 days or space pressure, so long-term transcript references may become stale.
