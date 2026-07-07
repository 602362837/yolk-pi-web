# handoff

## registry-lib-api implementation

### Files changed

- `lib/project-registry-types.ts` — added Project Registry/project-space schema and API input types.
- `lib/project-registry.ts` — added registry persistence at `getAgentDir()/pi-web-projects.json`, canonical realpath-backed path keys, project registration with main-space creation, duplicate active-project detection, and project/space metadata patch helpers.
- `app/api/projects/route.ts` — added `GET /api/projects` and `POST /api/projects`.
- `app/api/projects/[projectId]/route.ts` — added project read/update API.
- `app/api/projects/[projectId]/spaces/route.ts` — added project-space listing API.
- `app/api/projects/[projectId]/spaces/[spaceId]/route.ts` — added project-space read/update API.
- `docs/modules/api.md` — documented Project Registry routes and route ownership.
- `docs/modules/library.md` — documented Project Registry library modules and canonical path reuse rule.

### Validation

- `npm install --include=dev` — installed missing dev dependencies required by validation; npm reported existing peer/vulnerability warnings.
- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Notes / risks

- Scope intentionally limited to Registry lib/API; session linking, WorkTree sync, allowed-roots integration, sidebar UI, and legacy-session UX remain for later subtasks.
- `POST /api/projects` returns an existing active project when canonical `pathKey` already exists; archived projects with the same path do not block a new active record.

## worktree-registry-sync implementation

### Files changed

- `lib/project-registry.ts` — added worktree-space id generation, registry upsert/archive helpers, registered-project sync from `git worktree list --porcelain`, and main-project matching by canonical path key.
- `lib/git-worktree.ts` — exported `WorktreeRecord` so registry sync can consume parsed porcelain records.
- `lib/allowed-roots.ts` — included active Project Registry roots/spaces in allowed roots so registered projects without sessions can use file APIs.
- `app/api/projects/route.ts` — refreshes worktree spaces after project registration or duplicate lookup.
- `app/api/projects/[projectId]/worktrees/refresh/route.ts` — added explicit worktree refresh endpoint for registered projects.
- `app/api/git/worktrees/route.ts` — upserts registry worktree space after WorkTree creation and marks matching space archived/missing after removal.
- `app/api/git/worktrees/archive/route.ts` — marks matching registry worktree spaces archived/missing after archive removal.
- `docs/modules/api.md` — documented worktree refresh route and registry-aware WorkTree create/remove behavior.
- `docs/modules/library.md` — documented registry worktree sync, exported Git worktree record usage, and registry-backed allowed roots.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Notes / risks

- No manual browser/API verification was run in this delegated pass.
- WorkTree archive/removal still preserves the existing behavior of deleting related sessions; registry spaces are only marked `archived=true`/`missing=true`.

## session-project-link implementation

### Files changed

- `lib/session-project-link.ts` — added helpers to read/write optional `projectId`/`spaceId` session header links, derive `legacyUnassigned`, and match legacy cwd using registry canonical path keys.
- `lib/project-session-index.ts` — added best-effort `pi-web-session-index.json` maintenance for newly linked and forked sessions.
- `lib/types.ts` — extended session header/info types with optional `projectId`, `spaceId`, and `legacyUnassigned`.
- `lib/session-reader.ts` — includes project link metadata when listing active/archived sessions while keeping missing-link sessions readable.
- `lib/agent-session-bootstrap.ts` — validates optional project/space context for new/draft sessions, writes header links, and updates the session index.
- `app/api/agent/new/route.ts` — accepts `projectId`/`spaceId` and forwards them to session bootstrap without sending them as prompt commands.
- `app/api/agent/draft/route.ts` — accepts `projectId`/`spaceId` for precreated draft/Browser Share sessions.
- `lib/rpc-manager.ts` — forked sessions inherit `projectId`/`spaceId` from linked source sessions and update the session index; legacy forks stay unassigned.
- `app/api/sessions/[id]/route.ts` — returns project link metadata and `legacyUnassigned` on session detail without requiring those fields.
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts` — added project-space sessions endpoint filtering by explicit session header link, with optional legacy exact-cwd results returned separately.
- `docs/architecture/overview.md`, `docs/modules/api.md`, `docs/modules/library.md` — documented optional session link fields, project-space sessions API, and helper boundaries.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Notes / risks

- No manual browser/API verification was run in this delegated pass.
- The session index is maintained for new/forked linked sessions but not yet used as the primary query path; project-space session API filters headers to preserve header-as-source-of-truth semantics.

## sidebar-project-tree implementation

### Files changed

- `components/SessionSidebar.tsx` — switched the sidebar project selector to `/api/projects`, renders Project → Space entries from the registry, registers added paths through `POST /api/projects`, lazy-loads linked sessions through the project-space sessions API, shows exact-cwd legacy sessions in a separate “未关联旧会话” section, and forwards selected project/space context for new chats.
- `components/AppShell.tsx` — tracks active and new-session project/space context from the sidebar and passes it into chat creation while preserving legacy URL session restore behavior.
- `components/ChatWindow.tsx` — accepts optional new-session project/space context and forwards it to the agent hook.
- `hooks/useAgentSession.ts` — includes optional `projectId`/`spaceId` in new and draft session requests and local session-created projections.
- `docs/modules/frontend.md` — documented the Project Registry-driven sidebar and project/space context plumbing.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Notes / risks

- No manual browser verification was run in this delegated pass.
- WorkTree creation refreshes registry data and relies on the registry space match by path after refresh; checker should verify the newly created worktree is selected/linked in the browser flow.

## metadata-legacy-ux implementation

### Files changed

- `components/SessionSidebar.tsx` — added a workspace metadata action menu and modal for editing project/space display name, tags, pinned, and archived state via the existing Project Registry PATCH APIs; pinned/archived updates immediately affect active sidebar sorting/visibility; missing spaces keep metadata editable while new-session creation remains disabled; legacy rows now show an inline “未关联” marker.
- `docs/modules/frontend.md` — documented Project Registry metadata editing in the sidebar module map.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Notes / risks

- No manual browser verification was run in this delegated pass.
- Archived projects/spaces are hidden from the active selector; this subtask did not add a separate archived-project management view.

## docs-validation implementation

### Files changed

- `docs/architecture/overview.md` — added the Project Registry boundary, storage path, project/space data-source rule, canonical path matching rule, and session-index/source-of-truth notes.
- `docs/modules/api.md` — verified Project Registry/project-space/worktree route documentation is present and states sessions are not used to synthesize projects.
- `docs/modules/frontend.md` — verified sidebar/AppShell/chat hook documentation describes registry-driven project/space context and lazy session loading.
- `docs/modules/library.md` — verified Project Registry, session-link, index, worktree sync, allowed-root, and canonical path reuse guidance is present.
- `AGENTS.md` — added Project Registry module navigation, invariants, and data-file locations for future agents.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Manual checklist record

- Browser/API manual acceptance from `checks.md` was not executed in this non-interactive delegated pass. The checklist should still be run by the checker/main session against a dev server, especially empty-registry behavior, linked new/draft/fork sessions, WorkTree refresh/archive, metadata persistence, and legacy unassigned display.

### Notes / risks

- No product decisions needed from the main session.
- Remaining risk is manual UX/API coverage only; automated validation passed.
