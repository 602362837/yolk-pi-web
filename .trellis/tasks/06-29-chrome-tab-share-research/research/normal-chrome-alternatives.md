# Normal Chrome Alternatives Without Launch Flags

## Problem

CDP debug-port integration is powerful, but it requires Chrome to be launched with `--remote-debugging-port` and often a separate `--user-data-dir`. That does not match normal user behavior for sharing an already-open daily Chrome tab.

## Best-Fit Alternative: Chrome Extension

A Chrome extension is the practical route for normal Chrome usage. It can access the active tab after a user gesture without requiring Chrome restart or launch flags.

### MVP: content-script share, no debugger

Permissions:

- `activeTab`
- `scripting`
- `tabs`
- optional `storage`

Capabilities:

- URL/title/favIcon through `tabs`.
- Selected text and page text through injected script.
- Readability-style article extraction if bundled.
- Visible screenshot through `chrome.tabs.captureVisibleTab`.
- Send payload to pi-web through a content script running in the pi-web tab, or call a dedicated local pi-web API.

Advantages:

- Works with the user's normal existing Chrome tabs.
- No Chrome restart.
- No scary `debugger` permission.
- Good enough for "share current tab context to chat".

Limitations:

- Not full browser automation.
- Page extraction can be limited by CSP/protected pages/browser pages.
- Cross-origin iframes are partial unless additional permissions are granted.
- Cannot access full CDP-level DOM/network/runtime state.

### Advanced: extension with `debugger` permission

This mirrors the OpenClaw Browser Relay direction.

Permissions:

- `debugger`
- `tabs`
- `activeTab`
- `storage`

Capabilities:

- Attach to the active normal Chrome tab at click time.
- Use Chrome DevTools Protocol without a debug port launch flag.
- Read DOM/runtime state, capture screenshots, and potentially automate the page.

Advantages:

- Works on the user's normal already-open tab.
- Much closer to CDP/debug-port capability.
- Can become a browser-control bridge later.

Limitations:

- Chrome shows a debugging warning/infobar while attached.
- `debugger` is a high-risk permission and harder to explain/trust.
- Must manage attach/detach lifecycle carefully.
- Overkill for simple context sharing.

## Other Possible Routes

### Bookmarklet

A bookmarklet can collect `location`, `document.title`, selected text, and body text from the current page and open/post to pi-web.

Pros: no extension install.
Cons: poor UX, blocked by CSP on many pages, no screenshot, not robust.

### Native helper app

A native app can use OS automation/accessibility APIs or Chrome profile files to infer current tabs.

Pros: possible for desktop companion products.
Cons: high install/friction, platform-specific, fragile, usually worse than a Chrome extension.

### Chrome side panel extension

A Chrome extension can expose a side panel UI that talks to pi-web/local APIs and shares the active tab.

Pros: good UX; user can preview/edit context beside page.
Cons: still an extension; needs same content-script/direct API design.

## Recommended Product Direction

For normal users, implement the Chrome extension path first:

1. Start with low-permission content-script share:
   - current tab URL/title,
   - selected text,
   - page text excerpt,
   - optional visible screenshot,
   - stage into pi-web chat input.
2. Add a dedicated pi-web bridge/API and pairing token.
3. Only add `debugger` permission as an optional advanced mode if users need automation or more reliable deep capture.

OpenClaw Browser Relay remains useful as reference for advanced debugger/CDP attach mode, not as the baseline MVP.
