# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

---

## Scenario: YPI Studio workflow/task state machines

### 1. Scope / Trigger

Use this contract when adding or changing YPI Studio workflows, tasks, runtime
session binding, role-subagent dispatch, or the Studio APIs that project those
files to the browser. This is cross-layer work: `.ypi/` storage → `lib/` reader
and writer → Next.js API routes → Pi extension workflow interception.

### 2. Signatures

- Workflow storage: `.ypi/workflows/<workflow-id>.json` with
  `schemaVersion`, `id`, `states`, `transitions`, `initialStatus`,
  `terminalStatuses`, and `triggers`.
- Task storage: `.ypi/tasks/<task-id>/task.json` plus `events.jsonl` and
  markdown artifact files.
- Runtime pointer: `.ypi/.runtime/sessions/<context-id>.json` with
  `{ currentTask, updatedAt }`.
- List APIs: `GET /api/studio/workflows?cwd=<cwd>` and
  `GET /api/studio/tasks?cwd=<cwd>`.
- Detail/mutation API: `GET/PATCH /api/studio/tasks/[taskKey]?cwd=<cwd>`.
- Extension tools: `ypi_studio_task` for lifecycle/artifacts and
  `ypi_studio_subagent` for member delegation.

### 3. Contracts

- Workflow and task readers must validate workspace paths with allowed roots and
  must not let stable keys become raw filesystem paths.
- Default workflow initialization/backfill is additive only; never overwrite
  user-authored `.ypi/workflows/*.json` files.
- Task transitions must follow workflow-defined transitions unless an explicit
  override/reason path is used.
- `awaiting_approval -> implementing` requires user approval; the main session
  must not silently treat planning approval as implementation approval.
- Role work belongs to `ypi_studio_subagent`; the main session remains the
  orchestrator and should not pretend to be architect/implementer/checker for
  member-owned phases.
- Extension child processes must set a guard env such as
  `YPI_STUDIO_SUBAGENT_CHILD=1` to avoid recursively registering the Studio
  extension inside children.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing `.ypi/workflows` | Workflow list returns an empty state; explicit init creates defaults. |
| Existing workflow file | Backfill skips it and does not overwrite content. |
| Malformed workflow/task JSON | List route returns a per-item read error when safe. |
| Invalid task key or artifact name | Reject with 400/security error; do not read arbitrary paths. |
| Unknown transition | Reject unless override is explicit and recorded. |
| Missing active runtime pointer | Extension injects `no_task` guidance instead of guessing a task. |
| Missing member definition | `ypi_studio_subagent` returns a clear error; do not fallback to main-session execution. |

### 5. Good/Base/Bad Cases

- Good: `/studio-start` creates a task, binds the current context id, dispatches
  the architect through `ypi_studio_subagent`, then waits in
  `awaiting_approval` before implementation.
- Base: a workspace has no Studio tasks; the task list API returns an empty list
  and the extension injects `no_task` guidance.
- Bad: the UI sends `../../task.json` as a task id, or the agent directly edits
  code while the task is still in `awaiting_approval`.

### 6. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- Default workflows initialize/backfill without overwriting existing files.
- Task creation writes valid `task.json`, `events.jsonl`, and artifact files.
- Runtime context id resolves the current task.
- Invalid transitions and invalid task keys are rejected.
- `ypi_studio_subagent` receives member definition plus task/workflow context and
  records a run summary.
