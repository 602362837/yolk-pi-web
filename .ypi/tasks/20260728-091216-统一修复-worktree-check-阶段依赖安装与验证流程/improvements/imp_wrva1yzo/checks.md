# IMP-002 Checks

| ID | Boundary | Expected |
| --- | --- | --- |
| C1 | implementer returns `blocked_manual_ui_approval` with child status succeeded | durable needs-user/policy disposition; checker, validation, publish spawn = 0 |
| C2 | needs-user, policy block, cancelled, paused, runtime failed | each maps only to allowlisted reason/layer/retryability; no free-text classification |
| C3 | qualifying IMP-001 transport failure | preserves existing bounded retry only; no UI/manual automatic retry |
| C4 | late checker result after newer implementer block | generation/run-fence CAS rejects stale write; latest reason retained |
| C5 | resume/tick with terminal disposition | downstream gate zero calls; legacy mismatch operator block |
| C6 | each mapped exceptional disposition | correct existing approved labels; unrelated/user labels untouched |
| C7 | same notification revision twice | labels idempotent and one canonical `automation_status` comment; no duplicate POST |
| C8 | changed safe reason/revision | existing marker comment PATCHes once with Chinese fixed template |
| C9 | label write fails / unknown result | original disposition remains; `operator_notification`, safe event, zero checker; reconcile before retry |
| C10 | comment write fails / unknown result | same; notification-only retry does not rerun implementer |
| C11 | Issue/comment injection | cannot select labels/template/retry/stage or expose raw text |
| C12 | safe projection/event | excludes output, prompt, URL, path, tokens and raw exception |
| C13 | successful implementation | only matching successful fence clears notification/block state and permits checker |

## Required evidence

- Tests must invoke the real unattended runner and member adapter boundary; constructed `checkResult`, direct status mutation, source scan, or message-regex assertions do not satisfy C1/C4/C5.
- App requests use deterministic fake installation transport but must exercise existing label/comment upsert and unknown-write reconciliation.
- Run: `npm run test:github-automation`, `npm run test:github-unattended-runner`, `npm run test:github-unattended`, `npm run test:github-handler-runtime`, `npm run lint`, `node_modules/.bin/tsc --noEmit`, `git diff --check`.
