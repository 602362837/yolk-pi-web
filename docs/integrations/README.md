# Integrations and Dependencies

## Primary Runtime Dependencies

See `package.json` for exact versions.

| Dependency | Purpose |
| --- | --- |
| `next`, `react`, `react-dom` | Web application framework/runtime. |
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` | In-process pi AgentSession and AI provider integration. |
| `pi-grok-cli` | SuperGrok / X Premium OAuth provider, model catalog, inference, and request adapter. Integrated as a fixed, full extension; Web adds multi-account storage, global Active live reload, optional auto-failover, and quota management on top. |
| `pi-kiro-provider` | AWS Kiro OAuth provider (`kiro`) with Builder ID / Google / GitHub login methods and model catalog. Loaded like Grok via jiti (package ships TypeScript source); Web adds multi-account storage, GetUsageLimits quota, optional Path B auto-failover, and top-bar usage. Fixed at `^0.2.2`. |
| `@yofriadi/pi-antigravity-oauth` | Google Antigravity / Cloud Code Assist OAuth provider (`google-antigravity`) with Gemini/Claude/GPT-OSS catalog and stream adapter. Exact pin `0.3.0`; TypeScript source loaded only via jiti + `serverExternalPackages`. Web adds multi-account opaque store, fixed `fetchAvailableModels` per-model quota, model-aware Path B auto-failover, and Full/Compact/Aggregate top-bar. **Not** an official Google SLA channel. |
| `jiti` | Runtime TypeScript loader used only for fixed provider packages (`pi-grok-cli`, `pi-kiro-provider`, `@yofriadi/pi-antigravity-oauth`) so Next/Turbopack never statically compiles their source trees. Listed in `next.config.ts` `serverExternalPackages`. |
| `react-markdown`, `remark-gfm`, `remark-math`, `rehype-raw`, `rehype-sanitize`, `rehype-katex`, `katex` | Markdown, raw HTML sanitization, and math rendering. |
| `react-syntax-highlighter` | Code block highlighting. |
| `mermaid` | Diagram rendering. |
| `mammoth` | DOCX content handling. |
| `@lobehub/icons` | Provider/model icon assets. |
| `@xterm/xterm`, `@xterm/addon-fit` | Browser-side Web Terminal rendering and sizing. |
| `@lydell/node-pty` | Server-side local PTY process for interactive Web Terminal sessions; selected because the original `node-pty` failed under the local Node 26 runtime. |

## pi SDK Documentation

When changing pi SDK usage, read the installed package documentation first:

- `node_modules/@earendil-works/pi-coding-agent/README.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/`
- `node_modules/@earendil-works/pi-coding-agent/examples/`

YPI Studio subagents support an in-process SDK runner selected by `studio.subagents.runner` (`auto`/`sdk`/`cli`). SDK child sessions use the same installed `@earendil-works/pi-coding-agent` dependency and auth/model configuration path as main Chat sessions, but they receive their own persistent child session id for provider request affinity. The legacy CLI runner remains as rollback and resolves the bundled package CLI before consulting `PATH`.

## Model Price Sources

The model price suggestion feature (`/api/model-prices/suggest`) fetches public pricing data from curated HTTPS allowlist sources. The only current source is the OpenRouter public model catalog at `https://openrouter.ai/api/v1/models`. Fetches enforce:
- HTTPS only; redirects only to hosts on the same allowlist
- Response size cap at 512 KB
- Timeout and MIME type validation
- No API keys, session tokens, or user credentials sent

AI-assisted extraction uses the configured model from `usage.pricingAssistant` / `usage.pricingAssistantFallback` (default `followMain` → `piDefault`). The AI receives only bounded pre-fetched evidence excerpts and has no network/file/tool access. See `lib/model-price-sources.ts` and `lib/model-price-assistant.ts` for complete adapter and extraction contracts.

## Auth Providers

Auth-related API routes live under `app/api/auth/`. Provider tokens and API-key status are stored/read through the pi configuration mechanisms; keep provider-specific network calls isolated in `lib/` helpers.

### Grok CLI OAuth & Account Management

`pi-grok-cli@0.5.0` provides the Grok OAuth provider (OIDC discovery, PKCE browser/device/manual flows, refresh) and the `grok-cli` model catalog. Web layers on top:

