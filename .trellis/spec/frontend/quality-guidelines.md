# Quality Guidelines

> Code quality standards for frontend development.

---

## ESLint Configuration

The project uses ESLint with Next.js core-web-vitals and TypeScript rules:

```javascript
// eslint.config.mjs
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Relaxed rules for this project's patterns
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
```

**Run lint:** `npm run lint`

**Relaxed rules rationale:**
- `react-hooks/immutability` — off because we use refs for mutable state
- `react-hooks/refs` — off because we update refs on every render
- `react-hooks/set-state-in-effect` — off because some effects need to update state

## Required Patterns

### 1. Use CSS Variables for Theming
Always use CSS variables instead of hardcoded colors:

```typescript
// ✅ Good
<div style={{ background: "var(--bg-panel)", color: "var(--text)" }}>

// ❌ Bad
<div style={{ background: "#f5f5f5", color: "#1a1a1a" }}>
```

### 2. Normalize Tool Calls at Boundaries
Always call `normalizeToolCalls()` when loading or receiving assistant messages:

```typescript
// ✅ Good - in lib/session-reader.ts
const normalized = normalizeToolCalls(message);

// ✅ Good - in hooks/useAgentSession.ts
const normalized = normalizeToolCalls(event.message);
```

### 3. Use Path Helpers for File Operations
Always use `lib/file-paths.ts` for path encoding and display:

```typescript
// ✅ Good
import { encodeFilePathForApi, getRelativeFilePath } from "@/lib/file-paths";
const encoded = encodeFilePathForApi(filePath);

// ❌ Bad - manual encoding
const encoded = filePath.split("/").map(encodeURIComponent).join("/");
```

### 4. Clean Up Side Effects
Always clean up in effect return functions:

```typescript
// ✅ Good
useEffect(() => {
  const es = new EventSource(`/api/agent/${sessionId}/events`);
  es.onmessage = (e) => { /* ... */ };
  return () => es.close();
}, [sessionId]);

// ❌ Bad - no cleanup
useEffect(() => {
  const es = new EventSource(`/api/agent/${sessionId}/events`);
  es.onmessage = (e) => { /* ... */ };
}, [sessionId]);
```

### 5. Use `useCallback` for Handlers Passed as Props
Prevent unnecessary re-renders:

```typescript
// ✅ Good
const handleClick = useCallback(() => {
  onSelect(session);
}, [onSelect, session]);

return <Child onClick={handleClick} />;
```

### 6. Type Props Explicitly
Always define `interface Props` for components:

```typescript
// ✅ Good
interface Props {
  session: SessionInfo;
  onSelect: (session: SessionInfo) => void;
}

export function SessionCard({ session, onSelect }: Props) {
  // ...
}

// ❌ Bad - inline types
export function SessionCard({ session, onSelect }: { 
  session: SessionInfo; 
  onSelect: (session: SessionInfo) => void 
}) {
  // ...
}
```

## Forbidden Patterns

### 1. Don't Use `any` Type
Use `unknown` and narrow with type guards:

```typescript
// ❌ Bad
function process(data: any) {
  return data.value;
}

// ✅ Good
function process(data: unknown) {
  if (isObject(data) && "value" in data) {
    return data.value;
  }
}
```

### 2. Don't Import Session Lifecycle into Components
Keep session management in `lib/rpc-manager.ts` and `hooks/useAgentSession.ts`:

```typescript
// ❌ Bad - in a component
import { createAgentSession } from "@earendil-works/pi-coding-agent";
const session = createAgentSession({ /* ... */ });

// ✅ Good - in a hook
import { useAgentSession } from "@/hooks/useAgentSession";
const { messages, handleSend } = useAgentSession({ session });
```

### 3. Don't Hardcode Theme Colors
Always use CSS variables:

```typescript
// ❌ Bad
<div style={{ background: isDark ? "#242424" : "#f5f5f5" }}>

// ✅ Good
<div style={{ background: "var(--bg-panel)" }}>
```

