# ChatGPT panel auto refresh and account switch

## Goal

Enhance the top-bar ChatGPT/Codex usage panel so users can optionally refresh quota data in the background on a configurable schedule and quickly see/switch among multiple saved ChatGPT/Codex accounts directly from the panel.

## User Value

- Keep ChatGPT/Codex quota status current without repeatedly opening the panel and clicking refresh.
- Reduce friction when several saved ChatGPT/Codex accounts are used by exposing account status and activation in the compact panel.
- Stagger quota requests across accounts so automatic polling is less bursty and less mechanically regular.

## Confirmed Facts

- `components/ChatGptUsagePanel.tsx` currently renders the optional top-bar panel, loads `/api/auth/accounts/openai-codex`, selects the active account, shows cached quota tiers, and supports manual refresh via `/api/auth/quota/openai-codex` for the active account only.
- `components/SettingsConfig.tsx` has a ChatGPT settings section with only `chatgpt.usagePanelEnabled`; its current description explicitly says the panel does not auto-refresh.
- `lib/pi-web-config.ts` persists web UI settings in `~/.pi/agent/pi-web.json`; `PiWebChatGptConfig` currently contains only `usagePanelEnabled` and validation/normalization must be extended for new fields.
- Saved accounts already exist via `/api/auth/accounts/openai-codex`; account activation already exists via `POST /api/auth/accounts/openai-codex/activate` and reloads RPC auth state.
- Per-account quota querying already exists via `/api/auth/quota/openai-codex?accountId=...`; active-account quota querying omits the query parameter.
- Models config already has full multi-account management, but the top-bar panel currently shows only the active account.

## Requirements

- Add a background auto-refresh switch for the ChatGPT usage panel.
- Auto-refresh should run from the backend, not from each browser tab, to avoid duplicate refresh loops.
- Auto-refresh should refresh **all saved ChatGPT/Codex accounts**, not only the currently active account.
- Persist auto-refresh configuration in `pi-web.json` under the ChatGPT section.
- Support these interval settings:
  - Cycle interval: one numeric value for how often an automatic refresh cycle begins.
  - Per-account interval: one numeric value for how long to wait before refreshing the next account after an automatic refresh cycle has started.
  - Cycle random salt range in seconds: minimum and maximum extra delay; each cycle samples one random value from this range so cycles are less regular.
  - Per-account random salt range in seconds: minimum and maximum extra delay; each gap between account refreshes samples one random value from this range so per-account calls are less regular.
- Interval controls should support seconds/minutes where relevant; salt ranges are configured as min/max seconds.
- Keep manual refresh available.
- Show multiple saved ChatGPT/Codex accounts in the usage panel when expanded.
- Add scheduler maintenance/fault handling in the ChatGPT panel: a risk-gated action should clean up or repair the backend refresh lock when the user suspects the scheduler is stuck.
- Allow fast account activation/switching from the usage panel using existing account activation API.
- After switching accounts, update the panel state and quota display to the newly active account.
- If the active ChatGPT/Codex account is changed elsewhere, especially in Models, the ChatGPT panel must reload the active account when the panel is expanded instead of continuing to display stale active-account information.
- Avoid breaking existing default behavior: the usage panel remains disabled by default and auto-refresh remains off unless explicitly enabled.

## Acceptance Criteria

- [ ] Settings > ChatGPT includes an auto-refresh toggle and controls for cycle interval, per-account interval, cycle random salt min/max seconds, and per-account random salt min/max seconds.
- [ ] Auto-refresh settings save to and load from `pi-web.json`.
- [ ] With auto-refresh off, behavior matches today except for the enhanced account list/switching UI.
- [ ] With auto-refresh on, the backend schedules recurring refresh cycles for all saved ChatGPT/Codex accounts; multiple browser tabs do not create multiple refresh loops.
- [ ] During each cycle, accounts are refreshed one by one with the configured per-account delay plus a sampled random salt between account requests.
- [ ] Each cycle begins according to the configured cycle interval plus a sampled random salt.
- [ ] Intervals are validated/clamped to prevent unsafe rapid polling.
- [ ] Expanded panel shows all saved ChatGPT/Codex accounts with active status and cached quota summary.
- [ ] Users can activate a non-active account from the panel; the API response refreshes the account list and active-account quota display.
- [ ] When an account is activated from Models, expanding the ChatGPT panel reloads account data and shows the new active account without requiring a full page reload.
- [ ] Manual refresh and auto-refresh update the same cached quota data used by Models.
- [ ] Scheduler startup handles stale/invalid lock files safely.
- [ ] ChatGPT panel includes a fault-handling action with a clear risk warning before lock repair is attempted.
- [ ] Lint and TypeScript checks pass.

## Out of Scope

- Adding new OAuth login/import flows to the top-bar panel.
- Replacing the full Models account-management UI.
- Refreshing accounts that are not saved in the existing OpenAI Codex account store.
- Server-side cron/background jobs independent of the browser UI.

## Subtasks

- `06-30-chatgpt-refresh-config-settings` — Extend `pi-web.json` ChatGPT config, validation, settings UI, and docs.
- `06-30-chatgpt-refresh-scheduler-lock` — Implement backend scheduler, all-account refresh loop, file lock, stale lock handling, and scheduler APIs.
- `06-30-chatgpt-panel-accounts-maintenance` — Enhance panel multi-account display/switching and add risk-gated fault/lock maintenance UI.

## Open Questions

1. What safe minimum/default values should be used for the cycle interval, per-account interval, and salt ranges?
2. What exact stale-lock multiplier should be used? Current direction: dynamic stale threshold from the configured cycle interval, e.g. `2 * refreshCycleIntervalSeconds`, without a fixed minimum fallback.
