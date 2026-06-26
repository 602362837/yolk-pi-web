# Trellis Panel — Design

## Architecture Overview

Add an optional Trellis drawer by reusing the existing right-side panel shell. The work is split into four boundaries:

1. **Config boundary** — `lib/pi-web-config.ts` owns the persisted `trellis` web setting.
2. **Trellis reader boundary** — a new shared library reads and normalizes `.trellis/tasks` from a selected workspace.
3. **API boundary** — new read-only routes expose normalized task summaries/details to the browser.
4. **UI boundary** — AppShell switches the right drawer between file and Trellis modes; `TrellisPanel` renders list/detail/progress.

```text
SettingsConfig
  └─ GET/PUT /api/web-config
       └─ lib/pi-web-config.ts
            └─ ~/.pi/agent/pi-web.json

AppShell
  ├─ loads web config
  ├─ rightPanelMode: "files" | "trellis"
  ├─ FileViewer mode (existing)
  └─ TrellisPanel mode
       ├─ GET /api/trellis/tasks?cwd=...&includeArchived=...
       └─ GET /api/trellis/tasks/[taskKey]?cwd=...
            └─ lib/trellis-reader.ts
                 └─ <cwd>/.trellis/tasks/**
```

## Repository Integration Points

| Area | Existing file | Planned change |
| --- | --- | --- |
| Main layout | `components/AppShell.tsx` | Add right panel mode, Trellis toggle, config loading. |
| Settings modal | `components/SettingsConfig.tsx` | Add left-nav section state and Trellis settings form. |
| Config storage | `lib/pi-web-config.ts` | Add `PiWebTrellisConfig`, defaults, normalization, validation/write helper. |
| Config API | `app/api/web-config/route.ts` | Accept partial `{ worktree?, trellis? }` updates. |
| Trellis parsing | new `lib/trellis-reader.ts` | Centralize task discovery, artifact reads, progress derivation. |
| Trellis API | new `app/api/trellis/tasks/...` | Read-only list/detail endpoints. |
| Shared types | `lib/types.ts` or new `lib/trellis-types.ts` | Add normalized task summary/detail/progress wire types. |
| Right panel CSS | `app/globals.css` | Reuse current `.right-panel-container`; optionally add mode-toggle group styles. |
| Docs | `docs/modules/{api,frontend,library}.md` | Document new routes/components/library. |

## Config Contract

Extend `PiWebConfig`:

```ts
export interface PiWebTrellisConfig {
  enabled: boolean;
  includeArchived: boolean;
}

export interface PiWebConfig {
  worktree: PiWebWorktreeConfig;
  trellis: PiWebTrellisConfig;
}
```

Defaults:

```ts
const DEFAULT_PI_WEB_CONFIG = {
  worktree: { ...existingDefaults },
  trellis: {
    enabled: false,
    includeArchived: false,
  },
};
```

Write behavior:

- Replace the current `writePiWebWorktreeConfig(worktree)` route-only contract with either:
  - `writePiWebConfigPatch({ worktree?, trellis? })`, or
  - separate `writePiWebWorktreeConfig()` and `writePiWebTrellisConfig()` helpers used by a generalized route.
- Preserve unknown top-level keys and unknown future section keys when possible.
- If the existing JSON is malformed, keep current behavior: GET reports parse error and returns defaults; PUT writes valid JSON.
- Validate `trellis.enabled` and `trellis.includeArchived` as booleans.

## API Contract

All Trellis API routes should read `readPiWebConfig()` first and return 403 when `config.trellis.enabled` is false. The setting is therefore both a UI gate and a server API gate.

### `GET /api/trellis/tasks`

Query:

```ts
{
  cwd: string;                 // required active workspace cwd
  includeArchived?: "true";   // default comes from client config/panel state
}
```

Response:

```ts
interface TrellisTasksResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;           // display label such as .trellis/tasks, not an absolute path
  tasks: TrellisTaskSummary[];
  statusCounts: Record<string, number>;
  archivedCount: number;
  errors: TrellisTaskReadError[];
}
```

### `GET /api/trellis/tasks/[taskKey]`

`taskKey` should be an encoded stable key returned by the list endpoint, not a raw path. Recommended shapes:

- active task: `active:<dirName>`
- archived task: `archive:<YYYY-MM>:<dirName>`

Query:

```ts
{
  cwd: string;
}
```

Response:

