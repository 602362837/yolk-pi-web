# Implementation Plan

## Order

1. Config and Settings UI (`06-30-chatgpt-refresh-config-settings`)
   - Extend `PiWebChatGptConfig` defaults, normalization, and validation in `lib/pi-web-config.ts`.
   - Update `components/SettingsConfig.tsx` ChatGPT section with auto-refresh controls.
   - Update docs for ChatGPT settings behavior.

2. Backend scheduler and lock (`06-30-chatgpt-refresh-scheduler-lock`)
   - Add scheduler module with `globalThis` process singleton.
   - Add lock-file acquire/heartbeat/stale/repair helpers.
   - Refresh all saved accounts sequentially using existing quota/account helpers.
   - Add status/ensure/repair API routes.
   - Hook scheduler ensure into config save/read or a common server path so enabled config starts it.

3. Panel UX (`06-30-chatgpt-panel-accounts-maintenance`)
   - Expand `ChatGptUsagePanel` account state from active-only to all accounts.
   - Reload accounts when the panel is opened so Models-side account activation is reflected on expand.
   - Add account activation buttons in the panel.
   - Show scheduler status and risk-gated lock repair action.
   - Ensure no browser auto-refresh loop is introduced.

4. Documentation and validation
   - Update `docs/modules/frontend.md`, `docs/modules/api.md`, and relevant architecture/deployment notes if routes or scheduler behavior are added.
   - Run `npm run lint`.
   - Run `node_modules/.bin/tsc --noEmit`.

## Risk Points

- Lock repair must not silently delete a healthy current-process lock.
- Auto-refresh must avoid parallel per-account refreshes in one cycle.
- Config validation must preserve old `pi-web.json` files.
- UI should keep manual refresh behavior available and understandable.

## Current Product Decisions

- Refresh all saved ChatGPT/Codex accounts.
- Backend scheduler, not browser timers.
- Use file lock to reduce duplicate scheduler processes.
- Stale lock threshold is dynamic: based on configured cycle interval, e.g. `2 * refreshCycleIntervalSeconds`, without fixed minimum fallback.
- Models-side account switching only needs to be reflected when the ChatGPT panel is expanded; no cross-tab synchronization required.
