# Task Plan — Chrome Debugger Extension Browser Control

## Understanding Check

Yes: the intended architecture has two cooperating parts.

1. **pi-web browser-control bridge**
   - A local bridge inside/alongside pi-web.
   - Maintains extension connection state.
   - Tracks attached Chrome tabs.
   - Exposes constrained browser actions to chat/agent code.
   - Normalizes observations, screenshots, and action results.

2. **Google Chrome extension**
   - Installed in the user's normal Chrome.
   - User clicks it to attach the current tab via `chrome.debugger`.
   - Connects back to pi-web over a local authenticated channel.
   - Relays browser events/actions between Chrome DevTools Protocol and pi-web.

The agent should not directly talk to arbitrary CDP. It should use a safe browser tool surface provided by pi-web.

## Target Architecture

```text
User's normal Chrome tab
  │
  │ user clicks extension: Attach agent to this tab
  ▼
Chrome MV3 extension
  ├─ chrome.debugger.attach({ tabId }, "1.3")
  ├─ chrome.debugger.sendCommand(...)
  ├─ receives CDP events
  └─ local authenticated WebSocket
      │
      ▼
pi-web browser-control bridge
  ├─ extension connection/session registry
  ├─ attached tab registry
  ├─ CDP command/event relay
  ├─ observe/screenshot/action normalization
  ├─ approval/safety checks
  └─ browser tool interface for pi sessions
      │
      ▼
pi agent chat session
  ├─ browser.status / tabs
  ├─ browser.observe
  ├─ browser.screenshot
  ├─ browser.click / type / navigate / evaluate
  └─ validation report back to user
```

## Child Tasks

### 1. `06-29-piweb-browser-control-bridge`

Build the local bridge and server-side connection/state layer.

Deliverables:

- Local extension connection endpoint.
- Pairing/auth token model.
- Attached-tab registry.
- Command request/response routing.
- Event routing from extension to pi-web.
- Cleanup on disconnect/tab detach.

Open design point:

- Next.js route handlers may not be ideal for long-lived WebSockets. Decide whether to implement through a sidecar Node WebSocket server, custom Next server hook, or existing pi runtime extension point.

### 2. `06-29-chrome-debugger-relay-extension`

Build the Chrome MV3 extension.

Deliverables:

- `manifest.json` with `debugger`, `tabs`, `activeTab`, `storage`, optional `alarms`.
- Toolbar attach/detach behavior.
- Options page for pi-web URL/token.
- WebSocket client to bridge.
- CDP command execution via `chrome.debugger.sendCommand`.
- CDP event forwarding.
- Badge/status UX.
- Lifecycle resilience: reconnect, service worker restart recovery, tab close/replacement cleanup.

Reference:

- OpenClaw Browser Relay is the primary implementation reference for debugger attach, command/event relay, and MV3 hardening.

### 3. `06-29-browser-control-protocol-tools`

Define the protocol and agent-facing browser tools.

Deliverables:

- Extension ↔ bridge message schema.
- Bridge internal command schema.
- Agent-visible tool actions:
  - `status`
  - `tabs`
  - `observe`
  - `screenshot`
  - `click`
  - `type`
  - `navigate`
  - `evaluate`
- Stable tab IDs and element refs.
- Observation format based on accessibility/DOM snapshot plus bounding boxes.
- Result/error model.

Rule:

- Do not expose raw CDP to the model by default. Raw CDP can be a developer-only diagnostic escape hatch.

### 4. `06-29-browser-attached-ui-safety`

Add user-facing UI and safety controls.

Deliverables:

- pi-web attached-browser indicator.
- Attached tab title/URL display.
- Detach button.
- Optional browser panel showing latest observation/screenshot.
- User consent states.
- Warnings for debugger permission and sensitive page data.
- Per-action confirmation policy for risky actions if needed.

## Recommended Build Order

1. **Protocol spike**
   - Prove extension can attach to tab and exchange one `Runtime.evaluate` command with a local bridge.
   - No agent integration yet.

2. **Bridge MVP**
   - Add bridge state and request/response plumbing.
   - Support one attached tab.
   - Support `status`, `tabs`, `observe`, `screenshot`.

3. **UI MVP**
   - Show attached tab in pi-web.
   - Let user manually request observation and insert/share it into chat.

4. **Agent tool MVP**
   - Let agent call browser actions for the attached tab.
   - Start with `observe`, `screenshot`, `click`, `type`, `navigate`.

5. **Stability and safety**
   - Reconnect handling.
   - MV3 service worker persistence.
   - Detach cleanup.
   - Approval gates.
   - Documentation.

## MVP Acceptance Criteria

- User can install/load unpacked Chrome extension.
- User can attach the current normal Chrome tab without launching Chrome with special flags.
- pi-web shows the attached tab.
- Agent or pi-web can observe the page title/URL and visible/interactable elements.
- Agent or pi-web can capture a screenshot.
- Agent can perform at least one simple validation flow: observe → click/type → observe/screenshot → report.
- User can detach and control stops immediately.
- No arbitrary web page can send browser-control commands to the bridge.

## Risks

- Chrome `debugger` permission is powerful and visible to users.
- Long-lived WebSocket support may require non-trivial server/runtime changes in pi-web.
- Stable element refs are hard; selectors can go stale after DOM changes.
- Agent actions can be destructive; approval policy is important.
- Sensitive pages may leak data into chat context.

## Non-goals for MVP

- Multi-browser support.
- Chrome Web Store publishing.
- Multi-user remote browser control.
- Fully general Playwright replacement.
- Raw unbounded CDP command access from the model.
