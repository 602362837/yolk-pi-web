# Browser Share Architecture

Browser Share lets a user explicitly share the active Chrome tab with one selected ypi chat/session.

## Runtime model

- Chrome MV3 extension lives outside this package at `~/gitProjects/ypi-browser-share-extension`.
- ypi web exposes a localhost-only bridge under `app/api/browser-share/**`.
- The extension creates a short-lived one-time share code. The user enters that code in the target chat input to bind the page to that session.
- Agent tools are scoped to the current session id and never accept arbitrary `shareId` input.

## Safety boundaries

- Default permission mode is `readonly`.
- `type` and `navigate` commands require approval; readonly shares require approval for all action commands.
- Snapshots include URL/title, visible text, selection, and bounded interactive element summaries.
- Password, payment, token-like, and hidden field values are not collected by the extension and server snapshots are length-limited.
- Share codes expire before binding, are single-use, and are deleted when bound.

## API summary

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