- **Provider bootstrap** (`lib/pi-provider-extensions.ts`): Single entry point for Grok extension factories injected into every ResourceLoader, `createAgentSessionServices`, and Auth bootstrap path. Prevents registry-reset from dropping Grok from the global provider set.
- **OAuth saved-account store** (`lib/oauth-accounts.ts` + `lib/oauth-account-providers.ts`): Provider-adapter architecture supporting `openai-codex` and `grok-cli`. Each login creates an opaque storage id; credentials are stored in per-account `0600` files under `~/.pi/agent/auth-accounts/<provider>/`.
- **Global Active + auto-failover** (`lib/grok-account-failover.ts`, `lib/grok-session-account.ts`, `lib/grok-account-token.ts`): Models Activate updates the provider-global Active account and reloads live wrappers. Session Authorization pin is retired; historical `grokAccountStorageId` is parse-only/ignored. Optional `grok.autoFailover` (default off) rotates Active on explicit quota/rate-limit errors with GPT-aligned lock/budget/retry semantics (Path B independent controller). Token resolver supports true `forceRefresh` for billing 401/403 retry.
- **Quota service** (`lib/grok-subscription-quota.ts`): Reads monthly/optional weekly usage from the Grok CLI billing endpoint with 60s fresh / 24h stale TTL, single-flight, 401 refresh+retry, and strict allowlist projection. See `GET /api/auth/quota/grok-cli`. No Grok reset-credit or backend multi-account scheduler is provided.
- **ModelsConfig UI** (`components/ModelsConfig.tsx`): Provider-capability-driven OAuth detail renders Grok login methods, multi-account list, active/default-session semantics, session-reference delete protection, and shared `GrokQuotaView` quota cards with fresh/stale/error/reauth states.
- **Top-bar usage panel** (`components/GrokUsagePanel.tsx`, Settings `grok.usagePanelEnabled` default off): Optional GPT-symmetric usage entry for the global Active Grok account. Reuses accounts/quota/activate APIs and shared `GrokQuotaView` helpers. Standalone Full/Compact share the N-ring primitive: optional weekly/monthly (and any future recognized windows) become **unordered safe candidates** only when present; the shared projector sorts trusted duration short→long (outer shortest, center = outermost) and detail-only-degrades unknown/tie ranks — adapters never hardcode week/month radial layout. When `usage.providerPanelsAggregated` is true, Grok publishes an allowlisted projection into the single aggregate shell instead of its own trigger (no second mount / double poll). Foreground 30s light revalidation only; force refresh/Activate use `refresh=1`. Does not add GPT reset credits, warmup, or lock-repair UI.

#### Account data layout

```text
~/.pi/agent/auth-accounts/grok-cli/
  accounts.json               # 0600 — metadata only (no secrets)
  <opaque-storage-id>.json    # 0600 — full OAuth credential
  .quota-cache.json           # 0600 — normalized quota cache
  deleted/                    # soft-deleted credentials
```

#### Key invariants

- Active account mirror to `auth.json` uses compare-and-set: a refresh of a non-active account never overwrites the current active mirror.
- Session binding is additive and non-secret: only opaque storage ids appear in JSONL headers.
- Deleting an active account requires explicit replacement or disconnect.
- Quota responses carry `Cache-Control: no-store` and never return tokens, raw billing payloads, upstream error bodies, or filesystem paths.
- `pi-grok-cli` full extension is approved: Cursor tools, vision, and Imagine are available when Grok models are selected; the session-account header hook covers main inference; vision/Imagine token paths are a documented risk until upstream provides per-call token override.

#### Rollback

Remove Grok from `webExtensionFactories()` and hide Grok UI/API entries. Saved accounts and quota cache are preserved but inactive. `auth.json["grok-cli"]` is only cleared on explicit user disconnect.

### Kiro OAuth, Quota, Auto-Failover & Compact Top-bar

`pi-kiro-provider@0.2.2` provides the `kiro` provider + OAuth methods. Web layers on top (symmetric to Grok, but independent modules and Path B controller):

