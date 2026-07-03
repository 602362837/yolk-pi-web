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

## YPI Studio DAG and Async Runs

- If a task is bound to the current chat but `awaiting_approval -> implementing` is blocked, inspect `.ypi/tasks/<task>/task.json`: `contextIds` should include the current Studio context and `meta.approvalGrant` should be written only after a later explicit user confirmation.
- If a queued/running async subagent disappears after server restart or dev hot reload, poll/collect may mark the run as `runtime_lost`; retry the affected subtask instead of assuming the whole task failed.
- Use `npm run test:studio-dag` for DAG scheduling regressions and `npm run test:studio-policy` for approval/policy regressions.
- UI truncation flags on subagent transcripts are display limits, not failure signals; use run status, `result.isError`, and termination reason for severity.
