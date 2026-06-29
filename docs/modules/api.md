# API Module Map

API routes live under `app/api/`. When adding, removing, or changing routes, update this file and the short index in `AGENTS.md`.

| Route | Methods | Purpose |
| --- | --- | --- |
| `sessions/` | GET | List sessions grouped by cwd (includes `archivedCwds` and `archivedCounts`). |
| `sessions/[id]/` | GET/PATCH/DELETE | Read session detail, rename, delete. Returns `archived: true` for archived sessions. |
| `sessions/[id]/context/` | GET | Get context for a specific `leafId`. |
| `sessions/[id]/export/` | GET | Export session as Markdown. |
| `sessions/new/` | 410 | Deprecated route kept for compatibility. |
| `agent/new/` | POST | Create a new session and send the first message. |
| `agent/[id]/` | GET/POST | Get agent state or send a command. |
| `agent/[id]/events/` | GET | SSE event stream. |
| `files/[...path]/` | GET | Read file contents for the file viewer. |
| `files/search/` | GET | Search files in the selected workspace. |
| `files/upload/` | POST | Upload files for chat/file workflows. |
| `models/` | GET | List available models and default model. |
| `models-config/` | GET/POST | Read/write `~/.pi/agent/models.json`. |
| `models-config/test/` | POST | Test a model config with a completion request. |
| `skills/` | GET | List installed skills for a cwd. |
| `skills/search/` | GET | Search skills.sh for available skills. |
| `skills/install/` | POST | Install a skill via `npx skills add`. |
| `commands/` | GET | List slash commands from skills for a cwd. |
| `cwd/validate/` | POST | Validate a candidate workspace path. |
| `git/worktrees/` | GET/POST/DELETE | Inspect, create, and remove Git worktrees from the selected cwd; removal also deletes sessions for that worktree cwd. |
| `sessions/archive/` | POST | Archive one or more sessions (moves to `sessions-archive/`). |
| `sessions/unarchive/` | POST | Unarchive one or more sessions (moves back to `sessions/`). |
| `sessions/archive-all/` | POST | Archive all sessions for a cwd. |
| `sessions/archived/` | GET | List archived sessions for a cwd. |
| `git/worktrees/archive/` | POST | Squash, push, merge, and remove a Git worktree after user risk confirmation; archive also deletes sessions for that worktree cwd. |
| `git/info/` | GET | Return best-effort Git branch/worktree metadata for a cwd. |
| `git/status/` | GET | Return detailed Git status (branch, commits, staged/unstaged changes, untracked files, stash) for a cwd. |
| `git/graph/` | GET | Return decorated commit graph data (commits, parents, refs, local branches) for the Git panel branch visualization. |
| `web-config/` | GET/PUT | Read/write `~/.pi/agent/pi-web.json` for WorkTree defaults and optional Trellis panel settings. |
| `trellis/tasks/` | GET | List read-only Trellis task summaries for an authorized workspace cwd when the Trellis panel setting is enabled. |
| `trellis/tasks/[taskKey]/` | GET | Read one Trellis task detail, artifacts, manifest counts, hierarchy, and derived phase/progress. |
| `trellis/setup/status/` | GET | Inspect Trellis prerequisites, CLI availability, and selected-workspace initialization state without requiring the panel setting to be enabled. |
| `trellis/setup/init/` | POST | Install/ensure the Trellis CLI, run `trellis init -u <developer> --pi` for an authorized uninitialized workspace, and auto-enable the Trellis drawer setting on success. |
| `trellis/setup/update/` | POST | Upgrade/install the Trellis CLI and run `trellis update` for an authorized workspace that already has `.trellis`. |
| `default-cwd/` | POST | Create and return `~/pi-cwd-<YYYYMMDD>`. |
| `home/` | GET | Return `os.homedir()`. |
| `usage/` | GET | Aggregate token/cost usage across sessions. |
| `auth/providers/` | GET | List configured auth provider statuses. |
| `auth/all-providers/` | GET | List all known provider ids. |
| `auth/accounts/[provider]/` | GET/POST/PATCH/DELETE | List saved OAuth accounts, import one or more raw/CPA/SUB2API OAuth account JSON entries, update account remarks, and soft-delete inactive saved accounts for supported providers (`openai-codex`). |
| `auth/accounts/[provider]/activate/` | POST | Activate a saved OAuth account and reload live RPC auth state. |
| `auth/login/[provider]/` | GET/POST | Initiate OAuth login for a provider; `openai-codex?accountMode=add` saves another account without replacing active auth. |
| `auth/logout/[provider]/` | POST | Clear OAuth tokens for a provider. |
| `auth/api-key/[provider]/` | GET | Get masked API-key status for a provider. |
| `auth/balance/[provider]/` | GET | Query DeepSeek account balance. |
| `auth/quota/[provider]/` | GET | Query OpenAI Codex subscription quota. |

## Implementation Pointers

- Agent command routes should go through `lib/rpc-manager.ts`.
- Session-file routes should use `lib/session-reader.ts` and shared types in `lib/types.ts`.
- Client-side command calls should use `lib/agent-client.ts`.
- Normalize streamed/file-loaded tool calls through `lib/normalize.ts`.
