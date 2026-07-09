# review

## Check Complete

### Findings Fixed

- None.

### Remaining Findings

1. **Blocker — missing-path space rows cannot open the required context menu**  
   `components/ProjectSpaceSwitchDialog.tsx` renders each space row as `<button disabled={!!isMissing}>...` while also attaching `onContextMenu`. Disabled buttons do not provide the required right-click interaction, so missing spaces cannot expose the safe metadata/star/archive actions required by PRD R10 / `checks.md`.

2. **Blocker — WorkTree row context menu lost the archive-WorkTree safety flow**  
   In `components/SessionSidebar.tsx`, the unified `projectSpaceContextMenu` for space rows only offers `归档当前空间` via `patchSpaceMetadata(..., { archived: true })` plus `删除 WorkTree…`. It does **not** expose `归档 WorkTree…` / `openWorktreeAction("archive", ...)` for WorkTree rows. That means the dialog row no longer preserves the existing WorkTree archive confirmation / dirty-summary / cleanup flow required by brief, PRD R9, and `checks.md`.

### Verification

- `npm run lint` — PASS
- `node_modules/.bin/tsc --noEmit` — PASS
- Static code review against `brief.md`, `prd.md`, `design.md`, `implement.md`, `checks.md`, `handoff.md` — 2 blockers found

### Verdict

- **changes_required** — automated validation passes, but two requirement-level regressions remain in the dialog space-row interaction path.