### 4. Don't Duplicate Path Logic
Use `lib/file-paths.ts` helpers:

```typescript
// ❌ Bad - duplicated in multiple files
const relativePath = filePath.startsWith(cwd) 
  ? filePath.slice(cwd.length + 1) 
  : filePath;

// ✅ Good
import { getRelativeFilePath } from "@/lib/file-paths";
const relativePath = getRelativeFilePath(filePath, cwd);
```

### 5. Don't Use Module-Level Maps for Session State
Use `globalThis.__piSessions` to survive hot-reload:

```typescript
// ❌ Bad - lost on hot-reload
const sessions = new Map<string, AgentSessionWrapper>();

// ✅ Good - survives hot-reload
globalThis.__piSessions ??= new Map<string, AgentSessionWrapper>();
const sessions = globalThis.__piSessions;
```

See `lib/rpc-manager.ts` for the full pattern.

### 6. Don't Forget to Update AGENTS.md
When adding new components, hooks, or API routes, update the tables in `AGENTS.md`:

- Components table for new `components/*.tsx` files
- Hooks table for new `hooks/*.ts` files
- API Routes table for new `app/api/**/route.ts` files

## Testing

The project currently has **no automated tests**. Quality is maintained through:

1. **TypeScript type checking** — `node_modules/.bin/tsc --noEmit`
2. **ESLint** — `npm run lint`
3. **Manual testing** — verify in browser at `http://localhost:30141`
4. **Code review** — follow the patterns in this spec

## Code Review Checklist

Before committing changes:

- [ ] TypeScript compiles without errors (`tsc --noEmit`)
- [ ] ESLint passes (`npm run lint`)
- [ ] No hardcoded colors (use CSS variables)
- [ ] Side effects are cleaned up in effects
- [ ] Props are typed explicitly
- [ ] No `any` types (use `unknown` + type guards)
- [ ] Path operations use `lib/file-paths.ts`
- [ ] Tool calls are normalized at boundaries
- [ ] `AGENTS.md` is updated if adding new components/hooks/routes
- [ ] Manual testing in browser confirms functionality

## Build and Type Checking

**During development:**
```bash
npm run dev          # Start dev server with hot-reload
npm run lint         # Run ESLint
node_modules/.bin/tsc --noEmit  # Type-check without emitting
```

**Never run `npm run build` during development** — it pollutes `.next/` and breaks `npm run dev`.

## Performance Guidelines

1. **Use `useCallback` for handlers passed as props** — prevents child re-renders
2. **Use `useMemo` for expensive computations** — but only when actually expensive
3. **Use refs for mutable state** — avoids re-renders for non-visual state
4. **Lazy initialize state** — use `useState(() => expensiveComputation())`
5. **Avoid inline object/array literals in JSX** — they create new references every render

```typescript
// ❌ Bad - new object every render
<Child style={{ padding: 12, margin: 8 }} />

// ✅ Good - stable reference
const style = useMemo(() => ({ padding: 12, margin: 8 }), []);
<Child style={style} />
```

## Import Order

Follow this order for imports:

```typescript
// 1. React and Next.js
import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// 2. Components
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";

// 3. Hooks
import { useTheme } from "@/hooks/useTheme";
import { useAgentSession } from "@/hooks/useAgentSession";

// 4. Lib utilities
import { encodeFilePathForApi } from "@/lib/file-paths";
import { normalizeToolCalls } from "@/lib/normalize";

// 5. Types (use import type)
import type { SessionInfo, AgentMessage } from "@/lib/types";
```

## Documentation

- **Component files**: No JSDoc needed; code should be self-documenting
- **Lib functions**: Add JSDoc for public APIs with complex signatures
- **Hooks**: Document the return object shape in the hook file
- **API routes**: Document request/response shapes in comments

Example:

```typescript
// lib/agent-client.ts
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  // ...
}
```
