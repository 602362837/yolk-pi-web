# Design: Trellis Workflow Visualizer

## Summary

Implement a read-only workflow visualizer launched from Settings → Trellis. The server parses `.trellis/workflow.md` into a structured projection; the client renders it as an inspectable phase/process map with warnings and source traceability.

## UX Shape

### Entry point

In `components/SettingsConfig.tsx`, replace the single official-doc link row with a compact action row:

- `打开 Trellis 官方文档 ↗` — unchanged external link.
- `流程设计` — button/link-styled action that opens the visualizer.

The button should be disabled or show a helpful message when no workspace `cwd` is selected.

### Container

Use a large in-app modal for this release:

- fixed overlay, high z-index, consistent with `SettingsConfig`, `ModelsConfig`, and `SkillsConfig`
- width around `min(1180px, calc(100vw - 48px))`
- height around `min(820px, calc(100vh - 48px))`
- header: title, workspace path, refresh button, close button
- body: left navigation / right details, or top diagram / lower details depending on available width

Rationale: a modal avoids adding route and tab state while still feeling like a full design surface. The component can later be reused by a dedicated route if workflow editing needs deep links or browser tabs.

### Initial read-only layout

Recommended layout:

1. Header summary
   - workflow file path `.trellis/workflow.md`
   - parse status: OK / warnings / missing
   - last modified time if available
2. Main canvas
   - phase cards in order: e.g. `Phase 1: Plan`, `Phase 2: Execute`, `Phase 3: Finish`
   - each phase card lists step headings such as `1.0 Create task`, `1.1 Requirement exploration`
   - arrows between phases for the default linear flow
3. Workflow-state rail
   - status chips: `no_task`, `planning`, `planning-inline`, `in_progress`, `in_progress-inline`, `completed`, custom statuses
   - each chip links to the relevant breadcrumb text details
4. Detail pane
   - selected phase/step/status source excerpt
   - line range
   - warnings affecting that node
5. Warning panel
   - missing default states
   - unmatched/malformed state tags
   - phase headings or step headings that do not match parser-sensitive conventions

No drag handles, save button, or edit controls in this release.

### Assistant reading

The node detail pane also supports read-only assistant reading:

- Settings → Trellis configures a workflow assistant primary model, fallback model, and thinking levels.
- The detail pane keeps `MD 模式` and `原文` display modes for source guidance.
- An `辅助阅读` button sends the selected node's title, kind, source range, and body to the backend.
- The backend returns Chinese translation, a one-sentence summary, key actions, and cautions; if the primary model fails or returns empty content, it retries with the configured fallback model before the Pi default fallback.
- Results are cached in component state by node id during the modal session.
- Assistant reading never writes workflow files and must not suggest direct workflow edits.

## Backend Contract

Add a new route:

```text
GET /api/trellis/workflow?cwd=<workspace>
POST /api/trellis/workflow/assist
```

Behavior:

- does **not** require `config.trellis.enabled`; this is launched from Settings and should work during setup inspection, similar to `trellis/setup/status`
- requires `cwd`
- validates `cwd` with `getAllowedRoots()` and `isPathAllowed()`
- canonicalizes the workspace and only reads `<cwd>/.trellis/workflow.md`
- returns a missing state instead of throwing when `.trellis` or `workflow.md` is absent
- enforces a conservative max read size, e.g. 512 KiB or 1 MiB, and reports `truncated` if needed
- assist requests validate `cwd`, cap node body length, call only the configured workflow assistant model, and return structured Chinese explanation JSON

### Response type

Add types in a new `lib/trellis-workflow-types.ts` or extend `lib/trellis-types.ts` if preferred.

