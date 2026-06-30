# Implementation Plan: Trellis task join chat

## Pre-Implementation Gate

Do not run `task.py start` or edit product code until the user approves implementation after reviewing this revised block-based plan.

## Files Likely to Change

- `components/TrellisPanel.tsx`
- `components/AppShell.tsx`
- `components/ChatInput.tsx`
- `lib/trellis-chat-context.ts` (recommended new helper)
- `docs/modules/frontend.md`
- `docs/modules/library.md` (if helper is added)

## Ordered Checklist

1. Load Trellis development specs before code changes.
2. Add a small Trellis chat-context helper/type, likely `lib/trellis-chat-context.ts`:
   - minimal payload type for composer block;
   - `buildTrellisTaskResumePrompt(payload)` for send-time serialization;
   - optional adapter from `TrellisTaskDetail` to payload.
3. Extend `ChatInputHandle` with `addTrellisTaskContext(payload)`.
4. In `ChatInput.tsx`, add a `trellisTaskInsertAtCursor(...)` helper modeled on `chipInsertAtCursor(...)`:
   - creates a non-editable Trellis block;
   - stores minimal payload fields in dataset;
   - visually distinguishes it from file chips;
   - inserts at cursor or appends at end.
5. Extend `serializeNodes(...)` to detect the Trellis block and expand it into the resume prompt.
6. Ensure `hasContent(...)` treats the Trellis block as composer content (existing `[data-chip]` can work if the block uses `data-chip`).
7. Extend `TrellisPanel` props with `onJoinTaskChat?: (task: TrellisTaskDetail) => void`.
8. Add a `加入会话` action to task detail/header for unarchived tasks; archived tasks are disabled/absent.
9. Wire `TrellisPanel` -> `AppShell` through the new callback.
10. Implement `AppShell` pending-block orchestration:
    - ensure Trellis cwd chat is visible;
    - select existing same-cwd session when available;
    - otherwise open new-session chat for cwd;
    - after input ref exists, call `addTrellisTaskContext(payload)`.
11. Verify the serialized prompt contains the exact `Active task: .trellis/tasks/<dirName>` line.
12. Update docs.
13. Run validation:
    - `npm run lint`
    - `node_modules/.bin/tsc --noEmit`

## Manual Verification

- Open Trellis drawer, select an active task, click `加入会话`.
- Confirm the chat composer receives a compact Trellis context block, not raw long prompt text.
- Type text before/after the block and send.
- Confirm the sent user message includes expanded task-resume text with `Active task: .trellis/tasks/<dirName>`.
- Confirm the Trellis session widget/link appears after association refresh.
- Try with no selected session and with an existing same-cwd session.
- Try with the input focused at a middle cursor position and unfocused, verifying insert-at-cursor vs append behavior.
- Try with an archived task shown via `归档 ✓` and confirm the action is disabled/absent.

## Rollback Points

- If block styling inside contentEditable is fragile, start with an inline-block chip using the same structure as file references, then improve visual layout later.
- If shared helper import into `ChatInput` causes client/server concerns, keep the helper pure and type-only safe, or localize serialization in `ChatInput`.
- If pending insertion races with remount, keep a retry counter in the effect for a short duration, then surface a non-blocking console warning.
- If archived task handling is requested later, add path generation for `.trellis/tasks/archive/<month>/<dirName>` as a follow-up.
