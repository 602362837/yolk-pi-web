# Handoff：DOC-05 完成

## Subtask

- **ID**: DOC-05
- **Title**: Document identity/action/command/recovery contracts
- **Status**: implemented (awaiting checker / parallel with TEST-04)
- **Member**: implementer

## Files Changed

- `docs/architecture/overview.md` — ingress actor/source matrix, generation rules, stable markers, exact owner commands, closed/park behavior, global vs per-job pause, generation-storm recovery; identity matrix updated
- `docs/modules/api.md` — webhook safe envelope + classify/enqueue rules; config `paused` operator-only; jobs per-job pause ≠ global; notes for exact-comment path
- `docs/modules/library.md` — store/runtime/comments/owner-intent/triage/runner module map updated for LOOP/IDEMP/CMD contracts; non-injection reuse rule
- `docs/integrations/README.md` — design bullets for self-event isolation, command protocol, markers; rollback/stop-bleed; test coverage note
- `docs/integrations/github-app-automation-setup.md` — Owner `@AppBot`/`/ypi` protocol, identity isolation, acceptance, FAQ generation storm, product boundary table
- `docs/operations/troubleshooting.md` — ignored self/Bot reasons, owner command failures, per-job vs global pause table, generation-storm runbook

## Acceptance mapped

- Docs consistently describe audit-only self events, action/generation rules, stable markers, exact `@AppBot`/`/ypi` commands, receipt/status, per-job vs global pause, closed Issue park, no comment injection, and recovery without deleting durable history
- Stale “any comment / broad adoption scan” guidance removed from the six DOC-05 targets
- Global paused remains user/management controlled in all wording

## Verification

| Check | Result |
| --- | --- |
| Stale phrase search (`any issue_comment enqueues`, scan recent, …) on DOC-05 files | **clean** |
| Coverage search for self_app / @AppBot / generation storm / exact comment / issue_closed | **present** across architecture, api, library, integrations, setup, troubleshooting |
| Production code changes | **none** (docs only) |
| Global paused | **unchanged** (docs only; no config mutation) |
| git commit/push/merge | **not performed** |

## Not in this subtask

- TEST-04 focused suite expansion
- CHECK-06 barrier / live unpaused smoke
- Any production TypeScript changes

## Risks / checker focus

- Setup guide uses `@AppBot` as product-facing default when real bot login may differ at runtime (matches code fallback); operators with custom App slug should use their real `@…[bot]` login or `/ypi`
- Architecture overview is dense; if product wants a shorter operator-only section, DOC can later split a dedicated runbook without changing contracts
- Parallel TEST-04 may still be running; docs assert contracts already implemented in LOOP/IDEMP/CMD — checker should align wording with final tests

## Main session next

1. Mark DOC-05 done when checker accepts.
2. Ensure TEST-04 completes in parallel; then CHECK-06.
3. Do **not** clear global automation paused without explicit user decision.
"}