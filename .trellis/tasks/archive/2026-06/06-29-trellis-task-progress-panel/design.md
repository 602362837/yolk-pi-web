# Trellis Task Progress Floating Panel — Design

## Architecture Overview

Add a session-scoped Trellis association layer and a compact floating widget in the chat UI. The association is derived from the current pi session only; it is not stored on Trellis task metadata and does not affect the task list.

```text
ChatWindow / AppShell
  └─ GET /api/sessions/[id]/trellis-task
       ├─ resolve pi session JSONL path
       ├─ read session entries and header cwd
       ├─ extract high-confidence Trellis task refs from this session
       ├─ optionally check exact per-session Trellis runtime pointer
       └─ match refs against lib/trellis-reader task summaries/details

Floating widget
  ├─ displays associated task summary/progress
  └─ click → AppShell opens right drawer in Trellis mode and focuses task
         └─ TrellisPanel selects focused task and renders existing detail view
```

## Key Principle

The session owns the association. Trellis tasks remain clean source records. If session evidence is missing or ambiguous, the UI hides the widget instead of guessing.

## Repository Integration Points

| Area | File | Change |
| --- | --- | --- |
| Session/Trellis association library | new `lib/trellis-session-link.ts` | Resolve a task for a session from session-local evidence and exact runtime pointers. |
| Session API | new `app/api/sessions/[id]/trellis-task/route.ts` | Return normalized associated task summary/detail key for one session. |
| Trellis task reader | `lib/trellis-reader.ts` | Reuse existing list/detail methods; add helper only if needed to match by task ref. |
| Trellis wire types | `lib/trellis-types.ts` | Add association response/confidence types if useful. |
| Main layout | `components/AppShell.tsx` | Track session-associated Trellis task, render floating widget, and open/focus Trellis drawer on click. |
| Trellis drawer | `components/TrellisPanel.tsx` | Accept optional focused task key and select it when available. |
| Chat state | `components/ChatWindow.tsx` / `hooks/useAgentSession.ts` | Notify AppShell on session activity/end as already done; no task metadata writes. |
| Docs | `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md` | Document new route/component/library behavior. |

## Association Contract

### API

`GET /api/sessions/[id]/trellis-task`

Response when an associated task is found:

```ts
interface TrellisSessionTaskResponse {
  task: TrellisTaskSummary;
  source: "session-transcript" | "session-runtime";
  confidence: "high";
}
```

Response when no safe association exists:

```ts
interface TrellisSessionTaskResponse {
  task: null;
  reason: "no-session" | "trellis-disabled" | "no-workspace" | "no-evidence" | "ambiguous" | "task-not-found";
}
```

Route behavior:

- 403 if Trellis is disabled, matching existing Trellis API gate.
- 404 if the pi session id does not resolve.
- 200 with `task: null` for normal no-association cases.
- Reuse allowed-root checks for the session cwd before reading `.trellis` data.
- Do not expose raw `.trellis/.runtime/sessions/*.json` content.

### Evidence Sources

Allowed by default:

1. **Explicit session transcript evidence** (`source=session-transcript`):
   - session messages/tool results contain `.trellis/tasks/<dirName>` or `tasks/<dirName>` task refs;
   - task creation output such as `Created task: <dirName>` followed by a `.trellis/tasks/<dirName>` path;
   - active-task dispatch lines such as `Active task: .trellis/tasks/<dirName>`.
2. **Exact per-session Trellis runtime pointer** (`source=session-runtime`):
   - only keys deterministically tied to this pi session are checked, for example `pi_<sanitized-session-id>` and `pi_transcript_<hash(session-file-path)>`;
   - process/global fallback keys such as `pi_process_*` are intentionally ignored.

Disallowed for automatic widget display:

- "current workspace has one in_progress task" guesses;
- arbitrary first task in the Trellis task list;
- process-level or global runtime fallback pointers;
- mutating `task.json` with session ids or backlinks.

### Candidate Resolution

1. Read the session header cwd and all visible/raw session entries from the session JSONL.
2. Extract task refs from high-confidence text fields:
   - user/assistant text;
   - tool result text;
   - tool call arguments for bash/subagent prompts when they contain explicit task refs.
