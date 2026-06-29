# Design: Trellis Subagent Model Routing

## Summary

Add a Trellis subagent model-routing layer that resolves the model for each `trellis_subagent` child process from a typed settings schema. The resolver sits inside `.pi/extensions/trellis/index.ts`, between explicit tool inputs and existing `.pi/agents/*` frontmatter defaults.

The design intentionally keeps routing local to the Trellis extension because that is the only place that sees the final subagent prompt, agent name, mode, and Pi child-process spawn.

## Current Runtime

```text
Main web session model/thinking
  └─ assistant calls trellis_subagent({ agent, prompt, model?, thinking? })
      └─ .pi/extensions/trellis/index.ts
          ├─ reads .pi/agents/<agent>.md frontmatter
          ├─ resolveRunCfg(input, agentCfg, inheritedThinking)
          └─ spawn pi --mode json -p --no-session [--model ...] [--thinking ...]
```

Current limitations:

- The selected main-session model is not inherited by the child; only thinking can be inherited via `pi.getThinkingLevel?.()`.
- Persistent web settings do not define subagent model policy.
- `fallbackModels` is parsed from agent frontmatter but not used.
- Model routing is only possible when the parent model manually fills `model` in the tool call.

## Proposed Data Flow

```text
pi-web.json
  └─ trellis.subagents routing config
      └─ SettingsConfig validates/edits config via /api/web-config
          └─ trellis extension reads config at tool execution time
              ├─ collects run context: agent, mode, prompt(s), parent model/thinking
              ├─ optional router model classifies modality+difficulty
              ├─ resolves model entry by precedence
              └─ spawns child pi with resolved --model/--thinking
```

## Config Shape

Add a nested section under `trellis`:

```jsonc
{
  "trellis": {
    "enabled": true,
    "includeArchived": false,
    "proxyEnabled": false,
    "proxyUrl": "",
    "subagents": {
      "enabled": true,
      "defaultPolicy": {
        "model": { "mode": "followMain" },
        "thinking": "inherit"
      },
      "router": {
        "enabled": false,
        "model": { "mode": "specific", "provider": "openai", "modelId": "gpt-4.1-mini" },
        "thinking": "minimal",
        "fallbackOnError": { "modality": "text", "tier": "standard" }
      },
      "routes": {
        "text": {
          "simple": { "model": { "mode": "specific", "provider": "deepseek", "modelId": "deepseek-chat" }, "thinking": "off" },
          "standard": { "model": { "mode": "followMain" }, "thinking": "inherit" },
          "complex": { "model": { "mode": "specific", "provider": "anthropic", "modelId": "claude-sonnet-4" }, "thinking": "high" },
          "critical": { "model": { "mode": "specific", "provider": "anthropic", "modelId": "claude-opus-4" }, "thinking": "xhigh" }
        },
        "multimodal": {
          "simple": { "model": { "mode": "followMain" }, "thinking": "inherit" },
          "standard": { "model": { "mode": "specific", "provider": "openai", "modelId": "gpt-4.1" }, "thinking": "medium" },
          "complex": { "model": { "mode": "specific", "provider": "google", "modelId": "gemini-2.5-pro" }, "thinking": "high" },
          "critical": { "model": { "mode": "specific", "provider": "google", "modelId": "gemini-2.5-pro" }, "thinking": "xhigh" }
        }
      },
      "agents": {
        "trellis-check": {
          "strategy": "route",
          "minimumTier": "standard"
        },
        "trellis-research": {
          "strategy": "fixed",
          "fixed": { "model": { "mode": "specific", "provider": "openai", "modelId": "gpt-4.1-mini" }, "thinking": "low" }
        },
        "trellis-implement": {
          "strategy": "route",
          "minimumTier": "complex"
        }
      }
    }
  }
}
```

### Core Types

