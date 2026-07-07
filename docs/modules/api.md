# API Module Map

API routes live under `app/api/`. When adding, removing, or changing routes, update this file and the short index in `AGENTS.md`.

| Route | Methods | Purpose |
| --- | --- | --- |
| `projects/` | GET/POST | List Project Registry records from `~/.pi/agent/pi-web-projects.json`, or register a project path and create its main space without scanning sessions. |
| `projects/select-directory/` | POST | Open a local OS directory picker from the server process and return the selected project path; manual path entry remains the fallback when a picker is unavailable. |
| `projects/[projectId]/` | GET/PATCH | Read or update project metadata (`displayName`, `tags`, `pinned`, `archived`, `metadata`, `lastOpenedAt`). |
| `projects/[projectId]/spaces/` | GET | List spaces for one registered project. |
| `projects/[projectId]/spaces/[spaceId]/` | GET/PATCH | Read or update project-space metadata, including the main space created at registration. |
| `projects/[projectId]/spaces/[spaceId]/sessions/` | GET | List sessions explicitly linked to one project space; root `sessions` exclude Studio child audit roots but include child rows whose `studioChild.parentSessionId` belongs to a visible parent so the Sidebar can fold them under that parent. Optional `includeLegacy=1` returns exact-cwd legacy sessions separately without backfilling headers. |
| `projects/[projectId]/worktrees/refresh/` | POST | Discover `git worktree list --porcelain` entries for a registered project and upsert/archive worktree spaces without scanning sessions. |
| `sessions/` | GET | List lightweight active session summaries grouped by cwd (includes `archivedCwds` and `archivedCounts`); Git/worktree metadata is omitted by default and only included with `includeGit=1`. YPI Studio child audit sessions are filtered unless `includeStudioChildren=1` is provided for debugging/audit views. |
| `sessions/[id]/` | GET/PATCH/DELETE | Read session detail, rename, delete. Returns `archived: true` for archived sessions and includes optional `studioChild` metadata for child audit sessions. |
| `sessions/[id]/context/` | GET | Get context for a specific `leafId`. |
| `sessions/[id]/changes/` | GET | List files changed by tracked agent file tools in this session from non-Git sidecar data. |
| `sessions/[id]/changes/file/` | GET | Return the stored unified diff or metadata-only reason for one tracked session-changed file. |
| `sessions/[id]/trellis-task/` | GET | Resolve the high-confidence Trellis task associated with one pi session, using session-local transcript evidence or exact per-session Trellis runtime pointers only. |
| `sessions/[id]/studio-task/` | GET | Resolve the high-confidence YPI Studio task associated with one pi session and return a lightweight widget/Chat projection (no artifact bodies or full transcripts), including compact implementation timeline and session runtime hints such as `waiting_for_studio_children` when Studio subtasks are queued/running. |
| `sessions/[id]/export/` | GET | Export session as Markdown. |
| `sessions/new/` | 410 | Deprecated route kept for compatibility. |
| `agent/new/` | POST | Create a new session and send the first message when no precreated/effective session exists. |
| `agent/draft/` | POST | Create a real empty session for a validated cwd, applying optional tool/model/thinking selections without sending a prompt. |
| `agent/[id]/` | GET/POST | Get agent state or send a command. POST rejects YPI Studio child audit sessions as read-only so they cannot be continued as ordinary Studio-enabled chats. |
| `agent/[id]/events/` | GET | SSE event stream. |
| `browser-share/health/` | GET | Chrome extension health check for Browser Share; returns versioned capabilities including service-address config, DOM/debugger capture modes, long-poll support, bounded screenshot support, persistent debugger, heartbeat, and control projection support. |
| `browser-share/shares/` | POST | Create a short-lived Browser Share from the Chrome extension and return a one-time share code; accepts optional extension/source/capability/capture/debugger/screenshot metadata for newer extensions. |
| `browser-share/shares/[shareId]/snapshot/` | POST | Extension upload of a sanitized, bounded page snapshot for one share, including optional capture mode, viewport, debugger summary, element bounds/AX/selector refs, and screenshot metadata. |
| `browser-share/shares/[shareId]/heartbeat/` | POST | Extension heartbeat/runtime update endpoint; stores lifecycle/debugger/tab/transport projection and returns share control data, using 410 when the extension should detach for a tombstone/not-found share. |
| `browser-share/shares/[shareId]/` | DELETE | Extension stop/tab-close notification; clears the session binding, fails active commands, writes a short-lived tombstone, and returns detach control projection. |
| `browser-share/shares/[shareId]/commands/` | GET | Extension polling/long-poll endpoint for executable queued Browser Share commands; updates command heartbeat, never returns pending-approval commands, marks returned commands `running`, and returns share control projection or 410 tombstone detach data. Supports bounded `waitMs` (max 30s). |
| `browser-share/sessions/[sessionId]/bind/` | POST/DELETE | Bind a one-time share code to the explicit target chat/session, replacing any previous session binding and writing a tombstone for the old share; DELETE unbinds the current share, fails active commands, and lets the extension release debugger through heartbeat/command control projection. |
| `browser-share/sessions/[sessionId]/state/` | GET | Return the current session-scoped Browser Share status, lifecycle/operator authorization projection, tab, snapshot, heartbeat/connection projection, active commands, recent terminal commands, and optional source/capture/persistent-debugger/screenshot metadata for `BrowserShareControl` and tools. |
| `browser-share/sessions/[sessionId]/commands/` | POST | Queue a Browser Share action command for the current session binding only; permission mode decides pending approval vs queued, and action execution requires the extension's persistent debugger to be attached. |
| `browser-share/sessions/[sessionId]/commands/[commandId]/approval/` | POST | Approve a pending command into `queued` or reject it into terminal `rejected`, notifying command waiters. |
| `browser-share/commands/[commandId]/result/` | POST | Extension result callback for a Browser Share command; records terminal success/failure, stores an included snapshot plus optional capture/debugger/screenshot metadata, updates heartbeat, and ignores late terminal overwrites. |
| `files/[...path]/` | GET/PUT | List/read/watch/preview workspace files for the file viewer and safely save existing editable text files; directory listing returns truncation metadata for very large folders. |
| `files/search/` | GET | Search files in the selected workspace. |
| `files/definitions/` | GET | Lightweight workspace text/code symbol definition search for editor drill-down actions. |
| `files/implementations/` | GET | Lightweight workspace search for Java symbol implementations/references used by the Monaco file editor. |
| `files/references/` | GET | Lightweight workspace text/code symbol reference search for editor “find usages” actions. |
| `files/upload/` | POST | Upload files for chat/file workflows. |
| `models/` | GET | List available models and default model. |
| `models-config/` | GET/POST | Read/write `~/.pi/agent/models.json`. |
| `models-config/test/` | POST | Test a model config with a completion request. |
| `skills/` | GET | List installed skills for a cwd. |
| `skills/search/` | GET | Search skills.sh for available skills. |
| `skills/install/` | POST | Install a skill via `npx skills add`. |
| `commands/` | GET | List slash commands from built-in YPI Studio extension commands plus skills and prompt templates for a cwd. |
| `cwd/validate/` | POST | Validate a candidate workspace path. |
| `git/worktrees/` | GET/POST/DELETE | Inspect, create, and remove Git worktrees from the selected cwd; creation upserts a registered project worktree space when the main worktree is registered, and removal marks matching spaces archived/missing while still deleting sessions for that worktree cwd. |
| `sessions/archive/` | POST | Archive one or more sessions (moves to `sessions-archive/`). |
| `sessions/unarchive/` | POST | Unarchive one or more sessions (moves back to `sessions/`). |
| `sessions/archive-all/` | POST | Archive all sessions for a cwd. |
| `sessions/archived/` | GET | List archived sessions for a cwd. |
| `git/worktrees/archive/` | POST | Squash, push, merge, and remove a Git worktree after user risk confirmation; archive marks matching spaces archived/missing and deletes sessions for that worktree cwd. |
| `git/info/` | GET | Return best-effort Git branch/worktree metadata for a cwd. |
| `git/status/` | GET | Return detailed Git status (branch, commits, staged/unstaged changes, untracked files, stash) for a cwd. |
| `git/graph/` | GET | Return decorated commit graph data (commits, parents, refs, local branches) for the Git panel branch visualization; optional `branch` previews one validated local branch. |
| `git/commit/` | GET | Return read-only metadata and first-parent/root changed-file stats for a selected commit in the Git panel. |
| `git/diff/` | GET | Return a bounded read-only unified diff, or binary/too-large/unavailable fallback metadata, for one changed file in a selected commit. |
| `git/switch/` | POST | Switch the current workspace to a local branch. Validates cwd, branch existence, and working tree cleanliness before executing `git switch`. Returns `switchedTo` on success or an error message. |
| `web-config/` | GET/PUT | Read/write `~/.pi/agent/pi-web.json` for Yolk Pi chat defaults such as `yolk.defaultToolPreset`, WorkTree defaults, YPI Studio default/member model and thinking policies, Usage scan scope, Web Terminal settings, ChatGPT usage panel/warmup schedule/default-off auto-failover settings, Editor implementation/shortcut settings, optional Trellis panel settings, setup proxy, and Trellis subagent model policy; also lazily ensures the local ChatGPT warmup scheduler. |
| `terminal/env/assist/` | POST | Use the configured Terminal env assistant model to parse complex raw env text into normalized key-value env entries. |
| `terminal/ssh/credentials/` | GET/POST | Settings Terminal SSH credential UI lists redacted credential summaries and creates vault-backed credentials. Secret fields are accepted only on create/replace requests and are never returned to the browser. |
| `terminal/ssh/credentials/[id]/` | PATCH/DELETE | Settings Terminal SSH credential UI updates metadata or explicitly replaces secrets; DELETE returns 409 with referencing profile ids when a credential is still used unless a future force flow is chosen. |
| `terminal/ssh/profiles/` | GET/POST | List non-secret Web Terminal SSH profiles from `terminal.ssh.profiles`, or create one after route-level validation rejects secret fields such as private keys, passwords, passphrases, and proxy passwords. |
| `terminal/ssh/profiles/[id]/` | GET/PATCH/DELETE | Read, update, or delete one non-secret SSH profile in `pi-web.json`; update/delete preserves credential secrets in the separate vault and never returns secret material. |
| `terminal/ssh/profiles/[id]/test/` | POST | Settings Terminal SSH profile UI calls validate/resolve preflight for a saved profile and displays redacted warnings/errors. Resolve returns only a redacted launch plan and keeps credential secrets in the vault/temp context path. |
| `terminal/ssh/known-hosts/` | GET/POST/DELETE | Manage the dedicated Web Terminal SSH `known_hosts` file under `~/.pi/agent/terminal/known_hosts`: list redacted host-key summaries, trust a caller-provided public host key, or remove entries by host/fingerprint/index. Responses expose key type and SHA256 fingerprint, not unnecessary raw file contents. |
| `terminal/ssh/known-hosts/scan/` | POST | Best-effort `ssh-keyscan` for `{ host, port }`, returning displayable key type/SHA256 fingerprint/public key candidates plus a warning that scans do not prove trust. Scan failures are returned as normal result data and do not modify profiles or config. |
| `terminal/sessions/` | POST | Create a Web Terminal session for an authorized workspace cwd when the Terminal setting is enabled. Old local bodies `{ cwd, cols, rows }` still create local shells; `{ kind: "ssh", profileId, cwd, cols, rows }` creates an OpenSSH-backed SSH session when `terminal.ssh.enabled` is true. Responses include `kind` and optional SSH profile/target labels without secrets. |
| `terminal/sessions/[id]/` | DELETE | Close a Web Terminal session and terminate its process. |
| `terminal/sessions/[id]/events/` | GET | Stream Web Terminal output through SSE. |
| `terminal/sessions/[id]/input/` | POST | Write user input to a Web Terminal session. |
| `terminal/sessions/[id]/resize/` | POST | Resize a Web Terminal PTY. |
| `trellis/tasks/` | GET | List read-only Trellis task summaries for an authorized workspace cwd when the Trellis panel setting is enabled. |
| `trellis/tasks/[taskKey]/` | GET | Read one Trellis task detail, artifacts, manifest counts, hierarchy, and derived phase/progress. |
| `trellis/workflow/` | GET | Read and parse the selected workspace `.trellis/workflow.md` into a read-only workflow visualization projection with phases, steps, workflow-state blocks, source line ranges, and parser warnings. |
| `trellis/workflow/assist/` | POST | Use the configured Trellis workflow assistant model to translate and summarize one selected workflow node's guidance text without mutating `.trellis/workflow.md`. |
| `trellis/setup/status/` | GET | Inspect Trellis prerequisites, CLI availability, and selected-workspace initialization state without requiring the panel setting to be enabled. |
| `trellis/setup/install/` | POST | Install/ensure the Trellis CLI without running project initialization, so interactive `trellis init` prompts stay in the user's terminal. |
| `trellis/setup/init/` | POST | Legacy endpoint that installs/ensures the Trellis CLI, runs `trellis init -u <developer> --pi` for an authorized uninitialized workspace, and auto-enables the Trellis drawer setting on success. UI flows should prefer terminal-driven initialization. |
| `trellis/setup/update/` | POST | Upgrade/install the Trellis CLI and run `trellis update` for an authorized workspace that already has `.trellis`. |
| `studio/agents/` | GET/POST | Read project-local YPI Studio member cards from `.ypi/agents/` for an authorized workspace, initialize/backfill the four default members (`architect`, `ui-designer`, `implementer`, `checker`), update files that exactly match the legacy defaults, and warn about custom member files that need manual cleanup without overwriting them. |
| `studio/workflows/` | GET/POST | Read project-local structured YPI Studio workflows from `.ypi/workflows/`, and initialize/backfill default workflow JSON files without overwriting existing files. |
| `studio/tasks/` | GET/POST | List structured YPI Studio task summaries from `.ypi/tasks/` with state/progress projections (`scope=active\|archived\|all`, active by default and skips `.ypi/tasks/archive`), or create a new active task directory with task artifacts and runtime context binding. |
| `studio/tasks/[taskKey]/` | GET/PATCH | Read one YPI Studio task detail by `active:<id>` or `archived:<YYYY-MM>:<id>` including optional `implementationPlan` / `implementationProgress` and server-derived `implementationProjection` (`subtasksWithStatus`, `waitingOn`, `blockedBy`, `runsBySubtask`, `statusCounts`, `compactTimeline`, `sessionRuntime`), or PATCH `{ action: "bind", contextId }` to bind/resume an active task in the current chat context without granting approval, update an artifact, transition workflow states, save/claim/update implementation subtasks, or archive a completed active task with persisted `.ypi/knowledge` output. Implementation plan/progress contracts accept schemaVersion 2 DAG metadata: `subtasks[].dependsOn` is the scheduling source, `execution.groups` is display-only, and progress may include `waiting/queued/failed`, multi active/queued/next ids, `waitingOn`, and `blockedBy`; legacy `pending` remains accepted and should display as waiting. |
| `studio/tasks/[taskKey]/subagents/[runId]/` | GET/PATCH/DELETE | Read a bounded YPI Studio subagent run projection (registry status, progress, transcript preview metadata) or cancel a run without returning full transcript/artifact bodies. |
| `studio/tasks/[taskKey]/subagents/[runId]/transcript/` | GET | Read a bounded, browser-safe projection of a YPI Studio member delegation transcript sidecar for a run that belongs to the requested task. |
| `default-cwd/` | POST | Create and return `~/pi-cwd-<YYYYMMDD>`. |
| `home/` | GET | Return `os.homedir()`. |
| `usage/` | GET | Aggregate token/cost usage across active-only or active-plus-archived sessions based on `pi-web.json` Usage settings. |
| `auth/providers/` | GET | List configured auth provider statuses. |
| `auth/all-providers/` | GET | List all known provider ids. |
| `auth/accounts/[provider]/` | GET/POST/PATCH/DELETE | List saved OAuth accounts, import one or more raw/CPA/SUB2API OAuth account JSON entries, update account remarks/extra info, return cached quota reset metadata, and soft-delete inactive saved accounts for supported providers (`openai-codex`). |
| `auth/accounts/[provider]/activate/` | POST | Activate a saved OAuth account and reload live RPC auth state. |
| `auth/login/[provider]/` | GET/POST | Initiate OAuth login for a provider; `openai-codex?accountMode=add` saves another account without replacing active auth. |
| `auth/logout/[provider]/` | POST | Clear OAuth tokens for a provider. |
| `auth/api-key/[provider]/` | GET | Get masked API-key status for a provider. |
| `auth/balance/[provider]/` | GET | Query DeepSeek account balance. |
| `auth/quota/[provider]/` | GET/POST | GET queries OpenAI Codex subscription quota and reset-credit availability for the active account, or for a saved account with `?accountId=...`; queries update the saved account's cached quota/reset-credit metadata and refresh expired saved-account OAuth tokens when possible. POST consumes one available Codex reset credit for the active account or JSON `{ accountId }`, then returns freshly queried quota. |
| `auth/warmup/openai-codex/` | GET/POST | GET returns recent ChatGPT/Codex warmup history and lazily ensures the local scheduler. POST warms selected saved OAuth accounts by sending a tiny real Codex request without activating them; returns per-account results, records manual run history, and refreshes quota cache when possible. |
| `chatgpt/usage-refresh/status/` | GET | Ensure and inspect the backend ChatGPT usage auto-refresh scheduler, including lock diagnostics and last-run state. |
| `chatgpt/usage-refresh/ensure/` | POST | Start or re-arm the backend ChatGPT usage auto-refresh scheduler according to `pi-web.json`. |
| `chatgpt/usage-refresh/repair-lock/` | POST | Risk-gated stale lock repair for the ChatGPT usage auto-refresh scheduler. Requires `{ confirm: true }`. |
| `chatgpt/usage-refresh/run/` | POST | Trigger a best-effort immediate ChatGPT usage refresh cycle through the backend scheduler. |