- `npm run lint` and `node_modules/.bin/tsc --noEmit` pass after route/lib changes.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Browser or agent chooses an arbitrary path and bypasses the state machine.
fetch(`/api/studio/tasks/read?path=${encodeURIComponent("../../task.json")}`);
await editCodeWhileTaskStatusIs("awaiting_approval");
```

#### Correct

```typescript
// Browser uses the stable key returned by the list API, and implementation waits
// for an approved state transition.
await fetch(`/api/studio/tasks/${encodeURIComponent(task.key)}?cwd=${encodeURIComponent(cwd)}`);
await ypi_studio_task({ action: "transition", taskId: task.id, to: "implementing", reason: "user approved plan" });
await ypi_studio_subagent({ member: "implementer", taskId: task.id, prompt: "Implement the approved plan." });
```

---

## Scenario: Optional read-only workspace-file panels

### 1. Scope / Trigger

Use this contract when adding a UI panel that reads project-local files through
Next.js API routes, especially when the panel is gated by `pi-web.json` settings.
This is cross-layer work: settings storage → API validation → filesystem reader
→ UI rendering.

### 2. Signatures

- Config API: `GET /api/web-config`, `PUT /api/web-config` with a partial patch
  such as `{ worktree?: unknown; trellis?: unknown }`.
- Feature API list route: `GET /api/<feature>/...?cwd=<absolute-cwd>`.
- Feature API detail route: `GET /api/<feature>/[stableKey]?cwd=<absolute-cwd>`.
- Shared allowed-root helper: `getAllowedRoots()`, `registerAllowedRoot(cwd)`,
  and `isPathAllowed(target, roots)`.

### 3. Contracts

- The feature setting must default to disabled unless the product explicitly
  requires opt-out behavior.
- The UI entry point and the backing API must both respect the setting gate.
- Settings/setup inspection APIs may intentionally bypass the feature enable
  gate when they are needed to inspect or configure the feature itself; document
  that exception in the route and keep normal feature list/detail APIs gated.
- Browser code must not read arbitrary paths directly; components fetch typed
  API responses only.
- API routes must validate `cwd` against shared allowed roots before reading
  project files.
- Detail routes must accept stable keys returned by the list route, not raw
  filesystem paths.
- Filesystem readers own raw JSON/JSONL/Markdown parsing and export typed
  projections for UI consumers.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Feature disabled | 403 JSON error from normal feature APIs; setup/settings inspection APIs may still return read-only status or projections when explicitly documented. |
| Missing `cwd` | 400 JSON error. |
| `cwd` outside allowed roots | 403 JSON error. |
| Missing feature directory | 200 empty-state response, not an exception. |
| Unknown stable key | 404 JSON error. |
| Invalid/path-traversal key | 400 JSON error. |
| Symlink or realpath escapes workspace | Reject with 400/security error. |
| Malformed per-item JSON | Return per-item read error when safe; do not crash the whole list unless security is involved. |

### 5. Good/Base/Bad Cases

- Good: selected workspace was validated through `/api/cwd/validate`, registered
  with `registerAllowedRoot()`, and the panel fetches a typed list/detail API.
- Base: no feature directory exists; the panel renders an explanatory empty
  state.
- Bad: component constructs `../../some/file` paths or casts raw payload fields
  in multiple places.

### 6. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- Config patch preserves unrelated sections and validates booleans/strings.
- Disabled setting blocks APIs and hides the UI entry point.
- Allowed-root registration lets a newly validated workspace read feature data.
- List route isolates malformed task/item JSON without leaking raw paths.
- Detail route rejects invalid keys and symlink escapes.
- Existing file-panel/drawer behavior still works after adding another mode.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Raw path from the browser decides what the server reads.
fetch(`/api/feature/read?path=${encodeURIComponent(userSuppliedPath)}`);
```

#### Correct

```typescript
// Browser uses a cwd plus a stable key that came from the list response.
fetch(`/api/feature/${encodeURIComponent(item.key)}?cwd=${encodeURIComponent(cwd)}`);
```

### Scenario: Session-scoped Trellis task widgets

### 1. Scope / Trigger

Use this contract when adding UI that displays a Trellis task as related to a
specific pi chat session. This is stricter than the normal Trellis task drawer:
the association belongs to the session projection, not to Trellis task metadata.

### 2. Signatures

- Session association route:
  `GET /api/sessions/[id]/trellis-task`.
- Success response:
  `{ task: TrellisTaskSummary, source: "session-transcript" | "session-runtime", confidence: "high" }`.
- No-association response:
  `{ task: null, reason: "no-session" | "trellis-disabled" | "no-workspace" | "no-evidence" | "ambiguous" | "task-not-found" }`.