- **Provider bootstrap** (`lib/pi-provider-extensions.ts`): Fixed list is always `[grokCliExtension, kiroProviderExtension, antigravityProviderExtension]` via `webProviderExtensions()` / `webExtensionFactories()`. Cold paths use `ensureWebProvidersBootstrapped()` and `createWebProviderAwareModelRegistry()` (deprecated Grok-named aliases remain). Every ResourceLoader / Models / Auth / Studio SDK child / Skills / Commands / assist route must load this list so registry refresh cannot drop fixed providers. Per-provider jiti load failures are isolated.
- **OAuth saved accounts** (`lib/oauth-account-providers.ts` `kiroAdapter` + `lib/oauth-accounts.ts`): Opaque storage ids, metadata-only `accounts.json`, per-account `0600` secrets, `0700` dirs, soft-delete to `deleted/`. No credential JSON import. Display hints never include access/refresh/`clientSecret`/full `profileArn`. Active mirror to `auth.json` uses compare-and-set.
- **Token refresh** (`lib/kiro-account-token.ts`): Per-account single-flight, file lock, atomic 0600 write, `forceRefresh`, active-mirror CAS. Uses registered OAuth provider refresh (`getOAuthApiKey("kiro", …)`).
- **Quota** (`lib/kiro-subscription-quota.ts`): Official AWS CodeWhisperer only:
  - `POST https://q.<validated-commercial-region>.amazonaws.com/`
  - `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits`
  - Primary body `{ origin: "AI_EDITOR", resourceType: "CREDIT", isEmailRequired: false, profileArn? }`; at most one `ValidationException` minimal fallback body.
  - Strict allowlist parser for `usageBreakdownList` / `usageBreakdown` (precision-first used/limit, remaining, utilization, reset, subscription title, primary CREDIT bucket).
  - 60s fresh / 24h stale normalized cache (`.quota-cache.json`), per-account single-flight, 10s timeout, one 401 force-refresh retry.
  - Wire type `KiroQuotaResultV1` only; never returns userInfo/email/overage raw/profileArn/tokens/upstream body/URL/path. Unknown/missing buckets stay unavailable (never fake 0%).
  - `GET /api/auth/quota/kiro` (+ optional `accountId`, `refresh=1`); `POST` → 405; `Cache-Control: no-store`.
- **Auto-failover Path B** (`lib/kiro-account-failover.ts`, outer patch in `lib/rpc-manager.ts`): Default off (`kiro.autoFailover`). Chain order: **Kiro → Grok → OpenCode Go → ChatGPT → Pi native**. Only explicit AWS quota reasons / explicit rate-limit semantics trigger; hard-negatives include `INSUFFICIENT_MODEL_CAPACITY`, bare 429/403, network/timeout/5xx, auth/reauth, context/content/model. Candidates require credential + **fresh/live** primary remaining > 0 (stale/unknown/reauth **fail-closed**). Process lock, Active double-check, TOCTOU, cooldown, max 1 switch + 1 retry per turn. SSE `kiro_account_failover` projects only status/reason/retry/safe message (no account ids).
- **Top-bar N-ring, compact, and aggregate**: `components/KiroUsagePanel.tsx` gated by `kiro.usagePanelEnabled` (default off). `lib/kiro-usage-ring.ts` converts safe GetUsageLimits buckets into unordered candidates; shared `projectProviderUsageWindows` filters, resolves trusted duration evidence only, sorts outer→inner short→long, and detail-only-degrades unknown/tie ranks (1 comparable window=1 ring, N unique ranks=N rings, 0 unique multi-window ranks=`ringUnit=null` + safe fallback). Remaining never becomes percent and never orders windows; generic `Limits` is not duration. Global `usage.providerPanelsCompact` (default false) is standalone-only density (label + one N-ring; click still opens detail). Global `usage.providerPanelsAggregated` (default false) switches AppShell to one hover/focus aggregate entry with non-accordion GPT→Grok→Kiro→Antigravity columns, light/dark usage tokens, trigger 30px / panel header ring ≥38px (target 40px); Compact value is retained but unused while aggregated. AppShell single host with one right-padding reserve; JSX mutual exclusion prevents double polling. Settings: aggregate + compact under Usage; Kiro panel/failover under Kiro section (peer of ChatGPT/Grok/Antigravity).
- **Models UI**: Capability-driven OAuth branch in `ModelsConfig` for Builder ID / Google / GitHub, multi-account Active semantics, and `KiroQuotaView` buckets (no Reset credits / JSON import).

#### Account data layout

```text
~/.pi/agent/auth-accounts/kiro/
  accounts.json               # 0600 — metadata only (no secrets)
  <opaque-storage-id>.json    # 0600 — full OAuth credential (Builder ID / social shape preserved server-side)
  .quota-cache.json           # 0600 — normalized GetUsageLimits cache only
  deleted/                    # soft-deleted credentials
```

#### Key invariants

