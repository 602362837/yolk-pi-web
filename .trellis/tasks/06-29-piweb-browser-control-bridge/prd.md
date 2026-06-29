# Pi web browser control bridge

## Goal

Build the pi-web local bridge that accepts a Chrome debugger extension connection, tracks attached tabs, and routes constrained browser-control requests/results between pi-web/agent sessions and the extension.

## Requirements

- Provide a local-only authenticated extension connection channel.
- Track connected extensions and attached tabs.
- Route request/response commands to the correct tab.
- Receive browser/CDP events from the extension.
- Clean up state on disconnect, detach, tab close, or server shutdown.
- Avoid exposing broad unauthenticated browser-control APIs.

## Acceptance Criteria

- [ ] pi-web can detect when the extension is connected.
- [ ] pi-web can list one attached tab with title/URL/status.
- [ ] pi-web can send a simple command and receive a response.
- [ ] stale connection/tab state is cleaned up.
- [ ] bridge is protected by local-only binding and a pairing/token check.
