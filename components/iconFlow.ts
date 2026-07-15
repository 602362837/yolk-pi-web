/**
 * Opt-in host attributes for ActionFlowIcon stroke motion.
 *
 * Pair with a host element that sets `data-icon-flow` and a descendant
 * `ActionFlowIcon` (`.action-flow-icon__overlay`). Without the attr, CSS
 * keeps the overlay hidden — never force motion via global `button` rules.
 *
 * Modes:
 * - `interactive` — flow on hover / focus-visible / active-open states
 * - `ambient` — continuous flow (sidebar utility whitelist only)
 * - `off` — explicitly hide overlay (e.g. disabled or loading)
 */

export type IconFlowMode = "interactive" | "ambient" | "off";

export type IconFlowAttrs = {
  "data-icon-flow": IconFlowMode;
};

/** Stable host attrs for icon-flow opt-in. Pure; no side effects. */
export function iconFlowAttrs(mode: IconFlowMode): IconFlowAttrs {
  return { "data-icon-flow": mode };
}
