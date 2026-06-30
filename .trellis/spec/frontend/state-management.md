# State Management

> How state is managed in this project.

---

## State Categories

The project uses four categories of state, each with a specific purpose:

### 1. Local Component State (`useState`)
UI state that lives within a single component:

```typescript
const [hovered, setHovered] = useState(false);
const [copied, setCopied] = useState(false);
const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
```

**Use for:**
- Hover/active states
- Modal open/close
- Form input values
- Animation states

### 2. Complex State (`useReducer`)
State with multiple interdependent fields or complex transitions:

```typescript
interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

const [streamState, dispatch] = useReducer(streamReducer, {
  isStreaming: false,
  streamingMessage: null,
});
```

**Use for:**
- Streaming state (isStreaming + partial message)
- Multi-field state that updates together
- State with complex transition logic

### 3. External Stores (`useSyncExternalStore`)
State that lives outside React and needs to sync across components:

```typescript
// hooks/useTheme.ts
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // ...
}
```

**Use for:**
- Theme (dark/light mode)
- Any state that multiple unrelated components need to read
- State that persists across component unmounts

### 4. URL State (`useSearchParams`)
State that should survive page refreshes and be shareable:

```typescript
const searchParams = useSearchParams();
const [initialSessionId] = useState<string | null>(
  () => searchParams.get("session")
);
```

**Use for:**
- Selected session ID (`?session=<id>`)
- Any state that should be bookmarkable

### 5. Persistent State (`localStorage`)
User preferences that persist across sessions:

```typescript
const [enabled, setEnabled] = useState<boolean>(() => {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem("pi-sound-enabled");
  return stored === null ? true : stored === "true";
});

const toggle = useCallback(() => {
  setEnabled((prev) => {
    const next = !prev;
    localStorage.setItem("pi-sound-enabled", String(next));
    return next;
  });
}, []);
```

**Use for:**
- Sound enabled/disabled
- Theme preference (also synced via `html.dark` class)

## When to Use Global State

The project has **minimal global state**. Most state is local to components or hooks.

**Promote state to global when:**
- Multiple unrelated components need to read the same value
- State should persist across route changes
- State is expensive to compute and should be shared

**Current global state:**
- Theme (via `useTheme` hook with `useSyncExternalStore`)
- Selected session (via URL `?session=` param)

**Don't promote state to global when:**
- Only one component or parent-child tree uses it
- It's UI state (hover, modal open/close)
- It can be derived from props or other state

## Server State

Server state is fetched in API routes and cached in component state:

```typescript
// In a component or hook
const [sessions, setSessions] = useState<SessionInfo[]>([]);

useEffect(() => {
  fetch("/api/sessions")
    .then(res => res.json())
    .then(data => setSessions(data.sessions));
}, [refreshKey]);
```

**No client-side caching library** (React Query, SWR) is used. State is fetched on demand and cached in `useState`.

**Real-time updates** use Server-Sent Events (SSE):

```typescript
const eventSourceRef = useRef<EventSource | null>(null);

useEffect(() => {
  if (!sessionId) return;
  
  const es = new EventSource(`/api/agent/${sessionId}/events`);
  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    handleAgentEventRef.current(event);
  };
  
  eventSourceRef.current = es;
  return () => es.close();
}, [sessionId]);
```

## Derived State

Compute derived state inline or with `useMemo` when expensive:

```typescript
// Inline derivation (preferred for simple cases)
const content = typeof message.content === "string"
  ? message.content
  : message.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n");

// useMemo for expensive computations
const normalizedMarkdown = useMemo(
  () => normalizeDisplayMath(children), 
  [children]
);
```

**Don't use `useEffect` to compute derived state** — it causes an extra render cycle.

## Refs for Non-Render State

Use refs for state that shouldn't trigger re-renders:

```typescript
const playDoneSoundRef = useRef(playDoneSound);
playDoneSoundRef.current = playDoneSound; // Update on every render

const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

// Use in callback without adding to deps array
const handleBranchLeafChange = useCallback((leafId: string | null) => {
  branchLeafChangeFnRef.current?.(leafId);
}, []);
```

**Use refs for:**
- Callbacks that need current values but shouldn't recreate
- Imperative handles (e.g., `chatInputRef.current?.insertText()`)
- Timers, subscriptions, and other mutable state

