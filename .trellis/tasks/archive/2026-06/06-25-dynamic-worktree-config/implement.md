# Dynamic worktree configuration page — Implementation Plan

## Ordered Checklist

1. Refine `lib/pi-web-config.ts`
   - Keep existing defaults and `readPiWebConfig()` behavior for runtime consumers.
   - Add API-oriented read metadata (`path`, `exists`, optional parse error).
   - Add validation helpers for known worktree fields.
   - Add write helper that merges known `worktree` values into raw JSON and preserves unrelated top-level keys.

2. Add config API route
   - Create `app/api/web-config/route.ts` (or equivalent final route name).
   - `GET`: return effective config, defaults, path, exists/parse metadata.
   - `PUT`: validate body, write config, return saved effective config.
   - Use 400 for validation errors; 500 for unexpected file errors.

3. Add frontend config modal
   - Create a new component, likely `components/WebConfig.tsx` or `components/WorktreeConfig.tsx` depending on final product-surface decision.
   - Load config on open.
   - Render WorkTree fields, supported variables, reset-to-defaults, save, status/error messages.
   - Keep styling consistent with existing modal components (`ModelsConfig`, `SkillsConfig`, `UsageStatsModal`).

4. Wire modal into `components/AppShell.tsx`
   - Add state for opening/closing the config UI.
   - Add a bottom settings entry.
   - If using generic `Settings`, avoid breaking existing `Models`, `Usage`, and `Skills` access.

5. Documentation updates
   - Update `AGENTS.md` API routes table if adding `/api/web-config`.
   - Update `AGENTS.md` Components table for the new component.
   - Update `README.md` note from manual `pi-web.json` editing to UI-backed configuration.

6. Validation
   - Run `npm run lint`.
   - Run `node_modules/.bin/tsc --noEmit`.
   - Smoke test in dev server if available:
     - open config modal;
     - save a custom branch prefix;
     - create New WorkTree;
     - confirm generated branch/path reflects saved config;
     - reset defaults and confirm config file updates.

## Risky Files / Rollback Points

- `lib/pi-web-config.ts`: runtime worktree creation depends on this fallback behavior; preserve defaults and forgiving read semantics.
- `components/AppShell.tsx`: top-level UI state can get crowded; keep wiring localized.
- New modal component: avoid copying the large `ModelsConfig` complexity; implement a small focused form.
- `AGENTS.md`: update only concise index rows; do not expand detailed docs there.

## Cross-Layer Contracts

- `PiWebConfig` TypeScript type ↔ API response/request ↔ frontend form state.
- Config write helper ↔ `POST /api/git/worktrees` existing use of `readPiWebConfig()`.
- Default constants ↔ UI reset behavior ↔ README/AGENTS documentation.

## Review Gates Before Implementation

- Product-surface decision confirmed: use a generic Settings modal with WorkTree as the initial section.
- User confirms MVP excludes template preview/per-repo overrides.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Do not run `next build` during development.
