# Design — Session file changes diff overlay

## Summary

Implement a non-Git session change projection. The server observes live agent tool events, captures bounded before/after file snapshots for workspace files, persists a sidecar projection under the pi agent data directory, and exposes typed session APIs consumed by a floating chat widget and diff modal.

The primary invariant is: **the changed-files UI is derived from agent session tool execution, not from repository status**.

## Architecture

```text
AgentSessionWrapper.start()
  └─ observes pi tool events
      └─ lib/session-file-changes.ts
          ├─ capture before snapshots on tool_execution_start
          ├─ capture after snapshots on tool_execution_end
          ├─ generate cumulative unified diffs
          └─ persist sidecar JSON

GET /api/sessions/[id]/changes
GET /api/sessions/[id]/changes/file?path=...
  └─ read sidecar projection

ChatWindow
  └─ SessionChangesFloatingPanel
      ├─ changed file list popover
      └─ FileDiffModal / UnifiedDiffView
```

## Server Tracking Boundary

`lib/rpc-manager.ts` is the right integration point because every live RPC session goes through `AgentSessionWrapper.start()` and all browser SSE clients already subscribe to wrapper events.

Recommended flow in `AgentSessionWrapper.start()`:

1. Receive an event from `inner.subscribe()`.
2. Pass the event to `recordSessionFileChangeEvent({ sessionId, sessionFile, cwd, event })`.
3. Forward the original event to listeners as today.
4. If the tracker reports that summary data changed, optionally emit a synthetic UI event:

```ts
{ type: "session_file_changes_update", sessionId, fileCount }
```

The synthetic event is not persisted to JSONL; it only lets the browser refresh without polling aggressively.

### Race control

For known path tools (`edit`, `write`), before snapshots should be captured synchronously or through an awaited listener path before the tool mutates the file. If pi's subscribe pipeline does not await listeners for `tool_execution_start`, use bounded synchronous `fs.statSync/readFileSync` for these snapshots to avoid after-state races.

## Tool Coverage

### `edit`

Input source:

```ts
{ path: string, edits: Array<{ oldText: string; newText: string }> }
```

Behavior:

- Resolve the target path against session `cwd`.
- Ignore paths outside `cwd` for MVP UI projection.
- On start, capture file status and baseline text if the file is a bounded text file.
- On successful end, capture current text/status.
- Update one cumulative per-file record.
- Prefer the internally generated cumulative diff; pi's `result.details.patch` may be kept as operation metadata but should not replace the cumulative session diff.

### `write`

Input source:

```ts
{ path: string, content: string }
```

Behavior:

- On start, determine whether the file exists and capture baseline text when safe.
- On successful end, capture current text.
- If no baseline existed and current text exists, status is `added`.
- If a baseline existed and current text differs, status is `modified`.

### `bash`

`bash`-driven file change detection is out of scope for MVP. Arbitrary shell commands cannot be perfectly attributed without a sandbox, filesystem monitor, or bounded workspace scanner, and the first implementation should avoid that complexity.

MVP behavior:

- Ignore `tool_execution_start` / `tool_execution_end` events whose `toolName` is `bash`.
- Do not display bash coverage claims in the UI.
- Leave room in the sidecar/source-kind design for a future `bash-scan` enhancement.

The only global size budgets needed for MVP are:

```ts
const MAX_TEXT_FILE_BYTES = 512 * 1024;
const MAX_DIFF_BYTES = 1024 * 1024;
```

## Sidecar Persistence

Do not modify the primary session JSONL. Persist under the pi agent data dir:

```text
~/.pi/agent/session-changes/<session-id>.json
```

Session IDs are UUID-like and already the web UI's stable key. Store the owning `cwd` and `sessionFile` in the sidecar for diagnostics and safety checks.

### Sidecar shape

```ts
export interface SessionFileChangesSidecar {
  version: 1;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  updatedAt: string;
  files: Record<string, SessionFileChangeRecord>;
  pendingTools?: Record<string, PendingToolSnapshot>;
}

export interface SessionFileChangeRecord {
  path: string;                 // cwd-relative normalized slash path
  absolutePath?: string;         // server-only diagnostic, not required in API responses
  status: "added" | "modified" | "deleted" | "metadata-only";
  additions: number;
  deletions: number;
  firstChangedAt: string;
  lastChangedAt: string;
  toolCallIds: string[];
  toolNames: string[];
  sourceKinds: Array<"edit" | "write">;
  diffAvailable: boolean;
  diff?: string;
  reason?: "binary" | "too-large" | "outside-workspace" | "unreadable" | "unchanged";
  baselineText?: string;         // kept only when safe and needed for future cumulative updates
  baselineHash?: string;
  latestHash?: string;
}
```

API responses must omit raw `absolutePath`, `baselineText`, and other implementation-only fields.

### Storage trade-off

Keeping a bounded `baselineText` enables cumulative diffs across multiple tool calls and resumed sessions. This is local data under the same pi agent directory as transcripts. Enforce byte limits and avoid binary/large content to prevent unbounded storage growth.

## Unified Diff Generation

Add a small wrapper such as `lib/unified-diff.ts`.

