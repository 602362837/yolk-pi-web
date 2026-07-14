# review.md

## Check Complete

### Checks Run

| Check | Result |
|---|---|
| `npm run lint` | ✅ 0 errors |
| `node_modules/.bin/tsc --noEmit` | ✅ 0 errors |
| `node scripts/test-grok-provider.mjs` | ✅ 40/40 passed |
| `node scripts/test-grok-accounts.mjs` | ✅ 70/70 passed |
| `node scripts/test-grok-quota.mjs` | ✅ 48/48 passed |
| `git diff --check` | ✅ clean |
| Secret redaction (grep source) | ✅ no tokens, credentials, or raw upstream payloads in any module |
| Test isolation (real data dirs) | ✅ tests use temp `PI_CODING_AGENT_DIR`, never read `~/.pi/agent` or `~/.grok/auth.json` |

### Requirements Coverage (vs checks.md)

| Requirement | Status |
|---|---|
| `grok-cli` visible in cold-start Auth/Models API | ✅ |
| Main Chat, resume, fork, Studio child all load same provider factory | ✅ |
| OAuth browser/device/manual/existing/cancel/error flows with safe projection | ✅ |
| add-account does not overwrite active; opaque storage id per login | ✅ |
| Activation atomically updates sidecar metadata + `auth.json` mirror (CAS) | ✅ |
| Existing sessions keep account pin; active switch only affects new sessions | ✅ |
| Same-account refresh single-flight; different accounts independent | ✅ |
| Monthly/weekly quota fields, TTL, force refresh, stale fallback, 401 retry | ✅ |
| UI HTML prototype approved; implementation matches prototype patterns | ✅ |

### Security

| Check | Status |
|---|---|
| No access/refresh/id-token, auth code, callback URL, raw billing payload in browser/API/logs | ✅ |
| OAuth discovery/token endpoint host validation by extension (x.ai only) | ✅ |
| Account API validates provider against allowlist; no user-input path construction | ✅ |
| Secret files `0600`, directories `0700`, tmp+rename atomic writes | ✅ |
| Error classification based on HTTP status/internal code; upstream body not leaked | ✅ |
| Quota response `Cache-Control: no-store` | ✅ |
| `GrokQuotaResultV1` wire projection — no raw upstream payload, base URL, or filesystem path | ✅ |

### Non-Regression

| Check | Status |
|---|---|
| OpenAI Codex OAuth accounts unchanged | ✅ |
| xAI/API-key managed accounts unchanged | ✅ |
| Other model providers unaffected | ✅ |
| `oauth-account-converters.ts` import chain preserved | ✅ |

---

### Findings Fixed

None — no production code was modified during review.

### Remaining Findings

#### Warnings (Non-Blocking)

1. **`jiti` not in direct `devDependencies`** — `scripts/run-oauth-account-tests.mjs` imports `jiti` which is only available as a transitive dependency of `@earendil-works/pi-coding-agent`. If that package changes its dependency tree, the test runner may break. Recommendation: add `jiti` to `devDependencies` explicitly.

2. **`npm run build` not executed** — per `implement.md`, build validation is gated to final release. Not a defect, but if this is the final checkpoint before merge, running `npm run build` once would catch any bundler-only issues (e.g., dynamic `import("./grok-session-account")` inside `pi-provider-extensions.ts`).

3. **Vision/Imagine token path not isolated** — `before_provider_headers` hook in `grokSessionAccountExtension` covers main inference requests only. pi-grok-cli's vision and Imagine capabilities may bypass this hook and use the global `auth.json` active token. This is documented as a known limitation in design.md, handoff.md, and the code comments in `pi-provider-extensions.ts`. Not a blocker for v1; tagged for upstream per-call token override.

4. **Upstream billing endpoint is non-public** — Grok `/billing` is a CLI backend endpoint with no stability guarantee. Strict parser, short cache, and stale degradation provide defense-in-depth, but field schema changes may break quota display. Not actionable in this review.

#### No Blockers

All core invariants from the PRD, design, and implement plan are met. No issues that would prevent proceeding.

---

### Verification

```
npm run lint                 → 0 errors
node_modules/.bin/tsc --noEmit → 0 errors
node scripts/test-grok-provider.mjs → 40/40 passed
node scripts/test-grok-accounts.mjs → 70/70 passed
node scripts/test-grok-quota.mjs → 48/48 passed
git diff --check             → clean
```

---

### Verdict

**Pass** — All requirements covered, all tests passing, no secrets exposed, OpenAI regression verified, docs complete. The 4 warnings above are non-blocking and can be addressed post-merge or tracked as follow-up tasks. Ready for main session to review, run `npm run build` at final gate, and decide on commit/push.
