# Pi Agent Web — Trellis Spec

> Project-specific coding guidance for AI assistants and developers.

---

## Spec Structure

| Directory | Scope | Description |
|-----------|-------|-------------|
| [`frontend/`](./frontend/) | Frontend layer | Components, hooks, state, types, quality standards |

---

## Quick Start

1. **Understand the architecture**: Read `AGENTS.md` for the full system overview
2. **Locate guidelines**: Use the spec index in each directory
3. **Follow patterns**: Reference files demonstrate the preferred patterns
4. **Avoid anti-patterns**: Each guideline lists forbidden patterns and common mistakes

---

## Key Principles

### 1. Runtime Boundaries
- `app/` — Next.js App Router entrypoints and API routes
- `components/` — Client UI components
- `hooks/` — Browser-side stateful logic
- `lib/` — Shared TypeScript utilities and type contracts

### 2. Session Lifecycle
- One `AgentSessionWrapper` per session ID in `globalThis.__piSessions`
- Idle timeout: 10 minutes
- After fork: destroy wrapper immediately (fork mutates `inner.sessionId` in-place)

### 3. Type Safety
- Shared types in `lib/types.ts`
- Discriminated unions for variants (e.g., `AgentMessage`)
- Type guards for external data (API responses, file parsing)
- No runtime validation libraries — rely on TypeScript + normalization

### 4. State Management
- Local state: `useState` for component UI
- Complex state: `useReducer` for multi-field transitions
- External stores: `useSyncExternalStore` for theme
- URL state: `useSearchParams` for session ID
- Persistent: `localStorage` for user preferences

### 5. Styling
- CSS variables for theming (`var(--bg)`, `var(--text)`, etc.)
- Inline styles with CSS variables
- Theme toggles via `html.dark` class
- View Transitions API for theme animation

---

## Verification Commands

```bash
# Type-check without emitting
node_modules/.bin/tsc --noEmit

# Run ESLint
npm run lint

# Start dev server
npm run dev

# Check for placeholder text in specs
grep -R "To be filled\|TODO: fill\|placeholder" .trellis/spec
```

---

## Contributing to Specs

When you discover a new pattern or fix a bug:

1. Identify which spec file should document it
2. Add the pattern with a reference to the source file
3. Include code examples from the actual codebase
4. List the anti-pattern or common mistake if applicable

**Spec quality checklist:**
- [ ] Describes the project as it exists now
- [ ] Contains real code examples with file paths
- [ ] Lists forbidden patterns and common mistakes
- [ ] No placeholder text or generic advice
- [ ] Index files match the actual spec file set
