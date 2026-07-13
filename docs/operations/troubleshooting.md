# Operations and Troubleshooting

## Common Checks

- Confirm the server is on port `30141` unless `--port` or `PORT` overrides it.
- Confirm `PI_CODING_AGENT_DIR` when sessions or config appear missing.
- Check `~/.pi/agent/sessions/` for raw session JSONL files.
- For PM2 deployments, inspect `logs/pi-web-out.log` and `logs/pi-web-error.log`.

## Development Safety

- Use `npm run dev` during development.
- Do not run `next build` directly; use `npm run build` only when validating release/publish behavior.
- If `.next/` appears polluted after an accidental build, clean it before continuing dev-server work.

## Network / Proxy

Use `scripts/start-pi-web-proxy.sh` or `scripts/start-pi-web-proxy.ps1` when provider calls need the local proxy. They set common proxy env vars and `NODE_OPTIONS=--use-env-proxy` for modern Node fetch/undici behavior.

## Web Terminal SSH

- If local terminal creation works but SSH tabs fail, confirm both `terminal.enabled` and `terminal.ssh.enabled` are true in Settings → Terminal and that the workspace `cwd` is still under an allowed root.
- If SSH session creation reports that OpenSSH is missing, install a system `ssh` client and ensure `ssh`/`ssh.exe` is on the server process `PATH`.
- SSH profiles in `~/.pi/agent/pi-web.json` must contain only non-secret fields. Private keys, passwords, passphrases, and proxy passwords belong in `~/.pi/agent/terminal-secrets/`; API/UI summaries should show only `has*` flags and fingerprints.
- The dedicated known-hosts file is `~/.pi/agent/terminal/known_hosts`. `ssh-keyscan` output is advisory; verify fingerprints independently before trusting. The default policy is `ask`; `accept-new` may accept a malicious first-seen key.
- SOCKS5/HTTP proxy auth is stored in a session temp context file and should not appear in OpenSSH command lines. Custom ProxyCommand runs a local command, is disabled by default, and requires global plus profile-level risk acknowledgement.
- Stale SSH temp dirs are named `ypi-terminal-ssh-*` under the OS temp directory and are swept on server startup if older than 24h. If a crashed dev server leaves files behind, confirm they use that prefix before manually deleting them.
- Run `node scripts/test-terminal-ssh-config.mjs` for dry-run checks covering config defaults, redaction boundaries, HostKeyAlias generation, ProxyCommand gates, proxy command secret handling, and temp cleanup assumptions.

## Managed API-key accounts (OpenCode Go, xAI)

Allowlisted providers store multi-account metadata and secrets under `~/.pi/agent/auth-api-key-accounts/<provider>/`:

- OpenCode Go: `~/.pi/agent/auth-api-key-accounts/opencode-go/`
- xAI: `~/.pi/agent/auth-api-key-accounts/xai/`

Each directory holds `accounts.json` (masked previews, fingerprints, active id, optional disable metadata) and per-account `<accountId>.json` secret files (mode 0600). Metadata never contains plaintext keys. Accounts are provider-scoped; matching fingerprints across providers are not shared or deduped.

Both providers support **manual** multi-key management in Settings → Models (add/edit/activate/enable/disable/delete/reveal). Only OpenCode Go has optional automatic failover (`opencodeGo.autoFailover`). **xAI does not auto-failover** — users must activate the desired key manually.

## OpenCode Go Auto Failover & Account Recovery

The optional OpenCode Go auto-failover feature (`opencodeGo.autoFailover` in `~/.pi/agent/pi-web.json`) automatically switches the globally active **OpenCode Go** managed API-key account when a request fails with a quota/billing error or a permanent `Invalid/Missing API key` error. It does **not** apply to xAI, and it does **not** trigger on transient 429/rate-limit, network errors, or 5xx.

### Symptoms when failover triggers

