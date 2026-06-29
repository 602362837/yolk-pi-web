# New WorkTree session — Design

## Architecture Overview

The feature spans frontend UI, a new backend API, shared config loading, Git command execution, session metadata projection, and file API access control.

```
SessionSidebar
  └─ POST /api/git/worktrees
       └─ lib/pi-web-config.ts
       └─ lib/git-worktree.ts
            └─ git rev-parse / worktree add
  └─ setSelectedCwd(newWorktreePath)
  └─ onNewSession(tempId, newWorktreePath)
       └─ existing ChatWindow/useAgentSession draft flow
            └─ POST /api/agent/new on first prompt
```

## Config Contract

Config file:

```text
~/.pi/agent/pi-web.json
```

Shape:

```ts
interface PiWebConfig {
  worktree?: {
    baseRef?: string;
    branchNameTemplate?: string;
    baseDirTemplate?: string;
    pathTemplate?: string;
    sessionDisplay?: "separate" | "tag";
  };
}
```

Default config:

```json
{
  "worktree": {
    "baseRef": "HEAD",
    "branchNameTemplate": "pi/{yyyyMMdd-HHmmss}",
    "baseDirTemplate": "{repoParent}/{repoName}.worktrees",
    "pathTemplate": "{baseDir}/{branchSlug}",
    "sessionDisplay": "separate"
  }
}
```

Template variables:

- `{repoRoot}` absolute Git repo root
- `{repoParent}` parent directory of repo root
- `{repoName}` basename of repo root
- `{baseDir}` resolved base directory
- `{branchName}` generated branch name
- `{branchSlug}` filesystem-safe branch name
- `{yyyyMMdd-HHmmss}` timestamp

Validation/normalization lives in `lib/pi-web-config.ts`; consumers should not parse raw config locally.

## Worktree API Contract

Route:

```text
POST /api/git/worktrees
```

Request:

```ts
{
  cwd: string;
  baseRef?: string;
  branchName?: string;
  targetPath?: string;
}
```

Response on success:

```ts
{
  success: true;
  cwd: string;
  repoRoot: string;
  mainWorktreePath?: string;
  branchName: string;
  baseRef: string;
  targetPath: string;
  isWorktree: true;
}
```

Response on failure:

```ts
{ error: string }
```

## Git Execution

`lib/git-worktree.ts` owns all Git commands using `execFile`:

- `git -C <cwd> rev-parse --show-toplevel`
- `git -C <repoRoot> check-ref-format --branch <branchName>`
- `git -C <repoRoot> worktree list --porcelain` for metadata projection
- `git -C <repoRoot> worktree add -b <branchName> <targetPath> <baseRef>`

No shell concatenation.

## Session Metadata Projection

Extend `SessionInfo` with optional worktree metadata:

```ts
worktree?: {
  isWorktree: true;
  branch?: string;
  repoRoot?: string;
  mainWorktreePath?: string;
}
```

`lib/session-reader.ts` should enrich sessions by detecting whether each session cwd is a Git worktree. To avoid expensive repeated Git calls, compute metadata per unique cwd during `listAllSessions()` and cache short-term if needed.

The frontend should consume the `worktree` projection only; it should not run path heuristics.

## CWD Picker Metadata

The sidebar derives recent cwds from sessions. A cwd can be enriched by looking up the first/newest session with that cwd and reading `session.worktree`. Brand-new worktrees created through the API can be displayed immediately by carrying API response metadata in local state until sessions refresh.

## UI Rendering

- Add `New WorkTree` button next to existing `New`.
- While creating, disable the button and show a brief loading state.
- On error, show inline error near sidebar header/project picker.
- CWD picker rows for worktrees show a compact `WT` badge and branch text.
- Session items for worktree sessions show a compact `WT` badge and branch text.
- Normal sessions remain visually unchanged.

## File API Access Control

After API success, add the new target path to `globalThis.__piAllowedRootsCache?.roots` and initialize the cache if needed, so `/api/files` can list the worktree before a pi session exists.

## Error Handling

Expected user-visible errors:

- selected cwd is missing;
- selected cwd is not inside a Git repository;
- generated or provided branch name is invalid;
- target path already exists;
- Git command fails.

Return HTTP 400 for validation/user input errors and HTTP 500 for unexpected errors.

## Compatibility

- Existing session file format is unchanged.
- Existing session creation and fork behavior is unchanged.
- Config file is optional; absence preserves defaults.
- Existing sessions without worktree metadata render normally.
