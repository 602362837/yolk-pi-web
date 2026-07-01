# Mobile Responsive Adaptation

## Problem

Pi Agent Web has partial mobile support for the main chat surface, but many secondary controls and panels still assume desktop width. On phone-sized viewports, top-bar actions, the minimap, input controls, side panels, modal dialogs, and terminal/file/task surfaces can crowd, overflow, or consume too much width.

## Goals

- Make the core app shell usable at phone widths around 360px–430px without horizontal page overflow.
- Preserve desktop layout and behavior at tablet/desktop widths.
- Prioritize high-traffic flows: selecting workspaces/sessions, chatting, changing models/tools, opening files/tasks, and using settings/models/skills dialogs.
- Add responsive CSS/classes where possible instead of duplicating component trees.
- Keep changes focused on layout/adaptation; do not change backend behavior or persisted data formats.

## Non-Goals

- No redesign of visual identity or component hierarchy beyond responsive layout needs.
- No native mobile app/PWA installation work.
- No full rewrite of inline-style-heavy components into a design system.
- No terminal feature expansion beyond preventing unusable mobile layout.

## Target Areas

1. `AppShell`: mobile-safe top bar, side overlay, right panel behavior, floating panel toggles.
2. `ChatWindow` and `ChatInput`: mobile chat width, hide minimap, tighter input padding, wrapping/scrollable control rows, mobile dropdown bounds.
3. `SessionSidebar` and `FileExplorer`: ensure sidebar content fits within mobile drawer and context menus/dialogs stay in viewport.
4. `FileViewer` and `TrellisPanel`: ensure right panel behaves as full-width overlay on mobile, with vertical list/detail layouts where applicable.
5. Modal dialogs: `ModelsConfig`, `SettingsConfig`, `SkillsConfig`, `UsageStatsModal`, `ChatGptWarmupDialog`, `TrellisWorkflowVisualizer` should clamp or full-screen on narrow viewports.
6. `TerminalPanel`: provide a mobile-safe dock/fullscreen fallback and avoid cramped split controls.

## Acceptance Criteria

- At 375px viewport width, the main app does not create horizontal document overflow during normal chat usage.
- Mobile sidebar opens as an overlay and does not obscure close/toggle access permanently.
- Top-bar actions do not push stats/usage controls off-screen; lower-priority text labels can hide or scroll horizontally.
- Chat minimap is hidden or non-intrusive on phone widths, and chat input uses available width efficiently.
- Chat input bottom controls wrap or horizontally scroll without breaking send/abort access.
- Right panel opens full-width on mobile and can be closed using existing floating buttons.
- Major modals clamp to viewport width/height or switch to full-screen mobile layout.
- Desktop behavior remains visually equivalent at widths above 640px.
- Validation passes with `npm run lint` and `node_modules/.bin/tsc --noEmit`, or any pre-existing/unrelated failures are clearly reported.