- A chat message fails with a quota-exhausted or API-key error, then the agent **retries automatically** with a different account.
- A lightweight notice appears in the chat: "OpenCode Go account switched … Retrying…" or "OpenCode Go account disabled … Switching…"
- In Settings → Models → OpenCode Go, an account may show as **DISABLED** with reason `Account unusable: Invalid API key` (auto-disabled by the system).
- The `active` badge moves to a different account in the managed-account list.

### Rollback: disable auto failover

**Method 1 — Settings UI (recommended):**
1. Open Settings → OpenCode Go managed API keys.
2. Turn off the **OpenCode Go auto failover** toggle.
3. The change is saved immediately to `pi-web.json` and takes effect for new turns without a server restart.

**Method 2 — Config file:**
1. Edit `~/.pi/agent/pi-web.json`.
2. Set `opencodeGo.autoFailover.enabled` to `false`.
3. If the server is running, the next agent turn picks up the change; no restart is required.

After disabling, the feature stops all automatic switching. Manually choosing which account is active (via the Activate button in Settings) continues to work as before.

### Recovering an auto-disabled account

When an account is permanently unusable (invalid/missing API key), the failover system **persistently disables** it so it won't be retried. Recovery steps:

1. **Fix the key**: In Settings → Models → OpenCode Go, click **Edit** on the disabled account, replace the API key with a valid one, and save.
2. **Re-enable**: Click **Enable** on the account. This restores the account's eligibility to be activated or participate in failover; it does **not** automatically make it active.
3. **Activate** (optional): Click **Activate** to make this account the globally active one.

> The Enable action clears all `disabled*` metadata fields and records `enabledAt` / `enabledBy: "user"`. After enabling, the account is treated identically to a never-disabled account.

### Verifying account state from the filesystem

OpenCode Go failover inspects managed account metadata at `~/.pi/agent/auth-api-key-accounts/opencode-go/`:
- `accounts.json` — metadata for all accounts, including `disabled`, `disabledReason`, `disabledBy`, `autoDisabledReason`, `enabledAt`, `enabledBy`.
- `<accountId>.json` (mode 0600) — per-account secret; never inspect this file casually.

xAI multi-key state (manual only) uses the same layout under `~/.pi/agent/auth-api-key-accounts/xai/`; it is independent of the OpenCode Go store and is not read by auto-failover.

A disabled account has `disabled: true` in `accounts.json`. An enabled account either has `disabled: false` or the field is absent (old metadata defaults to enabled).

### No migration required

Old managed account metadata (created before this feature) does **not** have `disabled` fields. The code treats missing `disabled` as **enabled** — no startup migration, no data-loss risk, and no manual intervention needed for existing accounts.

### Multi-process caveat

The failover lock is **process-level** (`globalThis.__piOpencodeGoFailover`). In single-process deployments (default `next start`, `ypi`) this is sufficient. If you run multiple Node processes behind a load balancer or use PM2 in `cluster` mode, concurrent quota failures across processes can still cause multiple activations. Mitigation:
- The per-turn budget (`maxAccountSwitchesPerTurn=1`) and cooldown still limit damage.
- Disable auto failover if cross-process race conditions become a practical issue.
- A future v2 may add file-system or external locking for multi-process deployments.


## YPI Studio DAG and Async Runs

- `studio.subagents.runner` in `~/.pi/agent/pi-web.json` controls new Studio subagent runs: `auto` (default rollout), `sdk` (force SDK and fail instead of using CLI if unavailable), or `cli` (legacy rollback). The runner is read when a new run starts; already running CLI children are not migrated or interrupted by config changes.
- Studio subagents using the legacy CLI runner first resolve the bundled `@earendil-works/pi-coding-agent/dist/cli.js` from the web app dependency and only fall back to `pi` on `PATH` if no local CLI is found. If child startup fails with `ENOENT`, verify the package dependency is installed before requiring a global `pi` install.
- If a task is bound to the current chat but `awaiting_approval -> implementing` is blocked, inspect `.ypi/tasks/<task>/task.json`: `contextIds` should include the current Studio context and `meta.approvalGrant` should be written only after a later explicit user confirmation.
- If a queued/running async subagent disappears after server restart or dev hot reload, poll/collect may mark the run as `runtime_lost`; retry the affected subtask instead of assuming the whole task failed. For rollback, set `studio.subagents.runner` to `cli`; child sessions already written by SDK runs remain hidden audit records and do not need deletion.
- If child audit sessions appear in ordinary history during debugging, remove `includeStudioChildren=1` from the session-list request or reset the UI debug view. The underlying JSONL can remain for audit/replay.
- Use `npm run test:studio-dag` for DAG scheduling regressions and `npm run test:studio-policy` for approval/policy regressions.
- UI truncation flags on subagent transcripts are display limits, not failure signals; use run status, `result.isError`, and termination reason for severity.

