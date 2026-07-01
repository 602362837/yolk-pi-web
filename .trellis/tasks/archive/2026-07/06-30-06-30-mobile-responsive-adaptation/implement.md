# Implementation Plan

## Steps

1. Add responsive class hooks to `AppShell`, `ChatWindow`, and `ChatInput` around layout-critical containers.
2. Extend `app/globals.css` with mobile rules for top bar overflow, hidden low-priority labels, minimap visibility, input padding, right panel, and dialog helpers.
3. Patch high-risk dialogs/panels with reusable class names or viewport clamping: models, settings, skills, usage, warmup, Trellis workflow visualizer, terminal.
4. Review fixed-width and fixed-position UI with `rg` and add targeted mobile-safe classes where needed.
5. Run `npm run lint` and `node_modules/.bin/tsc --noEmit`.
6. Record any remaining mobile limitations and suggested follow-up work.

## Validation Plan

- Static search for remaining risky fixed widths or `100vw`/`100vh` conflicts.
- `npm run lint`.
- `node_modules/.bin/tsc --noEmit`.
- Manual browser checks recommended at 375px and desktop widths after code changes.

## Rollback Points

- If CSS-only changes cause regressions, revert `app/globals.css` mobile block additions first.
- If component class hook changes cause type/render issues, revert the affected component independently because no shared data contracts change.