```ts
export interface TrellisWorkflowResponse {
  cwd: string;
  exists: boolean;
  pathLabel: ".trellis/workflow.md";
  modifiedAt?: string;
  truncated: boolean;
  workflow?: TrellisWorkflowProjection;
  warnings: TrellisWorkflowWarning[];
}

export interface TrellisWorkflowProjection {
  title?: string;
  phases: TrellisWorkflowPhase[];
  states: TrellisWorkflowStateBlock[];
  taskCommands: TrellisWorkflowCommand[];
  skillRouting: TrellisWorkflowRoutingItem[];
  rawLineCount: number;
}

export interface TrellisWorkflowPhase {
  id: string;              // stable slug from heading text, e.g. "phase-1"
  title: string;           // full heading text after hashes
  phaseNumber?: string;    // "1", "2", "3", custom if parseable
  lineStart: number;
  lineEnd: number;
  steps: TrellisWorkflowStep[];
  summary?: string;
}

export interface TrellisWorkflowStep {
  id: string;              // e.g. "phase-1-step-1-0"
  stepNumber?: string;     // e.g. "1.0"
  title: string;
  lineStart: number;
  lineEnd: number;
  required?: boolean;
  once?: boolean;
  repeatable?: boolean;
}

export interface TrellisWorkflowStateBlock {
  status: string;
  id: string;              // e.g. "state-planning"
  body: string;
  lineStart: number;
  lineEnd: number;
  relatedPhaseId?: string;
}

export interface TrellisWorkflowWarning {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  lineStart?: number;
  lineEnd?: number;
  nodeId?: string;
}
```

Keep the contract intentionally richer than the first UI needs so later editing can target source ranges safely.

## Parser Design

Create `lib/trellis-workflow-reader.ts`.

Parsing is markdown-structure based, not a full Markdown AST:

1. Split file into lines, preserving 1-based line numbers.
2. Parse state blocks with regex:
   - start: `/^\[workflow-state:([A-Za-z0-9_-]+)\]\s*$/`
   - end must match the same status exactly.
   - collect body and range.
   - warn on unclosed or mismatched blocks.
3. Parse phase headings:
   - `/^##\s+Phase\s+([^\s:]+)\s*:?\s*(.*)$/i`
   - range ends before next `## Phase` or EOF.
4. Parse step headings inside each phase:
   - `/^####\s+([0-9A-Za-z]+(?:[.][0-9A-Za-z]+)*)\s+(.+)$/`
   - detect `[required · once]`, `[required · repeatable]`, etc. from title text.
5. Optionally parse `### Skill Routing` and `### Task System` tables/command blocks as best-effort arrays; if this is too much for the first implementation, return empty arrays and keep the type.
6. Compute warnings:
   - missing default states: `no_task`, `planning`, `in_progress`, `completed`
   - no phases found
   - no steps found under a phase
   - malformed state block
   - truncated file

Do not mutate files. Do not execute Trellis scripts from this reader.

## Frontend Components

Add `components/TrellisWorkflowDesigner.tsx` or `components/TrellisWorkflowVisualizer.tsx`.

Props:

```ts
interface TrellisWorkflowVisualizerProps {
  cwd: string | null;
  onClose: () => void;
}
```

State:

- loading/error/data
- selected node id
- local refresh counter

Rendering helpers:

- `WorkflowPhaseCard`
- `WorkflowStateRail`
- `WorkflowDetailPane`
- `WorkflowWarnings`

Naming recommendation: use `Visualizer` internally now; label the button “流程设计” in the UI to reserve future editing semantics.

## Future Editing Compatibility

This release should intentionally include these foundations:

- stable node ids
- line ranges
- warnings linked to node ids
- clear separation between reader/projection and renderer
- no direct UI dependence on raw Markdown regexes

A later release can add:

- edit mode toggle
- patch-based backend writer that validates ranges before saving
- preview/diff step
- agent prompt seeded with selected node, source range, and warning context

## Documentation Updates

- `docs/modules/api.md`: add `trellis/workflow/` route.
- `docs/modules/frontend.md`: add workflow visualizer component.
- Consider `docs/modules/library.md`: add `trellis-workflow-reader.ts` if created.
