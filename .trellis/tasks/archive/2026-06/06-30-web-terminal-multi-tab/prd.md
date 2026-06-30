# Web terminal multi-tab support

## Goal

Extend the existing Web Terminal bottom dock from a single terminal session into a multi-tab terminal experience so users can run more than one independent command/shell workflow inside the selected workspace.

## User Value

- Users can keep multiple terminal workflows open at once, for example a dev server in one tab and ad-hoc commands in another.
- Switching between terminal workflows should not kill the inactive shell process.
- The terminal remains tied to the current authorized workspace to avoid commands running in an unexpected directory.

## Confirmed Facts

- Current Web Terminal MVP is already implemented as a bottom dock in `components/TerminalPanel.tsx`.
- `components/AppShell.tsx` owns the single `terminalOpen` / `terminalCollapsed` state and renders one `TerminalPanel` for `terminalCwd`.
- Each `TerminalPanel` currently creates exactly one server terminal session on mount, streams output by SSE, sends input/resize by HTTP POST, and deletes the server session on unmount/close.
- Backend terminal sessions are already independent server objects keyed by `id` in `globalThis.__piTerminalSessions` via `lib/terminal-manager.ts`.
- Existing terminal session APIs can already create, stream, input, resize, and close an arbitrary terminal session by id.
- The previous MVP decision was ephemeral lifecycle: terminal sessions live while open/collapsed in the browser tab and are cleaned up on close, workspace switch, refresh, or disconnect.
- Web Terminal is setting-gated and server-side launch checks already enforce enabled state and workspace allowed-root validation.

## Requirements

- Terminal tabs remain ephemeral like the MVP terminal; refreshing the page, closing the dock, or switching workspace closes tabs and kills their processes.
- Add a terminal tab strip to the existing bottom dock.
- Support creating a new terminal tab from the dock.
- Support switching between terminal tabs without terminating inactive tab processes.
- Support renaming terminal tabs in the dock.
- Support dragging terminal tabs within the terminal content area to split the terminal workspace into multiple panes/windows.
- Dropping a dragged tab on another pane's title/tab-strip area should move it into that pane instead of splitting; split intent comes from dropping over the terminal content area.
- Split direction/placement should follow the pointer position over the target terminal content area, for example the right half of another terminal pane means split to the right.
- If the target terminal content area is too small for the intended split direction, show an explicit tooltip/overlay explaining that there is not enough space instead of failing silently.
- Split panes must support nested splits rather than only one flat split level.
- Split panes must support resizing by dragging dividers between adjacent terminal panes.
- Drag-to-split interactions must be scoped to the terminal dock only and must not affect the chat, sidebars, file tabs, or browser window.
- Terminal tab and pane counts do not have hard MVP limits; the UI should rely on minimum pane size constraints to prevent unusable split drops.
- Dragging a terminal tab into a split must move the existing terminal session into the new pane; it must not duplicate or clone the shell process.
- If moving a tab leaves the source pane empty, the empty pane should be removed/merged from the terminal split layout.
- Support closing an individual terminal tab and terminating only that tab's server process.
- Each terminal tab must have its own independent shell/session id and output buffer.
- New tabs should start in the current terminal workspace cwd and use the existing terminal shell/env settings.
- The dock should continue to support minimize/collapse, fullscreen/maximize, and whole-dock close controls.
- Closing the whole terminal dock must prompt for confirmation because terminal sessions are ephemeral and cannot be restored.
- Closing the last terminal tab should close the whole terminal dock after user confirmation.
- Closing a non-last individual terminal tab should not require confirmation.
- Workspace/session changes that would close all terminal sessions should require confirmation or otherwise avoid silent terminal loss.
- The overall bottom terminal dock height must be resizable by dragging its top edge; height persistence beyond the current browser page is not required.
- Workspace/session changes must not leave visible tabs accidentally targeting the previous cwd; all tabs for the old cwd should be closed/cleaned up or otherwise clearly separated.
- Terminal disabled state and missing/unauthorized cwd behavior must remain enforced by existing settings and server validation.
- Update project docs if component/module responsibilities change.

## Acceptance Criteria

- [ ] With Web Terminal enabled and a workspace selected, opening Terminal shows a tabbed terminal dock.
- [ ] Clicking `+` (or equivalent) creates another terminal tab in the same cwd.
- [ ] Each tab starts an independent shell process; commands/output in one tab do not appear in another.
- [ ] Terminal tabs can be renamed and the label persists while the browser page remains loaded.
- [ ] Dragging a terminal tab over another pane's content area can split the terminal area into nested panes/windows according to pointer position without affecting non-terminal UI.
- [ ] If a pane is too small for the intended split direction, the UI shows a clear not-enough-space tip/overlay.
- [ ] Dropping a dragged tab on another pane's title/tab strip moves it into that pane as a normal tab instead of splitting.
- [ ] Nested split dividers can be dragged to resize adjacent terminal panes, with usable minimum pane sizes.
- [ ] Switching tabs preserves the inactive tab process and scrollback/output state.
- [ ] Drag-to-split moves the existing terminal session to the new pane without restarting or duplicating the shell process.
- [ ] Empty source panes created by tab moves are removed/merged cleanly.
- [ ] Tab and pane counts have no fixed upper limit, but split/drop interactions prevent creating panes smaller than the minimum usable size.
- [ ] Closing one non-last tab kills only that tab's server-side terminal session without confirmation.
- [ ] Closing the last tab asks for confirmation, then closes the whole dock and cleans up terminal sessions after confirmation.
- [ ] Closing the whole terminal dock asks for confirmation, then cleans up all open terminal tab sessions after confirmation.
- [ ] Workspace/session changes do not silently kill all terminal sessions without confirmation or an explicit safe handling path.
- [ ] Changing workspace/session closes or isolates previous-cwd terminal tabs so commands cannot silently keep targeting the wrong cwd.
- [ ] Minimize/collapse and restore still work with multiple tabs, and restoring focuses the active tab.
- [ ] App-local fullscreen/maximize mode is available from the terminal dock controls and can be exited without killing terminal sessions.
- [ ] The overall terminal dock height can be adjusted by dragging the dock's top edge, with sensible minimum and maximum heights.
- [ ] Lint and type-check pass with no new errors.

## Recommended MVP Scope

- Keep multi-tab lifecycle browser-tab-local and ephemeral, matching the MVP terminal behavior. User confirmed no refresh/session restore is needed.
- Do not persist terminal tabs or reconnect them after browser refresh/server restart.
- Include terminal tab renaming in MVP per user request.
- Include nested drag-to-split terminal panes/windows in MVP per user request, constrained to the terminal area.
- Use the existing backend session API per tab instead of adding a new backend multi-tab abstraction.

## Out of Scope

- Persisting/restoring terminal tabs across browser refresh or server restart.
- Sharing terminal tabs between browser clients.
- SSH host/profile tabs or remote terminal management.
- Terminal history/replay beyond each xterm instance's in-memory scrollback.

## Open Questions

- None blocking.
