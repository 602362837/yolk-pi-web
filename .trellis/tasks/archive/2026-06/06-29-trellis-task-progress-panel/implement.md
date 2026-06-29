# Trellis Task Progress Floating Panel — Implementation Plan

## Ordered Checklist

### 1. Session association types and library

- [x] Add association response/source/reason types to `lib/trellis-types.ts` or a focused local route type.
- [x] Add `lib/trellis-session-link.ts`.
- [x] Implement safe text extraction from session entries/messages/tool calls/tool results.
- [x] Implement high-confidence task-ref regexes for:
  - `.trellis/tasks/<dirName>`;
  - `tasks/<dirName>`;
  - absolute `<cwd>/.trellis/tasks/<dirName>` paths;
  - `Created task: <dirName>` plus emitted task path;
  - `Active task: .trellis/tasks/<dirName>`.
- [x] Implement exact runtime-key candidate generation:
  - `pi_<sanitized-session-id>`;
  - `pi_transcript_<sha256(sessionFilePath).slice(0, 24)>`.
- [x] Explicitly ignore `pi_process_*` and other fallback runtime session files.
- [x] Match extracted refs against `listTrellisTasks(cwd, true)` summaries.
- [x] Return no association on ambiguity or unknown refs.

### 2. Session association API

- [x] Add `app/api/sessions/[id]/trellis-task/route.ts`.
- [x] Gate with `readPiWebConfig().trellis.enabled`.
- [x] Resolve the session path via `resolveSessionPath(id)`.
- [x] Read session entries/header via `SessionManager.open()` or existing session-reader helpers.
- [x] Validate session cwd with allowed roots before calling the Trellis reader.
- [x] Return `{ task, source, confidence }` for safe association or `{ task: null, reason }` for normal misses.
- [x] Keep unexpected filesystem/parser errors as bounded JSON errors.

### 3. TrellisPanel focus support

- [x] Add optional `focusedTaskKey?: string | null` prop to `components/TrellisPanel.tsx`.
- [x] When task list loads and `focusedTaskKey` exists in the list, set `selectedKey` to it.
- [x] Avoid infinite set loops by only applying focus when it differs from current selected key.
- [x] Preserve existing default selection behavior when no focus key is provided.

### 4. Floating widget UI

- [x] Add `components/TrellisSessionWidget.tsx` or inline component in AppShell if small.
- [x] Render task title, derived progress label/percent, status dot/progress bar, vertical stage nodes, current-stage marker, and optional child progress.
- [x] Make the widget draggable with a semi-transparent default upper-right placement that avoids the chat input and right-drawer top buttons.
- [x] Hide the widget when Trellis disabled, no active session id, archived session, no association, or ambiguous association.
- [x] Click handler opens Trellis drawer and focuses associated task.

### 5. AppShell integration

- [x] Track associated Trellis task state in `components/AppShell.tsx`.
- [x] Fetch `/api/sessions/[id]/trellis-task` on selected session changes and after session creation.
- [x] Refresh the association in `handleAgentEnd` alongside existing session/git refreshes.
- [x] Optionally poll every 10 seconds while a widget is visible to keep progress fresh.
- [x] Pass `focusedTrellisTaskKey` into `TrellisPanel`.
- [x] Preserve file drawer behavior and existing Trellis toggle behavior.

### 6. Docs

- [x] Update `docs/modules/api.md` with the new session Trellis association route.
- [x] Update `docs/modules/frontend.md` with the floating widget and TrellisPanel focus prop behavior.
- [x] Update `docs/modules/library.md` with the session-link helper.
- [x] Update `docs/architecture/overview.md` only if a new durable invariant is introduced (not needed).

## Validation Plan

Minimum validation:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Focused manual/API checks:

- [ ] Trellis disabled: widget hidden; new association route returns disabled/403.
- [x] Session containing explicit `.trellis/tasks/<task>` evidence: route returns matching task and widget appears (`curl /api/sessions/019f1137-8618-76a7-b33a-10b2f721e0eb/trellis-task` returned `active:06-29-trellis-task-progress-panel`).
- [ ] Session with no task evidence: route returns `task: null`; widget hidden.
- [ ] Session with multiple ambiguous task refs: route returns `task: null` reason `ambiguous`; widget hidden.
- [ ] Runtime file `pi_<sessionId>.json` with `current_task`: route returns matching task.
- [ ] Runtime file only under `pi_process_*`: route ignores it; widget hidden unless transcript evidence exists.
- [ ] Clicking widget opens Trellis drawer and selects the associated task detail.
- [ ] Opening Files, then clicking widget, preserves file tabs when switching to Trellis.
- [x] Existing Trellis drawer list/detail still works without a focused task via preserved default selection behavior.

Validation run:

- [x] `node_modules/.bin/tsc --noEmit`
- [x] `npm run lint` (passes with pre-existing warnings in `components/ChatInput.tsx` and `hooks/useAgentSession.ts`)


## Risky Files / Rollback Points

| File | Risk | Mitigation |
| --- | --- | --- |
| `components/AppShell.tsx` | Central layout state; easy to regress drawer behavior. | Keep widget state isolated and reuse existing drawer handlers. |
| `components/TrellisPanel.tsx` | Existing selection logic could loop or override user choice. | Apply `focusedTaskKey` only when changed and present in loaded tasks. |
| `lib/trellis-session-link.ts` | Regex/link inference could be too broad. | High-confidence patterns only; ambiguity returns no widget. |
| `app/api/sessions/[id]/trellis-task/route.ts` | New filesystem path from session cwd. | Reuse allowed-root and Trellis reader constraints. |

## Review Gate Before Implementation

- [x] User approved session-owned association, no Trellis task backlinks.
- [x] User approved high-confidence-only default: explicit transcript evidence or exact per-session runtime pointer.
- [x] Planning artifacts reviewed; run `task.py start` only after approval.
