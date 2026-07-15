# handoff

Task: `20260715-085126-操作按钮科技感-流动-tag-化与全局圆角`  
Title: 操作按钮科技感/流动/tag 化与全局圆角  
Implementer DOC-01 completed: 2026-07-15  
Plan progress at handoff: IMP-01 / IMP-02 / IMP-03 / DOC-01 complete (implementation code + docs); awaiting checker (CHK-01).

## Summary

Implemented the revised approved plan: **static pill action tags** for the sidebar utility strip and Chat top bar, with **tech motion only on inline SVG stroke overlays** (base `currentColor` + per-instance gradient dashed overlay). Button borders/backgrounds do **not** animate. Ordinary buttons get a low-specificity **8px** radius baseline; action tags use pill radius; circular/segmented/special controls keep explicit exceptions (no destructive global `button { border-radius: … !important }`).

## Files changed (implementation + docs)

| Path | Change |
| --- | --- |
| `app/globals.css` | Control radius / icon-flow tokens; `:where(button)` 8px baseline; `.tech-action-tag*` static states; sidebar 4-col / 220px 2×2; top-bar modifiers; `data-icon-flow` ambient \| interactive \| off; overlay dash animation; disabled + `prefers-reduced-motion` hide overlay; Branches inline host / badge layering. |
| `components/ActionFlowIcon.tsx` | **New** shared SVG primitive: same geometry as base + gradient overlay; `useId()` sanitized gradient id; `aria-hidden` / non-focusable. |
| `components/AppShell.tsx` | Models / Usage / Skills / Settings + top-bar actions wired to tag + `ActionFlowIcon`; removed target-button inline hover recolor; narrow sidebar `is-narrow` + `data-sidebar-width="220"`; badges use `.tech-action-tag__badge`. |
| `components/BranchNavigator.tsx` | Inline Branches trigger aligned to top-bar action tag + interactive icon-flow; dropdown still anchors via `containerRef`/`topBarRef` (`top`/`left`/`width`); non-inline header keeps `borderRadius: 0` and shared icon geometry. |
| `docs/modules/frontend.md` | Documented `ActionFlowIcon`, BranchNavigator tag wiring, and Styles section for tokens/classes/motion/a11y reuse boundaries. |

No API, config, session, SSE, or persistence changes.

## Implementation mapping (for checker)

| Area | Wiring |
| --- | --- |
| Sidebar utilities | `.sidebar-utility-actions` + `.sidebar-utility-tag`; `data-icon-flow="ambient"` (disabled Skills → `"off"`); 260px 4-col, `sidebarWidth <= 220` → 2×2 |
| Top bar | `.app-top-action-tag` + `data-icon-flow="interactive"`; Export without session → `"off"`; active via `.is-active` / `aria-pressed` / `aria-expanded` |
| Branches inline | Same interactive tag language; outer `.branch-navigator-inline` |
| Motion | Overlay only: `stroke-dasharray` / `stroke-dashoffset` (`@keyframes action-icon-flow`); ambient ~4.8s with nth-child delays; interactive ~1.55s hover/focus, ~1.25s active |
| Reduced motion / disabled | Overlay `opacity: 0` + `animation: none`; base stroke remains |

## Verification evidence

### Automated (DOC-01 re-run)

| Command | Result |
| --- | --- |
| `npm run lint` | **Pass** — 0 errors; 6 pre-existing warnings in unrelated archive/test scripts (`.ypi/tasks/archive/.../pre01-verification.mjs`, `scripts/test-model-prices.mjs`) |
| `node_modules/.bin/tsc --noEmit` | **Pass** — exit 0 |

IMP-01 / IMP-02 / IMP-03 also reported the same lint/tsc results after their code changes.

### Static searches (DOC-01)

```bash
rg -n "ActionFlowIcon|action-flow-icon|tech-action-tag|control-radius|data-icon-flow|stroke-dash" components app/globals.css
```

- Hits: `ActionFlowIcon.tsx`, `AppShell.tsx`, `BranchNavigator.tsx`, `app/globals.css` (tokens, tag states, overlay animation). Matches shared icon-flow wiring.

