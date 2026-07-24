# Handoff：GitHub 自动化凭据产品化（GHCRED-08 集成验证）

## Status

- Workflow phase: implementing closeout
- Active subtask: **GHCRED-08** → **done**
- Plan progress: **8/8 done**
- Production code changes in this subtask: **none** (validation-only)
- No `commit` / `push` / `merge`
- No real user `ypi` process start/stop

## GHCRED-08 Result

Integrated checker validation **passed** against the already-implemented GHCRED-01…07 surface.

### Validation commands

| Command | Result |
| --- | --- |
| `npm run lint` | **pass** (exit 0; 11 pre-existing warnings only, 0 errors; none in GitHub credentials paths) |
| `node_modules/.bin/tsc --noEmit` | **pass** (exit 0) |
| `npm run test:github-automation` | **pass** `76/76` |
| `npm run test:github-unattended` | **pass** `17/17` |
| `npm run test:github-publish-policy` | **pass** `23/23` |

### Evidence covered by focused suite (no destructive host ypi restart)

`scripts/test-github-automation.mjs` GHCRED-06 block independently covers:

- Local first-save permissions / generation pointer / **child-process restart-import** with empty `YPI_GITHUB_APP_*`
- Partial rotation + blank-preserve (never imports env)
- Env overlay matrix, blank env fallback, invalid-local masking when env-complete
- Local webhook HMAC pass + wrong signature fail; env secret override
- Installation token cache clear after local rotation/delete
- Fail-closed: malformed/future schema, symlink, oversize, non-RSA, concurrent upsert
- Credentials route GET/PUT/DELETE contracts + sentinel isolation
- Setup/status source semantics; non-credential surfaces stay clean

### Static product-path audit

| Surface | Evidence |
| --- | --- |
| Local store | `lib/github-app-credential-store.ts` — `credentials.v1.json` + generation PEM, 0700/0600, lock, fail-closed |
| Env-over-local resolver | `lib/github-app-credentials.ts` — per-field env → one local snapshot → missing; safe projection |
| Credentials API | `app/api/github-automation/credentials/route.ts` — GET/PUT/DELETE, `Cache-Control: no-store`, cache clear on mutation |
| Settings UI primary path | `components/GithubAutomationConfig.tsx` — card **本机 GitHub App 凭据** above checklist; CTA **保存到本机**; env under **高级：环境变量覆盖** |
| Docs local-first | `docs/integrations/github-app-automation-setup.md`, `docs/modules/{api,frontend,library}.md`, `docs/architecture/overview.md`, `docs/deployment/README.md`, `docs/operations/troubleshooting.md`, `AGENTS.md` |

No customer-facing “Settings deliberately refuses App credentials / env is the only path” guidance remains in the audited docs/components for this feature.

## Files changed (this subtask)

- `.ypi/tasks/20260724-173213-github-自动化凭据产品化-本机持久化-设置页配置-env-仅覆盖/handoff.md` — validation handoff (this file)

No production source/docs edits in GHCRED-08.

## Remaining risks / pending UAT

1. **Real GitHub App + public HTTPS UAT is pending** — not run (no safe test App / public tunnel approved this round). Offline HMAC, JWT, cache, store, API, and docs checks are complete; live install/delivery/Recent Deliveries remains owner-supplied UAT.
2. Management UI/API remains without product auth; public deploy must continue to expose only webhook route (or protect management plane). Documented; not newly introduced by this validation.
3. Lint warnings elsewhere in the repo are pre-existing and unrelated.

## Decisions needed from main session

1. Mark task implementation complete / move to checker or review workflow as appropriate.
2. Optionally run live UAT with a **non-production** test GitHub App when available (Settings save → stop/restart ypi without env → status configured → signed webhook → env override matrix).
3. Do **not** commit from implementer role unless parent explicitly requests a separate submit flow.

## Prior planning artifacts (unchanged)

- brief / prd / design / ui / implement / checks / plan-review
- Final HTML prototype: `github-app-local-credentials.html`
- Implementation plan: 8 subtasks GHCRED-01…08, maxConcurrency=2