## State Lifting Pattern

When child components need to share state, lift it to the parent:

```typescript
// In AppShell.tsx
const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);

const handleBranchDataChange = useCallback(
  (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, 
  []
);

// Pass to ChatWindow
<ChatWindow 
  onBranchDataChange={handleBranchDataChange}
  // ...
/>

// Pass to BranchNavigator
<BranchNavigator 
  tree={branchTree}
  activeLeafId={branchActiveLeafId}
  onLeafChange={handleBranchLeafChange}
/>
```

## Scenario: Browser-local terminal workspaces

### 1. Scope / Trigger

Use this contract when a frontend component manages ephemeral browser-local UI for
server-backed terminal sessions, such as `components/TerminalPanel.tsx`.

### 2. Signatures

- Tab state owns a stable browser tab id and the server `sessionId` returned by
  `POST /api/terminal/sessions`.
- Layout state is a typed tree of pane leaves and split nodes; split ratios are
  UI-only browser state.
- Explicit destructive actions call `DELETE /api/terminal/sessions/[id]`.

### 3. Contracts

- Use `useReducer` for tab/pane/split transitions because add, close, move,
  prune-empty-pane, and resize updates must stay consistent.
- Keep terminal tabs ephemeral unless a task explicitly designs restore/reconnect
  semantics.
- Moving a tab between panes must move the existing `sessionId`; it must not
  duplicate or restart the shell process.
- React unmount cleanup may close SSE/xterm resources, but it must not delete the
  server session when the unmount is caused by a layout move. Only explicit tab,
  dock, or feature-close paths should delete the server session.
- Pin the terminal workspace to the cwd captured at dock open. Do not silently
  retarget running terminals when the selected chat/workspace changes.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Non-last tab close | Delete only that tab's session; no confirmation needed unless product asks. |
| Last tab or whole-dock close | Confirm before deleting sessions because there is no restore. |
| Tab move/split | Preserve `sessionId`; close only the old EventSource/xterm mount if React remounts. |
| Workspace selection changes | Keep terminal pinned or confirm before closing; never silently retarget cwd. |
| Pane resize/drop below usable size | Clamp resize or reject/drop-disable the split action. |

### 5. Good/Base/Bad Cases

- Good: a tab is dragged from one pane into a new split pane; its `sessionId`
  remains the same and the view reconnects to the existing SSE stream.
- Base: closing the dock deletes all sessions and unmount cleanup only disposes
  browser resources.
- Bad: `useEffect` cleanup always calls `DELETE /api/terminal/sessions/[id]`, so
  a layout remount kills a shell during drag-to-split.

### 6. Tests Required

At minimum, manually or automatically verify:

- Moving a tab between panes does not restart the shell or lose the server
  session.
- Closing one non-last tab kills only that tab.
- Closing the dock/last tab prompts and then kills all relevant sessions.
- Workspace changes do not silently retarget a running terminal cwd.
- Split and dock resizing trigger xterm fit/PTY resize without creating new
  sessions.

### 7. Wrong vs Correct

#### Wrong

```typescript
return () => {
  if (sessionIdRef.current) {
    void fetch(`/api/terminal/sessions/${sessionIdRef.current}`, { method: "DELETE" });
  }
  term.dispose();
};
```

#### Correct

```typescript
return () => {
  eventSourceRef.current?.close();
  term.dispose();
  // Session deletion belongs to explicit tab/dock close actions, not every
  // React unmount caused by split-layout moves.
};
```

## Common Mistakes

1. **Don't use `useEffect` for derived state** — compute inline or with `useMemo`
2. **Don't store derived state in `useState`** — it causes unnecessary re-renders
3. **Don't forget SSR checks** — use `typeof window !== "undefined"` before accessing browser APIs
4. **Don't use module-level `Map` for session state** — use `globalThis.__piSessions` to survive hot-reload (see `lib/rpc-manager.ts`)
5. **Don't put server state in global stores** — fetch on demand and cache in component state
6. **Don't forget cleanup** — close EventSource connections, clear timers, remove listeners in effect cleanup functions
7. **Don't delete server-backed terminal sessions on every React unmount** — layout moves can remount terminal views; delete sessions only from explicit destructive actions.
