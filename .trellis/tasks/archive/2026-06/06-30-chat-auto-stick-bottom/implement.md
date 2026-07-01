# Implementation Plan — 聊天自动吸底开关

## Checklist

1. Add a localStorage-backed auto-scroll preference hook following `hooks/useAudio.ts` conventions.
2. Extend `useAgentSession` options with `autoScrollEnabled` and add sticky-bottom tracking:
   - near-bottom helper and threshold,
   - scroll listener on the message container,
   - toggle-on effect,
   - message/stream update effect that respects sticky state.
3. Wire the preference through `ChatWindow` and suppress the running spacer when auto-scroll is enabled.
4. Extend `ChatInput` props and render an icon-only auto-scroll toggle beside the sound toggle.
5. Update `docs/modules/frontend.md` for the new hook if added.
6. Validate with lint and type-check.

## Validation

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Manual Checks

- Start a chat with the toggle on and verify streaming output stays visible.
- Scroll upward during streaming and verify the view is not pulled back down.
- Scroll back to the bottom and verify sticky behavior resumes.
- Turn the toggle off and verify new output does not force bottom scrolling.
- Refresh the page and verify the preference persists.

## Rollback Points

- Revert `hooks/useAgentSession.ts` if scroll behavior regresses.
- Revert the preference hook and `ChatInput` props if the toggle UI causes layout issues.
