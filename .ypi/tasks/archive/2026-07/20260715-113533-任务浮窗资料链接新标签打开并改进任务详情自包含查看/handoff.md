# handoff — IMP-002 MODEL-PIN-1

## Status
MODEL-PIN-1 implemented (code). Subtask completion should follow this implementer run terminal status.

## Files changed
- `lib/session-model-pin.ts` — pure resolve/equal/shouldPin helpers
- `hooks/useAgentSession.ts` — serial model-change chain, `ensureSessionModel` before prompt/steer/follow_up, failure aborts send with `setError`
- `scripts/test-session-model-pin.mjs` + `package.json` `test:session-model-pin`

## Behavior
1. `handleModelChange` optimistically updates UI refs and enqueues `set_model` on a Promise chain.
2. Existing-session `handleSend` / `handleSteer` / `handleFollowUp` await `ensureSessionModel` before the agent command.
3. Failed `set_model` throws → send aborts (no silent old-model execution).
4. New sessions still pass `provider`/`modelId` on `/api/agent/new` (and draft) and seed `lastPinnedModelRef`.

## Validation
- `npm run test:session-model-pin` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- eslint on touched files — clean

## Out of scope (later PIN)
- PIN-2 reload/display restore (loadSession still clears override; baseline seeds from context.model only)
- PIN-3 session-scoped set_model vs global default isolation
- PIN-4 yolk.defaultModel Settings / thinking-follow-model

## Risks
- Extra set_model RPC latency on send when UI model ≠ last pin
- Steer mid-stream may call set_model while agent is busy (depends on server accept)
- Without PIN-2, post-run selector may still flip from assistant history
