# Implementation Plan: Trellis Subagent Model Routing

## Gate

Do not start implementation until the user reviews and approves the design choices, especially the default behavior for automatic routing.

## Phase 1 — Foundation: Config + Follow Main

1. Update `lib/pi-web-config.ts`.
   - Add typed nested `trellis.subagents` config.
   - Add defaults, normalizers, and validators.
   - Preserve existing `worktree` / `trellis` fields and unknown raw config fields.
2. Add focused config validation tests if the project has a test pattern; otherwise prepare manual validation cases.
3. Update `/api/web-config` consumers if TypeScript requires response-shape changes.
4. Update `components/SettingsConfig.tsx`.
   - Fetch `/api/models` for model dropdowns.
   - Add an advanced Trellis subagent settings section.
   - Save full Trellis config patch without dropping existing Trellis settings.
5. Update `.pi/extensions/trellis/index.ts`.
   - Read and normalize the new config at tool execution time.
   - Add model-reference resolution for `followMain`, `piDefault`, `specific`, and `unset`.
   - Add parent-model access if available from Pi extension context/API; if unavailable, degrade `followMain` to Pi default with a recorded routing note.
   - Preserve current explicit-input and agent-frontmatter behavior.
6. Extend subagent progress details with routing decision metadata.
7. Update `components/SubagentPanel.tsx` to display routing source/model/tier when present.
8. Update docs:
   - `docs/modules/frontend.md`
   - `docs/modules/library.md`
   - `docs/architecture/overview.md`
   - `docs/modules/api.md` only if route payload docs need clarification.

## Phase 2 — Router Classification

1. Implement deterministic pre-classification heuristics in the extension.
2. Implement router model invocation with strict JSON output parsing.
3. Add route table resolution and tier clamp by per-agent min/max.
4. Add failure fallback behavior: router fallback route → default policy → current behavior.
5. Add progress metadata for router model, modality, tier, confidence, and fallback reason.
6. Update Settings UI with route table controls.

## Phase 3 — Fallback Retry (Optional Later)

1. Decide whether to activate existing `fallbackModels` frontmatter.
2. Add route-level fallback arrays if needed.
3. Retry only on model/provider availability or transient provider errors, not on task-level failures.
4. Record retry attempts in progress details.

## Validation Commands

Minimum after implementation:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Focused manual validation:

- Existing sessions still run subagents with no `trellis.subagents` config.
- Explicit `trellis_subagent({ model, thinking })` wins over settings.
- `followMain` uses the selected main model when parent model is available.
- `piDefault` spawns child Pi without `--model`.
- Invalid config normalizes safely on read and rejects invalid writes.
- Router failure does not block subagent execution.
- Subagents panel shows resolved model/routing metadata when available.

## Risky Files / Rollback Points

- `.pi/extensions/trellis/index.ts`: runtime subagent execution; keep behavior-compatible branches and avoid unsafe imports from app code.
- `lib/pi-web-config.ts`: shared config validation; preserve unrelated config sections.
- `components/SettingsConfig.tsx`: large settings UI; avoid dropping existing Trellis proxy/setup controls.

Rollback is primarily `trellis.subagents.enabled = false`; code should also ignore unreadable/invalid routing config and preserve current behavior.
