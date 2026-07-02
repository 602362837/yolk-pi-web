# handoff

## Implementation Summary

- Implemented active/archived/all YPI Studio task scopes and stable archived keys: `archived:<YYYY-MM>:<task-id>`.
- Added completed-task archive flow: validates `completed`, blocks running member runs, writes archive metadata/event, clears runtime pointers, moves task directory to `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`, and creates `.ypi/knowledge` Markdown + `index.json` entry.
- Added bounded knowledge injection for startup/input/member prompts using relevance + recent fallback from `.ypi/knowledge/index.json`.
- Added `/studio-archive` command and `ypi_studio_task(action="archive")` support.
- Updated Studio Panel task scope filters, completed-task archive action, archived task metadata display, and task open path to use `pathLabel`.
- Updated API/frontend/library/architecture docs.

## Files Changed

- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-extension.ts`
- `app/api/studio/tasks/route.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `app/api/studio/tasks/[taskKey]/subagents/[runId]/transcript/route.ts`
- `components/YpiStudioPanel.tsx`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`

## Verification

- `node_modules/.bin/tsc --noEmit` — passed.
- `npm run lint` — passed.

## Notes / Risks

- `/studio-archive` command path instructs the current session model to generate `knowledgeSummary`/`knowledgeMarkdown` before archiving.
- Studio Panel cannot access the current chat model directly; its archive confirmation explicitly warns and uses the deterministic artifact fallback with a warning in the API result.
- Manual browser/API archive flow was not exercised in a live server during this handoff.
