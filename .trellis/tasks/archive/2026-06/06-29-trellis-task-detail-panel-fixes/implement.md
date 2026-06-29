# Implementation Plan

1. Load project/frontend specs before code changes.
2. Update `lib/trellis-reader.ts` progress derivation:
   - make finished check-stage details completion-focused when no real check context exists;
   - treat optional `meta.lastCheck` as the persisted check execution record;
   - keep manifest counting semantics unchanged.
3. Update `components/TrellisPanel.tsx`:
   - add date/time formatting that preserves date-only values and shows seconds for datetime values;
   - make meta cards support optional `title` text;
   - clarify the child/context cards;
   - render all progress-stage detail lines so check result and check context can both be visible;
   - refine overview metadata rendering and missing-field notes.
4. Update docs if frontend/library module descriptions need a note about the clarified Trellis panel semantics.
5. Validate:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Rollback Points

- If progress derivation change is risky, revert the `createProgress` detail text only; counts and percent logic do not need to change.
- If overview hiding is too aggressive, keep all rows visible but add explanatory notes/tooltips.
