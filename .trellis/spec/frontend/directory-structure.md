# Directory Structure

Pi Agent Web is a single Next.js app with a browser UI, server API routes, and shared session/RPC utilities. Keep new code in the existing top-level directories instead of introducing a separate `src/` tree.

## Runtime Boundaries

- `app/` contains Next.js App Router entrypoints and API route handlers.
- `components/` contains client UI components used by the single-page shell.
- `hooks/` contains reusable browser-side stateful logic.
- `lib/` contains shared TypeScript utilities, pi session/RPC adapters, path helpers, and type contracts.
- `bin/` and `scripts/` are package/deployment tooling, not frontend runtime code.
- `docs/` is for project documentation; `.trellis/spec/` is for AI coding guidance.

Reference files: `app/page.tsx`, `components/AppShell.tsx`, `hooks/useAgentSession.ts`, `lib/session-reader.ts`, `bin/pi-web.js`.

## App Router Layout

Use thin App Router files:

- `app/layout.tsx` owns global HTML, metadata, font setup, global CSS imports, and the early theme bootstrap script.
- `app/page.tsx` only wraps `AppShell` in `Suspense`.
- `app/api/**/route.ts` files parse requests, call `lib/` helpers or pi SDK APIs, and return JSON/stream responses.

For API changes, keep business logic in `lib/` when it is shared, complex, or reused. Simple route-only glue can stay inside the route file. Existing examples: `app/api/sessions/route.ts` delegates session listing to `lib/session-reader.ts`; `app/api/agent/[id]/route.ts` delegates lifecycle work to `lib/rpc-manager.ts`; `app/api/files/[...path]/route.ts` keeps file-serving helpers local because they are route-specific.

## Component Organization

Components are flat under `components/` and named by UI role in PascalCase:

- Shell/navigation: `AppShell.tsx`, `SessionSidebar.tsx`, `TabBar.tsx`, `BranchNavigator.tsx`.
- Chat: `ChatWindow.tsx`, `ChatInput.tsx`, `MessageView.tsx`, `ChatMinimap.tsx`, `ToolPanel.tsx`.
- Files: `FileExplorer.tsx`, `FileViewer.tsx`, `FileIcons.tsx`.
- Modals/config: `ModelsConfig.tsx`, `SkillsConfig.tsx`, `UsageStatsModal.tsx`.
- Rendering helpers: `MarkdownBody.tsx`.

Keep feature-specific helper functions inside the component file when they are not reused. Examples include `phaseLabel` and `Typewriter` in `components/ChatWindow.tsx`, file extension helpers in `components/FileViewer.tsx`, and session tree helpers in `components/SessionSidebar.tsx`.

Promote helpers to `lib/` only when multiple components or routes need them. Current shared helpers include `lib/file-paths.ts` for path encoding/display and `lib/normalize.ts` for assistant tool-call normalization.

## Hook Organization

Hooks are flat under `hooks/` and named `use*.ts`:

- `hooks/useAgentSession.ts` is the central chat/session orchestration hook.
- `hooks/useTheme.ts` exposes theme state through `useSyncExternalStore`.
- `hooks/useAudio.ts` owns sound preference and playback.
- `hooks/useDragDrop.ts` owns image drag/drop state and DOM event handlers.

Do not add hook directories unless the app grows into multiple independent feature areas.

## Shared Library Organization

`lib/` is the boundary for non-React code:

- Session parsing/tree/context: `lib/session-reader.ts`.
- In-process AgentSession registry and command adapter: `lib/rpc-manager.ts`.
- Shared contracts: `lib/types.ts`, `lib/pi-types.ts`.
- Client fetch helper: `lib/agent-client.ts`.
- Cross-platform path utilities: `lib/file-paths.ts`.
- Provider/account helpers: `lib/deepseek-balance.ts`, `lib/subscription-quota.ts`.
- Process wrapper: `lib/npx.ts`.
- Usage aggregation: `lib/usage-stats.ts`.

Route files may import from `lib/`, but `lib/` should not import React components. The one intentional UI import exception is client-side dynamic import of tool presets from `components/ToolPanel.tsx` inside `hooks/useAgentSession.ts`; keep preset definitions stable if you modify this coupling.

## Naming Conventions

- React component files use PascalCase and export the component by name.
- Hook files use `useX.ts` and export the hook by name.
- Library files use kebab-case for multiword filenames, such as `session-reader.ts` and `file-paths.ts`.
- API route directories follow Next.js route conventions, including dynamic segments such as `app/api/agent/[id]/route.ts` and catch-all segments such as `app/api/files/[...path]/route.ts`.
- Local TypeScript interfaces are usually named `Props`, `FileData`, `SessionData`, etc. Shared app-wide types belong in `lib/types.ts`.

## Anti-Patterns

- Do not create a parallel `src/` directory; the project already uses root-level `app/`, `components/`, `hooks/`, and `lib/`.
- Do not put pi session lifecycle code in React components; use `lib/rpc-manager.ts` and `hooks/useAgentSession.ts` as the existing boundaries.
- Do not duplicate path encoding or relative-path logic in components; use `lib/file-paths.ts`.
- Do not add API route behavior without checking whether `AGENTS.md` needs the route table updated.