### 3. Contracts

- Do not write session ids, backlinks, or UI-only association fields into
  `task.json`.
- The browser passes only a pi session id. The server resolves the session file,
  reads the session cwd, validates it with allowed roots, and then reads Trellis
  data through the existing Trellis reader.
- Automatic display is high-confidence only:
  - explicit current-session transcript/tool evidence naming a Trellis task path
    or lifecycle output; or
  - exact per-session runtime pointer keys that are deterministically tied to the
    pi session.
- Ignore workspace-level guesses, process/global runtime fallback pointers, and
  "first active task" heuristics. On ambiguity, hide the widget.
- Do not expose raw `.trellis/.runtime/sessions/*.json` contents to the browser.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Trellis disabled | 403 JSON error; widget hidden. |
| Session id not found | 404 JSON error. |
| Session has no cwd | 200 `{ task: null, reason: "no-workspace" }`. |
| Cwd outside allowed roots | 403 JSON error. |
| No transcript/runtime evidence | 200 `{ task: null, reason: "no-evidence" }`. |
| Multiple candidate tasks | 200 `{ task: null, reason: "ambiguous" }`. |
| Evidence points to missing task | 200 `{ task: null, reason: "task-not-found" }`. |

### 5. Good/Base/Bad Cases

- Good: the current session contains `Active task: .trellis/tasks/06-29-foo`;
  the route returns `active:06-29-foo`, and clicking the widget focuses the
  existing Trellis drawer detail.
- Base: the session has no Trellis evidence; the widget is hidden and the normal
  Trellis drawer still works.
- Bad: the UI selects the first `in_progress` workspace task or mutates
  `task.json` to add a session backlink.

### 6. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- Disabled setting blocks the association route and hides the widget.
- Explicit session transcript task path resolves to the matching task.
- Exact `pi_<sessionId>` / `pi_transcript_<hash(sessionFile)>` runtime pointers
  resolve, but `pi_process_*` does not.
- Ambiguous transcript evidence returns no task.
- Clicking the widget opens the Trellis drawer without losing file tabs.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Workspace-level guess can show the wrong task in multi-session workflows.
const task = tasks.find((item) => item.status === "in_progress") ?? tasks[0];
```

#### Correct

```typescript
// Session-owned projection: no high-confidence session evidence means no widget.
const result = await fetch(`/api/sessions/${sessionId}/trellis-task`);
if (result.task) showWidget(result.task);
```

### Scenario: Subagent panel metadata projections

### 1. Scope / Trigger

Use this contract when displaying subagent execution metadata in the top-bar
Subagents panel or nested-subagent inspection UI. The data may arrive from live
RPC tool events or from stored child-session JSONL parsing.

### 2. Signatures

- Live event owner: `hooks/useAgentSession.ts` projects subagent tool events into
  `SubagentRun`.
- Stored child parser: `parseSubagentChildren(sessionFile)` returns
  `SubagentRun[]` for nested subagents.
- UI consumer: `SubagentPanel({ runs }: { runs: SubagentRun[] })` renders rows
  without reparsing raw tool payloads.
- Metadata fields: `SubagentRun.routing.model` and
  `SubagentRun.routing.thinking`; generic subagent result payloads may expose
  `details.results[].model` even when no `routing` object exists.

### 3. Contracts

- `SubagentRun` is the shared UI projection. Components should format
  `SubagentRun` fields, not cast raw RPC/JSONL payloads.
- Prefer explicit routing metadata when present.
- If only result metadata is present, project known fields into
  `SubagentRun.routing` with a non-user-facing source such as `"result"`.
- Missing model or thinking fields must be hidden or clearly non-misleading;
  do not invent a thinking level from the parent session.
- Preserve full routing details in a tooltip or equivalent compact debugging
  affordance when visible metadata is shortened.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| `routing.model` exists | Show the model outside raw expanded output. |
| `routing.thinking` exists, including `off` | Show the thinking level outside raw expanded output. |
| `details.results[].model` exists without `routing` | Show the model after projecting it into `SubagentRun.routing`. |
| Model/thinking missing | Hide that field; do not show `unknown` unless product explicitly asks for it. |
| Multiple parallel/chain results | Map each row to the matching `details.results[]` index. |

### 5. Good/Base/Bad Cases

- Good: a completed subagent row shows `Model: openai-codex/gpt-5.5`, with the
  row tooltip preserving the routing/result source.
- Base: no model or thinking metadata exists; the row still shows agent, task,
  status, and expansion controls.
- Bad: the component parses `event.result.details.results` directly or displays
  the parent chat thinking level as the child subagent thinking level.

### 6. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- Live subagent completion with `details.results[].model` displays a model chip.
- Rows with no metadata still render and expand normally.
- Tooltip/debug text remains available for shortened metadata.
- Nested child parsing preserves available model/thinking metadata.
- Parallel or chain subagent rows map result metadata by row index.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Component reparses a raw result shape and may diverge from live event logic.
const model = (run as { details?: { results?: { model?: string }[] } }).details?.results?.[0]?.model;
```

