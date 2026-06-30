# Library Module Map

Shared logic lives under `lib/`. Prefer adding behavior here when it is used by multiple API routes, hooks, or components.

| File | Purpose |
| --- | --- |
| `lib/rpc-manager.ts` | `AgentSessionWrapper`, global registry, `startRpcSession()`, cwd-scoped session cleanup, lifecycle handling. |
| `lib/session-reader.ts` | Parse `.jsonl` session files, resolve session paths, prune/delete sessions for removed WorkTree cwd paths, read model/default config. Archive helpers: `getSessionsArchiveDir()`, `archiveSessionFile()`, `unarchiveSessionFile()`, `scanArchivedCwds()`, `listArchivedSessionsForCwd()`, `resolveArchivedSessionPath()`. |
| `lib/types.ts` | Shared TypeScript types for messages, sessions, and API payloads. |
| `lib/pi-types.ts` | `AgentSessionLike` wrapper interface expected by hooks/components. |
| `lib/normalize.ts` | Normalize pi tool-call fields to web UI shape. |
| `lib/agent-client.ts` | Client-side helper for `POST /api/agent/[id]`. |
| `lib/file-paths.ts` | Path normalization utilities for file viewer APIs. |
| `lib/cwd.ts` | Cwd validation and normalization helpers. |
| `lib/git-worktree.ts` | Git worktree creation, status, archive, and removal helpers. |
| `lib/deepseek-balance.ts` | Query DeepSeek account balance. |
| `lib/quota-display.ts` | Shared ChatGPT/Codex quota display helpers: tier labels, utilization colors, reset countdowns, relative refresh time, and known-tier filtering. |
| `lib/oauth-accounts.ts` | Persist, import raw/converted credential JSON, sanitize, sync, label, activate, and soft-delete saved `openai-codex` OAuth accounts without exposing tokens. |
| `lib/oauth-account-converters.ts` | Shared OAuth account import mode registry, raw credential validation, and CPA/SUB2API-to-raw conversion used by the UI and account import API; SUB2API exports may convert to multiple raw credentials. |
| `lib/subscription-quota.ts` | Query OpenAI Codex subscription quota. |
| `lib/npx.ts` | Cross-platform `npx` wrapper that avoids shell quoting issues. |
| `lib/usage-stats.ts` | Aggregate token/cost across configured active-only or active-plus-archived sessions by day, model, provider, and session. |
| `lib/pi-web-config.ts` | Read/write/validate `~/.pi/agent/pi-web.json` for WorkTree, Usage scan scope, ChatGPT usage panel settings, and Trellis panel settings, including Trellis install/update proxy options, workflow assistant primary/fallback model policy, and Trellis subagent model policy. |
| `lib/allowed-roots.ts` | Shared authorized-workspace root discovery and path checks for file and Trellis APIs. |
| `lib/trellis-manager.ts` | Trellis setup/status/update helper: prerequisite checks, CLI/version inspection, proxy-scoped child-process environment, and fixed Trellis/npm command execution. |
| `lib/trellis-reader.ts` | Read-only Trellis task discovery, artifact loading, manifest counting, hierarchy, optional `meta.lastCheck` quality-check state, and phase/progress derivation. |
| `lib/trellis-workflow-reader.ts` | Read-only `.trellis/workflow.md` reader/parser for Settings workflow visualization; extracts phases, steps, workflow-state blocks, source line ranges, and parser warnings without executing Trellis commands or mutating files. |
| `lib/trellis-workflow-types.ts` | Wire types for Trellis workflow visualization API responses and UI consumers. |
| `lib/trellis-session-link.ts` | Session-scoped Trellis task association resolver for the floating widget; uses high-confidence session transcript evidence and exact per-session runtime pointers without mutating Trellis task metadata. |
| `lib/trellis-chat-context.ts` | Pure helpers for converting Trellis task details into compact chat-composer context payloads and serializing those blocks into resume prompts recognized by session-task linking. |
| `lib/trellis-setup-types.ts` | Wire types for Trellis setup status and setup/update command API responses. |
| `lib/trellis-types.ts` | Wire types for Trellis task list/detail API responses and UI consumers. |
| `lib/workspace-title.ts` | Shared workspace title formatting from cwd and Git metadata. |

## Reuse Rules

- Do not duplicate JSONL parsing or tool-call normalization in UI code.
- If a route and a component need the same derived value, put it in `lib/` and import it from both sides.
- Keep wire types in `lib/types.ts` synchronized with route responses and hook consumers.
