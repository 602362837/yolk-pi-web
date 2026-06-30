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
