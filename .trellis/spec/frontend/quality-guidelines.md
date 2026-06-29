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
| Feature disabled | 403 JSON error from feature APIs; no UI entry point. |
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
