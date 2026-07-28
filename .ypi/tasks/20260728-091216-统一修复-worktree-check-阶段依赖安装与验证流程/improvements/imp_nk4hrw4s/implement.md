# IMP-001 Implement plan

## IMP-01 — Structured child transport outcome
- Establish a typed child startup/first-request/terminal outcome.
- Distinguish before-first-provider-request transport failure from started/unknown.
- Add deterministic fault-injection coverage.

## IMP-02 — Durable runner mapping and bounded retry
- Add implementer-specific retry provenance and reservation.
- Retry only qualifying failures, at most twice, with 20s/60s bounded backoff.
- Re-check fence, generation, stage, effects, and WorkTree diff before launch.

## IMP-03 — Exactly-once progression
- Make success-to-checking idempotent.
- Never replay after checker, validation, publisher, PR, or uncertain side effects.

## IMP-04 — Regression and docs
- Add GitHub runner/child fault tests and document operator semantics.

## Validation
- npm run test:github-unattended-runner
- npm run test:github-unattended
- npm run test:github-handler-runtime
- npm run test:github-publish-policy
- npm run lint
- node_modules/.bin/tsc --noEmit
- git diff --check