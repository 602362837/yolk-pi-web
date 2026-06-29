# Code, Comment, and Test Standards

This is the project standards entry point. Prefer existing local patterns over broad rewrites.

## Code Style

- TypeScript is strict (`tsconfig.json`); avoid `any` unless a boundary is truly dynamic and document why.
- Use the `@/*` path alias for project-root imports when it improves clarity.
- Keep route-specific logic in `app/api/.../route.ts`; move reusable parsing, validation, and cross-route behavior to `lib/`.
- Keep UI state orchestration in hooks, especially `hooks/useAgentSession.ts` for chat/session behavior.
- Follow nearby component style for React props, local state, and event handlers.
- Before changing constants, event kinds, JSONL fields, config fields, or shared helpers, search the repository for existing uses.

## Comment Style

- Comment non-obvious behavior: lifecycle invariants, external protocol compatibility, security/trust boundaries, or intentionally surprising workarounds.
- Do not add comments that only repeat what the next line of code says.
- Keep comments close to the code they explain and update them when behavior changes.
- Use TODO/FIXME only when there is a clear follow-up condition or owner/context.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Do not run `next build` directly during development. Use `npm run build` only for release/publish validation because it is wrapped by `scripts/build-next.js`.

## Tests

There is no dedicated automated test suite in the current repository. For changes that affect data flow, use lint + type-check and manually verify the affected browser/API flow. If a test framework is introduced later, document it here and update `AGENTS.md`.

## Trellis Specs

Local Trellis guidance exists under `.trellis/spec/` and is not project documentation. If a coding task uses Trellis, load the relevant spec indexes before editing; user-facing project knowledge still belongs in `docs/`.
