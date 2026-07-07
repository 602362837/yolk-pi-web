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

## YPI Studio DAG and Async Runs

- If a task is bound to the current chat but `awaiting_approval -> implementing` is blocked, inspect `.ypi/tasks/<task>/task.json`: `contextIds` should include the current Studio context and `meta.approvalGrant` should be written only after a later explicit user confirmation.
- If a queued/running async subagent disappears after server restart or dev hot reload, poll/collect may mark the run as `runtime_lost`; retry the affected subtask instead of assuming the whole task failed.
- Use `npm run test:studio-dag` for DAG scheduling regressions and `npm run test:studio-policy` for approval/policy regressions.
- UI truncation flags on subagent transcripts are display limits, not failure signals; use run status, `result.isError`, and termination reason for severity.
