# 聊天自动吸底开关

## Goal

Improve the chat reading experience by adding an opt-out auto-stick-to-bottom mode for the conversation area. New agent output should stay visible by default, while user-initiated upward scrolling should pause the sticky behavior until the user returns to the bottom.

## Confirmed Facts

- Chat scrolling is currently coordinated in `hooks/useAgentSession.ts` with `messagesEndRef`, `scrollContainerRef`, `pendingScrollToUserRef`, and `initialScrollDoneRef`.
- `components/ChatWindow.tsx` renders a scrollable message container, streaming assistant output, a minimap, and an agent-running spacer that can create a large blank region below the current output.
- `components/ChatInput.tsx` already contains the completion-sound toggle in the right-side control group.
- `hooks/useAudio.ts` persists the sound preference in `localStorage`, which is a suitable pattern for a UI preference toggle.

## Requirements

- Auto-stick-to-bottom is enabled by default and persisted as a browser preference.
- When enabled, new or streaming assistant output scrolls to the latest visible output automatically.
- If the user scrolls upward away from the bottom, auto-stick pauses so the user can read earlier agent output.
- If the user scrolls back near the bottom, auto-stick resumes for subsequent output.
- Add an icon toggle next to the completion sound toggle in the chat input controls.
- When auto-stick is disabled, avoid forcing scroll-to-bottom for new assistant output; preserve intentional user scroll position as much as possible.
- Avoid the current large blank-bottom experience when auto-stick is enabled.

## Acceptance Criteria

- [ ] The chat input shows an auto-stick-bottom toggle beside the completion sound toggle.
- [ ] The toggle defaults on, persists in `localStorage`, and updates immediately when clicked.
- [ ] With auto-stick on, streaming output remains visible at the bottom without requiring mouse-wheel scrolling.
- [ ] With auto-stick on, manually scrolling up pauses automatic bottom scrolling.
- [ ] With auto-stick on, manually scrolling back to the bottom resumes automatic bottom scrolling.
- [ ] With auto-stick off, incoming output does not forcibly scroll the conversation to the bottom.
- [ ] The running-agent blank spacer is not shown in auto-stick mode, preventing a large blank region below current output.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Out of Scope

- Server/API changes.
- Cross-device synchronization of the preference.
- Redesigning the chat minimap or message layout.
