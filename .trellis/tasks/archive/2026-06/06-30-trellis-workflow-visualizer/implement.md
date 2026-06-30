# Implementation Plan: Trellis Workflow Visualizer

## Ordered Checklist

1. Add shared workflow types
   - create `lib/trellis-workflow-types.ts` or extend `lib/trellis-types.ts`
   - include response, projection, phase, step, state block, warning types

2. Add server-side workflow reader
   - create `lib/trellis-workflow-reader.ts`
   - safely read `<cwd>/.trellis/workflow.md`
   - parse workflow-state blocks, phases, steps, warnings, and source line ranges
   - return missing-workflow response without throwing

3. Add API route
   - create `app/api/trellis/workflow/route.ts`
   - validate `cwd`
   - check allowed roots
   - call the workflow reader
   - return JSON errors consistently with existing Trellis routes

4. Add visualizer component
   - create `components/TrellisWorkflowVisualizer.tsx`
   - implement modal shell, loading/error/empty states
   - render phase cards, state rail, warning panel, and detail pane
   - keep all controls read-only except refresh/close

5. Wire Settings → Trellis entry
   - in `components/SettingsConfig.tsx`, add state for opening the visualizer
   - place “流程设计” next to the official docs link
   - pass current `cwd` into the visualizer

6. Update docs
   - `docs/modules/api.md`: document `trellis/workflow/` GET route
   - `docs/modules/frontend.md`: document visualizer component
   - `docs/modules/library.md`: document workflow reader/types if new module is added

7. Validate
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Risky Files / Rollback Points

- `components/SettingsConfig.tsx`: large file; keep edits minimal and localized around Trellis section state/rendering.
- New parser: avoid overfitting to this repository's workflow; treat unknown/custom headings as warnings rather than fatal errors.
- API route: do not require `trellis.enabled`, otherwise Settings users may be unable to inspect workflow before enabling the panel.

## Review Gates Before Implementation

- Confirm modal vs new tab/route. Recommended: modal for this release.
- Confirm whether best-effort parsing of Skill Routing / Task System is required in v1. Recommended: not required for the first visual surface; type placeholders can remain for future.