```ts
interface TrellisTaskDetailResponse {
  task: TrellisTaskDetail;
}
```

### Error Handling

| Case | Status | Body |
| --- | --- | --- |
| Trellis disabled in web config | 403 | `{ error: "Trellis panel is disabled" }` |
| Missing cwd | 400 | `{ error: "Missing cwd parameter" }` |
| cwd outside allowed/validated roots | 403 | `{ error: "Access denied" }` |
| No `.trellis/tasks` | 200 | `{ exists: false, tasks: [] }` |
| Unknown task key | 404 | `{ error: "Task not found" }` |
| Invalid task key/path traversal | 400 | `{ error: "Invalid task key" }` |
| Unexpected filesystem error | 500 | `{ error: string }` |

## Shared Type Model

```ts
export type TrellisTaskStatus =
  | "planning"
  | "in_progress"
  | "review"
  | "completed"
  | "done"
  | "unknown"
  | string;

export interface TrellisTaskSummary {
  key: string;
  dirName: string;
  archiveMonth?: string;
  isArchived: boolean;
  id: string;
  name: string;
  title: string;
  description?: string;
  status: TrellisTaskStatus;
  priority?: string;
  assignee?: string;
  creator?: string;
  createdAt?: string;
  completedAt?: string | null;
  branch?: string | null;
  baseBranch?: string | null;
  worktreePath?: string | null;
  commit?: string | null;
  prUrl?: string | null;
  parent?: string | null;
  children: string[];
  subtasks: string[];
  childProgress: {
    total: number;
    completed: number;
  };
  progress: TrellisTaskProgress;
  hasArtifacts: {
    prd: boolean;
    design: boolean;
    implement: boolean;
    implementContext: boolean;
    checkContext: boolean;
  };
  readError?: string;
}

export interface TrellisTaskProgress {
  phase: "plan" | "execute" | "check" | "finish";
  label: string;
  percent: number;
  stages: TrellisTaskProgressStage[];
}

export interface TrellisTaskProgressStage {
  id: "plan" | "execute" | "check" | "finish";
  label: string;
  status: "done" | "active" | "pending";
  details: string[];
}

export interface TrellisTaskDetail extends TrellisTaskSummary {
  pathLabel: string;           // repo-relative display path only
  relatedFiles: string[];
  notes?: string;
  meta: Record<string, unknown>;
  documents: {
    prd?: TrellisDocument;
    design?: TrellisDocument;
    implement?: TrellisDocument;
  };
  manifests: {
    implementCount: number;
    checkCount: number;
  };
}

export interface TrellisDocument {
  fileName: "prd.md" | "design.md" | "implement.md";
  content: string;
  truncated: boolean;
}
```

## Progress Derivation

Progress is a conservative visualization, not a runtime guarantee.

### Stage rules

| Stage | Done when | Active when |
| --- | --- | --- |
| Plan | PRD exists and either task is beyond planning or `design.md`/`implement.md` exists | `status=planning` |
| Execute | `status` is `review`, `completed`, `done`, archived, or finish metadata exists | `status=in_progress` |
| Check | `status` is `completed`/`done`, archived, or `check.jsonl` has real entries plus later metadata | `status=review` |
| Finish | `completedAt`, `commit`, `pr_url`, archived, or completed/done status | completed/done/archive state |

### Percent rule

Use stage count, not exact work units:

```ts
percent = Math.round((doneStages + activeStagePartial) / 4 * 100)
```

Suggested partials:

- active planning: 12–25 depending on artifacts present;
- active execute: 50;
- active check: 75;
- finish: 100.

The UI should display the label/stages more prominently than the number.

### Child progress

Use Trellis' existing semantics where archived/missing children count as completed, but the web reader can improve this by scanning active and archived tasks:

```text
completed child = child.status in completed/done OR child is archived
```

## Filesystem Reader Design

`lib/trellis-reader.ts` should own all task file parsing.

Responsibilities:

- Resolve `trellisRoot = path.join(cwd, ".trellis")` and `tasksRoot = path.join(trellisRoot, "tasks")`.
- Scan active task directories under `tasksRoot`, skipping `archive`.
- Optionally scan archived task directories under `tasksRoot/archive/<YYYY-MM>/`.
- Read `task.json` as unknown, validate only the fields needed for display, and preserve raw metadata in normalized form.
- Map known `task.json` fields explicitly:

