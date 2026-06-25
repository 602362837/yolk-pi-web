# Component Guidelines

> How components are built in this project.

---

## Component Structure

Components are functional React components with named exports. Each component file follows this structure:

```typescript
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { SessionInfo } from "@/lib/types";

interface Props {
  session: SessionInfo;
  onSelect: (session: SessionInfo) => void;
}

export function SessionCard({ session, onSelect }: Props) {
  // State and hooks
  const [hovered, setHovered] = useState(false);
  
  // Handlers
  const handleClick = useCallback(() => {
    onSelect(session);
  }, [onSelect, session]);
  
  // Render
  return (
    <div onClick={handleClick}>
      {session.name}
    </div>
  );
}
```

Reference files:
- `components/MessageView.tsx` — message rendering with role-based dispatch
- `components/ChatInput.tsx` — complex input with autocomplete and imperative handle
- `components/SessionSidebar.tsx` — tree rendering with local helpers

## Props Conventions

Props are defined as `interface Props` and passed via destructuring:

```typescript
interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  modelsRefreshKey?: number;
}

export function ChatWindow({ 
  session, 
  newSessionCwd, 
  onAgentEnd, 
  onSessionCreated,
  modelsRefreshKey 
}: Props) {
  // ...
}
```

**Rules:**
- Use `interface Props` (not `type Props`) for component props
- Optional callbacks use `?` suffix
- Destructure props in the function signature
- For complex callbacks, type them explicitly rather than using generic `Function`

## Styling Patterns

The project uses **CSS variables** for theming with **inline styles**:

```typescript
<div style={{
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  padding: 12,
  borderRadius: 8,
}}>
  Content
</div>
```

**Available CSS variables** (defined in `app/globals.css`):
- `--bg`, `--bg-panel`, `--bg-hover`, `--bg-selected`, `--bg-subtle`
- `--border`, `--text`, `--text-muted`, `--text-dim`
- `--accent`, `--accent-hover`
- `--user-bg`, `--assistant-bg`, `--tool-bg`
- `--font-mono`

**Tailwind CSS** is available but used minimally. Prefer CSS variables for theme-aware colors.

**Theme switching** happens via `html.dark` class. CSS variables automatically update when the class changes.

Reference: `app/globals.css` for variable definitions, `hooks/useTheme.ts` for theme toggle logic.

## Local Helper Functions

Keep feature-specific helpers inside the component file when they are not reused:

```typescript
// Inside components/ChatWindow.tsx
function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  return "Thinking...";
}

function Typewriter({ phrases }: { phrases: string[] }) {
  // Local component used only in ChatWindow
  // ...
}
```

**Promote helpers to `lib/` only when:**
- Multiple components need them
- They are pure utilities (no React imports)
- Examples: `lib/file-paths.ts` (path encoding), `lib/normalize.ts` (tool call normalization)

## Component Composition

Use **role-based dispatch** for components that render different variants:

```typescript
export function MessageView({ message, isStreaming, toolResults }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} />;
  }
  if (message.role === "toolResult") {
    return null; // Rendered inline under parent
  }
  return null;
}
```

This pattern keeps the public API simple while delegating rendering to private sub-components.

## Imperative Handles

Use `forwardRef` + `useImperativeHandle` when parent components need to call methods on child components:

```typescript
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(
  function ChatInput(props, ref) {
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    
    useImperativeHandle(ref, () => ({
      insertText: (text: string) => {
        // ...
      },
      insertIfEmpty: (text: string) => {
        // ...
      },
      addImages: (files: File[]) => {
        // ...
      },
    }), []);
    
    return <textarea ref={textAreaRef} />;
  }
);
```

Reference: `components/ChatInput.tsx` for full implementation.

## Event Handlers

Use `useCallback` for event handlers passed as props or used in effects:

```typescript
const handleBranchDataChange = useCallback(
  (tree: SessionTreeNode[], activeLeafId: string | null) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
  }, 
  [] // Empty deps when using refs for mutable state
);
```

**Use refs to avoid stale closures** when handlers need current values:

```typescript
const playDoneSoundRef = useRef(playDoneSound);
playDoneSoundRef.current = playDoneSound;

// In effect or callback:
playDoneSoundRef.current();
```

## Common Mistakes

1. **Don't import pi session lifecycle code into components** — use `lib/rpc-manager.ts` and `hooks/useAgentSession.ts` as boundaries
2. **Don't duplicate path encoding logic** — use `lib/file-paths.ts` (`encodeFilePathForApi`, `getRelativeFilePath`)
3. **Don't hardcode theme colors** — always use CSS variables like `var(--bg)` instead of hardcoded hex values
4. **Don't put business logic in render functions** — extract to helpers or move to `lib/`
5. **Don't forget to update `AGENTS.md`** when adding new components to the Components table

## Accessibility

- Use semantic HTML elements (`button`, `input`, `nav`, `main`)
- Add `aria-label` for icon-only buttons
- Ensure sufficient color contrast (CSS variables are designed for WCAG AA)
- Test keyboard navigation for interactive elements
