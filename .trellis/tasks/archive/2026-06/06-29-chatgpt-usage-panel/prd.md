# ChatGPT usage panel

## Goal

Add an optional ChatGPT/Codex subscription usage panel to pi-web settings and the main top bar so users can see the currently active ChatGPT account's quota at a glance without opening the Models modal.

## User Value

- Users who rely on ChatGPT Plus/Pro Codex OAuth can keep quota visibility while chatting.
- The panel should be unobtrusive: hidden unless enabled, semi-transparent when shown, and expandable on click for more detail.

## Confirmed Facts from Codebase

- Web UI settings are stored in `~/.pi/agent/pi-web.json` via `lib/pi-web-config.ts`; current top-level sections are `worktree`, `usage`, and `trellis`.
- `components/SettingsConfig.tsx` already has a Usage settings section and saves the full `PiWebConfig` through `PUT /api/web-config`.
- Current ChatGPT/Codex quota data exists through `GET /api/auth/quota/openai-codex`, implemented by `lib/subscription-quota.ts` using `https://chatgpt.com/backend-api/wham/usage`.
- `GET /api/auth/quota/openai-codex?accountId=...` can query a saved account; without `accountId`, it queries the active OAuth credential and updates cached quota metadata when possible.
- `components/ModelsConfig.tsx` already defines quota concepts and UI helpers: `SubscriptionQuota`, `QuotaTier`, known tiers (`five_hour`, `seven_day`), usage colors, refresh timestamp formatting, reset countdowns, full quota bars, and mini conic-gradient pie charts for saved accounts.
- `components/AppShell.tsx` owns top-bar state and renders existing dropdown panels (`branches`, `system`, `subagents`, `git`) plus session/context usage stats.
- Top-level module docs that must be updated if routes/components/config shape change: `docs/modules/frontend.md`, `docs/modules/api.md` if an API route is added/changed, and `docs/modules/library.md` for shared config/types/helper changes.

## Requirements

- Add a persisted ChatGPT settings section that controls whether the ChatGPT usage floating/top-bar panel is enabled.
- When disabled by default, no ChatGPT usage floating panel is rendered and no quota polling/query should happen from that panel.
- When enabled, show a semi-transparent usage entry in the top area for the currently active `openai-codex` account only.
- The collapsed usage entry shows only refresh time plus pie-style quota visualization; it must not show account remarks/notes in collapsed state. When there is no cached quota, show the refresh time as unknown and a neutral/unknown pie placeholder.
- Clicking the compact usage entry opens a semi-transparent dropdown/window with account/quota details.
- The expanded dropdown must display account remarks/notes when available, active-account identity, refresh time, quota reset details, and pie-style quota visualization.
- The panel must support manual refresh and show loading/error/expired/no credential states.
- Use the existing quota API and shared/centralized helpers where practical; avoid duplicating quota parsing logic in multiple components.
- Respect existing theme variables and mobile/top-bar layout constraints.

## Acceptance Criteria

- [ ] Settings modal exposes a new ChatGPT section with a usage panel enable/disable toggle and persists it in `pi-web.json`.
- [ ] Default config keeps the new panel disabled.
- [ ] Enabling the setting updates the main UI without app restart.
- [ ] Top bar/floating usage entry appears only when enabled.
- [ ] The compact entry shows refresh time and pie chart(s) only, with concise fallback status for loading/no credential/error; missing cache is shown as unknown until the user refreshes.
- [ ] Clicking the entry opens a semi-transparent small panel.
- [ ] The opened panel shows active account identity, remarks/notes when available, last refresh time, quota reset information, and pie chart(s) for returned quota tiers.
- [ ] Manual refresh re-queries `GET /api/auth/quota/openai-codex`, updates the active account quota cache, and the refreshed state is consistent with Models config.
- [ ] Existing Models modal quota behavior still works.
- [ ] Docs are updated for new config/component behavior.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Likely Out of Scope

- Showing all saved ChatGPT accounts at once.
- Account switching inside the floating panel; that remains in Models config.
- New backend quota provider support beyond `openai-codex`.
- Historical token/cost session usage; existing Usage modal already covers that.

## Decisions

- No background auto-refresh and no automatic first-load query. The panel shows the same cached quota state as Models config when available, and users explicitly refresh with a button in the floating window.
- Collapsed state should show only refresh time and quota pie chart(s). Account remarks/details are shown only after clicking to expand.
- Anchor the semi-transparent entry on the right side of the top bar, near the existing session/context usage stats, while avoiding overlap with the Trellis/right-drawer controls.
- Add a new ChatGPT section in Settings rather than placing the toggle inside the existing Usage section.
- When no cached quota exists, display an unknown refresh time/status and let the user manually refresh to populate it.

## Open Questions

None.
