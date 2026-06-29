# Session Archive Feature — PRD

## Goal

Add session archiving functionality to pi-web. Users can archive sessions they no longer actively use, keeping them accessible for later viewing while decluttering the main session list.

## User Value

- **Declutter**: Projects accumulate many sessions over time. Archiving hides inactive ones without permanently deleting them.
- **Reversible**: Unlike deletion, archiving is non-destructive and easily undone.
- **Project persistence**: Even when all sessions are archived, the project remains visible in the workspace picker.

## Constraints

- Session JSONL file format is NOT modified — archiving is purely a file-move operation.
- pi SDK's `SessionManager.listAll()` only scans `~/.pi/agent/sessions/`. Archived sessions live in a separate `sessions-archive/` directory and need custom scanning.
- Existing `parentSession` paths inside JSONL headers point at absolute paths — they must be updated when files move.
- Active RPC sessions must be destroyed before archiving.

## Requirements

### Core: Single Session Archive

- [ ] User can archive a session from the session list (hover action button)
- [ ] No confirmation dialog needed (non-destructive, reversible)
- [ ] Archived session disappears from the active session list immediately
- [ ] If the archived session is the currently viewed session, show a read-only "archived" banner with unarchive action

### Core: Batch Archive

- [ ] User can enter multi-select mode in the session list
- [ ] User can select multiple sessions and archive them in one action
- [ ] Multi-select mode has clear enter/exit UI

### Core: Archive All

- [ ] User can archive all sessions for the current workspace (cwd)
- [ ] Requires a confirmation dialog (bulk action)
- [ ] Accessible from a workspace-level menu (e.g., "⋯" button in header)

### Core: View Archived Sessions

- [ ] When a cwd has archived sessions, show a collapsible "Archived (N)" section at the bottom of the session list
- [ ] Archived sessions render with distinct styling (muted/italic)
- [ ] Clicking an archived session opens it in read-only mode (no message sending)

### Core: Unarchive

- [ ] User can unarchive a session from the archived section (hover action button)
- [ ] Unarchived session returns to the active session list

### Core: Project Visibility

- [ ] When all sessions in a project are archived, the project still appears in the CWD picker
- [ ] These archive-only projects are styled distinctly (muted text, "archived" label)

### Nice-to-have

- [ ] Delete archived sessions directly from the archived section
- [ ] Archived session count shown in workspace picker per project
- [ ] Keyboard shortcuts for archive operations

## Acceptance Criteria

1. `npm run lint` passes
2. `node_modules/.bin/tsc --noEmit` passes
3. Single archive → session moves to `sessions-archive/`, disappears from list, appears in archived section
4. Unarchive → session moves back, reappears in active list
5. Archive all → all sessions for a cwd move, project still visible in picker
6. Batch archive → selected sessions move, UI exits multi-select mode
7. Viewing an archived session works (read-only), sending message is blocked
8. parentSession paths in JSONL headers are updated on archive/unarchive
9. Active RPC sessions are destroyed before archive

## Technical Design

See `docs/research/session-archive-design.md` for the full design document.
