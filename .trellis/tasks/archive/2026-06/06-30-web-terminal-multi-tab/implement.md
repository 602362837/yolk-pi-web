# Web Terminal Multi-Tab Implementation Plan

## Phase 1: Refactor terminal session view

- [ ] Extract the current one-session logic from `components/TerminalPanel.tsx` into a reusable per-tab `TerminalSessionView` or equivalent private component.
- [ ] Ensure server session deletion happens only on explicit close, not every React unmount caused by layout moves.
- [ ] Keep input, SSE output, resize, local echo fallback, error display, shell/backend metadata, and focus behavior from the existing MVP.
- [ ] Add a callback path for `TerminalSessionView` to report created `sessionId`, shell/backend, status, and errors to parent tab state.

## Phase 2: Add terminal workspace state and tab strip

- [ ] Replace the single `TerminalPanel` export with a `TerminalWorkspace`-style component or evolve `TerminalPanel` into that role.
- [ ] Add `useReducer` state for tabs, panes, active pane/tab, labels, and layout tree.
- [ ] On initial open, create one tab in one root pane.
- [ ] Add `+` new-tab control that creates an independent tab/session in the captured cwd.
- [ ] Add tab selection and non-last tab close behavior.
- [ ] Add tab rename UI, such as double-click label or a small rename action, persisting only in current state.

## Phase 3: Nested split layout and drag-to-split

- [ ] Implement typed layout tree helpers for finding panes, removing tabs, pruning empty panes, replacing a pane with a split, and clamping ratios.
- [ ] Render pane leaves and nested split nodes recursively.
- [ ] Implement terminal-scoped drag state for tab drag payloads.
- [ ] Add pane drop zones for left/right/top/bottom split and center move.
- [ ] Drag-to-split moves the existing tab/session into the new pane without duplicating or restarting it.
- [ ] Remove/merge empty source panes after moves.
- [ ] Reject/disable drops that would create panes smaller than the minimum usable size.

## Phase 4: Resize, dock controls, and fullscreen

- [ ] Add draggable dividers between split children and update split ratios with min-size clamping.
- [ ] Add dock top-edge drag resize for normal-mode height, clamped to sensible min/max values.
- [ ] Preserve existing collapse/minimize behavior; restoring focuses the active terminal.
- [ ] Add app-local fullscreen/maximize and exit control without using browser Fullscreen API.
- [ ] Ensure xterm fit/resize runs after pane resize, dock resize, tab switch, restore, and fullscreen transitions.

## Phase 5: Destructive close confirmation and cwd handling

- [ ] Whole-dock close asks for confirmation and then deletes all tab sessions.
- [ ] Closing the last terminal tab asks for confirmation and then closes the dock.
- [ ] Non-last tab close skips confirmation and deletes only that tab's session.
- [ ] Workspace/session changes must not silently retarget or kill running terminals. Capture terminal cwd at open time, label it clearly, and confirm before closing all sessions when the active app cwd changes.
- [ ] Terminal disabled/missing cwd behavior remains compatible with existing `AppShell` gating.

## Phase 6: Documentation and validation

- [ ] Update `docs/modules/frontend.md` for multi-tab/nested split terminal UI responsibilities.
- [ ] Update API/library docs only if route or terminal-manager contracts changed.
- [ ] Run `npm run lint`.
- [ ] Run `node_modules/.bin/tsc --noEmit`.

## Manual Validation Checklist

- [ ] Open Terminal with Web Terminal enabled: one tab appears and starts in captured workspace cwd.
- [ ] Create multiple tabs: each has an independent shell process/output.
- [ ] Rename a tab: label updates and remains until page reload/close.
- [ ] Switch tabs: inactive processes continue and output/scrollback remains visible when returning.
- [ ] Close non-last tab: no confirmation, only that session is killed.
- [ ] Close last tab: confirmation appears; confirming closes the dock.
- [ ] Close dock with multiple tabs/panes: confirmation appears; confirming kills all sessions.
- [ ] Drag a tab to split left/right/top/bottom: nested panes are created and the shell session moves without restarting.
- [ ] Drag a tab to another pane center: tab moves into that pane without splitting.
- [ ] Moving a tab out of a pane that becomes empty removes/merges that pane.
- [ ] Split dividers resize adjacent panes and do not allow unusably small panes.
- [ ] Dock top edge resizes overall terminal height.
- [ ] Minimize/restore works with multiple tabs and panes.
- [ ] App-local fullscreen/exit works and sessions remain alive.
- [ ] Changing selected workspace/session does not silently kill or retarget running terminal sessions.

## Risk / Rollback Points

- If nested split tree logic becomes unstable, keep the tab strip and postpone drag-to-split behind a clearly isolated reducer branch.
- If preserving xterm DOM across pane moves is too fragile, preserve the server session id first and document any temporary scrollback redraw limitation before refining the portal/mount strategy.
- If workspace-change confirmation is hard to intercept globally, keep terminal sessions pinned to their captured cwd with a clear label rather than silently retargeting them.
