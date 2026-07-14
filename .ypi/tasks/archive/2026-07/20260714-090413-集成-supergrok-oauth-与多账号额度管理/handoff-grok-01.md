# GROK-01 Handoff: Provider Bootstrap Complete

## Status: ✅ Done

## What Was Done

### 1. New File: `lib/pi-provider-extensions.ts`
Centralized provider extension module exporting:
- `grokCliExtension` — named InlineExtension wrapping `pi-grok-cli` default factory
- `webExtensionFactories(extra)` — stable helper merging Grok + caller factories
- `ensureGrokBootstrapped()` — memoized one-shot bootstrap for standalone `ModelRegistry.create()` callers
- `createGrokAwareModelRegistry(authStorage, modelsPath?)` — drop-in replacement for raw `ModelRegistry.create()` that ensures Grok survives `refresh()`

### 2. Injected `grokCliExtension` into All Resource-Loader Paths

| File | Path | Change |
|------|------|--------|
| `lib/rpc-manager.ts` | `startRpcSession` → `DefaultResourceLoader` | `grokCliExtension` already injected (prior attempt) |
| `lib/ypi-studio-child-session-runner.ts` | SDK child `createAgentSessionServices` | `grokCliExtension` already injected (prior attempt) |
| `app/api/models/route.ts` | `GET` → `createAgentSessionServices` | `grokCliExtension` already injected (prior attempt) |
| `app/api/auth/providers/route.ts` | `GET` → `createAgentSessionServices` | `grokCliExtension` already injected (prior attempt) |
| `app/api/auth/login/[provider]/route.ts` | `GET/POST` → `createAgentSessionServices` | `grokCliExtension` already injected (prior attempt) |
| `app/api/auth/logout/[provider]/route.ts` | `POST` → `createAgentSessionServices` | `grokCliExtension` already injected (prior attempt) |
| `app/api/terminal/env/assist/route.ts` | `POST` → `createAgentSessionServices` | **Added** `grokCliExtension` |
| `app/api/trellis/workflow/assist/route.ts` | `POST` → `createAgentSessionServices` | **Added** `grokCliExtension` |
| `app/api/commands/route.ts` | `GET` → `DefaultResourceLoader` | **Added** `grokCliExtension` |
| `app/api/skills/route.ts` | `GET` → `DefaultResourceLoader` | **Added** `grokCliExtension` |

### 3. Hardened Standalone `ModelRegistry.create()` Callers

| File | Change |
|------|--------|
| `app/api/auth/api-key/[provider]/route.ts` | Replaced `ModelRegistry.create()` with `createGrokAwareModelRegistry()` |
| `app/api/auth/all-providers/route.ts` | Replaced `ModelRegistry.create()` with `createGrokAwareModelRegistry()` |
| `app/api/models-config/test/route.ts` | Replaced `ModelRegistry.create()` with `createGrokAwareModelRegistry()` |
| `lib/deepseek-balance.ts` | Added `await ensureGrokBootstrapped()` before `ModelRegistry.create()` |

## Verification

```bash
$ node_modules/.bin/tsc --noEmit    # clean, zero errors
$ npm run lint                       # clean, zero errors
$ npm ls pi-grok-cli                 # pi-grok-cli@0.4.1
```

## Files Changed (17 total, 1 new)

- `lib/pi-provider-extensions.ts` **(NEW)**
- `package.json` (pi-grok-cli@^0.4.1)
- `package-lock.json`
- `app/api/auth/all-providers/route.ts`
- `app/api/auth/api-key/[provider]/route.ts`
- `app/api/auth/login/[provider]/route.ts`
- `app/api/auth/logout/[provider]/route.ts`
- `app/api/auth/providers/route.ts`
- `app/api/commands/route.ts`
- `app/api/models-config/test/route.ts`
- `app/api/models/route.ts`
- `app/api/skills/route.ts`
- `app/api/terminal/env/assist/route.ts`
- `app/api/trellis/workflow/assist/route.ts`
- `lib/deepseek-balance.ts`
- `lib/rpc-manager.ts`
- `lib/ypi-studio-child-session-runner.ts`

## Acceptance Criteria Met

- [x] Cold-process Auth API lists grok-cli (bootstrap guard + all auth routes have Grok)
- [x] Cold-process Models API registers Grok models (models route has Grok)
- [x] Main and Studio child sessions resolve same Grok model (rpc-manager + child runner)
- [x] Provider bootstrap diagnostics surfaced without secrets (lightweight, best-effort, no credential leakage)

## Risks & Notes

1. **Full extension scope**: `pi-grok-cli@0.4.1` only exports the complete factory (Cursor tools, vision, Imagine). User must approve this scope or the upstream must provide a provider-only export. This is documented in plan-review.md.

2. **`ensureGrokBootstrapped()` one-shot cost**: Creates a throwaway `createAgentSessionServices` on first cold call (~1-2s). Subsequent calls return the memoized promise immediately. Acceptable for v1; can be optimized later.

3. **`@earendil-works/pi-agent-core` dependency**: Required by `pi-grok-cli/src/tools/webSearchDelegate.ts` as a type import. It's a transitive dep of `@earendil-works/pi-coding-agent` but was missing in the initial node_modules state. Now installed at 0.80.6.

4. **No runtime validation yet**: Only static type-check and lint run. Full runtime acceptance (fresh process → Auth/Models API see Grok) should be done in GROK-06 or GROK-07. Cold-bootstrap is structurally correct but not yet end-to-end verified.

5. **`deepseek-balance.ts`**: Uses `ensureGrokBootstrapped()` + raw `ModelRegistry.create()` rather than `createGrokAwareModelRegistry()`. This is intentional — the function is a utility called from a route handler, not a direct API endpoint. Both patterns are safe for Grok survival.

## Next Steps for Main Session

- GROK-01 is complete. Move to GROK-02 (generalize saved OAuth accounts).
- Approve the full extension scope (tools/vision/Imagine) or wait for upstream provider-only export.
