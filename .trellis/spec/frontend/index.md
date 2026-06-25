# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development in Pi Agent Web, a Next.js application with a browser UI, server API routes, and shared session/RPC utilities.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | ✅ Complete |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | ✅ Complete |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | ✅ Complete |
| [State Management](./state-management.md) | Local state, global state, server state | ✅ Complete |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | ✅ Complete |
| [Type Safety](./type-safety.md) | Type patterns, validation | ✅ Complete |

---

## Quick Reference

### Key Patterns

- **Components**: Functional components with `interface Props`, CSS variables for theming
- **Hooks**: Return objects with state + handlers, use refs for mutable state
- **State**: Local `useState`, reducers for complex transitions, `useSyncExternalStore` for theme
- **Types**: Shared in `lib/types.ts`, discriminated unions for variants, type guards for external data
- **Styling**: CSS variables (`var(--bg)`, `var(--text)`), inline styles, minimal Tailwind
- **Quality**: ESLint + TypeScript, no `any`, normalize at boundaries, clean up side effects

### Critical Files

- `lib/types.ts` — shared type contracts
- `lib/rpc-manager.ts` — AgentSession lifecycle (uses `globalThis.__piSessions`)
- `hooks/useAgentSession.ts` — central chat/session orchestration
- `app/globals.css` — CSS variable definitions for theming
- `AGENTS.md` — component/hook/route tables (update when adding new files)

### Common Mistakes to Avoid

1. Don't use hardcoded colors — use CSS variables
2. Don't import session lifecycle into components — use hooks
3. Don't duplicate path logic — use `lib/file-paths.ts`
4. Don't use module-level Maps for sessions — use `globalThis.__piSessions`
5. Don't forget to update `AGENTS.md` when adding new components/hooks/routes

---

## How to Use These Guidelines

**Before coding:**
1. Read the relevant guideline for your task
2. Check the reference files mentioned
3. Follow the patterns and avoid forbidden patterns

**During code review:**
1. Check the Quality Guidelines checklist
2. Verify TypeScript compiles (`tsc --noEmit`)
3. Verify ESLint passes (`npm run lint`)
4. Test manually in browser

---

**Language**: All documentation is written in **English**.
