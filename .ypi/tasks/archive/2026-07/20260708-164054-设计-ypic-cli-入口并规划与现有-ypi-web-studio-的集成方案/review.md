# review

## Check Complete

### Findings Fixed

None — no issues required fixing during review.

### Remaining Findings

#### Non-blocking

1. **Minor indentation inconsistency in `bin/ypic.js` `checkHealth()`** — The `try` body is indented at 2 spaces while surrounding code uses 4-space convention. Purely cosmetic; does not affect execution.

2. **`findRecentSessionForCwd` filters by `!s.archived` but `listAllSessions` does not include `archived` field** — The filter is always a no-op (`undefined` is falsy, `!undefined` is true), so all non-StudioChild sessions pass. This is not a bug because `listAllSessions` only returns non-archived sessions (archived sessions live in a separate `sessions-archive/` directory). The filter is defensive but redundant. No functional impact.

3. **Health endpoint exposes `process.pid`** — This is an intentional design choice per the plan for server process identification. The PID is only visible to localhost callers. If PID exposure is considered sensitive, it can be removed in a follow-up without breaking the contract (`ypic` does not read `pid` from the health response).

No blocking findings.

### Verification

| Command | Result |
| --- | --- |
| `npm run lint` | Pass (clean) |
| `node_modules/.bin/tsc --noEmit` | Pass (clean) |
| `node bin/ypic.js --help` | Pass — displays usage, options, in-session commands |
| `node scripts/test-ypic-cli.mjs` | Pass — 16/16 checks |
| `npm pack --dry-run` | Pass — includes `bin/pi-web.js`, `bin/server-runner.js`, `bin/ypic.js` |
| `node -e "require('./bin/server-runner')"` | Pass — CommonJS loads, all 7 exports present |
| `node -e "require('./bin/ypic')"` | Pass — CommonJS loads, all 7 pure-helper exports present; `require.main === module` guard prevents `main()` execution |

### Per-requirement Verification

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| R1 | `ypi` / `ypic` dual bin; `ypi` compatible | ✅ Pass | `package.json` has both; `bin/pi-web.js` delegates to `server-runner.js` with identical param/env resolution and `openBrowser: true` |
| R2 | cwd session binding | ✅ Pass | `ypic` sends `cwd` in `POST /api/agent/draft` payload; `draftSession()` resolves canonical path via `fs.realpathSync` |
| R3 | Reuse ypi server, no self-start | ✅ Pass | `checkHealth()` validates `app === "yolk-pi-web"`; failure prints guidance and `process.exit(1)`; `startNextServer` is never called in ypic |
| R4 | Chat-only terminal experience | ✅ Pass | readline loop with `/help`, `/config`, `/open`, `/status`, `/abort`, `/steer`, `/follow`, `/quit`; SSE renders text deltas, tool start/end, compact Studio summaries |
| R5 | Studio light entry | ✅ Pass | `/studio-*` forwarded as chat prompts; `ypi_studio_task/ypi_studio_subagent/ypi_studio_wait` render compact summaries; `plan-review.md` path + Web URL displayed on `awaiting_approval`; `approvalPromptText()` explicitly states "CLI will not auto-approve"; backup `maybePromptStudioApproval()` after `agent_end` catches out-of-band approval transitions |
| R6 | Documentation | ✅ Pass | README, deployment, API, architecture, library docs all updated with ypic usage, constraints, and data flow |
| — | Project auto-registration | ✅ Pass | `resolveProjectContext()` calls `GET /api/projects` to find existing space, `POST /api/projects` to register; `registerProject` uses `canonicalizeProjectPath` + `pathKey` deduping |
| — | No TS imports in bin | ✅ Pass | `bin/ypic.js` and `bin/server-runner.js` use only `require('util')`, `require('child_process')`, `require('readline')`, `require('fs')`, `require('path')` — zero TypeScript/library imports |

### Verdict

**Pass** — All 5 subtasks are implemented according to the plan. All automated verification passes cleanly. The implementation:

- Preserves `ypi` backward compatibility
- Correctly reuses the ypi Web server over HTTP/SSE
- Never self-starts a server
- Handles project auto-registration with canonical path deduplication
- Provides Studio lightweight status display without bypassing the approval gate
- Includes documentation across README, deployment, API, architecture, and library docs
- Includes 16 pure-function smoke tests
- Is publishable (all `bin/` files included in `npm pack --dry-run`)

**Manual smoke testing deferred** to the main session: a running ypi server is needed to verify end-to-end chat flow, Studio workflow, and server reuse. The smoke checklist is documented in `docs/deployment/README.md` and `checks.md`.
