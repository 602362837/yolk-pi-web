# Design: Trellis task join chat

## Overview

Add a UI bridge from the read-only Trellis task drawer to chat composition. The bridge does not mutate Trellis state and does not send a message automatically. It inserts a compact non-editable Trellis task context block into the chat composer, similar to the existing `@文件` file-reference chip. On send, `ChatInput` serialization expands that block into plain task-resume instructions that include stable `Active task:` evidence for existing session-link logic.

## Boundaries

- `components/TrellisPanel.tsx`: displays the action in task detail and emits the selected `TrellisTaskDetail` upward.
- `components/AppShell.tsx`: owns cross-panel orchestration, chooses/opens the chat surface for the Trellis cwd, and asks `ChatInput` to add the Trellis block.
- `components/ChatInput.tsx`: owns contentEditable DOM blocks and message serialization. This is where the Trellis block should be inserted and serialized, following the existing file-reference chip pattern.
- `lib/trellis-chat-context.ts` (recommended new helper): builds the serialized user-visible continuation prompt from a minimal Trellis task reference payload.
- `lib/trellis-session-link.ts`: no planned change; the serialized prompt should reuse its existing `Active task:` and task-path evidence formats.

## Data Flow

```text
TrellisPanel TaskDetail button
  -> onJoinTaskChat(task)
  -> AppShell handleJoinTrellisTaskChat(task)
  -> ensure chat for trellisCwd is visible
  -> chatInputRef.current.addTrellisTaskContext(task-payload)
  -> ChatInput inserts contentEditable=false Trellis block
  -> user adds text around the block and sends
  -> serializeNodes expands Trellis block into plain resume context
  -> session transcript includes Active task path
  -> existing /api/sessions/[id]/trellis-task resolver links task
```

## Composer Block Model

Extend `ChatInputHandle` with a method like:

```ts
addTrellisTaskContext: (task: TrellisTaskChatContext) => void;
```

Add a small serializable UI payload type, either local to `ChatInput` or shared from `lib/trellis-chat-context.ts`:

```ts
interface TrellisTaskChatContext {
  dirName: string;
  title: string;
  status: string;
  progressLabel: string;
  isArchived: boolean;
}
```

`TrellisTaskDetail` should not be stored wholesale in DOM dataset fields. Pass only strings needed for display and serialization.

The inserted element should follow the file chip precedent:

- `contentEditable = "false"`
- `dataset.chip = "trellis-task"` or `dataset.block = "trellis-task"`
- `dataset.dirName`, `dataset.title`, `dataset.status`, `dataset.progressLabel`
- distinct Trellis visual styling using existing CSS variables;
- block-like display, preferably `display: inline-flex` or `display: flex` with enough width to read, while still working inside contentEditable.

## Serialization Contract

Extend `serializeNodes(...)`:

- File chips continue to serialize as path references.
- Trellis task blocks serialize with `buildTrellisTaskResumePrompt(...)`.
- Unknown chips remain ignored or recurse as today.

The serialized Trellis text must include:

- `Active task: .trellis/tasks/<dirName>` for active tasks.
- Human-readable task title, status, phase/stage, and directory.
- Artifact reading instructions for `prd.md`, `design.md`, `implement.md`, `implement.jsonl`, and `check.jsonl`.
- A planning-safe instruction: recover background and recommend next steps unless the user explicitly asks to implement.

Archived paths would require `.trellis/tasks/archive/<month>/<dirName>`, but archived tasks are out of scope for the MVP and should not be inserted.

## Chat Selection Behavior

Recommended MVP behavior:

1. If a same-cwd, unarchived session is selected, use it.
2. Otherwise set `selectedSession` to `null`, set `newSessionCwd` to the Trellis cwd, clear stale branch/system panel state as appropriate, and show a new-session chat.
3. Insert the Trellis block after the `ChatWindow` remount has created the input ref.

Because `ChatWindow` is keyed by `sessionKey`, inserting immediately after changing chat state may race with remount. Use a pending Trellis-context state/ref and an effect that runs after render when `showChat` is true and `chatInputRef.current` exists.

## Existing Input Handling

The Trellis block should be inserted as an additional content unit, not replace composer content.

- If the composer is focused, insert at the cursor.
- If it is not focused, append at the end.
- Add newline/space separators so surrounding user text remains readable.
- Do not use `insertIfEmpty` for this feature; it conflicts with the requested `@文件`-style behavior.

## Compatibility

- Reuses existing task link detection; no new JSONL record type or API route is required.
- Does not change agent command payloads.
- Does not alter Trellis setup or task reader security boundaries.
- Does not auto-run `task.py start`; the user remains in control of planning vs implementation.

## Risks and Mitigations

- **Race inserting into a remounted input:** keep a pending Trellis block payload and insert from an effect after the chat input exists.
- **Dataset escaping / large payloads:** store only minimal strings in `dataset`; build serialized prompt from those fields.
- **Context block not serialized:** add an explicit `serializeNodes` branch for the Trellis block and validate manually by sending.
- **Input overwrite:** never set `textContent` for this feature; insert DOM block at cursor/end.
- **Context bloat:** serialize paths and summary, not full PRD/design contents.
- **Wrong task association:** include the exact active task path recognized by `lib/trellis-session-link.ts`.
- **Archived ambiguity:** disable archived tasks in MVP.

## Documentation Impact

- Update `docs/modules/frontend.md` for `AppShell`, `TrellisPanel`, and `ChatInput` composer block behavior.
- Update `docs/modules/library.md` if `lib/trellis-chat-context.ts` is added.
