# Hook Guidelines

> How hooks are used in this project.

---

## Custom Hook Patterns

Hooks are functional and return objects containing state and handlers:

```typescript
export function useAudio() {
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

  const playDone = useCallback(() => {
    // ...
  }, []);

  return { 
    soundEnabled: enabled, 
    onSoundToggle: toggle, 
    playDoneSound: playDone 
  };
}
```

**Return object shape:**
- Expose state values (not setters)
- Expose handler functions with descriptive names
- Use consistent naming: `on*` for event handlers, `is*` for booleans

Reference files:
- `hooks/useAudio.ts` — simple state + handlers
- `hooks/useDragDrop.ts` — DOM event coordination
- `hooks/useTheme.ts` — external store integration
- `hooks/useAgentSession.ts` — complex orchestration

## Hook Categories

### 1. Simple State Hooks
Manage local preferences or UI state:

```typescript
// hooks/useAudio.ts
export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(/* ... */);
  return { soundEnabled: enabled, onSoundToggle: toggle };
}
```

### 2. External Store Hooks
Use `useSyncExternalStore` for state that lives outside React:

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
  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    // Toggle logic + view transition animation
  }, []);
  
  return { theme, toggleTheme, isDark: theme === "dark" };
}
```

### 3. DOM Event Hooks
Coordinate browser event listeners:

```typescript
// hooks/useDragDrop.ts
export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0); // Track nested drag events

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.items)
      .some((item) => item.type.startsWith("image/"));
    if (!hasImages) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  return { 
    isDragOver, 
    handleDragEnter, 
    handleDragOver, 
    handleDragLeave, 
    handleDrop 
  };
}
```

### 4. Orchestration Hooks
Manage complex state machines and side effects:

```typescript
// hooks/useAgentSession.ts
export function useAgentSession(opts: UseAgentSessionOptions) {
  const [data, setData] = useState<SessionData | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, initialState);
  
  // SSE connection management
  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/agent/${sessionId}/events`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      handleAgentEventRef.current(event);
    };
    return () => es.close();
  }, [sessionId]);
  
  // Command handlers
  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    await sendAgentCommand(sessionId, { type: "prompt", message, images });
  }, [sessionId]);
  
  return {
    loading, error, messages, streamState,
    handleSend, handleAbort, handleFork,
    // ...
  };
}
```

## Data Fetching

**Server-side fetching** happens in API routes (`app/api/**/route.ts`), not in components or hooks.

**Client-side fetching** uses `fetch` directly or the `sendAgentCommand` helper:

```typescript
// lib/agent-client.ts
export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}
```

**Real-time updates** use Server-Sent Events (SSE):

```typescript
const es = new EventSource(`/api/agent/${sessionId}/events`);
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // Update state based on event type
};
```

## Reducers for Complex State

Use `useReducer` when state transitions are complex or interdependent:

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

export function useAgentSession(opts: UseAgentSessionOptions) {
  const [streamState, dispatch] = useReducer(streamReducer, {
    isStreaming: false,
    streamingMessage: null,
  });
  
  // Later:
  dispatch({ type: "start" });
  dispatch({ type: "update", message: partialMessage });
  dispatch({ type: "end" });
}
```

## Naming Conventions

- Hook files: `use*.ts` (e.g., `useAgentSession.ts`, `useTheme.ts`)
- Hook functions: `useX` (e.g., `useAgentSession`, `useAudio`)
- Handler functions returned from hooks: `handle*` (e.g., `handleSend`, `handleAbort`)
- Callback props: `on*` (e.g., `onAgentEnd`, `onSessionCreated`)

## Refs for Mutable State

Use refs to avoid stale closures in callbacks and effects:

```typescript
const playDoneSoundRef = useRef(playDoneSound);
playDoneSoundRef.current = playDoneSound;

const handleAgentEvent = useCallback((event: AgentEvent) => {
  // Can safely call playDoneSoundRef.current without adding it to deps
  if (event.type === "agent_end") {
    playDoneSoundRef.current();
  }
}, []); // Empty deps array is safe because we use a ref
```

**When to use refs:**
- Callbacks that need current values but shouldn't recreate on every render
- Imperative handles (e.g., `chatInputRef.current?.insertText()`)
- Tracking mutable state that doesn't trigger re-renders (e.g., timers, subscriptions)

## Common Mistakes

1. **Don't fetch data in components** — use hooks or API routes
2. **Don't forget cleanup in effects** — close EventSource, clear timers, remove listeners
3. **Don't use `useEffect` for derived state** — compute inline or use `useMemo`
4. **Don't put business logic in hooks that belongs in `lib/`** — hooks orchestrate, `lib/` implements
5. **Don't create hook directories** — the project uses a flat `hooks/` structure
6. **Don't forget to handle SSR** — check `typeof window !== "undefined"` before accessing browser APIs

## Effect Cleanup

Always clean up side effects:

```typescript
useEffect(() => {
  const es = new EventSource(`/api/agent/${sessionId}/events`);
  es.onmessage = (e) => { /* ... */ };
  
  return () => {
    es.close(); // Cleanup on unmount or sessionId change
  };
}, [sessionId]);
```

## Lazy Initialization

Use lazy initializers for expensive state setup:

```typescript
const [phraseIdx, setPhraseIdx] = useState(() => 
  Math.floor(Math.random() * phrases.length)
);

const [enabled, setEnabled] = useState<boolean>(() => {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem("pi-sound-enabled");
  return stored === null ? true : stored === "true";
});
```

This runs only once on mount, not on every render.
