# ChatGPT panel account switch and maintenance

## Goal

Enhance the top-bar ChatGPT usage panel with multi-account visibility, quick account switching, scheduler status, and risk-gated lock repair.

## Requirements

- Expanded panel shows all saved ChatGPT/Codex accounts, not only the active one.
- Each account row shows active status, display name, masked id, cached quota summary, and refresh status where available.
- Non-active accounts can be activated from the panel using existing activation API.
- After activation, panel reloads account list and reflects the new active account.
- If the active account changes outside the panel, especially from Models, the panel reloads account data when expanded and stops showing stale account information.
- Manual refresh remains available.
- Show backend scheduler/auto-refresh status when configured.
- Add a fault-handling action that calls the lock repair API only after clear risk confirmation.
- Avoid replacing full Models account management; advanced import/edit/delete stays in Models.

## Acceptance Criteria

- [ ] Expanded panel lists all saved accounts with clear active marker.
- [ ] Switching accounts works from the panel and reloads active quota display.
- [ ] Switching accounts from Models is reflected when the ChatGPT panel is expanded, without a full page reload.
- [ ] Scheduler state is visible enough to diagnose stuck refresh/lock conditions.
- [ ] Lock repair action displays a warning that deleting a live lock may cause duplicate refreshers.
- [ ] No auto-refresh loop runs in browser tabs.
- [ ] Lint and TypeScript pass.
