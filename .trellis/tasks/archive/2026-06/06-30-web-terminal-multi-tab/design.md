# Web Terminal Multi-Tab Design

## Summary

Replace the single-session `TerminalPanel` dock with a terminal workspace that can own many local terminal tabs and arrange them in a nested split-pane layout inside the bottom terminal area. Backend terminal sessions remain unchanged: each tab still maps to one existing `/api/terminal/sessions` server session, and multi-tab/pane behavior is a browser-side layout and lifecycle concern.

## Scope Decisions

- Tabs and panes are ephemeral and browser-page-local. No refresh restore, session persistence, or cross-browser sharing.
- Tabs can be renamed; labels live only in current React state.
- Drag-to-split moves an existing tab/session into a new pane. It never duplicates a shell process.
- Nested split panes are required, with draggable dividers for pane resizing.
- No hard tab or pane count limit. Minimum pane size prevents unusable drops/resizes.
- Closing a non-last tab needs no confirmation. Closing the last tab, whole dock, or all terminal sessions requires confirmation.
- Fullscreen is app-local, not the browser Fullscreen API.

## Existing Architecture

- `components/AppShell.tsx` currently owns `terminalOpen` and `terminalCollapsed` and renders one `TerminalPanel` with the current `terminalCwd`.
- `components/TerminalPanel.tsx` currently creates one terminal session on mount, streams via SSE, posts input/resize, and deletes the session during unmount cleanup.
- `lib/terminal-manager.ts` already stores independent sessions in `globalThis.__piTerminalSessions`, keyed by server session id.
- `/api/terminal/sessions/**` routes already support create/events/input/resize/delete by session id.

## Proposed Frontend Structure

### Components

- `TerminalWorkspace` (new or refactored from `TerminalPanel`): owns dock controls, tab model, nested layout tree, drag/drop, splitter resizing, dock height, fullscreen/minimized state, and close confirmation.
- `TerminalSessionView` (extracted from current `TerminalPanel` session logic): owns one xterm instance and one server terminal session. It accepts a stable tab id, cwd, and close lifecycle callbacks.
- Optional small private subcomponents inside `TerminalWorkspace`: tab strip, pane renderer, split renderer, divider, rename input.

### State Model

Use `useReducer` because terminal state has interdependent transitions.

```ts
type SplitDirection = "horizontal" | "vertical";

interface TerminalTabState {
  id: string;
  label: string;
  cwd: string;
  sessionId: string | null;
  shell: string | null;
  backend: "pty" | "script" | "pipe" | null;
  status: "starting" | "connected" | "error";
  error: string | null;
}

interface TerminalPaneNode {
  kind: "pane";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

interface TerminalSplitNode {
  kind: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: TerminalLayoutNode;
  second: TerminalLayoutNode;
}

type TerminalLayoutNode = TerminalPaneNode | TerminalSplitNode;
```

Interpretation:

- `direction: "horizontal"` means panes are side-by-side and the divider is vertical.
- `direction: "vertical"` means panes are stacked and the divider is horizontal.
- `ratio` is the first child size fraction, clamped during resize.
- Pane leaves own tab membership and active tab selection.
- Tab records own session metadata and labels.

### Layout Operations

- Add tab: append a new tab to the active pane and make it active.
- Rename tab: update `TerminalTabState.label`.
- Close tab: close that tab's server terminal session; if it was the last tab in the whole workspace, confirm and close the dock. If a pane becomes empty, remove/merge it from the layout tree.
- Move tab within pane: reorder or select if needed.
- Move tab to another pane center: remove from source pane and append to target pane.
- Drag tab to target pane edge: replace target pane with a split node containing the original target pane plus a new pane that owns the moved tab. Remove/merge empty source panes after the move.
- Resize split: update the split node ratio, clamped by minimum pane dimensions.

### Drag-to-Split Semantics

- Use browser drag events or pointer-based drag state scoped to the terminal workspace root.
- Drag payload contains `{ tabId, sourcePaneId }` only; it is ignored outside the terminal workspace.
- Pane title/tab-strip drops always move the tab into the target pane without splitting.
- Split drop zones are computed from pointer position inside the target pane's terminal content area, not the title/tab strip:
  - the right/left side of the content area creates a right/left horizontal split
  - the top/bottom side of the content area creates a top/bottom vertical split
  - if the content area is too small for the intended split direction, the drop is disabled and a not-enough-space overlay/tip is shown instead of failing silently
- Drops that would produce a pane smaller than the minimum width/height are rejected or visually disabled.

### Session Lifecycle

Each tab maps to one server terminal session:

```text
TerminalTabState.id ──creates/reconnects──▶ /api/terminal/sessions id
TerminalSessionView ──GET events──────────▶ output stream
TerminalSessionView ──POST input/resize───▶ same server session
TerminalWorkspace close tab/dock ──DELETE─▶ session cleanup
```

Important lifecycle rule: moving a tab between panes must not delete its server session. If React remounting is unavoidable during a layout move, the view should reconnect to the existing `sessionId` rather than creating a new shell. Explicit tab/dock close is the only path that deletes the server session.

For tab switching, keep inactive terminal views mounted when possible, hidden inside the pane, so xterm scrollback and focus state are preserved. If a tab view must detach temporarily during layout changes, the server session id remains authoritative and the existing server buffer can refill recent output.

### Workspace CWD Handling

- Terminal workspace should capture the cwd at the time the dock is opened.
- Existing tabs keep their captured cwd; switching chat sessions/workspaces must not silently retarget running tabs.
- If the active app workspace changes while terminal sessions exist, show an explicit confirmation before closing all terminal sessions. If the user cancels, keep the old terminal workspace visible and clearly labeled with its captured cwd instead of silently killing or retargeting processes.

### Dock Controls

- Minimize/collapse: hides terminal body but leaves tabs/processes running.
- Restore: shows body and focuses active terminal.
- App-local fullscreen: terminal workspace overlays or expands within the app shell; it does not use browser Fullscreen API and does not kill sessions.
- Close: asks for confirmation, then deletes all terminal sessions and closes the dock.
- Height resize: dragging the dock top edge adjusts the normal-mode dock height, clamped to a sensible minimum and maximum such as `180px` to `70vh`.

## Backend Compatibility

No backend API changes are expected. The existing routes already support multiple terminal sessions because each tab creates and owns an independent session id.

## Documentation Updates

- Update `docs/modules/frontend.md` to describe the terminal workspace as multi-tab/nested split capable.
- Update `docs/modules/api.md` only if API behavior changes; the expected design does not require route changes.
- Update `docs/modules/library.md` only if `lib/terminal-manager.ts` contracts change; expected design reuses it unchanged.

## Risks and Trade-offs

- Nested layout state is complex; keep tree transforms pure and typed.
- React unmount cleanup must not accidentally kill a tab's shell during drag/move. Only explicit close actions should delete sessions.
- xterm fitting must run after tab switch, pane resize, dock resize, restore, and fullscreen transitions.
- Confirmation prompts should protect destructive bulk close without making routine non-last tab closes annoying.
