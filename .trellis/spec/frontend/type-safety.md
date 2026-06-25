# Type Safety

> Type safety patterns in this project.

---

## Type Organization

Types are organized by scope:

### Shared Types (`lib/types.ts`)
App-wide type contracts used across components, hooks, and API routes:

```typescript
// lib/types.ts
export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}
```

### Component-Local Types
Props and local interfaces defined within component files:

```typescript
// components/ChatWindow.tsx
interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
}

// Local helper type
interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}
```

### Interface Adapters (`lib/pi-types.ts`)
Wrapper interfaces for external libraries:

```typescript
// lib/pi-types.ts
export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: { images?: Array<...> }): Promise<void>;
  abort(): Promise<void>;
  // ...
}
```

## Discriminated Unions

Use discriminated unions for variant types:

```typescript
// lib/types.ts
export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type AssistantContentBlock = 
  | TextContent 
  | ImageContent 
  | ThinkingContent 
  | ToolCallContent;
```

**Narrow with type guards:**

```typescript
const textBlocks = message.content.filter(
  (b): b is TextContent => b.type === "text"
);
```

## Type Guards and Normalization

Create type guards and normalizers for external data:

```typescript
// lib/normalize.ts
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function normalizeToolCallBlock(block: unknown): ToolCallContent | null {
  if (!isObject(block) || block.type !== "toolCall") return null;
  return {
    type: "toolCall",
    toolCallId: typeof block.toolCallId === "string" 
      ? block.toolCallId 
      : (typeof block.id === "string" ? block.id : ""),
    toolName: typeof block.toolName === "string" 
      ? block.toolName 
      : (typeof block.name === "string" ? block.name : ""),
    input: typeof block.input === "object" && block.input !== null 
      ? block.input as Record<string, unknown>
      : {},
  };
}

export function normalizeToolCalls(msg: AgentMessage): AgentMessage {
  if (msg.role !== "assistant") return msg;
  const content = (msg as AssistantMessage).content;
  if (!Array.isArray(content)) return msg;
  const normalized = content.map((block) => {
    const result = normalizeToolCallBlock(block);
    return result ?? block;
  });
  return { ...msg, content: normalized } as AgentMessage;
}
```

**Call normalization at data boundaries:**
- When loading from files (`lib/session-reader.ts`)
- When receiving from SSE streams (`hooks/useAgentSession.ts`)

## Optional Fields

Mark optional fields with `?`:

```typescript
export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  provider: string;
  stopReason?: string;        // Optional
  errorMessage?: string;      // Optional
  timestamp?: number;         // Optional
  usage?: {                   // Optional object
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}
```

**Check optional fields before use:**

```typescript
if (message.usage?.cost) {
  const totalCost = message.usage.cost.total;
}
```

## Generic Types

Use generics for reusable utilities:

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

// Usage:
const result = await sendAgentCommand<{ sessionId: string }>(
  sessionId, 
  { type: "prompt", message }
);
```

## Union Types for State

Use union types for state machines:

```typescript
// hooks/useAgentSession.ts
export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

// Narrow with discriminant:
if (phase?.kind === "running_tools") {
  const toolNames = phase.tools.map((t) => t.name);
}
```

## Callback Types

Type callback props explicitly:

```typescript
interface Props {
  onSessionCreated?: (session: SessionInfo) => void;
  onBranchDataChange?: (
    tree: SessionTreeNode[], 
    activeLeafId: string | null, 
    onLeafChange: (leafId: string | null) => void
  ) => void;
}
```

**Don't use generic `Function` type** — always specify the signature.

## Runtime Type Checking

The project does **not** use runtime validation libraries (Zod, Yup, io-ts). Instead:

1. **Trust TypeScript types** at compile time
2. **Use type guards** for external data (API responses, file parsing)
3. **Normalize at boundaries** (see `lib/normalize.ts`)

```typescript
// Type guard for unknown data
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

// Use before accessing fields
if (!isObject(block) || block.type !== "toolCall") return null;
```

## Common Patterns

### Partial Types for Updates
Use `Partial<T>` for update payloads:

```typescript
const [streamingMessage, setStreamingMessage] = 
  useState<Partial<AgentMessage> | null>(null);
```

### Record Types for Lookups
Use `Record<K, V>` for dictionaries:

```typescript
const [modelNames, setModelNames] = useState<Record<string, string>>({});
const [modelThinkingLevels, setModelThinkingLevels] = 
  useState<Record<string, string[]>>({});
```

### Ref Types
Type refs explicitly:

```typescript
const eventSourceRef = useRef<EventSource | null>(null);
const chatInputRef = useRef<ChatInputHandle | null>(null);
const branchLeafChangeFnRef = 
  useRef<((leafId: string | null) => void) | null>(null);
```

## Forbidden Patterns

1. **Don't use `any`** — use `unknown` and narrow with type guards
2. **Don't use type assertions (`as`)** except when normalizing external data (see `lib/normalize.ts`)
3. **Don't skip type checking** with `@ts-ignore` — fix the type instead
4. **Don't define types inline** in complex expressions — extract to a named interface
5. **Don't duplicate types** — import from `lib/types.ts` for shared contracts

## Type Imports

Use `import type` for type-only imports:

```typescript
import type { 
  AgentMessage, 
  SessionInfo, 
  SessionTreeNode 
} from "@/lib/types";

import type { 
  AssistantMessage, 
  UserMessage, 
  ToolResultMessage 
} from "@/lib/types";
```

This ensures types are not included in the JavaScript bundle.
