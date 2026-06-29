# Research Chrome tab sharing to chat

## Goal

Research whether this pi-agent-web project can support a Google Chrome extension that shares the user's current browser tab context into the active chat, and compare a native pi-web integration against reusing OpenClaw's browser-extension/browser-control work.

## User Value

Developers often ask the agent questions whose context lives in an existing browser tab: docs, issue pages, internal dashboards, logs, PR reviews, web apps, or selected page text. A Chrome extension could reduce copy/paste friction by sending the active tab's URL, title, selected text, DOM/text extract, screenshot, or page file directly to the current pi-web chat.

## Confirmed Facts

- pi-agent-web sends new-session prompts through `POST /api/agent/new` and existing-session prompts through `POST /api/agent/[id]`.
- `ChatInput` already has an imperative handle for inserting text and attaching image/non-image files: `insertText`, `insertIfEmpty`, `addImages`, `addFiles`, and `addFileReference`.
- Images are currently converted in-browser to base64 and sent as `images` on the pi command; non-image files are uploaded through `POST /api/files/upload` and appended to prompt text as absolute paths.
- The active chat/session is React state inside the web UI; there is no external API that tells a Chrome extension which chat tab/session is currently active.
- OpenClaw has a browser-control subsystem and CLI (`openclaw browser`) with managed and existing-session profiles.
- A public OpenClaw Browser Relay extension exists as a Manifest V3 extension that attaches Chrome debugger sessions to an existing tab and relays Chrome DevTools Protocol messages to a local OpenClaw gateway WebSocket.
- The OpenClaw repository depends on `@earendil-works/pi-tui`, but the inspected package metadata did not show `@earendil-works/pi-coding-agent`; OpenClaw is not a drop-in pi-agent-web runtime integration based on current evidence.

## Requirements

- Identify feasible Chrome-only integration patterns for sharing current-tab context into pi-web chat.
- Evaluate the reusable value of OpenClaw Browser Relay and OpenClaw browser-control runtime.
- Recommend an MVP path that fits the current pi-agent-web architecture.
- Call out security and permission risks, especially local API exposure and debugger permission scope.
- Produce enough design detail to decide whether to implement a browser extension next.

## Acceptance Criteria

- [x] Codebase integration points are identified with relevant files/routes.
- [x] OpenClaw/OpenClaw Browser Relay architecture is inspected enough to judge reuse potential.
- [x] At least three implementation options are compared.
- [x] A recommended MVP and follow-up path are documented.
- [x] Remaining product decisions are explicit.

## Out of Scope

- Implementing the Chrome extension in this research task.
- Supporting non-Chrome browsers.
- Building general browser automation/control unless chosen as a follow-up.
- Exposing pi-web publicly or adding multi-user auth in this task.
