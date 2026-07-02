# YPI Studio workflow tasks

## Goal

Add a structured YPI Studio workflow/task foundation so project-local Studio members can be orchestrated from chat as subagents, tracked as tasks with state/progress, and surfaced later in the Studio UI task list.

## Background and Confirmed Facts

- The current Studio member panel reads and initializes `.ypi/agents/*.md` through `components/YpiStudioPanel.tsx`, `app/api/studio/agents/route.ts`, `lib/ypi-studio-agents.ts`, and `lib/ypi-studio-types.ts`.
- Default Studio members are `architect`, `ui-designer`, `implementer`, and `checker`.
- Chat already supports slash command prompt templates from `.pi/prompts/` and structured Trellis task context insertion through `lib/trellis-chat-context.ts` and `ChatInput.addTrellisTaskContext()`.
- Trellis achieves implicit workflow routing through a project Pi extension that injects workflow-state context via `input` and `before_agent_start`, and it delegates role work through a subagent tool.
- The user explicitly requires task concepts, a state machine, structured workflows, progress tracking, and role assignment through subagents.

## Requirements

### R1 — Structured workflow definitions

Provide project-local structured Studio workflow definitions under `.ypi/workflows/` with default workflows for feature development, bug fixes, UI changes, and review-only work. Each workflow must include states, transitions, triggers, owners, artifact requirements, and progress percentages.

### R2 — Studio task model and persistence

Provide a Studio task format under `.ypi/tasks/<task-id>/` with `task.json`, `events.jsonl`, and markdown artifact slots. The task must track workflow id, status, progress, current member, timestamps, associated session context ids, artifacts, and subagent run summaries.

### R3 — Runtime session binding

Provide a Studio runtime session pointer under `.ypi/.runtime/sessions/<context-id>.json` so a chat session can be associated with the active Studio task independently from Trellis.

### R4 — Pi extension workflow interception

Add a built-in Pi extension factory for web-created AgentSessions that injects Studio workflow state into user prompts/system prompt so natural language requests such as “用工作室做”, “走工作室流程”, or “让架构师先设计” can enter the Studio workflow without a slash command. With no active Studio task, the injected state must tell the main session to classify non-trivial work and ask before creating a task. With an active task, it must tell the main session the current state, required artifacts, next owner, and guardrails.

### R5 — Studio extension tools

Register extension tools for Studio task management and subagent delegation:

- `ypi_studio_task` to initialize workflows, create tasks, read current task state, transition statuses, append events, and update artifacts/subagent summaries.
- `ypi_studio_subagent` to dispatch a Studio member as a subagent-like child process using that member definition and the active task/workflow context.

### R6 — Subagent-based role assignment

The main session must be guided to use `ypi_studio_subagent` when assigning architect, UI designer, implementer, or checker work. The implementation must not rely on the main session pretending to be a member for implementation/check phases.

### R7 — Read APIs for future UI task list

Add read-oriented API routes/types/helpers for listing Studio workflows and tasks so the existing Studio panel can later show task lists and progress. MVP UI changes may be minimal, but the data contracts must be structured enough for task list/progress rendering.

### R8 — Existing member behavior compatibility

Do not break existing `.ypi/agents/` initialization, backfill, reading, preview, or file-open behavior. Workflow/task initialization must not overwrite user-authored files.

### R9 — Commands, initialization, and task-list UI

Expose Studio commands for initialization/start/continue/check flows, make initialization cover both default members and default workflows, and show workflows/tasks with progress in the Studio panel.

## Acceptance Criteria

- [x] Default `.ypi/workflows/*.json` files can be initialized/backfilled without overwriting existing workflow files.
- [x] `ypi_studio_task` can create a task directory with valid `task.json`, `events.jsonl`, and markdown artifact placeholders.
- [x] `ypi_studio_task` can report current task state based on `YPI_STUDIO_CONTEXT_ID` or the Pi session context.
- [x] `ypi_studio_task` can transition a task only along workflow-defined transitions unless a safe documented override is used.
- [x] `ypi_studio_subagent` can run a default Studio member using `.ypi/agents/<member>.md` plus active task/workflow context and record a subagent event/summary.
- [x] The Studio extension injects workflow-state guidance on each user turn and stronger system prompt guidance before agent start.
- [x] New API routes expose workflows/tasks as structured JSON for authorized cwd paths.
- [x] Existing `GET/POST /api/studio/agents` behavior remains compatible.
- [x] Documentation module maps are updated for new APIs/libs/UI behavior.
- [x] Studio commands exist for init/start/continue/check flows.
- [x] Studio panel exposes Members, Workflows, and Tasks tabs with initialization and task progress display.
- [x] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass or any failures are reported with concrete blockers.

## Out of Scope

- Full visual task list UI with filtering, task detail drawer, or progress timeline beyond minimal hooks/contracts.
- Git commit/push automation.
- Perfect parity with Trellis task scripts or Trellis archive/journal behavior.
- Multi-writer parallel implementation; Studio role work should remain orchestrated by the main session.