## Memory Diagnostic Snapshots

When the Yolk Pi Web process memory grows (potentially to multiple GiB after days of uptime), generate a bounded read-only diagnostic snapshot to gather evidence for offline analysis. This is a diagnosis tool only; it does **not** fix or clean up leaks, abort sessions, force GC, or take heap snapshots.

- **Primary entry**: Settings → 诊断 / Diagnostics → 生成内存诊断快照. The UI shows file metadata (path/size/duration, schema version, partial/compacted badges) only and never renders the full JSON. A `409 busy` state means another capture is in progress on the same process.
- **Compatibility entry**: `curl -i -X POST http://localhost:30141/api/diagnostics/memory-snapshot`. The response is metadata only (`filePath`, `fileName`, `bytes`, `durationMs`, `partial`, `compacted`, `sectionSummary`, …); the full JSON is never returned over HTTP.
- Inspect the file on disk with `jq`:
  ```bash
  jq . "$(printenv HOME)/.pi/agent/diagnostics/<fileName from API response>"
  jq '.process.memoryUsage, .runtime.agentSessions.registryTotal, .findings' "...path..."
  ```
  With `PI_CODING_AGENT_DIR` override the directory is `<PI_CODING_AGENT_DIR>/diagnostics/`.
- **Multi-snapshot comparison**: collect snapshots at low memory, while growing, and after growth, then compare `capturedAt`, `process.memoryUsage.rss`/`heapUsed`, `runtime.agentSessions.aliveCount`/`registryTotal`, per-session `totalContentBytes`, `runtime.studio.childRunTotal`/`pendingContinuationTotal`, `runtime.sessionPathCache.total`, and `findings[]` trends. The snapshots are self-describing JSON and can be diffed with `jq`/normal tools.
- **Privacy before sharing**: the file may contain local workspace/session paths and identifiers (to help correlate), but it does **not** contain message content, tool args/results, system prompts, response ids, terminal buffers, browser snapshots, env vars, or credentials. Review and redact paths before sharing; each file includes a `privacy` block with a share-before-review warning.
- **Known limitation**: OpenAI Codex WebSocket debug stats are recorded **only for known active openai-codex sessions** via public getters (numeric/boolean fields only). The diagnostic does not enumerate the third-party private WebSocket cache/map, so the per-session stats may undercount the full set of cached sessions.
- **Cleanup**: there is no automatic retention, file list, or download center. Delete files manually when no longer needed:
  ```bash
  rm ~/.pi/agent/diagnostics/memory-*.json   # review before deleting
  ```
- If capture returns `409 snapshot_in_progress` from the UI or curl, another capture is in flight on the same process — retry shortly. The single-flight lock is process-level (`globalThis.__piMemoryDiagnosticSnapshotInFlight`); a crashed mid-capture process resets the lock on next start (the lock lives in memory, not on disk).
- If capture returns `500 snapshot_too_large`, even the compact form (samples removed, totals kept) exceeded the 5 MiB cap; retry after restarting the process or open the file-less error as evidence that the in-process state is exceptionally large.
- `partial: true` is expected when a section threw or the 5s deadline expired before later sections started; `sectionSummary` shows which sections have errors, and `errors[]`/`truncation[]` in the file explain the partial result.
- Use `npm run test:memory-diagnostics` for focused schema/marker/caps/deadline/size/atomic-write/lock regressions.
