# ChatGPT backend refresh scheduler with lock

## Goal

Implement a backend scheduler that refreshes all saved ChatGPT/Codex account quota caches without duplicate browser-tab loops, protected by a file lock.

## Requirements

- Add a server-side scheduler module stored on `globalThis` for hot-reload/process singleton behavior.
- Refresh all saved OpenAI Codex accounts one by one.
- Use configured cycle interval plus random cycle salt range.
- Use configured per-account interval plus random per-account salt range.
- Use existing account/quota helpers so caches remain shared with Models and panel.
- Add a lock file under the pi agent directory to reduce duplicate schedulers across Node processes.
- On startup/ensure, inspect and recover clearly stale locks.
- Stale-lock detection should be dynamic based on the configured cycle interval, e.g. `2 * refreshCycleIntervalSeconds`, without imposing a fixed minimum fallback that makes all short configurations behave the same.
- Expose scheduler status and lock diagnostics through API.
- Expose a risk-gated lock repair API for panel fault handling.

## Acceptance Criteria

- [ ] Only one scheduler runs per process and only lock owner performs refreshes.
- [ ] Multiple browser tabs do not start multiple refresh loops.
- [ ] Stale lock at startup is handled safely using the dynamic configured-cycle-based threshold.
- [ ] Scheduler status API reports enabled/running/next run/last run/last error/lock diagnostics.
- [ ] Repair API requires explicit confirmation and avoids deleting a healthy current-process lock.
- [ ] Lint and TypeScript pass.
