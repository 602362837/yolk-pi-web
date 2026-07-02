# Implement — YPI Studio workflow tasks

## Implementation checklist

1. Extend shared types in `lib/ypi-studio-types.ts` for workflows, tasks, events, task summaries/details, API request/response payloads, and extension/tool concepts.
2. Add `lib/ypi-studio-workflows.ts`:
   - default workflow JSON templates
   - workflow initialization/backfill
   - workflow list/read helpers with safe workspace paths
   - workflow state/transition helpers
3. Add `lib/ypi-studio-tasks.ts`:
   - task creation with `task.json`, `events.jsonl`, and placeholder artifacts
   - task list/detail projections
   - runtime session pointer read/write under `.ypi/.runtime/sessions`
   - transition validation and event appending
   - subagent summary updates
4. Add API routes:
   - `app/api/studio/workflows/route.ts`
   - `app/api/studio/tasks/route.ts`
   - `app/api/studio/tasks/[taskKey]/route.ts`
5. Add built-in extension factory `lib/ypi-studio-extension.ts` and load it from `lib/rpc-manager.ts`:
   - workflow-state injection in `input` and `before_agent_start`
   - `YPI_STUDIO_CONTEXT_ID` bash injection
   - `ypi_studio_task` and `ypi_studio_subagent` tools
6. Add minimal Studio panel flow/task affordances only if time permits; otherwise preserve existing members UI and rely on API/contracts.
7. Update docs:
   - `docs/modules/api.md`
   - `docs/modules/library.md`
   - `docs/modules/frontend.md` if UI text changes
   - `AGENTS.md` only if the top-level navigation changes materially
9. Validate:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Important files to inspect while implementing

- Existing Studio members:
  - `lib/ypi-studio-agents.ts`
  - `lib/ypi-studio-types.ts`
  - `app/api/studio/agents/route.ts`
  - `components/YpiStudioPanel.tsx`
- Trellis reference implementation:
  - `.pi/extensions/trellis/index.ts`
  - `lib/trellis-reader.ts`
  - `lib/trellis-types.ts`
  - `lib/trellis-chat-context.ts`
  - `app/api/trellis/tasks/route.ts`
- Shared safety helpers:
  - `lib/allowed-roots.ts`
  - `lib/cwd.ts`

## Validation notes

- Do not run `next build` directly.
- If subagent child execution cannot be fully exercised in this environment, verify type-safety and ensure tool output reports child-process errors clearly.
- If `npm run lint`/`tsc` finds unrelated pre-existing issues, report them separately from changed-file issues.

## Rollback points

- `lib/rpc-manager.ts` can remove `ypiStudioExtension` from the `DefaultResourceLoader` extension factory list to disable automatic interception without deleting persisted `.ypi` data.
- API/helper changes are additive and should not affect existing Studio agents unless imports are broken.
- Default workflow initialization must not overwrite user files, so rollback does not require restoring user-authored `.ypi/workflows` files.