Recommended implementation: add `diff` as a direct dependency and use `createPatch()` / structured line diff helpers. Although `diff` is already present transitively, importing it directly should be backed by a direct dependency.

Responsibilities:

- Generate `--- a/path` / `+++ b/path` headers.
- Use `/dev/null` style headers for additions/deletions if the library supports it, or a consistent equivalent.
- Count additions/deletions excluding headers.
- Truncate or mark diffs that exceed `MAX_DIFF_BYTES`.

## API Design

### `GET /api/sessions/[id]/changes`

Purpose: summary for the floating widget.

Checks:

- Resolve session path with `resolveSessionPath(id)`.
- 404 if session not found.
- Read sidecar if present; missing sidecar returns `{ files: [] }`.
- Return browser-safe data only.

Response:

```ts
export interface SessionChangesSummaryResponse {
  sessionId: string;
  updatedAt?: string;
  files: SessionChangedFileSummary[];
}

export interface SessionChangedFileSummary {
  path: string;
  status: "added" | "modified" | "deleted" | "metadata-only";
  additions: number;
  deletions: number;
  toolNames: string[];
  sourceKinds: Array<"edit" | "write">;
  diffAvailable: boolean;
  reason?: string;
  firstChangedAt: string;
  lastChangedAt: string;
}
```

### `GET /api/sessions/[id]/changes/file?path=<relative-path>`

Purpose: one file diff for the modal.

Checks:

- Resolve session path.
- Require a relative normalized path that exactly matches a sidecar file key.
- 404 if no change record exists.
- Return no raw snapshots.

Response:

```ts
export interface SessionFileDiffResponse extends SessionChangedFileSummary {
  diff?: string;
}
```

## UI Design

### Mount point

Mount `SessionChangesFloatingPanel` inside the existing `ChatWindow` root (`relative flex h-full...`). The panel uses absolute positioning and should avoid blocking the chat input. A default bottom-right placement is most aligned with the user request.

### Floating panel behavior

- Hidden when there are no files.
- Compact button text examples:
  - `1 file changed`
  - `3 files changed`
  - `Changes updating…` while a tool is running and a refresh is in flight.
- Clicking toggles a popover with the changed-file list.
- List rows show:
  - status badge (`M`, `A`, `D`, `?`)
  - path
  - `+N -M`
  - optional metadata chip when diff content is unavailable.
- Clicking a row opens `FileDiffModal`.

### Diff modal behavior

- Header: path, status, additions/deletions, source chip(s), close button.
- Body:
  - If `diffAvailable`, render unified diff in a monospace scroll area.
  - If not, show reason-specific explanation.
- `UnifiedDiffView` colors:
  - `+` additions green background/text
  - `-` deletions red background/text
  - `@@` hunk lines blue/accent-muted
  - `---` / `+++` headers dim/mono
  - context lines default mono
- The modal is read-only. Revert/apply is out of scope.

### Refresh strategy

Preferred:

- `useAgentSession` handles `session_file_changes_update` by exposing a lightweight `changesVersion` or by letting `SessionChangesFloatingPanel` listen through a prop.
- The panel refetches summary on mount, on `changesVersion`, and on `agent_end`.

Simpler acceptable MVP:

- The panel fetches on mount/session change.
- While `agentRunning` is true, poll every 2 seconds.
- Fetch once after `agentRunning` changes from true to false.

## Security and Safety

- Normalize paths with `path.resolve(cwd, inputPath)` and expose only cwd-relative slash paths.
- Ignore or metadata-mark paths that escape the workspace.
- Never accept arbitrary browser paths for file reads; diff APIs only return records already present in the sidecar for the session.
- Avoid raw snapshot content in API responses.
- Bound file size, diff size, and sidecar write size.
- Use atomic sidecar writes: write temporary file then rename.
- Sidecar parse errors should return a safe empty/error response and not crash session loading.

## Compatibility

- Existing sessions without sidecars show no floating change widget.
- Archiving a session does not need to move sidecar data because lookup is by session id. Deleting a session should delete its sidecar as best effort.
- Forked sessions should get their own sidecar. Do not copy parent sidecar by default because fork content is conversation history, not filesystem state.

## Documentation Updates

- `docs/modules/api.md`: add both session changes routes.
- `docs/modules/frontend.md`: add new change panel/modal/diff components.
- `docs/modules/library.md`: add `lib/session-file-changes.ts` and `lib/unified-diff.ts`.
- `docs/architecture/overview.md`: add the invariant that session file-change projection is sidecar-based and non-Git.
- `AGENTS.md`: add top-level pointers only if the route/component list changes materially enough to aid future agents.

## Risks

1. **Before snapshot race** — avoid by synchronous bounded reads for known path tools or by confirming pi awaits event listeners before tool execution.
2. **Bash attribution gap** — MVP intentionally excludes bash changes; future bash support needs a separate scanner/sandbox design.
3. **Storage growth** — enforce strict text/diff limits and omit binary/large snapshots.
4. **External user edits** — sidecar projection represents observed agent-tool changes; external edits between tool calls may affect current cumulative diff if a session resumes. This is acceptable for MVP but should be messaged carefully if encountered.
