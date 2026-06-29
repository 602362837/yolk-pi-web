# Browser attached UI and safety

## Goal

Add pi-web UI that makes attached browser state visible and gives users safety controls for browser-agent operation.

## Requirements

- Show attached browser/tab state in the chat UI.
- Display title, URL, connection status, and detach action.
- Provide clear warnings for debugger permission and sensitive page data.
- Let users stop/detach control immediately.
- Optionally support approval policy for risky actions.
- Ensure archived/disabled sessions do not silently receive browser actions.

## Acceptance Criteria

- [ ] User can see when a tab is attached.
- [ ] User can detach from pi-web.
- [ ] UI reflects extension disconnect/detach state.
- [ ] Browser actions are not hidden or silent.
- [ ] Safety copy documents that the agent can read/operate the attached tab.
