# Session file changes diff overlay

## Goal

Add a session-scoped floating UI that shows which workspace files an agent changed during the current pi session and lets the user open a Git-diff-style unified diff for each file, without requiring the workspace to be a Git repository.

## User Value

Users can stay in the chat flow while understanding exactly which files the agent touched and what changed. This must work for plain directories, generated workspaces, and non-Git projects.

## Confirmed Facts

- Pi Web is a single Next.js app with API routes under `app/api/`, React UI under `components/`, browser hooks under `hooks/`, and shared server/client contracts under `lib/`.
- Chat session UI is owned by `components/ChatWindow.tsx` and `hooks/useAgentSession.ts`.
- Live agent events are streamed through `app/api/agent/[id]/events/route.ts` from `AgentSessionWrapper.onEvent()`.
- `AgentSessionWrapper.start()` in `lib/rpc-manager.ts` subscribes to pi events and is the server-side boundary where tool execution events can be observed for every live RPC session.
- Pi emits tool events including `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` with `toolCallId`, `toolName`, `args`, `result`, and `isError` fields.
- Built-in `edit` args include `{ path, edits }` and edit results expose display diff / standard patch details in the pi SDK type definitions.
- Built-in `write` args include `{ path, content }`; the write tool does not expose an edit patch in its public type definition.
- Existing session JSONL files are read through `lib/session-reader.ts`; durable UI-only projections should avoid mutating the primary session JSONL unless that is explicitly required.
- Existing docs require new API routes/components/shared modules to be reflected in `docs/modules/*.md` and `AGENTS.md` if the top-level navigation changes.

## Requirements

1. The feature must not depend on Git or shelling out to `git diff` / `git status`.
2. Track agent file changes at session scope, not workspace scope.
3. Precisely track files changed through the built-in `edit` and `write` tools.
4. Do not include `bash`-driven file change scanning in MVP; arbitrary shell commands are explicitly out of scope for the first implementation.
5. Store change projection data outside the session JSONL file in a sidecar under the pi agent data directory.
6. Expose typed API routes for changed-file summary and per-file diff details.
7. Render a floating, theme-aware changed-files entry point inside the chat surface.
8. Clicking a changed file opens a modal/panel showing a unified diff with Git-style colors for added, removed, hunk, and context lines.
9. Large, binary, outside-workspace, unreadable, or ignored files must degrade safely with metadata and explanatory UI instead of crashing.
10. The UI should update while an agent is running and remain available when viewing an existing session that has sidecar change data.
11. Old sessions with no sidecar data may show no change overlay; reconstructing historical diffs from JSONL is out of MVP scope.

## Proposed MVP Scope

- Add `lib/session-file-changes.ts` for `edit`/`write` tool-event tracking, sidecar persistence, workspace path normalization, bounded text snapshots, and unified-diff projection.
- Hook the tracker into `AgentSessionWrapper.start()` so live sessions record changes as tools execute.
- Add:
  - `GET /api/sessions/[id]/changes`
  - `GET /api/sessions/[id]/changes/file?path=<relative-path>`
- Add shared wire types in `lib/types.ts`.
- Add UI components:
  - `components/SessionChangesFloatingPanel.tsx`
  - `components/FileDiffModal.tsx`
  - optionally `components/UnifiedDiffView.tsx` if diff rendering is large enough to split out.
- Mount the floating panel from `components/ChatWindow.tsx` for existing sessions once summary data reports at least one changed file.

## Out of Scope

- Revert/apply/discard actions.
- Split diff view.
- Git integration or staged/unstaged status.
- Detecting or attributing arbitrary `bash` command file changes.
- Tracking external manual user edits as session-owned changes.
- Full historical reconstruction for sessions created before this feature exists.

## Acceptance Criteria

- [ ] In a non-Git directory, when the agent edits an existing text file with `edit`, the floating changed-files UI appears and lists the file as modified.
- [ ] In a non-Git directory, when the agent creates a text file with `write`, the UI lists the file as added and shows an all-additions unified diff.
- [ ] Clicking a listed file opens a modal with a unified diff using theme-aware colors for `+`, `-`, `@@`, and context lines.
- [ ] Multiple edits to the same file in one session are summarized as one cumulative file diff from the first captured baseline to the latest captured content.
- [ ] Deleted files are represented when detectable, with a deletion diff or a safe metadata-only fallback.
- [ ] Binary or oversized files do not render raw content; the UI shows a clear non-text / too-large message.
- [ ] Bash-driven file changes are not shown in MVP, and the UI/API do not imply bash coverage.
- [ ] Archived/read-only sessions can display existing sidecar diffs without enabling mutation.
- [ ] Session JSONL content is not modified for this feature.
- [ ] New routes are documented in `docs/modules/api.md`; new components/shared modules are documented in the relevant module docs and `AGENTS.md` if needed.
- [ ] Validation passes: `npm run lint` and `node_modules/.bin/tsc --noEmit`.

## Product Decision

- MVP excludes `bash` workspace scanning. First implementation ships precise `edit`/`write` tracking only; bash detection can be designed as a later enhancement.
