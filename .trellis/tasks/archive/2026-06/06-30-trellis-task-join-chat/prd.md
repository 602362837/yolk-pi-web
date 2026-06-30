# Trellis task join chat

## Goal

Make unfinished Trellis tasks easy to resume from a later Pi Agent Web session by adding a visible action in the Trellis drawer that inserts a dedicated Trellis task context block into chat, similar to how `@文件` inserts a file-reference chip/block.

## User Value

Users may enable the Trellis panel, plan a task, stop before implementation, or stop halfway through execution. In a future session they should not need to manually remember task names, copy task paths, or explain how to resume. They can click a task action, get a structured task context block in the chat composer, add more description around it, and send one message that gives the agent enough context to continue.

## Confirmed Facts

- `components/TrellisPanel.tsx` currently lists Trellis tasks and shows task details, documents, progress, metadata, related files, and notes.
- `components/AppShell.tsx` owns right-drawer mode, active cwd/session state, and a `chatInputRef` that can manipulate the chat input.
- `components/ChatInput.tsx` already supports contentEditable non-editable chips for file references:
  - `chipInsertAtCursor(...)` creates a `contentEditable=false` block/span.
  - `serializeNodes(...)` expands chips into message text when sending.
  - `hasContent(...)` treats chips as content.
- `lib/trellis-session-link.ts` already recognizes transcript evidence such as `Active task: .trellis/tasks/<dir>` and `.trellis/tasks/<dir>` to associate a session with a Trellis task.
- Trellis task summary/detail types live in `lib/trellis-types.ts`.
- The Trellis drawer is currently read-only; this feature should not mutate task files simply by joining a task to chat.

## Requirements

1. Add a `加入会话` / resume action for active (not archived) Trellis tasks in the task detail view.
2. Clicking the action must open or focus the chat area for the same workspace cwd as the Trellis panel.
3. Clicking the action must insert a structured Trellis context block into the chat composer, not raw long text.
4. The block should behave like `@文件` references:
   - visually distinct;
   - non-editable as one unit;
   - inserted at cursor or appended predictably;
   - removable by normal editor deletion/selection behavior;
   - counted as composer content.
5. When the message is sent, serialization must expand the Trellis block into a stable textual context that the agent can read.
6. The serialized text must include stable task evidence that existing session-link logic can detect, especially `Active task: .trellis/tasks/<dirName>`.
7. The serialized text must tell the agent to read the task artifacts before proceeding, including `prd.md`, optional `design.md`, optional `implement.md`, and context manifests when present.
8. The serialized text must make it clear that the user may add more description and that implementation should not start unless the user asks for it.
9. Existing user text in the composer must not be overwritten; the Trellis block is added as another content unit.
10. Archived tasks must not be joinable in the MVP.
11. Keep reusable block serialization / draft construction in shared code if it is used outside a single component.
12. Update module documentation for new Trellis-panel-to-chat behavior.

## Trellis Block Semantics

The visible block should be compact, for example:

```text
Trellis 继续任务
Trellis task join chat · planning · 规划中
.trellis/tasks/06-30-trellis-task-join-chat
```

The sent message should contain expanded text equivalent to:

```md
继续 Trellis 任务：

Active task: .trellis/tasks/<dirName>

任务标题：<title>
当前状态：<status>
当前阶段：<progress.label>
任务目录：.trellis/tasks/<dirName>

请先读取并遵循该任务的 Trellis 上下文：
- .trellis/tasks/<dirName>/prd.md
- .trellis/tasks/<dirName>/design.md（如果存在）
- .trellis/tasks/<dirName>/implement.md（如果存在）
- .trellis/tasks/<dirName>/implement.jsonl / check.jsonl（如果存在）

我接下来会补充新的要求。除非我明确要求开始实现，否则先帮我恢复任务背景、确认当前阶段，并给出下一步建议。
```

## Acceptance Criteria

- [ ] A selected, unarchived Trellis task detail shows a clearly labeled `加入会话` action.
- [ ] Clicking the action from an empty workspace chat opens/focuses a new-session chat for the Trellis cwd and inserts a Trellis context block.
- [ ] Clicking the action from an existing same-cwd chat inserts the Trellis context block into the composer without replacing existing text.
- [ ] The visible composer content is a compact, block-like Trellis reference rather than raw long prompt text.
- [ ] Sending the message serializes the block into readable task-resume context.
- [ ] The serialized message contains `Active task: .trellis/tasks/<dirName>` and task title/status/stage.
- [ ] After the user sends the message, the existing Trellis session widget/linking path can associate the session with the task.
- [ ] Archived tasks do not expose an enabled join action.
- [ ] Lint and type-check pass: `npm run lint` and `node_modules/.bin/tsc --noEmit`.
- [ ] `docs/modules/frontend.md` is updated; `docs/modules/library.md` is updated if a shared helper is added.

## Out of Scope for MVP

- Auto-sending the continuation prompt.
- Mutating `.trellis/.runtime` or `task.json` when the user clicks the button.
- Creating a hidden system/developer prompt path for Trellis resume context.
- Joining archived tasks.
- Automatically choosing or starting implementation/check phases.
- Rich multi-block message persistence beyond the normal serialized user message.

## Open Questions

- None currently blocking. The clarified direction is: insert a structured Trellis context block like `@文件`, and expand it only when sending.