#### Correct

```typescript
// Event/parser layers project metadata once; the component only formats it.
const model = run.routing?.model;
```

### Scenario: Editable workspace text-file panels

#### 1. Scope / Trigger

Use this contract when a browser file panel edits and saves existing workspace
files through `app/api/files/[...path]/route.ts` or an equivalent workspace-file
API.

#### 2. Signatures

- Read route: `GET /api/files/[...path]?type=read` returns
  `{ content: string; language: string; size: number; mtimeMs?: number }` for
  editable text files.
- Save route: `PUT /api/files/[...path]` with
  `{ content: string; expectedMtimeMs?: number }`.
- Save success: `{ ok: true; size: number; mtimeMs: number; language: string }`.
- Conflict: `409 { error: string; mtimeMs: number; size: number }`.

#### 3. Contracts

- Save APIs must validate the target path against shared allowed roots before
  reading or writing.
- MVP save flows should write existing regular text files only. Do not create,
  rename, delete, or save preview-only/binary files unless that behavior has its
  own design.
- Browser dirty state must be explicit. A clean external file-change event may
  refresh editor content, but a dirty editor must not be silently overwritten.
- Send the read/save baseline `mtimeMs` as `expectedMtimeMs`; if the disk file
  changed, return a 409 conflict and keep local unsaved edits visible.
- Save failures must not clear dirty state.
- Editor components should emit line-selection ranges through typed callbacks;
  do not scrape DOM nodes from third-party editor internals.

#### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Target outside allowed roots | 403 JSON error. |
| Target missing | 404 JSON error. |
| Target is not a regular file | 400 JSON error. |
| Preview-only/binary target or NUL bytes | 400 JSON error. |
| Content exceeds edit limit | 413 JSON error. |
| `expectedMtimeMs` differs from current stat | 409 conflict; no write. |
| Valid text file and matching baseline | Write UTF-8 content and return fresh metadata. |

#### 5. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- Editing marks the panel dirty and `Cmd/Ctrl+S` saves through the API.
- Save errors remain visible and keep the dirty marker.
- Clean external file changes refresh content and keep the existing diff/source
  path usable.
- Dirty external file changes show a conflict warning and do not replace local
  unsaved content.
- Binary/media/document previews remain routed to their specialized viewers.

### Scenario: Guarded Git mutation routes from status panels

#### 1. Scope / Trigger

Use this contract when adding a Git mutation to a status-oriented panel. This is
cross-layer work: browser control → Next.js API route → local `git` command → UI
refresh.

#### 2. Signatures

- Branch switch route: `POST /api/git/switch`.
- Request: `{ cwd: string; branch: string }`.
- Success response: `{ success: true, branch: string, switchedTo: string }`.
- Error response: `{ error: string }` with an appropriate HTTP status.

#### 3. Contracts

- Keep mutation controls explicit; selecting an option must not mutate the
  workspace until the user clicks a dedicated action button.
