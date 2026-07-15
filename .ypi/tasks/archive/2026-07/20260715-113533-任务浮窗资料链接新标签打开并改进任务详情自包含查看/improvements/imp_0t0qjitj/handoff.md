# handoff — IMP-002 MODEL-PIN-2

## Status
MODEL-PIN-2 code complete. Improvement progress for this subtask should move to `done` when this implementer run records terminal success (parent/runtime).

## Files changed
- `lib/session-model-pin.ts` — `normalizeSessionModelRef`, `resolveChatDisplayModel`; pin resolve adds `live` source
- `hooks/useAgentSession.ts` — keep override across reload; `liveSessionModel`; agent_end uses `includeState`; display priority override > pending > live > context
- `scripts/test-session-model-pin.mjs` — PIN-2 display / normalize cases

## Behavior
1. `loadSession` no longer unconditionally `setCurrentModelOverride(null)`.
2. `agent_end` reloads with `includeState` and also reads live model from `/api/agent/:id` get_state payload.
3. Selector display uses `resolveChatDisplayModel`: explicit UI > pending > live get_state.model > path context.model.
4. Path context / assistant history alone cannot clobber an explicit or live Grok selection.
5. Session switch is still remounted via AppShell `key={sessionKey}`, so override/live state does not leak across sessions.

## Validation
- `npm run test:session-model-pin` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `eslint hooks/useAgentSession.ts lib/session-model-pin.ts` — pass

## Out of scope (later PIN)
- PIN-3 session-scoped set_model vs global default isolation
- PIN-4 yolk.defaultModel Settings / thinking-follow-model
- Full checks.md browser Grok↔GPT manual

## Risks
- If agent wrapper is already destroyed after agent_end, includeState may return `running:false` without model; we keep previous live/override rather than falling back to path GPT.
- Other consumers of `data.context.model` still see path model (messages/history only); only selector/pin path changed.
