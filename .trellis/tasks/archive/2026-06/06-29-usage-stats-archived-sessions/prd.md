# Investigate usage stats for archived sessions

## Goal

Understand the existing Usage statistics logic shown in the lower-left UI and identify why statistics for sessions may disappear after sessions are folded/collapsed or archived.

## Requirements

- Inspect the current code paths that compute and display Usage statistics.
- Trace how session lifecycle states (active, folded/collapsed in UI, archived/hidden/removed from session lists) affect the data included in Usage.
- Implement the agreed fix: Usage statistics should include archived sessions by default in both All and Cwd scopes.
- Surface enough metadata in the Usage modal to make active/archived scan counts visible.
- Add a Usage settings module so the user can choose whether Usage scans active sessions only or active + archived sessions.
- Display rounded M-token conversions in the Usage modal total tokens metric and each token breakdown row.
- Ignore already-deleted session files for this task; no recovery mechanism is required.

## Acceptance Criteria

- [x] A concise summary of the current Usage statistics data flow is provided in `research/current-usage-stats-flow.md`.
- [x] The summary identifies where session filtering/collapse/archive state can exclude usage records.
- [x] Usage statistics include archived sessions by default in All and Cwd scopes.
- [x] The modal shows active/archived scanned and matched session counts.
- [x] Settings include a Usage module controlling active-only vs active + archived aggregation.
- [x] Token totals and token rows show rounded M-token conversions.
- [x] Deleted sessions remain out of scope.

## Out of Scope

- Recovering usage for session files that were already deleted.