- Git commands must use `execFile("git", args)` or an equivalent argv-array API,
  never shell string interpolation.
- Validate `cwd` as a Git repository before running the mutation.
- Validate local branch identity exactly with `show-ref --verify --quiet
  refs/heads/<branch>` or an equivalent exact-ref check; do not use glob/list
  matching for security-sensitive branch existence checks.
- Block dirty working trees before branch switching. Do not stash, force switch,
  discard, or carry changes unless that behavior has its own explicit design.
- On success, refresh the existing status/graph loading path so displayed branch,
  ahead/behind, change lists, graph, and parent dirty indicators all update from
  server state.

#### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Invalid JSON | 400 JSON error. |
| Missing/blank `cwd` | 400 JSON error. |
| Missing/blank `branch` | 400 JSON error. |
| `cwd` is not a Git repository | 400 JSON error. |
| Local branch ref does not exist | 404 JSON error. |
| Working tree has staged, unstaged, or untracked changes | 409 JSON error; do not run `git switch`. |
| Clean worktree and valid local branch | Run `git switch -- <branch>` and return success. |
| Git rejects switch, such as branch checked out in another worktree | 500 JSON error with readable Git stderr/stdout detail. |

#### 5. Good/Base/Bad Cases

- Good: user selects `feature/foo`, clicks Switch, the route verifies
  `refs/heads/feature/foo`, sees a clean tree, switches, and `GitPanel` calls
  `fetchAll()`.
- Base: current branch is selected; the Switch button is disabled with an
  explanatory hint.
- Bad: branch select `onChange` immediately calls `git switch`, or the API checks
  existence with `git branch --list <branch>` and accepts pattern behavior.

#### 6. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- Dirty status disables the UI action and the API returns 409 if called anyway.
- Current-branch selection cannot switch.
- A missing local branch returns a 404-style JSON error.
- A branch already checked out in another worktree surfaces Git's error without
  clearing the current UI state.
- A successful switch refreshes status, graph, change lists, and top-bar dirty
  indicator.
- Non-Git directories keep their existing empty/not-repository state.

#### 7. Wrong vs Correct

##### Wrong

```typescript
// Selection alone mutates the workspace and branch matching can behave like a pattern.
onChange={(event) => fetch("/api/git/switch", { body: JSON.stringify({ branch: event.currentTarget.value }) })}
await git(["branch", "--list", branch], cwd);
```

##### Correct

```typescript
// Explicit action plus exact local-ref validation.
<button onClick={() => void handleSwitchBranch()} disabled={!canSwitchBranch}>Switch</button>
await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
```

### Trellis task-detail display contracts

When rendering the Trellis task drawer, keep these projections explicit:

- `task.json` is the only source for task metadata such as `base_branch`,
  `branch`, `worktree_path`, `commit`, and `pr_url`. The web UI must not infer
  missing historical worktree or merge details from Git logs unless that is a
  separately designed feature.
- `implement.jsonl` / `check.jsonl` counts are real manifest entries only;
  seed rows shaped like `{ "_example": "..." }` count as zero. These manifests
  are context inputs, not execution records.
- If the UI needs to mark a quality check as executed, use an explicit
  `task.json.meta.lastCheck` record such as
  `{ "status": "passed", "at": "<ISO timestamp>", "summary": "..." }`.
  Do not infer execution from `check.jsonl` entries.
- Task child progress comes from `task.json.children`. It is a Trellis task-tree
  count, not a subagent-dispatch count.
- Date-only `YYYY-MM-DD` values should stay date-only in the UI. Only strings
  that contain time information should be rendered with hour/minute/second.

#### Wrong

```typescript
// Makes missing historical metadata look like an error and suggests the UI
// knows the final merge target when it only has a task.json field.
<MetadataLine label="基准分支" value={task.baseBranch ?? "—"} />
<MetadataLine label="Worktree" value={task.worktreePath ?? "—"} />
```

#### Correct

