# CDP Debug Port Feasibility

## Short Answer

Using Chrome's remote debugging port is feasible and technically cleaner than a browser extension for a local developer tool, provided the user is willing to start Chrome with remote debugging enabled. It can enumerate tabs, read page text/DOM/selection, capture screenshots, and share the selected tab into pi-web chat without a Chrome extension.

The main caveat is operational: normal daily Chrome does not expose a CDP port by default, and modern Chrome versions increasingly discourage remote debugging on the default user profile. In practice, users may need to launch Chrome with `--remote-debugging-port=<port>` and often a separate `--user-data-dir`. That may not include their existing logged-in tabs unless they intentionally run their browser that way.

## Basic Mechanism

Start Chrome with a CDP HTTP/WebSocket endpoint:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.pi/chrome-debug-profile"
```

Then pi-web server can query:

- `GET http://127.0.0.1:9222/json/version` — confirms endpoint and returns browser websocket URL.
- `GET http://127.0.0.1:9222/json/list` — lists pages/tabs with `id`, `title`, `url`, `type`, `webSocketDebuggerUrl`.

For a selected tab, connect to `webSocketDebuggerUrl` and send Chrome DevTools Protocol commands:

- `Runtime.evaluate` for `location.href`, `document.title`, `getSelection().toString()`, `document.body.innerText`.
- `DOMSnapshot.captureSnapshot` or accessibility/ARIA snapshot for richer structure.
- `Page.captureScreenshot` for viewport/full page screenshots.
- `Page.printToPDF` for PDF capture if useful.

## Fit for pi-agent-web

A CDP-port design can be implemented mostly server-side:

```text
Chrome with --remote-debugging-port
  │
  ├─ HTTP /json/list
  └─ WebSocket CDP per tab
      │
Next.js API routes in pi-web
  ├─ GET  /api/browser-cdp/status
  ├─ GET  /api/browser-cdp/tabs
  └─ POST /api/browser-cdp/capture
      │
React UI
  ├─ tab picker / "Share Chrome tab" button
  └─ ChatInputHandle.insertText/addImages/addFiles
```

This avoids needing the extension to discover the current pi-web session. pi-web already knows the active chat, so the user can choose a Chrome tab from inside pi-web and insert/share it.

## What Works Well

- Enumerating tabs by title/URL.
- Reading DOM text from authenticated pages, because CDP runs inside the actual browser context.
- Capturing screenshots.
- Avoiding Chrome extension packaging and permissions.
- Keeping all pi-web integration inside the existing Next.js app.
- Future browser automation: once CDP is connected, click/type/navigation are possible.

## Limitations

- Chrome must be launched with remote debugging enabled before tabs are available.
- If using a separate user data dir, it will not share the user's normal logged-in profile unless they log in there too.
- If using the default daily profile, recent Chrome security changes may block/limit remote debugging with the default data dir; this should be validated on target Chrome versions.
- CDP is powerful: anyone who can access the port can fully control/read the browser. Bind only to `127.0.0.1` and never expose it on LAN.
- Some pages may have huge DOM/text; extraction needs size limits.
- Cross-origin iframes require per-frame handling for complete capture.
- Browser internal pages (`chrome://`, extension pages) and some protected contexts may be inaccessible.

## Comparison With Extension Approach

CDP debug port is better if the user accepts starting Chrome in debug mode and wants a local developer workflow. It also opens the door to browser automation.

Extension is better if the user wants to use their existing normal Chrome tab without restarting Chrome or running a debug-profile browser.

A pragmatic product path is:

1. Implement CDP debug-port integration first as a developer feature.
2. Later add an extension/debugger fallback for sharing the exact active tab from the user's normal Chrome profile.

## Recommended MVP for CDP Route

- Settings: `browserCdp.enabled`, `browserCdp.url` default `http://127.0.0.1:9222`.
- API routes:
  - `GET /api/browser-cdp/status`
  - `GET /api/browser-cdp/tabs`
  - `POST /api/browser-cdp/capture` with `{ tabId, includeText, includeScreenshot }`.
- UI: a "Share Chrome Tab" action that lists CDP tabs, previews URL/title/text length, then inserts context into the current chat input.
- Capture output:
  - formatted markdown context block for title/URL/selection/body excerpt,
  - optional screenshot as image attachment,
  - optional full page text as uploaded `.md`/`.txt` artifact if too long.
- Security:
  - allow only loopback CDP URLs by default,
  - redact CDP URLs in logs,
  - cap text/screenshot sizes,
  - treat page content as untrusted prompt context.
