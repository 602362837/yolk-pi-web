# Implementation Plan

1. Start the Trellis task.
2. Update `components/ModelsConfig.tsx`:
   - add raw OAuth validation helpers;
   - add CPA conversion helper and converter registry;
   - split import text state into source/final state for convertible modes;
   - enable CPA button and keep SUB2API disabled;
   - add conversion and validation buttons;
   - submit converted final JSON as raw credential.
3. Update docs if the frontend module description needs more detail.
4. Validate:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Risk / Rollback

- Main risk is breaking existing raw import. Keep raw mode state and POST contract compatible.
- Backend stays unchanged except through existing route behavior, so rollback is limited to the dialog changes.
