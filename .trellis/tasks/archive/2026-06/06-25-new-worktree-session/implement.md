# New WorkTree session — Implementation Plan

## Ordered Checklist

1. Add shared config loader
   - Create `lib/pi-web-config.ts`.
   - Read `join(getAgentDir(), "pi-web.json")`.
   - Provide typed defaults and normalization helpers.
   - Ensure malformed config falls back safely or produces clear errors where needed.

2. Add Git worktree service
   - Create `lib/git-worktree.ts`.
   - Implement safe `execFile` helper.
   - Implement repo discovery, branch validation, template expansion, target path checks, `worktree add`, and worktree metadata lookup.

3. Add API route
   - Create `app/api/git/worktrees/route.ts`.
   - Validate JSON body.
   - Call config + Git service.
   - Add created target path to files allowed-root cache.
   - Return typed metadata.

4. Extend shared types
   - Add optional `worktree` metadata to `SessionInfo` in `lib/types.ts`.
   - Add any local API response types near route/client usage if needed.

5. Enrich session list metadata
   - Update `lib/session-reader.ts` to attach worktree metadata to sessions.
   - Avoid repeated Git calls per session by deduplicating unique cwd values.
   - Fail closed for metadata lookup errors: sessions still list without `worktree` metadata.

6. Update sidebar UI
   - Add local state for worktree creation/loading/error and ephemeral worktree cwd metadata.
   - Add `New WorkTree` button.
   - On success, set selected cwd and invoke existing `onNewSession` flow with the returned cwd.
   - Render `WT`/branch labels in cwd picker rows.
   - Render `WT`/branch labels in session item rows.

7. Update documentation/index if needed
   - Add new API route to `AGENTS.md` API table.
   - Add config note to `README.md` or `AGENTS.md` data/config section if implementation adds user-facing config.

8. Validation
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`
   - Manual smoke test in a Git repo: create worktree, send first prompt, inspect session cwd.
   - Manual smoke test outside a Git repo: verify error and no cwd/session switch.

## Risky Files / Rollback Points

- `components/SessionSidebar.tsx`: large component with many inline styles; keep changes localized.
- `lib/session-reader.ts`: session list drives the whole sidebar; metadata enrichment must not break normal listing.
- `app/api/files/[...path]/route.ts`: allowed-root cache is global; prefer helper-compatible minimal update in new route instead of broad refactor.

## Cross-Layer Contracts to Keep Aligned

- `POST /api/git/worktrees` response shape ↔ sidebar client handling.
- `SessionInfo.worktree` type ↔ `session-reader` projection ↔ sidebar badges.
- `pi-web.json` config shape ↔ config loader defaults ↔ Git worktree path generation.

## Implementation Notes

- Do not run `next build` during development.
- Use `execFile`, not shell strings.
- Do not introduce worktree deletion/pruning in this task.
- Keep existing `New` behavior unchanged.
