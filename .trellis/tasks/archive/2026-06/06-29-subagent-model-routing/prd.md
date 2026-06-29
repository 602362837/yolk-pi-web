# Subagent model routing settings

## Goal

Design a durable model-selection system for Trellis-integrated subagent execution so a web session can keep its main conversation model while Trellis subagents can use explicit, default, or routed model choices.

## User Value

- Users can choose a strong or cheap model for the main session independently from subagent execution.
- Trellis subagents can be routed by task modality and task difficulty instead of relying on the parent model to pass ad-hoc `model` tool arguments.
- Settings can define sensible defaults, including a "follow main model" option for users who want current behavior-like simplicity.
- Routing can be evaluated by a dedicated classifier/judge model so expensive worker models are only used when needed.

## Confirmed Facts

- Trellis subagent execution lives in `.pi/extensions/trellis/index.ts` and registers the `trellis_subagent` tool.
- The tool already accepts optional `model` and `thinking` inputs and spawns a child Pi CLI process with `--model` / `--thinking`.
- `.pi/agents/<agent>.md` frontmatter already supports `model`, `thinking`, and `fallbackModels`, but `fallbackModels` is currently parsed and not used for retry.
- Current precedence is explicit tool input over agent frontmatter over inherited parent thinking; parent model itself is not inherited.
- Web settings persist in `~/.pi/agent/pi-web.json` through `lib/pi-web-config.ts`; the current Trellis settings only cover panel enablement, archived task inclusion, and setup proxy.
- `/api/models` already exposes available models, default model, thinking levels, and thinking maps for settings UI use.
- The Settings modal (`components/SettingsConfig.tsx`) is the natural UI entry point for persistent Trellis/subagent routing settings.

## Requirements

- Add a first-class configuration model for Trellis subagent model selection.
- Support these selection modes for subagent model entries:
  - follow the main session model;
  - use the Pi default model;
  - use a specific provider/model;
  - disable/ignore a route so lower-precedence defaults can apply.
- Support a default subagent model policy and optional per-agent overrides, at minimum for `trellis-implement`, `trellis-check`, and `trellis-research`.
- Support routing dimensions:
  - modality: text vs multimodal/image-capable tasks;
  - difficulty tier: simple, standard, complex, critical.
- Include a configurable router/classifier model used only to decide the route when automatic routing is enabled.
- Preserve explicit tool input as the highest-precedence override.
- Preserve compatibility with existing `.pi/agents/*` frontmatter and existing `pi-web.json` files.
- Surface the resolved model/thinking in subagent progress details so the Subagents panel can explain routing decisions.

## Acceptance Criteria

- [ ] A documented config schema exists for subagent model routing under the web/Trellis settings.
- [ ] A deterministic precedence order is defined for explicit tool input, routing settings, per-agent settings, agent frontmatter, and defaults.
- [ ] The design explains how "follow main model" is represented and how the main session model reaches the extension.
- [ ] The design explains how the router model classifies modality/difficulty and what happens if classification fails.
- [ ] The design includes API/UI integration points and validation requirements.
- [ ] The design includes backward compatibility and rollout/rollback notes.

## Out of Scope For The First Implementation

- Training a custom router model.
- Provider-specific cost optimization beyond user-configured routing tables.
- General-purpose community subagent packages outside the Trellis `trellis_subagent` tool.
- Full automatic fallback retry across multiple models unless explicitly included as a later phase.

## Product Decisions

- Automatic routing is disabled by default.
- The default subagent policy follows the main session model.
- Advanced users can manually enable router-based model routing.