## Implementation Pointers

- Agent command routes should go through `lib/rpc-manager.ts`.
- Project Registry routes should use `lib/project-registry.ts` and shared wire/schema types in `lib/project-registry-types.ts`; sessions must not be scanned to synthesize the top-level project list. Project-space session routes may filter lightweight session summaries by explicit header links and may return legacy exact-cwd matches separately.
- Session-file routes should use `lib/session-reader.ts` and shared types in `lib/types.ts`.
- Client-side command calls should use `lib/agent-client.ts`.
- Normalize streamed/file-loaded tool calls through `lib/normalize.ts`.
- Web Terminal SSH profile routes use `lib/terminal-ssh-profiles.ts` and keep profiles in `terminal.ssh` as non-secret config only; credential secrets must not be accepted through profile/config routes or written to `pi-web.json`.
- Web Terminal SSH session creation goes through `lib/terminal-manager.ts`, which calls `lib/terminal-ssh-runner.ts` to build an OpenSSH command plus session-scoped temp config/key/askpass/proxy files and registers the cleanup callback. Routes return only session metadata and never expose vault secrets.
- Web Terminal SSH credential UI uses `TerminalCredentialSummary` only; secret inputs are write-only and the browser should never receive `privateKeyPem`, `password`, `passphrase`, or `proxyPassword`.
- Web Terminal SSH known-hosts routes use `lib/terminal-known-hosts.ts`, which stores trust data in the dedicated `~/.pi/agent/terminal/known_hosts` file. `ssh-keyscan` results are advisory only; users must verify fingerprints through a trusted channel before trusting them.
