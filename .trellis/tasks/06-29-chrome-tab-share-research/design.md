# Design Sketch — Chrome Tab Share to Chat

## Recommended Architecture

Use a native Chrome extension plus a pi-web in-page bridge. Keep the first version as a user-confirmed "stage context in chat input" flow rather than auto-send.

```text
Target browser tab
  └─ extension action/user gesture
      ├─ tabs/query URL + title
      ├─ scripting.executeScript extracts selection/body text
      ├─ optional captureVisibleTab screenshot
      └─ chrome.runtime message

pi-web tab content script
  └─ window.postMessage / CustomEvent with validated payload

pi-web React bridge
  └─ ChatWindow/AppShell listener
      ├─ ChatInputHandle.insertText(...)
      ├─ ChatInputHandle.addImages([...])
      └─ future: explicit send after user opt-in
```

## Boundaries

- Chrome extension owns browser APIs and page extraction.
- pi-web content script is a thin bridge from extension runtime messages to the page.
- pi-web React owns active chat/session selection and uses existing input/attachment paths.
- Server API changes are optional for MVP; direct prompt API exposure is deferred.

## Data Contract

```ts
interface BrowserSharePayload {
  source: "pi-web-chrome-extension";
  version: 1;
  mode: "stage" | "send";
  tab: {
    url: string;
    title?: string;
    favIconUrl?: string;
  };
  selection?: string;
  textExcerpt?: string;
  htmlExcerpt?: string;
  screenshot?: {
    mimeType: "image/png" | "image/jpeg";
    dataUrl: string;
  };
  capturedAt: string;
}
```

MVP should support `mode: "stage"` only. `mode: "send"` requires an explicit product/security decision.

## Security Model

- Extension should require a user gesture to capture a tab.
- pi-web should accept bridge messages only from its own page context/content script and validate payload shape/size.
- Prefer pairing token or configured extension id before accepting messages.
- Do not expose existing `/api/agent/[id]` directly to the extension without a narrowed route and authentication.
- Treat shared page text as untrusted content/prompt-injection risk.

## OpenClaw Reuse Decision

OpenClaw Browser Relay is useful reference code for robust MV3 lifecycle, reconnect, and local bridge patterns. It is not the best base for MVP because it is a CDP remote-control relay requiring `debugger` permission and an OpenClaw Gateway protocol. Direct reuse should be reserved for a future browser-automation/control feature.

## Compatibility Notes

- MVP works with current `ChatInputHandle` for text and images.
- File artifacts can reuse `addFiles` by constructing `File` objects in the page from extension payloads.
- Direct API mode would need active-session discovery or a new `/api/browser-share` route.