```bash
rg -n "edge-flow|conic-gradient|button\s*\{[^}]*!important|border-radius:.*!important" app/globals.css components/AppShell.tsx components/BranchNavigator.tsx
```

- **No** new edge-flow / border-glow path for action tags.
- Existing unrelated matches (annotate if needed): `conic-gradient` usage chart (~line 2185); markdown/other `border-radius: 0 !important` (~889). Overlay hide rules intentionally use `opacity`/`animation` `!important` under disabled/reduced-motion only — **not** destructive radius overrides.

### Browser / manual (checks.md)

| Check area | Status | Notes |
| --- | --- | --- |
| Icon flow only on SVG strokes; static borders | **Code/static only** | Structure matches revised prototype (base + overlay dash). **No Chromium/Safari live pass recorded in this worktree session.** |
| Sidebar ambient stagger; Skills disabled static | **Code/static only** | CSS nth-child delays + disabled/`off` rules present. |
| Top bar default static; hover/focus/active flow | **Code/static only** | Interactive selectors implemented. |
| 260 single-row / 220 2×2 | **Code/static only** | Class/`data-sidebar-width` wiring present; not pixel-measured in browser. |
| Mobile 36px bar / 28×28 / horizontal scroll | **Code/static only** | Existing `.app-top-label` + max-width 640 rules retained; not re-measured. |
| Branches dropdown anchor | **Code/static only** | Positioning math left on `containerRef`/`btnRef`; no live offset measurement. |
| `prefers-reduced-motion` | **Code/static only** | Media query hides overlays. |
| Global radius regression sample (Settings, dialogs, segmented, circular) | **Not executed** | `:where(button)` is live globally; needs checker/browser sampling. |
| Light/dark theme contrast | **Not executed** | Tokens defined for `:root` and `html.dark`. |

**Honesty rule:** Do not treat browser checklist items as passed. Checker should run `checks.md` browser sections in Chromium and Safari (or WebKit) before completion.

## Known deviations / residual risks

1. **Browser evidence gap (High for completion gate):** Full visual regression vs `tech-action-tags-prototype.html` not run in-agent. Blocker/high findings may still appear on real devices.
2. **`:where(button)` global baseline:** Any control relying on UA square corners without an explicit radius may now show 8px. Explicit `50%` / `0` / pill / segmented styles should win; sample Settings, Terminal, Diff modal, circular close buttons.
3. **Accent text cues retained:** Branches with content and System-with-prompt still use accent text color hints (pre-existing product cue), independent of icon-flow.
4. **React double-render of geometry children:** `ActionFlowIcon` clones the same path nodes into base + overlay groups; fine for pure geometry, not for stateful children.
5. **Path-length dash rhythm:** Shared dasharray may feel uneven across complex icons (Settings gear vs simple lines); visual polish only.
6. **Overlay `!important` hide:** Limited to disabled/off/reduced-motion overlay kill-switch; not radius. Confirm no cascade surprise on nested SVGs.
7. **Non-inline Branches header:** Still full-width panel chrome (by design), only icon primitive shared — not a top-bar tag.

## Checker focus (CHK-01)

Priority against revised prototype + `checks.md`:

1. Confirm **no** continuous border/background animation on tags.
2. Confirm bright segment travels **along** stroke/path only; base always readable if gradient fails.
3. Sidebar ambient desync vs top-bar interactive timing; Skills/Export disabled static.
4. 220px 2×2 order Models → Usage → Skills → Settings; 260 single row no clip.
5. Branches open dropdown `top/left/width` vs pre-change; keyboard focus-visible + Enter/Space.
6. Subagents/Git badges not clipped or confused with flow.
7. reduced-motion + light/dark + 1440 / 640 / 390 / 320.
8. Radius sampling: circular stays circular; segmented joints intact; ordinary buttons ≥ 8px without `!important` radius wars.

## Main session next steps

1. Mark **DOC-01 → done** (this handoff + `docs/modules/frontend.md`).
2. Transition implementation → **checking** and dispatch **checker** against `checks.md` + this handoff (do not complete task while browser items remain unproven if findings are required).
3. Do **not** git commit/push from implementer context (already out of scope).
4. No product decisions pending for docs; any visual speed/brightness tweak is optional post-check polish only if user requests.
