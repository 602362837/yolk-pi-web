# Visualize Trellis workflow in settings

## Goal

Add a read-only Trellis workflow visualization entry from Settings → Trellis so users can inspect the current workspace's `.trellis/workflow.md` as an understandable process map.

## User Value

Users can understand how the active Trellis workflow behaves without opening markdown files manually. This creates the foundation for a later workflow editor and agent-assisted customization, while keeping this release safe and read-only.

## Confirmed Facts

- The Settings modal already has a Trellis section in `components/SettingsConfig.tsx` with an official docs link.
- Current Trellis UI reads workspace data through server APIs under `app/api/trellis/**` and shared readers under `lib/trellis-reader.ts`.
- Existing Trellis task visualization is read-only and uses inline-styled React components plus shared types in `lib/trellis-types.ts`.
- Trellis workflow customization docs define `.trellis/workflow.md` as the primary source for phases, skill routing, task commands, and `[workflow-state:STATUS]` breadcrumbs.
- Parser-sensitive conventions include `[workflow-state:STATUS]...[/workflow-state:STATUS]`, `## Phase X`, and `#### X.Y` headings.
- This release must not let users edit/save workflows or invoke an agent to rewrite workflows.

## Requirements

1. Add a “流程设计” entry next to the Trellis official docs link in Settings → Trellis.
2. Opening the entry should show a large workflow visualization surface. Prefer an in-app large modal for phase-1 delivery so it can reuse current workspace state and styling without introducing a route/tab lifecycle.
3. The visualization must read the current workspace's `.trellis/workflow.md` through a safe backend API.
4. The visualization must be read-only in this release.
5. The UI must show the current workflow structure:
   - phase index / phase summary when parseable
   - phases and ordered steps
   - workflow-state blocks with status names and breadcrumb text
   - basic parser/health warnings for missing workflow file, missing default state blocks, malformed state tags, or missing expected heading shapes
6. The data contract should preserve stable node ids and source line ranges to support later editing and agent-assisted customization.
7. The feature must respect existing workspace access controls and path safety patterns.
8. If the workspace has no initialized Trellis or no `workflow.md`, the UI should show an actionable empty/error state rather than failing silently.
9. Add a Settings → Trellis configuration item for an assistant model used by workflow-reading assistance.
10. In the workflow visualizer node detail area, add an assistant-reading action that translates the selected node guidance into Chinese and produces a concise summary.

## Non-Goals / Out of Scope

- Editing `.trellis/workflow.md`.
- Saving customized workflows.
- Drag-and-drop process editing.
- Agent-assisted workflow authoring or editing.
- Running Trellis lifecycle commands from the visualizer.
- Introducing a third-party graph library unless explicitly approved later.

## Acceptance Criteria

- [ ] Settings → Trellis shows “流程设计” next to “打开 Trellis 官方文档 ↗”.
- [ ] Clicking “流程设计” opens a large read-only visualizer for the selected workspace.
- [ ] The visualizer loads `.trellis/workflow.md` through a new or extended Trellis API using existing allowed-root validation.
- [ ] The visualizer shows phases, steps, and workflow-state blocks from the current file.
- [ ] The visualizer has clear loading, missing-workflow, parse-warning, and API-error states.
- [ ] The parser returns source line ranges for phases, steps, and state blocks.
- [ ] No UI control writes workflow changes in this release.
- [ ] Settings → Trellis includes an assistant model configuration for workflow-reading assistance.
- [ ] Node guidance details include an assistant-reading button that returns Chinese translation plus summary without mutating workflow.md.
- [ ] Documentation module maps are updated for any new API route or major component.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass after implementation.

## Decisions

- Use an in-app large modal for the first release. This preserves Settings context, avoids route plumbing, and remains compatible with extracting the component into a dedicated route later.