```ts
type SubagentModelMode = "followMain" | "piDefault" | "specific" | "unset";
type SubagentDifficultyTier = "simple" | "standard" | "complex" | "critical";
type SubagentModality = "text" | "multimodal";
type SubagentThinking = "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface SubagentModelRef {
  mode: SubagentModelMode;
  provider?: string;
  modelId?: string;
}

interface SubagentRunPolicy {
  model: SubagentModelRef;
  thinking: SubagentThinking;
}

interface SubagentRouterConfig {
  enabled: boolean;
  model: SubagentModelRef;
  thinking: SubagentThinking;
  fallbackOnError: { modality: SubagentModality; tier: SubagentDifficultyTier };
}

interface SubagentAgentOverride {
  strategy: "default" | "route" | "fixed" | "disabled";
  fixed?: SubagentRunPolicy;
  minimumTier?: SubagentDifficultyTier;
  maximumTier?: SubagentDifficultyTier;
}
```

## Model Reference Semantics

- `followMain`: use the parent session's current provider/model and current thinking unless a route explicitly sets thinking.
- `piDefault`: pass no `--model`; child Pi CLI uses its own configured default.
- `specific`: pass a specific provider/model to child Pi CLI.
- `unset`: ignore this policy entry and continue to the next lower-precedence source.

The extension should normalize a `specific` reference into the exact CLI string accepted by Pi. The safest initial representation is `provider/modelId` in config plus a helper that emits the same string format the Pi CLI expects. If the CLI only accepts model IDs for some providers, add a compatibility adapter in one shared helper rather than formatting strings inline.

## Resolution Precedence

Highest to lowest:

1. Explicit `trellis_subagent` tool input: `model` / `thinking`.
2. Agent override with `strategy: "fixed"`.
3. Route table selected by router classification when router is enabled and agent strategy permits routing.
4. Agent override with `strategy: "route"` plus `minimumTier` / `maximumTier` applied to the selected tier.
5. `subagents.defaultPolicy`.
6. Existing `.pi/agents/<agent>.md` frontmatter: `model`, `thinking`.
7. `followMain` fallback for thinking and main model if available.
8. Pi CLI default model.

Important compatibility rule: explicit tool input and existing frontmatter must keep working. If `trellis.subagents.enabled` is false or missing, behavior remains today's behavior except for optional parent model inheritance if implemented separately.

## Router Model

### Purpose

The router model classifies the subagent task before worker spawn. It should return only structured JSON:

```json
{
  "modality": "text",
  "tier": "complex",
  "confidence": 0.82,
  "reason": "Implementation task touches config, extension runtime, API, and UI."
}
```

### Input

The classifier prompt should include:

- agent name (`trellis-implement`, `trellis-check`, `trellis-research`, custom Trellis agent);
- mode (`single`, `parallel`, `chain`);
- subagent prompt(s), truncated with a stable max length;
- whether uploaded image/file references exist in the parent tool call or prompt;
- active task artifact summary if already loaded cheaply;
- optional user-set per-agent minimum/maximum tier.

### Classification Heuristics

Use deterministic pre-checks before calling the router model:

- If prompt or attachments contain images, screenshots, diagrams, or explicit multimodal words, set modality candidate to `multimodal`.
- If agent is `trellis-check`, minimum tier should default to `standard` because it can change code and run validation.
- If agent is `trellis-implement`, minimum tier should default to `complex` for cross-layer implementation tasks.
- If mode is `parallel` with multiple prompts, use the max tier across prompts or classify each child separately in a later phase.

### Failure Behavior

If the router model fails, times out, returns invalid JSON, or references an unavailable route:

1. Use `router.fallbackOnError` if configured.
2. Else use `subagents.defaultPolicy`.
3. Else preserve current behavior.

Do not block subagent execution solely because routing failed.

## Parent Model Propagation

The extension needs access to the main session model, not just thinking.

Recommended approaches, in order:

1. Extend Pi extension API usage if a `getModel()` or session model accessor exists.
2. If unavailable, capture model from session events if Pi exposes model-change / message metadata in extension hooks.
3. As a fallback for web-originated sessions, inject parent model into `trellis_subagent` tool input as hidden metadata only if Pi supports non-model-visible tool metadata. Avoid asking the LLM to fill this manually because it is unreliable.

If none is available, `followMain` degrades to `piDefault` and the progress UI should report `followMainUnavailable`.

## Extension Runtime Changes

Add these internal helpers to `.pi/extensions/trellis/index.ts` or split into local helper functions inside the extension file if packaged extension imports are unsafe:

- `readSubagentRoutingConfig()` — reads `~/.pi/agent/pi-web.json` directly or through a safe bundled helper.
- `normalizeSubagentRoutingConfig(raw)` — defaults and validates only the fields needed by the extension.
- `resolveParentModel(ctx)` — returns `{ provider, modelId } | null`.
- `classifySubagentRoute(input, routerConfig, parentCtx)` — calls the router model and validates JSON.
- `resolveSubagentRunConfig(input, agentCfg, routingConfig, parentCtx)` — replaces/extends current `resolveRunCfg`.
- `formatCliModel(modelRef, parentModel)` — one owner for CLI model-string formatting.

## Progress / Observability

Extend `RunState` and/or `ProgressDetails` with a routing explanation:

```ts
interface SubagentRoutingDecision {
  source: "toolInput" | "agentFixed" | "route" | "defaultPolicy" | "agentFrontmatter" | "followMain" | "piDefault";
  modality?: SubagentModality;
  tier?: SubagentDifficultyTier;
  model?: string;
  thinking?: string;
  routerModel?: string;
  fallbackReason?: string;
}
```

The Subagents panel can then show: `route text/complex → anthropic/claude-sonnet-4:high`.

## UI Design

In `SettingsConfig.tsx`, add an advanced Trellis section: "Subagent models".

Minimum UI controls:

- master toggle: enable subagent routing settings;
- default policy selector:
  - follow main model;
  - Pi default;
  - specific model;
- router toggle and router model selector;
- route table editor for text/multimodal × simple/standard/complex/critical;
- per-agent overrides for known `.pi/agents/*.md` entries discovered from workspace or fixed defaults for common Trellis agents;
- thinking selector per policy with `inherit` option.

Use `/api/models` to populate model dropdowns and thinking-level compatibility hints. Settings validation should reject `specific` entries without both provider and modelId.

## API / Config Changes

- `lib/pi-web-config.ts`
  - Add `PiWebTrellisSubagentConfig` and nested types.
  - Add defaults and normalizer so older `pi-web.json` files remain valid.
  - Add validation for model modes, route keys, tier keys, and thinking values.
- `app/api/web-config/route.ts`
  - No route shape change needed if the existing patch endpoint accepts the extended Trellis config.
- `docs/modules/frontend.md`, `docs/modules/api.md`, `docs/modules/library.md`, `docs/architecture/overview.md`
  - Update once implementation starts because this adds config fields and cross-layer behavior.

## Compatibility

- Existing `pi-web.json` without `trellis.subagents` normalizes to defaults.
- If `trellis.subagents.enabled` is false, keep current behavior.
- Existing `.pi/agents/*` frontmatter remains supported.
- Existing explicit tool-call `model` and `thinking` remain highest precedence.
- If a stored model no longer exists in `/api/models`, the UI should show it as unavailable and the runtime should fall back according to failure behavior.

## Rollout Plan

Phase 1: Config schema + settings UI + runtime default/follow-main resolution.

Phase 2: Router model classification + route table.

Phase 3: Optional fallback retry using `fallbackModels` and route-level fallback arrays.

This staged rollout prevents the first implementation from mixing persistent config, UI, routing inference, and retry semantics into one risky change.

## Rollback

Because the feature is config-driven:

- disable `trellis.subagents.enabled` to return to current behavior;
- keep unknown config fields preserved in `pi-web.json` where possible;
- if the extension cannot parse routing config, it should ignore the routing section and proceed with current behavior.
