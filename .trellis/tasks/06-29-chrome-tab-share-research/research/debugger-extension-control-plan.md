# Chrome Extension Debugger Mode Control Plan

## Updated Product Intent

The desired feature is not only "share current tab context to chat". The user wants the agent to perceive an already-open normal Chrome tab and operate it for validation, automation tests, and web interaction checks. This makes the Chrome extension `debugger` permission route a better fit than low-permission content extraction.

## Why `debugger` Extension Fits

Chrome's `chrome.debugger` extension API can attach DevTools Protocol access to a user-selected tab in the user's normal Chrome profile without requiring Chrome launch flags. This solves the debug-port usability problem while preserving CDP-like capabilities.

Capabilities after attach:

- enumerate/attach current active tab after toolbar click;
- read current URL/title/runtime state;
- evaluate JavaScript in page context;
- inspect DOM/accessibility tree;
- capture screenshots;
- click/type/scroll/navigate through CDP commands;
- stream tab events back to pi-web/local bridge;
- allow agent to validate UI flows in the same tab the user sees.

Tradeoff: Chrome will show a debugging warning/infobar and the extension needs a highly privileged `debugger` permission. This is acceptable if presented as an explicit "Attach agent to this tab" action, not a silent default.

## Reference: OpenClaw Browser Relay

OpenClaw Browser Relay is a strong reference implementation for this exact class of feature:

- Manifest V3 permissions include `debugger`, `tabs`, `activeTab`, `storage`, `alarms`.
- On toolbar click, it attaches `chrome.debugger` to the active tab.
- It connects to a local WebSocket relay, default port `18792`.
- It forwards CDP events with messages like `{ method: "forwardCDPEvent", params: ... }`.
- It receives CDP commands with `{ id, method: "forwardCDPCommand", params: { method, params, sessionId? } }` and calls `chrome.debugger.sendCommand`.
- The resilient fork adds reconnect, MV3 service worker keepalive, tab lifecycle cleanup, and state persistence.

This is conceptually reusable, but pi-web should define its own smaller protocol rather than importing OpenClaw Gateway wholesale.

## Recommended Architecture

```text
Normal user Chrome tab
  │ user clicks "Attach agent"
  ▼
Chrome MV3 extension with debugger permission
  ├─ chrome.debugger.attach({tabId}, "1.3")
  ├─ forwards CDP events
  └─ executes CDP commands
      │ WebSocket / Native message / localhost HTTP+WS
      ▼
pi-web local browser-control bridge
  ├─ tracks attached tabs
  ├─ exposes safe browser actions to pi agent/tool layer
  ├─ normalizes snapshots/screenshots
  └─ gates control with user consent/session binding
      ▼
pi agent chat session
  ├─ can request observe/snapshot/screenshot
  ├─ can click/type/navigate/scroll
  └─ reports validation results
```

## MVP Boundaries

### Extension

- Toolbar button: attach/detach current active tab.
- Badge state: off / connecting / attached / error.
- Options: pi-web bridge URL, token.
- Permissions: `debugger`, `tabs`, `activeTab`, `storage`, maybe `alarms` for keepalive.
- Connect to local pi-web bridge via WebSocket.
- Forward only attached tab events/commands.

### pi-web bridge/server

New local-only API/WS surface, for example:

- `GET /api/browser-control/status`
- `GET /api/browser-control/tabs`
- `POST /api/browser-control/attach-request` optional if web initiates attach guidance
- `WS /api/browser-control/extension` for extension connection
- internal tool API for agent actions

Because Next.js route handlers are not always ideal for long-lived WS depending deployment mode, this may require a small sidecar WebSocket server inside the pi-web runtime or a Node server hook if the project supports it.

### Agent-visible tool surface

Start with a compact tool set rather than raw CDP exposure:

```ts
type BrowserToolAction =
  | { action: "status" }
  | { action: "tabs" }
  | { action: "observe"; tabId?: string }
  | { action: "screenshot"; tabId?: string; fullPage?: boolean }
  | { action: "click"; tabId?: string; selector?: string; ref?: string; x?: number; y?: number }
  | { action: "type"; tabId?: string; selector?: string; text: string }
  | { action: "navigate"; tabId?: string; url: string }
  | { action: "evaluate"; tabId?: string; expression: string };
```

Avoid exposing arbitrary CDP to the model by default. Keep raw CDP as a developer/debug-only escape hatch.

## Observe/Snapshot Strategy

For agent validation, raw `document.body.innerText` is not enough. The bridge should provide an observation format with stable element references.

Possible MVP observation:

- page title/url;
- accessibility tree subset;
- visible interactive elements with generated refs;
- selected text;
- viewport size and scroll position;
- optional screenshot.

Example:

```json
{
  "tabId": "t1",
  "url": "https://example.com/login",
  "title": "Login",
  "elements": [
    { "ref": "e1", "role": "textbox", "name": "Email", "selector": "...", "box": { "x": 10, "y": 80, "width": 240, "height": 32 } },
    { "ref": "e2", "role": "button", "name": "Sign in", "selector": "...", "box": { "x": 10, "y": 130, "width": 120, "height": 36 } }
  ]
}
```

OpenClaw's browser docs emphasize stable refs/tab ids and snapshot-before-action loops; pi-web should adopt that pattern.

## User Experience

- User clicks extension on a tab: "Attach agent to this tab".
- Chrome shows debugging warning; extension badge shows ON.
- pi-web detects attached tab and shows a browser-control pill/panel in chat.
- User can tell agent: "在这个页面验证登录流程".
- Agent uses browser observe/action tools.
- User can detach at any time from extension or pi-web.

## Security Guardrails

- Require explicit user click to attach a tab.
- Bind control to the current pi-web origin and a local pairing token.
- Show attached tab state visibly in pi-web and extension badge.
- Default to one attached tab at a time for MVP.
- Restrict bridge to `127.0.0.1` / same local origin.
- Validate allowed commands; do not let arbitrary web pages send browser commands.
- Add per-action approval option for destructive actions or cross-origin navigation.
- Redact secrets in observations where possible, but assume page content may be sensitive.
- Detach on session end, browser tab close, or explicit stop.

## Implementation Phases

1. Prototype extension attach + WS bridge + raw observe/screenshot.
2. Add pi-web UI attached-tab indicator and manual "insert observation into chat".
3. Add agent tool surface for observe/screenshot/click/type/navigate.
4. Add stable refs and accessibility/DOM snapshot normalization.
5. Add lifecycle hardening from OpenClaw Relay patterns: reconnect, service worker persistence, alarms, tab replacement cleanup.

## Decision

Given the user's updated goal of agent-driven web validation, the recommended main path is now:

Chrome extension with `debugger` permission + local pi-web browser-control bridge + constrained browser tool surface.

Low-permission share-only extension remains a simpler fallback, not the primary direction.
