# Library Module Map

Shared logic lives under `lib/`. Prefer adding behavior here when it is used by multiple API routes, hooks, or components.

| File | Purpose |
| --- | --- |
| `lib/rpc-manager.ts` | `AgentSessionWrapper`, global registry, `startRpcSession()`, lifecycle handling. |
| `lib/session-reader.ts` | Parse `.jsonl` session files, resolve session paths, read model/default config. |
| `lib/types.ts` | Shared TypeScript types for messages, sessions, and API payloads. |
| `lib/pi-types.ts` | `AgentSessionLike` wrapper interface expected by hooks/components. |
| `lib/normalize.ts` | Normalize pi tool-call fields to web UI shape. |
| `lib/agent-client.ts` | Client-side helper for `POST /api/agent/[id]`. |
| `lib/file-paths.ts` | Path normalization utilities for file viewer APIs. |
| `lib/cwd.ts` | Cwd validation and normalization helpers. |
| `lib/git-worktree.ts` | Git worktree creation helpers. |
| `lib/deepseek-balance.ts` | Query DeepSeek account balance. |
| `lib/subscription-quota.ts` | Query OpenAI Codex subscription quota. |
| `lib/npx.ts` | Cross-platform `npx` wrapper that avoids shell quoting issues. |
| `lib/usage-stats.ts` | Aggregate token/cost by day, model, provider, and session. |
| `lib/pi-web-config.ts` | Read/write/validate `~/.pi/agent/pi-web.json`. |
| `lib/workspace-title.ts` | Shared workspace title formatting from cwd and Git metadata. |

## Reuse Rules

- Do not duplicate JSONL parsing or tool-call normalization in UI code.
- If a route and a component need the same derived value, put it in `lib/` and import it from both sides.
- Keep wire types in `lib/types.ts` synchronized with route responses and hook consumers.
