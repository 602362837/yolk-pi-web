# Design — 聊天自动吸底开关

## Boundaries

- `hooks/useAgentSession.ts` remains the owner of chat scroll refs and message/stream lifecycle side effects.
- `components/ChatWindow.tsx` wires the user preference into the session hook and controls whether the running-agent spacer is rendered.
- `components/ChatInput.tsx` renders the new preference toggle next to the existing completion sound toggle.
- A small browser-only preference hook follows the `hooks/useAudio.ts` localStorage pattern.

## Data / State Flow

1. `ChatWindow` reads `autoScrollEnabled` from a localStorage-backed hook.
2. `ChatWindow` passes `autoScrollEnabled` into `useAgentSession` and passes the toggle props into `ChatInput`.
3. `useAgentSession` tracks an imperative `autoScrollStickyRef`:
   - `true` when the user is at/near the bottom or auto-scroll just moved to the bottom.
   - `false` when the user scrolls upward away from the bottom.
4. A scroll listener on `scrollContainerRef.current` updates `autoScrollStickyRef` while the preference is enabled.
5. Message/stream update effects scroll to bottom only when auto-scroll is enabled and sticky is active.
6. Turning the preference on sets sticky active and scrolls to the current bottom once.

## Compatibility Notes

- Initial session load still scrolls to bottom so opening an existing chat starts at the latest content.
- When auto-scroll is disabled, the existing "scroll new user prompt near the top while the agent runs" behavior is retained.
- The running-agent spacer is suppressed while auto-scroll is enabled because it creates a real scrollable blank area below the output.

## Trade-offs

- Preference is per browser via `localStorage`, matching sound settings; it is not synced through `pi-web.json`.
- Scroll pause/resume uses a bottom-distance threshold rather than exact equality to tolerate sub-pixel layout and streaming height changes.
