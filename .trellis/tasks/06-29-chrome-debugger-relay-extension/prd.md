# Chrome debugger relay extension

## Goal

Build a Chrome MV3 extension that attaches to the user's normal active tab via `chrome.debugger` and relays constrained CDP commands/events to the pi-web browser-control bridge.

## Requirements

- Use Manifest V3.
- Request `debugger`, `tabs`, `activeTab`, `storage`, and optional `alarms` permissions.
- Attach/detach the active tab from the toolbar button.
- Connect to pi-web local bridge using configured URL/token.
- Forward CDP events to pi-web.
- Execute command requests through `chrome.debugger.sendCommand`.
- Show clear badge/status state.
- Recover from bridge disconnects and MV3 service-worker restarts where practical.

## Acceptance Criteria

- [ ] User can load the extension unpacked in Chrome.
- [ ] Clicking the toolbar button attaches/detaches the active tab.
- [ ] Extension connects to pi-web bridge with token.
- [ ] Extension can execute `Runtime.evaluate` and return result.
- [ ] Extension forwards tab detach/close events or cleans up state.
