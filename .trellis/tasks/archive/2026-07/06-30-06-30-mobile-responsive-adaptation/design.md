# Design: Mobile Responsive Adaptation

## Strategy

The existing frontend uses a mix of Tailwind utility classes and inline styles. The lowest-risk adaptation path is to add semantic CSS classes to key containers, then define breakpoint-specific behavior in `app/globals.css`. Inline styles remain for component-specific visual details, while CSS classes handle layout changes that need media queries.

## Breakpoints

- Mobile: `max-width: 640px`, matching existing sidebar/right-panel CSS.
- Desktop/tablet: existing behavior at `min-width: 641px` should be preserved.

## App Shell

- Add class names to the shell root, top bar, top action group, stats group, right-panel toggles, and chat area wrappers.
- On mobile:
  - Keep sidebar as fixed overlay.
  - Make the top bar horizontally scrollable for action buttons, while keeping the sidebar/theme buttons stable.
  - Hide non-essential top-bar labels where needed via CSS class hooks, not by removing controls.
  - Keep right panel full-width and ensure floating right toggles remain reachable.

## Chat Surface

- Hide `ChatMinimap` on mobile using a wrapper class.
- Replace minimap-specific input padding with CSS-variable-driven padding so mobile can reclaim the reserved space.
- Allow chat input control rows to wrap or scroll horizontally, preserving send/abort visibility.
- Clamp dropdown panels to viewport width where they are positioned with fixed coordinates.

## Panels and Modals

- Add reusable mobile dialog classes for fixed overlays and dialog bodies.
- For large dialogs with fixed widths, clamp width with `min()`/`calc()` and use `max-height` plus internal scrolling.
- For complex split-pane dialogs, stack panes vertically on mobile where class hooks are available; otherwise provide viewport clamping as a first pass.

## File, Trellis, and Terminal Surfaces

- File viewer already uses internal overflow areas; mobile work focuses on the right panel opening full-width.
- Trellis already stacks list/detail panes on mobile; verify class coverage and preserve it.
- Terminal panel should avoid desktop split assumptions on mobile by letting the dock use the available width and scroll tabs.

## Risk Management

- Prefer CSS-only responsive changes where possible.
- Avoid changing data flow, session state, or API contracts.
- Validate after each coherent batch with lint/type-check when implementation completes.
