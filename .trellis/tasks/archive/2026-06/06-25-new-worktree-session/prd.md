# New WorkTree session

## Goal

Add a `New WorkTree` flow to pi-web so a user can create an isolated Git worktree from the currently selected project, automatically switch the UI to that worktree, and start a new pi session in that worktree.

## User Value

Users can ask pi to work on isolated branches without manually creating worktrees in a terminal or losing the existing pi-web session workflow.

## Confirmed Facts

- Current `New` creates only a client-side draft session and defers the real pi session creation until the first prompt is sent through `POST /api/agent/new`.
- New session creation is cwd-based: `useAgentSession` posts `cwd` to `/api/agent/new`, and `rpc-manager` starts the pi session in that cwd.
- Session browsing is sourced from pi session files through `SessionManager.listAll()` in `lib/session-reader.ts`.
- The sidebar currently filters sessions by exact selected `cwd`.
- The file API allows reads only under known session cwds or default cwd shortcuts; a brand-new worktree must be added to the allowed-root cache before its first pi session exists.
- There is currently no worktree handling or config file for pi-web-specific settings.

## Requirements

1. Add a `New WorkTree` action near the existing `New` session action.
2. The action must create a Git worktree first, then start the existing new-session draft flow using the new worktree path as `cwd`.
3. Default behavior when no config is present:
   - discover the Git repo root from the selected cwd;
   - create from `HEAD`;
   - generate a branch name like `pi/{yyyyMMdd-HHmmss}`;
   - place worktrees under `{repoParent}/{repoName}.worktrees/{branchSlug}`.
4. Add pi-web config reading support so configured values override default worktree behavior.
5. Use a web-specific config file at `~/.pi/agent/pi-web.json`.
6. Minimum config fields:
   - `worktree.baseRef`
   - `worktree.branchNameTemplate`
   - `worktree.baseDirTemplate`
   - `worktree.pathTemplate`
   - `worktree.sessionDisplay`
7. Worktree creation must use safe process execution (`execFile`/`spawn`), not shell string concatenation.
8. Validate inputs and return useful errors for non-Git directories, invalid branch names, existing target paths, and Git command failures.
9. Worktree sessions must be visually distinguishable from normal sessions.
10. Worktree cwd entries in the project picker must be visually distinguishable from normal cwd entries.
11. The existing `New` flow must remain unchanged.

## Acceptance Criteria

- [ ] In a Git repository, clicking `New WorkTree` creates a new Git worktree using defaults when no config exists.
- [ ] After successful creation, the sidebar selected cwd becomes the new worktree path.
- [ ] The chat area opens a new-session draft in the new worktree cwd.
- [ ] Sending the first prompt creates a real pi session whose `cwd` is the new worktree path.
- [ ] The file explorer can browse the new worktree immediately after creation, before the first prompt is sent.
- [ ] In a non-Git directory, `New WorkTree` fails with a user-visible error and does not alter the selected session/cwd.
- [ ] Config values in `~/.pi/agent/pi-web.json` override default branch/path behavior.
- [ ] Worktree sessions show a `WT`/branch label in the sidebar session list.
- [ ] Worktree cwds show a `WT`/branch label in the cwd picker.
- [ ] Existing normal sessions continue rendering as before.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Out of Scope

- Deleting/pruning worktrees from the UI.
- Copying `.env` or installing dependencies in the worktree.
- Migrating existing sessions to worktree metadata.
- Committing, pushing, or syncing worktree changes.
- Creating worktrees from dirty uncommitted changes.

## Open Questions

None blocking. Use default strategy unless implementation reveals an unsafe edge case.