| `task.json` field | Wire field | Notes |
| --- | --- | --- |
| `id` | `id` | fallback to `name`/`dirName` if missing |
| `name` | `name` | fallback to `id`/`dirName` |
| `title` | `title` | fallback to `name`/`dirName` |
| `description` | `description` | optional summary text |
| `status` | `status` | string; unknown values preserved |
| `priority` | `priority` | optional display chip |
| `creator` / `assignee` | `creator` / `assignee` | optional display metadata |
| `createdAt` / `completedAt` | `createdAt` / `completedAt` | pass through as strings/null |
| `branch` | `branch` | optional Git branch |
| `base_branch` | `baseBranch` | camel-case wire mapping |
| `worktree_path` | `worktreePath` | optional; display only |
| `commit` | `commit` | optional finish metadata |
| `pr_url` | `prUrl` | optional finish metadata |
| `parent` / `children` | `parent` / `children` | hierarchy and child progress |
| `subtasks` | `subtasks` or detail metadata | optional string checklist; not status-aware |
| `relatedFiles` | `relatedFiles` | optional file links |
| `notes` | `notes` | optional freeform text |
| `meta` | `meta` | unknown structured metadata |

- Read artifact docs with size caps, e.g. 256 KB per markdown file.
- Count real JSONL manifest entries, ignoring rows that only contain `_example`.
- Return partial results and per-task read errors rather than failing the whole list.
- Sort active tasks by priority/status/createdAt or modified time; archived tasks after active tasks.

Security:

- The API route validates `cwd` before calling the reader.
- The detail route resolves a task key by scanning known tasks, not by joining arbitrary path segments.
- Use `realpath`/`lstat` checks for task directories and artifact files; reject symlinks or any resolved path outside the canonical workspace root.
- Details expose repo-relative path labels, not necessary absolute filesystem paths.

## Workspace Root Validation

Existing file APIs duplicate an allowed-root cache. This feature should avoid adding a third copy and should also handle custom paths accepted by `/api/cwd/validate`.

Recommended extraction:

```text
lib/allowed-roots.ts
  ├─ getAllowedRoots(): Promise<Set<string>>
  ├─ registerAllowedRoot(cwd: string): void
  └─ isPathAllowed(target: string, roots: Set<string>): boolean
```

`/api/cwd/validate` should register the canonical cwd after successful validation so a user-selected custom workspace can immediately use file/Trellis APIs before a session exists there. Trellis API routes then consume the shared helper. A later cleanup can migrate `app/api/files/search/route.ts` and `app/api/files/[...path]/route.ts` to the shared helper, or the Trellis task can include that extraction if scope allows.

## UI Design

### AppShell right panel modes

Current state:

```ts
const [fileTabs, setFileTabs] = useState<Tab[]>([]);
const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
const [rightPanelOpen, setRightPanelOpen] = useState(false);
```

Recommended state:

```ts
const [rightPanelOpen, setRightPanelOpen] = useState(false);
const [rightPanelMode, setRightPanelMode] = useState<"files" | "trellis">("files");
```

Behavior:

- `handleOpenFile()` sets `rightPanelMode("files")` and opens the drawer.
- Files toggle behavior:
  - if drawer is closed, set mode to `files` and open;
  - if drawer is open in `trellis`, switch to `files` without closing;
  - if drawer is open in `files`, close.
- Trellis toggle behavior:
  - if drawer is closed, set mode to `trellis` and open;
  - if drawer is open in `files`, switch to `trellis` without closing;
  - if drawer is open in `trellis`, close.
- Closing the drawer preserves `rightPanelMode` and file tabs.
- If Trellis is disabled while the drawer is open in Trellis mode, switch back to files mode or close if no files are open.

### Toggle placement

Preferred layout: a small fixed top-right rail with mode buttons.

```text
┌──────────────────── top bar ────────────────────┬──┐
│ chat/session controls                            │▣ │  Files toggle
│                                                  ├──┤
│                                                  │T │  Trellis toggle (only if enabled)
└──────────────────────────────────────────────────┴──┘
```

This avoids crowding the existing top bar and keeps the file drawer affordance familiar.

### Drawer header

Files mode keeps the existing `TabBar`.

Trellis mode header:

```text
┌─ Trellis ─────────────── workspace-name ───── [Archived □] [Refresh ↻] ┐
```

### Trellis panel layout