```typescript
// Display recorded values, then explain which optional task.json fields were
// not recorded instead of guessing them.
{task.baseBranch && <MetadataLine label="记录的基准分支" value={task.baseBranch} />}
{missingMetadata.length > 0 && <div>未记录：{missingMetadata.join("、")}</div>}
```

### Scenario: OAuth quota metadata mutations

#### 1. Scope / Trigger

Use this contract when extending OAuth quota data across `lib/`,
`app/api/auth/quota/[provider]/route.ts`, saved account metadata, and quota UI
surfaces. This includes adding read-only quota fields or mutation actions such
as consuming OpenAI Codex reset credits.

#### 2. Signatures

- Quota read route: `GET /api/auth/quota/openai-codex` and
  `GET /api/auth/quota/openai-codex?accountId=<saved-account-id>`.
- Quota mutation route: `POST /api/auth/quota/openai-codex` with optional JSON
  body `{ "accountId": "<saved-account-id>" }`.
- Shared result shape must include defaulted fields for every outcome:
  `success`, `tiers`, `error`, `queriedAt`, `resetCreditsAvailableCount`,
  `resetCredits`, and `resetCreditsError`.
- Saved account cache shape mirrors browser-safe quota metadata only; it must
  never include OAuth tokens or raw credential payloads.

#### 3. Contracts

- Browser code calls only pi-web server routes. It must not call ChatGPT
  backend APIs directly and must not receive access tokens.
- Active-account and saved-account paths must share credential semantics with
  quota refresh: no `accountId` uses the active credential, while non-empty
  `accountId` resolves the saved account credential.
- Metadata-only sub-requests, such as Codex reset-credit lookup, must degrade
  independently from the main quota request when the main quota request
  succeeds.
- Mutation routes must return a user-visible failure when the external consume
  call returns non-2xx, and must refresh quota/cache after successful consume.
- UI actions that spend an external account resource must be confirmed with the
  user and must disable duplicate refresh/reset actions while the mutation is
  in flight.

#### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Missing active OAuth credential | Return a not-found shaped quota result with default metadata fields. |
| Saved `accountId` does not exist | Return a not-found/error shaped quota result; do not mutate account metadata. |
| Main quota `/wham/usage` fails | Return `success: false` with a readable quota `error`. |
| Reset-credit lookup fails after usage succeeds | Return `success: true`, preserve quota tiers, set reset-credit count to fallback/null, empty details, and `resetCreditsError`. |
| Reset-credit payload is malformed | Treat only reset-credit metadata as invalid; do not fail the whole quota response. |
| Consume endpoint returns non-2xx | Return a failed quota result and display the error in the UI. |
| Consume succeeds but refresh fails | Surface a readable warning/error; do not claim a fresh quota cache. |

#### 5. Good/Base/Bad Cases

- Good: `POST /api/auth/quota/openai-codex` consumes one reset credit on the
  server, reuses the same saved-account credential path as GET, refreshes the
  cache, and returns the normalized quota result.
- Base: the reset-credit endpoint is unavailable; quota bars still render and
  reset-credit availability displays as unknown with a non-blocking warning.
- Bad: a component calls `https://chatgpt.com/backend-api/...` directly or hides
  quota tiers because the reset-credit endpoint returned a malformed payload.

#### 6. Tests Required

At minimum, verify these assertion points manually or with focused tests:

- GET active and saved-account quota responses contain reset-credit fields on
  both success and error results.
- Reset-credit lookup failure does not change a successful quota response into a
  failed quota response.
- POST with and without `accountId` uses the expected credential path and returns
  a refreshed quota result after consume.
- Saved account metadata files missing new fields still normalize to safe
  defaults.
- UI reset buttons appear only when the available count is greater than zero,
  ask for confirmation, and disable refresh/reset controls while in flight.

#### 7. Wrong vs Correct

##### Wrong

```typescript
// Browser receives or uses provider tokens and calls the third-party API.
await fetch("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

##### Correct

```typescript
// Browser calls the pi-web route; server-side lib code owns credentials and
// third-party request details.
await fetch("/api/auth/quota/openai-codex", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountId }),
});
```