3. Normalize refs to task directory names:
   - `.trellis/tasks/06-29-foo` → `06-29-foo`;
   - `tasks/06-29-foo` → `06-29-foo`;
   - absolute paths under `<cwd>/.trellis/tasks` → `06-29-foo`;
   - archived refs can map to archive task keys only when the path includes archive month.
4. Match normalized refs against `listTrellisTasks(cwd, true)`.
5. Select a task only when:
   - all high-confidence evidence points to a single task; or
   - a stronger latest lifecycle signal (`Created task`, `task.py start`, `Active task`) identifies one task unambiguously.
6. If evidence is missing, references unknown tasks, or multiple tasks remain tied, return `task: null` with a reason.

## Floating Widget UI

### Placement

Render inside AppShell, fixed near the lower-right of the chat area but offset from the chat input and right-side mode toggles. Suggested desktop placement:

```text
chat content
  ┌──────────────────────────────────────────┐
  │                                          │
  │                              ┌────────┐  │
  │                              │Trellis │  │
  │                              │ 60%    │  │
  └──────────────────────────────┴────────┘  │
                         chat input          │
```

Responsive behavior:

- Desktop: draggable compact card with title, status, percent, progress bar, and vertical progress nodes.
- Narrow screens: smaller card, max width under viewport, no overlap with input.
- Default placement is near the upper-right of the chat content area, below the top bar and away from the input; users can drag it elsewhere.
- The card uses a semi-transparent background with backdrop blur so it does not visually dominate chat content.
- Hidden when the right drawer is open in Trellis mode and already focused on the same task, unless keeping it visible is visually harmless.

### Content

Display:

- `Trellis` label or `T` icon;
- task title, truncated;
- `task.progress.label` and `task.progress.percent%`;
- status dot/color based on the existing Trellis status color mapping;
- all `task.progress.stages` rendered as a vertical node list;
- current/active stage marked with a `当前` badge;
- optional child progress when `childProgress.total > 0`.

States:

- Loading association: no widget (avoid flicker) or subtle skeleton only if needed.
- No association: no widget.
- Error: no widget; log/debug silently or show only in dev console.

### Click Behavior

Clicking the widget calls an AppShell handler:

```ts
setRightPanelMode("trellis");
setRightPanelOpen(true);
setFocusedTrellisTaskKey(task.key);
```

`TrellisPanel` receives `focusedTaskKey` and selects it after task list load. Existing file tabs remain in state.

## Refresh Strategy

MVP refresh triggers:

- selected session changes;
- session is created;
- agent ends (`onAgentEnd` already fires in AppShell);
- user clicks the widget refresh/action if added;
- optional light polling while agent is running or while widget is visible (e.g. 10s) to update progress after task file changes.

Preferred simple approach:

- Fetch association on session selection/creation and after `onAgentEnd`.
- Poll every 10 seconds only while a widget is visible and Trellis is enabled, aborting on unmount/session change.

## Security

- The browser only passes a session id to the new API.
- The server resolves the session path through existing `resolveSessionPath()`.
- The server gets cwd from the session header, then validates it through `getAllowedRoots()` / `isPathAllowed()` before Trellis reads.
- The server scans known task summaries/details instead of accepting arbitrary task paths.
- Runtime pointer files are read only for exact per-session candidate keys and only to extract `current_task`; raw contents never leave the server.
- Existing Trellis disabled gate remains authoritative.

## Compatibility

- No change to pi session JSONL format.
- No change to Trellis task JSON format.
- No change to existing Trellis task list/detail APIs.
- If the session association feature fails, the existing chat and Trellis drawer keep working.
- Archived sessions can be resolved read-only, but the widget should normally be hidden for archived sessions because they cannot continue work.

## Trade-offs

- Session-local inference is safer than task backlinks because stale/wrong inferred links cannot contaminate Trellis task records.
- Hiding on ambiguity may miss some useful widgets, but it matches the product rule that wrong associations are worse than no widget.
- Reusing the existing Trellis drawer avoids duplicate detail UI but requires `TrellisPanel` to accept an externally focused task key.
- Runtime pointer support is best-effort and strict; process-level fallbacks are intentionally ignored to avoid cross-session bleed.