Desktop/master-detail:

```text
┌──────────────────────── Right Drawer: Trellis ───────────────────────┐
│ Search tasks...                         Status ▾  Archived □  ↻     │
├───────────────────────┬──────────────────────────────────────────────┤
│ Task List             │ Task Detail                                  │
│                       │                                              │
│ ● in_progress (1)     │ Trellis 面板设计                 P2 planning │
│   ▸ Panel design      │ .trellis/tasks/06-26-trellis-panel-design    │
│     P2 · zyj · 1/3    │                                              │
│                       │ Progress                                     │
│ ○ planning (2)        │ [● Plan]──[○ Execute]──[○ Check]──[○ Finish] │
│   ...                 │ Plan active · PRD ready · design draft open  │
│                       │                                              │
│ ✓ completed (4)       │ Tabs: Overview | PRD | Design | Implement    │
│   ...                 │                                              │
│                       │ Overview cards: Assignee, branch, dates,     │
│                       │ child progress, related files, manifest nums │
└───────────────────────┴──────────────────────────────────────────────┘
```

Narrow/mobile layout stacks list above detail:

```text
┌ Trellis ────────────────┐
│ Search / filters        │
│ Task cards              │
├─────────────────────────┤
│ Selected task detail    │
└─────────────────────────┘
```

## Prototype Artifact

A low-fidelity SVG prototype is stored at:

```text
.trellis/tasks/06-26-trellis-panel-design/prototype.svg
```

It illustrates:

- Settings modal with WorkTree/Trellis sections and enable toggle.
- Top-right drawer mode buttons.
- Trellis drawer with task list, task detail, and phase timeline.

## Component Breakdown

```text
components/TrellisPanel.tsx
  ├─ fetches task list for cwd + includeArchived
  ├─ tracks selected task key
  ├─ fetches selected detail
  ├─ renders loading/empty/error states
  ├─ TrellisTaskList
  ├─ TrellisTaskDetail
  ├─ TrellisProgressTimeline
  └─ TrellisArtifactTabs
```

Suggested props:

```ts
interface TrellisPanelProps {
  cwd: string | null;
  includeArchivedDefault: boolean;
  onOpenFile?: (filePath: string, fileName: string) => void;
}
```

`onOpenFile` is optional for MVP. If implemented, only open related files that resolve under `cwd`.

## Settings UI Design

Turn the current single-section Settings sidebar into a real section switcher:

```text
Settings
├─ WorkTree
└─ Trellis
```

Trellis section fields:

- Enable Trellis panel.
- Include archived tasks by default.
- Read-only explanation: “Shows task files from the selected workspace's `.trellis/tasks` directory.”

Settings footer remains shared: Reset to defaults, Cancel, Save.

Implementation note: dirty state must compare both `worktree` and `trellis`, not only worktree.

## Refresh Strategy

MVP:

- Fetch settings on AppShell mount and after Settings closes.
- Fetch tasks when:
  - Trellis panel opens;
  - active cwd changes;
  - include archived toggle changes;
  - user clicks refresh.
- Optionally poll every 10 seconds while Trellis drawer is open. If added, abort/cleanup on close/unmount.

Future:

- SSE or `fs.watch` endpoint for live task updates.
- Browser notification/badge for task status changes.

## Compatibility

- No changes to pi session JSONL format.
- No changes to WorkTree creation behavior.
- Missing `pi-web.json` uses defaults with Trellis disabled.
- Missing `.trellis` in a workspace is a normal empty state, not an error.
- Archived tasks are opt-in to keep initial list fast.

## Trade-offs

- **One shared right drawer with modes** is preferred over a second drawer because it preserves screen space and reuses current responsive behavior. The cost is a small AppShell state refactor.
- **Read-only MVP** is preferred over task actions because Trellis writes have workflow/session semantics that are risky to guess from a web UI.
- **Stage timeline** is preferred over exact percent because Trellis task files do not contain canonical runtime percent.
- **Dedicated Trellis API** is preferred over exposing file APIs because it centralizes normalization and prevents path traversal.

## Future Extensions

- Create task from UI.
- Start/finish/archive actions with explicit confirmation and session limitations.
- Inline editing of PRD/design/implement artifacts.
- Link selected chat session to the Trellis task that created it.
- Show recent journal entries or subagent/check outputs for a task.
- Badges in the left session sidebar when a workspace has active Trellis tasks.
