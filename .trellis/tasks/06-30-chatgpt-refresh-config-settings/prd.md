# ChatGPT refresh config and settings UI

## Goal

Extend ChatGPT web config and Settings UI to support backend auto-refresh configuration.

## Requirements

- Extend `PiWebChatGptConfig` in `lib/pi-web-config.ts`.
- Add persisted fields for auto-refresh enabled, cycle interval, cycle salt min/max seconds, account interval, and account salt min/max seconds.
- Normalize old `pi-web.json` files safely with defaults.
- Validate saved values, including minimum intervals, non-negative salt ranges, and max >= min.
- Update `components/SettingsConfig.tsx` ChatGPT section to edit these fields.
- Keep `usagePanelEnabled` behavior unchanged.
- Update relevant docs for `pi-web.json` ChatGPT settings.

## Acceptance Criteria

- [ ] Old configs still load and save without losing unrelated settings.
- [ ] Settings > ChatGPT can edit and save all auto-refresh fields.
- [ ] Invalid interval/salt inputs are rejected or clamped consistently.
- [ ] Defaults keep auto-refresh disabled.
- [ ] Lint and TypeScript pass.
