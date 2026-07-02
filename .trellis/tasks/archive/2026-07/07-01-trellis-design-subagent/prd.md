# Add Trellis Design Subagent

## Goal

Introduce a Pi Trellis design subagent so complex planning can delegate technical design and implementation-plan authoring out of the main session.

## Scope

Implement the MVP only:

1. Add `.pi/agents/trellis-design.md` defining a technical design planner subagent.
2. Update `.trellis/workflow.md` so complex planning stabilizes `prd.md`, then dispatches `trellis-design` for `design.md` and `implement.md` before implementation review/start.
3. Update `.pi/prompts/trellis-continue.md` so planning resume routes complex tasks missing design artifacts to `trellis-design`.
4. Add `trellis-design` to the Trellis subagent model-routing defaults and Settings UI per-agent override list.

## Out of Scope

- No `~/.pi/agent/pi-web.json` user-file mutation.
- No `design.jsonl` support.
- No `.pi/extensions/trellis/index.ts` changes.
- No `.trellis/scripts/*` changes.
- No new Trellis task status.

## Acceptance Criteria

- `.pi/agents/trellis-design.md` exists and clearly states read order, outputs, write boundaries, and forbidden operations.
- `.trellis/workflow.md` mentions `trellis-design` in Phase 1 planning guidance and workflow-state planning hints.
- `.pi/prompts/trellis-continue.md` routes planning tasks with `prd.md` but missing complex design artifacts to dispatch `trellis-design`.
- The new flow keeps main-session user approval before `task.py start`.
- Trellis subagent model settings expose `trellis-design` alongside implement/check/research defaults.
