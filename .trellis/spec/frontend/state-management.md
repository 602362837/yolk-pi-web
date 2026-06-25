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

## Common Mistakes

1. **Don't use `useEffect` for derived state** — compute inline or with `useMemo`
2. **Don't store derived state in `useState`** — it causes unnecessary re-renders
3. **Don't forget SSR checks** — use `typeof window !== "undefined"` before accessing browser APIs
4. **Don't use module-level `Map` for session state** — use `globalThis.__piSessions` to survive hot-reload (see `lib/rpc-manager.ts`)
5. **Don't put server state in global stores** — fetch on demand and cache in component state
6. **Don't forget cleanup** — close EventSource connections, clear timers, remove listeners in effect cleanup functions
