# review

## Check Complete

### Findings Fixed

- `lib/ypi-studio-tasks.ts`
  - Fixed archived task loading to preserve `archived:<YYYY-MM>:<task-id>` metadata in `loadTaskRecord(...)`.
  - Before the fix, loading an archived key through detail/read-write paths re-scanned the archived directory as if it were active, which could:
    - return the wrong `task.key` in detail responses,
    - bypass `record.archived` guards for bind/transition/update/subagent-record paths,
    - weaken the archived-task immutability contract.

### Remaining Findings

- None blocking.
- Low-risk follow-up: archive writes knowledge/index and appends the archive event before `renameSync(...)`. If the final rename fails, task.json is reverted, but the knowledge entry and archive event can remain. Current behavior is retryable and acceptable for MVP, but it is not fully atomic.

### Verification

- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed
- Static review — confirmed:
  - completed-only archive enforcement
  - unfinished task archive rejection with cancelled guidance
  - no unarchive path added
  - `/studio-archive` command added
  - bounded knowledge injection added for startup/input/member prompts
  - active scanner skips `.ypi/tasks/archive`
  - archived key format and route validation added
  - UI task open path now uses `pathLabel`
  - docs updated in API / frontend / library / architecture docs

### Verdict

- Pass
- The implemented scope matches the confirmed product decisions. One correctness issue around archived key loading was fixed during review; after that, lint/type-check pass and no blocking gap remains.
