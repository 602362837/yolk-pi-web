# Implementation Plan — If Approved

## Phase 1: pi-web bridge MVP

1. Add shared TypeScript types for `BrowserSharePayload` under `lib/`.
2. Add a client-side bridge listener in `ChatWindow` or `AppShell` that:
   - validates payload source/version/size,
   - formats tab context as markdown,
   - calls `chatInputRef.current?.insertText(...)`,
   - converts `screenshot.dataUrl` to a `File` and calls `addImages`.
3. Add user-visible feedback/toast or lightweight banner when a tab is shared.
4. Document the bridge and security assumptions in `docs/modules/frontend.md` and possibly `docs/integrations/`.

## Phase 2: Chrome extension MVP

1. Create extension package, likely `extensions/chrome-tab-share/` or separate publishable folder.
2. Use Manifest V3 with minimal permissions: `activeTab`, `scripting`, `tabs`, `storage`.
3. Implement toolbar action:
   - inspect active tab URL/title,
   - extract selection and body text excerpt,
   - optionally capture visible screenshot,
   - find/open pi-web tab,
   - deliver payload to pi-web content script.
4. Add options page for pi-web origin and bridge token.
5. Add manual install/dev docs.

## Phase 3: Hardening and optional direct send

1. Add pairing/token flow and stricter origin/extension checks.
2. Add text/HTML artifact upload support if excerpts are too small.
3. Consider a dedicated `POST /api/browser-share` only after auth/session-selection requirements are settled.
4. Consider OpenClaw/CDP-style browser control only as a separate feature.

## Validation

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- Manual Chrome test:
  - share URL/title only,
  - share selected text,
  - share long page excerpt clipped by limit,
  - share screenshot,
  - pi-web not open -> extension opens/focuses configured URL,
  - archived/current chat disabled -> bridge reports failure instead of sending.

## Rollback Points

- The pi-web bridge can be hidden behind a setting or disabled by removing the event listener.
- Extension is independent and can be unpublished/removed without affecting core chat APIs.
