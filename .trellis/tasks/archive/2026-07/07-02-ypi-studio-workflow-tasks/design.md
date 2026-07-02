# Design — YPI Studio workflow tasks

## Summary

Add a YPI Studio task/workflow layer parallel to the existing Studio member reader. Workflows and tasks live under `.ypi/`, are structured JSON for future UI projections, and are managed by reusable `lib/` helpers, Next.js read APIs, and a built-in Pi extension factory that injects Studio state and exposes task/subagent tools for every web-created AgentSession.

## Architecture

### Persistent layout

```text
.ypi/
  agents/                         # existing member markdown definitions
  workflows/                      # structured workflow JSON definitions
    feature-dev.json
    bugfix.json
    ui-change.json
    review-only.json
  tasks/
    <task-id>/
      task.json                   # canonical task/progress state
      events.jsonl                # append-only task event stream
      brief.md
      prd.md
      ui.md
      design.md
      implement.md
      checks.md
      handoff.md
      review.md
      summary.md
  .runtime/sessions/<context>.json # chat-session active-task pointer
```

### Shared library modules

- `lib/ypi-studio-types.ts` grows workflow/task wire types.
- `lib/ypi-studio-workflows.ts` owns default workflow templates, non-overwriting initialization/backfill, workflow reading, and stable workflow keys.
- `lib/ypi-studio-tasks.ts` owns task id generation, task creation, current-session runtime binding, list/detail projections, transition validation, event appending, and safe filesystem handling.
- `lib/ypi-studio-agents.ts` continues to own member files and should call workflow initialization only when explicitly extended by API/UI; existing agent behavior remains compatible.

### API routes

- `GET/POST /api/studio/workflows`
  - GET lists workflows for an authorized cwd.
  - POST initializes/backfills default workflows without overwriting existing files.
- `GET/POST /api/studio/tasks`
  - GET lists Studio task summaries for an authorized cwd.
  - POST creates a Studio task for an authorized cwd.
- `GET/PATCH /api/studio/tasks/[taskKey]`
  - GET returns a task detail projection.
  - PATCH transitions or updates task metadata/artifacts for future UI use.

All routes validate `cwd` through `getAllowedRoots()`, `canonicalizeCwd()`, and `isPathAllowed()`, matching the existing Studio agents API.

### Pi extension

Add a built-in extension factory in `lib/ypi-studio-extension.ts` and load it from `lib/rpc-manager.ts` through `DefaultResourceLoader.extensionFactories`, following the same event pattern as the Trellis project extension while making the behavior available to every web-created AgentSession:

- `input` hook injects compact `<ypi-studio-state>` into every non-empty user prompt.
- `before_agent_start` injects stronger orchestrator system guidance.
- `tool_call` prepends `YPI_STUDIO_CONTEXT_ID` to bash commands so scripts/tools can resolve the session pointer.
- `ypi_studio_task` custom tool manages workflows/tasks.
- `ypi_studio_subagent` custom tool dispatches a member definition in a child Pi process and records the result.

## Workflow and state contracts

Default states:

```text
intake -> planning -> awaiting_approval -> implementing -> checking -> ready -> completed
checking -> changes_requested -> implementing
changes_requested -> planning
(any) -> blocked / cancelled
completed -> archived
```

Guardrails:

- With no active task, the injected state asks the main session to classify non-trivial work and ask before creating a Studio task.
- `awaiting_approval -> implementing` requires user approval unless a tool call explicitly uses an override with a reason.
- Role work should be delegated through `ypi_studio_subagent` rather than performed by the main session.
- Subagent child prompts include member definition, workflow JSON, task JSON, existing artifacts, and the delegated task.

## Data flow

### Natural-language entry

```text
User prompt
  -> extension input transform appends <ypi-studio-state>
  -> main agent sees no active task + trigger guidance
  -> main agent asks for / gets approval
  -> ypi_studio_task(action=create)
  -> runtime pointer .ypi/.runtime/sessions/<context>.json
```

### Role delegation

```text
main agent
  -> ypi_studio_subagent(member=architect|ui-designer|implementer|checker)
  -> extension builds child prompt from .ypi/agents, workflow, task, artifacts
  -> child Pi process runs with YPI_STUDIO_SUBAGENT_CHILD=1
  -> extension appends events.jsonl and updates task.subagents summary
```

### UI/API projection

```text
Browser Studio panel / future task list
  -> /api/studio/workflows or /api/studio/tasks
  -> lib readers validate paths and parse JSON
  -> typed summaries/details returned to UI
```

## Compatibility and migration

- Existing `.ypi/agents` files are not overwritten.
- Workflow initialization is additive and uses `wx`/existence checks.
- Missing `.ypi/workflows` or `.ypi/tasks` is an empty state for readers.
- Malformed workflow/task JSON is returned as per-item read errors where possible instead of crashing list routes.
- The extension avoids registering itself inside child subagent processes via `YPI_STUDIO_SUBAGENT_CHILD=1`.

## Risks and mitigations

- **Extension TypeScript is included by `tsc`**: use local structural types and avoid importing runtime types that may drift.
- **Large scope**: keep UI minimal in MVP; focus on structured data/tools/API.
- **Subagent process invocation may vary by install path**: reuse a Trellis-style Pi CLI resolver with safe fallback to `pi`.
- **Concurrent task writes**: use synchronous bounded file writes and append-only events for MVP; do not attempt parallel writer workflows.
- **State transition correctness**: validate transitions against workflow JSON by default and require an override reason for exceptional moves.
