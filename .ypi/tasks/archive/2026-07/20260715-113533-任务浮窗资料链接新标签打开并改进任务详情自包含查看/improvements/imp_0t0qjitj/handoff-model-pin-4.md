# handoff — IMP-002 MODEL-PIN-4 (implementer)

## Status
MODEL-PIN-4 code complete for yolk.defaultModel(+thinking), Settings UI, new-session seed, and Chat thinking clamp.

Note: improvement DAG title for MODEL-PIN-4 said “测试、文档与回归”, while parent delegated feature scope matches implement.md r4 PIN-4 extension. This run implemented that feature + docs/tests.

## Files changed
- `lib/pi-web-config.ts` — `yolk.defaultModel` (`piDefault` | `specific` + optional thinking); normalize/validate with legacy `defaultThinkingLevel` fallback; dual-write on save
- `lib/session-model-pin.ts` — `clampThinkingLevelToSupported`
- `components/SettingsConfig.tsx` — 蛋黄𝝅 group: tool preset + 新建会话默认模型与思考等级; thinking options follow model
- `components/AppShell.tsx` / `components/ChatWindow.tsx` — pass `defaultModel` + derived thinking seed
- `hooks/useAgentSession.ts` — seed new-session model from yolk.defaultModel; clamp thinking on model switch / model list load
- `docs/modules/{frontend,library,api}.md` — model selection / config semantics
- `scripts/test-session-model-pin.mjs` — clamp cases
- `scripts/test-yolk-default-model.mjs` + `package.json` script `test:yolk-default-model`
- `scripts/test-ypi-studio-policy.mjs` — yolk shape fixture

## Behavior
1. Settings → 蛋黄𝝅: tool preset + defaultModel mode/model/thinking (thinking options from `/api/models` thinkingLevels).
2. Save writes `yolk.defaultModel` and dual-writes `defaultThinkingLevel`.
3. New empty session seeds model from specific defaultModel, else Pi `/api/models` default; thinking from config then clamped to model support.
4. Chat model change clamps thinking session-scoped (no Settings / settings.json write).
5. PIN-1/2/3 pin/isolation paths untouched.

## Validation
- `npm run test:session-model-pin` — pass
- `npm run test:yolk-default-model` — pass
- `npm run test:studio-policy` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `eslint` on changed TS/TSX files — pass

## Manual remaining (checks.md)
1. Settings pick different default models → thinking options change.
2. Save specific model+thinking → new session matches.
3. Chat switch model → thinking clamped.
4. Legacy-only `defaultThinkingLevel` still loads.

## Risks
- If model list omits a configured specific model, seed keeps the configured provider/modelId even when not in list.
- Thinking clamp on model switch uses currently loaded thinkingLevels map; empty map leaves thinking unchanged until levels load.
- Browser Grok↔GPT end-to-end not run in this implementer pass.