- Never statically import `pi-kiro-provider` TypeScript source into Next app modules; only jiti default factory + `serverExternalPackages`.
- Never accept arbitrary quota URLs from credentials; region is commercial-AWS-format only, host is always `q.<region>.amazonaws.com`.
- Do not use streaming `meteringEvent` as subscription quota.
- Non-active token refresh never overwrites Active `auth.json` mirror.
- Failover candidates with unknown/stale quota are rejected (fail-closed).
- Compact and aggregate flags are global presentation switches; per-provider `usagePanelEnabled` still controls mount/polling independently.
- Aggregate shell never fetches quota; provider panels remain the sole accounts/quota owners. Projections are allowlisted (no accountId/credential/profileArn/raw body).

#### Rollback

1. Ops stop-bleed: set `usage.providerPanelsAggregated=false` to restore standalone triggers immediately; optionally `kiro.usagePanelEnabled=false`, `kiro.autoFailover.enabled=false`, `usage.providerPanelsCompact=false` in `pi-web.json` (no restart required for next turn / next panel mount). Compact preference and credentials/cache are not deleted. Dynamic candidate→projector layout rolls back with the code path only — no account/quota migration.
2. Provider-layer: remove Kiro from `webProviderExtensions()` and hide Kiro Models/Auth/Settings/topbar branches; Grok, Antigravity, and native providers keep working.
3. Preserve `auth-accounts/kiro/` and normalized quota cache; do not bulk-delete user credentials.
4. No Session JSONL / usage-ledger migration exists for Kiro, so no data rewrite rollback.

### Antigravity OAuth, Per-Model Quota, Model-Aware Auto-Failover & Top-bar

`@yofriadi/pi-antigravity-oauth@0.3.0` provides the `google-antigravity` provider (public default Pi extension only). Web layers on top; **do not** install or run `pi-antigravity-rotator` as a dependency, proxy, account system, or `auth.json` writer.

**Security / channel risks (must stay visible):**

- Non-official Cloud Code / Antigravity channel — Google may change or restrict endpoints at any time; not an official stable SLA.
- OAuth scopes include wide `cloud-platform` plus userinfo/cclog/experiments scopes.
- Package uses a hard-coded official IDE OAuth client and Antigravity-style `User-Agent` (`antigravity/<version> darwin/arm64`).
- Upstream OAuth callback host is read at import time from `PI_OAUTH_CALLBACK_HOST`; Web **forces** `127.0.0.1` under a single-flight loader before the first jiti import so unset/non-loopback values cannot widen the listener. Remote browsers still use the existing manual redirect-URL paste path.
- Package project discovery may fall back to default project `rising-fact-p41fc`. That value is **never** health or failover evidence; only live matching model quota or a real successful request counts.
- Upstream token exchange/refresh may put response text into `Error`; Web maps to fixed safe codes/messages before API/SSE/DOM/log.

Web modules:

- **Provider bootstrap** (`lib/pi-provider-extensions.ts`): Fixed list `[grokCliExtension, kiroProviderExtension, antigravityProviderExtension]`. jiti loads only the public default factory; never static-import package `src/**`. Per-provider load failures are isolated. Callback policy constants: `ANTIGRAVITY_OAUTH_CALLBACK_HOST="127.0.0.1"` / `PI_OAUTH_CALLBACK_HOST`.
- **OAuth saved accounts** (`lib/oauth-account-providers.ts` `antigravityAdapter` + `lib/oauth-accounts.ts`): Provider id `google-antigravity`. Credential requires non-empty `access`/`refresh`/`projectId` and finite `expires`; optional safe `email` display only. Opaque storage ids; metadata-only `accounts.json`; per-account `0600` secrets; `0700` dirs; soft-delete to `deleted/`. **No credential JSON import.** `projectId` stays in the secret file only (never metadata/API/DOM/SSE/log). Every OAuth add allocates a new opaque id even if Google identity matches.
- **Provider lock + token refresh** (`lib/antigravity-account-lock.ts`, `lib/antigravity-account-token.ts`): Process mutex + mkdir owner lock shared by refresh and Activate (Kiro-proven pattern, provider-independent). Per-account single-flight, merge refresh results so omitted `projectId` is preserved, atomic 0600 write, active-mirror CAS so non-Active refresh never overwrites `auth.json`. `getOAuthApiKey("google-antigravity", …)` yields JSON `{ token, projectId }` for the stream adapter; Web resolvers return access token only and read `projectId` server-side.
- **Quota** (`lib/antigravity-subscription-quota.ts`): Fixed egress only:
  - `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
  - Headers: Bearer access, fixed Antigravity-compatible UA, `Accept`/`Content-Type` JSON
  - Body: `{"project":"<server-only projectId>"}` only — no credential URL/header/body extension, no host guessing
  - Parser: bounded `models` map; only `quotaInfo.remainingFraction` (finite `[0,1]`) and `quotaInfo.resetTime`; `usedPercent = 100 × (1 − remaining)`; invalid/empty entries fail safely (never coerce unknown to 0%)
  - **5min fresh** / 24h stale normalized cache (`.quota-cache.json`), per-account single-flight, 10s timeout, one 401 force-refresh retry; manual `refresh=1` bypasses the 5min fresh TTL; 403 classified as access_denied/invalid_project (not auto-reauth)
  - Wire `AntigravityQuotaResultV1` only: opaque account id, bounded model windows, cache state, fixed error codes. No token/refresh/projectId/raw body/URL/headers/path/request id.
  - `GET /api/auth/quota/google-antigravity` (+ optional `accountId`, `refresh=1`); `POST` → 405; `Cache-Control: no-store`.
- **Model mapping** (`lib/antigravity-model-quota.ts`): Fixed `0.3.0` public model id → accepted quota keys table (no runtime private package import). Every catalog model is mapped or explicitly failover-unsupported. Failover uses only the **current** public model’s matching entry with `remainingFraction > 0`; quota on other models (including same UI group siblings) never proves the current model.
- **Display grouping** (`lib/antigravity-quota-groups.ts`): Fixed `quotaKey → groupId` table for UI only (Flash → Opus → Sonnet → Gemini Pro → Gemini 2.5 → Other). Group headers use **conservative** `max(usedPercent)` / `min(remainingFraction)`; never avg/sum. Unknown keys map to `other`. Display groups are **not** failover inputs.
- **Auto-failover Path B** (`lib/antigravity-account-failover.ts`, outermost patch in `lib/rpc-manager.ts`): Default off (`antigravity.autoFailover`). Chain: **Antigravity → Kiro → Grok → OpenCode Go → ChatGPT → Pi native**. Triggers only on explicit `RESOURCE_EXHAUSTED` / quota exhausted/exceeded / quotaResetDelay|TimeStamp / `rate_limit_exceeded` / too many requests / explicit rate-limit text. Hard-negatives: bare 429 / `Cloud Code Assist API error (429)`, 401/403, auth/token/project, network/timeout/abort, 5xx/529/capacity/overloaded, context/content/safety/model, fuzzy help. Candidates need readable credential + **fresh/live** matching-model remaining > 0 on the **current public model’s accepted keys only** (stale/unknown/reauth/unmapped/other-model-only/same-group-sibling-only **fail-closed**). **Not group-aware**: group remaining never makes an exhausted public model a candidate. Process lock, Active double-check, candidate revalidation, pre-Activate TOCTOU, cooldown, max 1 switch + 1 retry per turn. Concurrent sessions share `globalThis.__piAntigravityFailover` so only one real Activate occurs. SSE `antigravity_account_failover` projects only status/reason/retry/safe message (no account ids/projectId/tokens/paths). Terminal states never claim Retrying.
- **Top-bar dual-independent rings, compact, and aggregate**: `components/AntigravityUsagePanel.tsx` gated by `antigravity.usagePanelEnabled` (default off). `lib/antigravity-usage-ring.ts` groups safe windows and projects **priority model groups as independent side-by-side rings** (`ringSlots` / `ringUnits`): Gemini 3 Flash group and Claude Opus group each become a **single-layer** `ProviderUsageRingUnit` when present (`mode: dual-independent` or `single`). **Never** pack Flash outer + Opus inner into one concentric N-ring unit — concentric multi-layer N-ring remains **period-only** (5h/7d) for other providers; Antigravity currently has no trusted dual-period evidence, so each group is one layer. Center of each ring is that group’s conservative used%. Only non-priority groups (or no priority data) fall back to detail-only (`ringUnit=null`, fixed “多模型/详情”). `resetTime` is title/detail only and is **never** `durationMs` / `durationEvidence` or radial-order evidence. No sum/average/composite total percent across groups or models. Detail accordion expands variants under fixed group order. Aggregate order is GPT 0 → Grok 1 → Kiro 2 → Antigravity 3; shell may render multiple small independent rings via `ringUnits` and never fetches quota; provider panel remains sole data owner. Global Compact/Aggregate flags are unchanged presentation switches; per-provider `usagePanelEnabled` still controls mount/polling. AppShell single host + JSX mutual exclusion prevent double polling / double right-padding.
- **Models UI**: Capability-driven managed OAuth branch in `ModelsConfig` for `google-antigravity` (SSE browser OAuth + manual redirect paste; no JSON import). Multi-account Active, remark/extra info, selected quota account, Activate, reauth recovery, protected delete, risk disclosure (non-official channel / wide scope). `AntigravityQuotaView` reuses the same `groupByAntigravityQuotaWindows` helpers for collapsed group headers (conservative used/remaining) and expandable variants — never a cross-model total, second mapping table, JSON import, or projectId. Selection/Activate aborts prior requests and increments generation/accountId guards so old quota cannot flash back.
- **Settings**: Peer **Antigravity** section with `antigravity.usagePanelEnabled` and `antigravity.autoFailover.enabled` (both default off) plus fail-closed / model-aware copy. Usage section global Compact/Aggregate copy covers all four providers.

#### Account data layout

```text
~/.pi/agent/auth-accounts/google-antigravity/
  accounts.json               # 0600 — metadata only (no access/refresh/projectId)
  <opaque-storage-id>.json    # 0600 — access/refresh/projectId (+ optional email)
  .quota-cache.json           # 0600 — normalized safe model windows only
  provider.refresh-activate.lock/  # mkdir lock
  deleted/                    # soft-deleted credentials
```

#### Key invariants

- Never statically import `@yofriadi/pi-antigravity-oauth` TypeScript source into Next app modules; only jiti public default factory + `serverExternalPackages`.
- Never introduce `pi-antigravity-rotator` or a second third-party account store writing `auth.json`.
- Callback listener policy is loopback-only (`127.0.0.1:51121`); do not accept non-loopback `PI_OAUTH_CALLBACK_HOST` to widen bind.
- `projectId`, tokens, refresh, raw upstream body/URL/headers/paths never cross API/DOM/SSE/log; `accounts.json` is metadata-only.
- `remainingFraction` is remaining ratio; UI utilization is `1 − remaining`. Invalid remaining is rejected, not clamped to 0%.
- `resetTime` is display-only; not N-ring duration evidence (`durationMs` / `durationEvidence`) and not failover ranking.
- Default project `rising-fact-p41fc` is never a healthy candidate shortcut.
- Failover is **model-aware and not group-aware**: only the current public model’s accepted keys with fresh/live remaining > 0 count; same-group sibling remaining does not open a candidate; fail-closed on unknown mapping / stale / other-model-only quota.
- Display group aggregation is conservative `max(used)` / `min(remaining)` for UI headers/rings only; never avg/sum and never fed into failover.
- Dual independent rings (Flash | Opus side-by-side) are model-group presentation; period N-ring outer/inner semantics stay period-only and must not encode Flash/Opus.
- Compact and aggregate flags are global presentation switches; Antigravity panel visibility stays independent.
- Aggregate shell never invents a cross-provider or cross-model total percent.

#### Rollback

1. Ops stop-bleed: set `antigravity.usagePanelEnabled=false` and `antigravity.autoFailover.enabled=false` in `pi-web.json`; optionally `usage.providerPanelsAggregated=false` / `usage.providerPanelsCompact=false`. Credentials and normalized cache are retained.
2. UI stop-bleed without removing the provider: drop multi `ringSlots` / `ringUnits` rendering and restore flat multi-model detail-only; group helpers may remain unused. Do not delete user credentials/cache.
3. Provider-layer: remove Antigravity from `webProviderExtensions()` and hide Models/Auth/Settings/topbar/API branches; Grok/Kiro/native keep working. When removing the fourth aggregate column, preserve the first three providers’ contract and Compact preference.
4. Preserve `auth-accounts/google-antigravity/` and `.quota-cache.json`; do not bulk-delete user credentials.
5. No Session JSONL / usage-ledger / cacheWrite migration exists for Antigravity, so no data rewrite rollback.

## Skills and Commands

Skill search/install/list routes live under `app/api/skills/`; slash-command discovery lives under `app/api/commands/`. Use `lib/npx.ts` for cross-platform `npx` execution.
