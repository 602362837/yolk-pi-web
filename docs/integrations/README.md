# Integrations and Dependencies

## Primary Runtime Dependencies

See `package.json` for exact versions.

| Dependency | Purpose |
| --- | --- |
| `next`, `react`, `react-dom` | Web application framework/runtime. |
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` | In-process pi AgentSession and AI provider integration. |
| `pi-grok-cli` | SuperGrok / X Premium OAuth provider, model catalog, inference, and request adapter. Integrated as a fixed, full extension; Web adds multi-account storage, global Active live reload, optional auto-failover, and quota management on top. |
| `pi-kiro-provider` | AWS Kiro OAuth provider (`kiro`) with Builder ID / Google / GitHub login methods and model catalog. Loaded like Grok via jiti (package ships TypeScript source); Web adds multi-account storage, GetUsageLimits quota, optional Path B auto-failover, and top-bar usage. Fixed at `^0.2.2`. |
| `jiti` | Runtime TypeScript loader used only for fixed provider packages (`pi-grok-cli`, `pi-kiro-provider`) so Next/Turbopack never statically compiles their source trees. Listed in `next.config.ts` `serverExternalPackages`. |
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
- **Top-bar usage panel** (`components/GrokUsagePanel.tsx`, Settings `grok.usagePanelEnabled` default off): Optional GPT-symmetric collapsed/expanded usage entry for the global Active Grok account. Reuses accounts/quota/activate APIs and shared `GrokQuotaView` helpers; AppShell mounts it with ChatGPT in one `.app-top-usage-panel` host (GPT→Grok). Foreground 30s light revalidation only; force refresh/Activate use `refresh=1`. Does not add GPT reset credits, warmup, or lock-repair UI.

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

- **Provider bootstrap** (`lib/pi-provider-extensions.ts`): Fixed list is always `[grokCliExtension, kiroProviderExtension]` via `webProviderExtensions()` / `webExtensionFactories()`. Cold paths use `ensureWebProvidersBootstrapped()` and `createWebProviderAwareModelRegistry()` (deprecated Grok-named aliases remain). Every ResourceLoader / Models / Auth / Studio SDK child / Skills / Commands / assist route must load this list so registry refresh cannot drop either provider. Per-provider jiti load failures are isolated.
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
- **Top-bar & compact mode**: `components/KiroUsagePanel.tsx` gated by `kiro.usagePanelEnabled` (default off). Global `usage.providerPanelsCompact` (default false) compresses GPT/Grok/Kiro triggers together via pure `components/ProviderUsageTrigger.tsx` (provider + ≤2 summaries; click still opens detailed popover). AppShell single host order **GPT → Grok → Kiro** with one right-padding reserve. Settings: compact under Usage; Kiro panel/failover under Kiro section (peer of ChatGPT/Grok).
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
- Compact mode is global; per-provider `usagePanelEnabled` still controls mount/polling independently.

#### Rollback

1. Ops stop-bleed: set `kiro.usagePanelEnabled=false`, `kiro.autoFailover.enabled=false`, optional `usage.providerPanelsCompact=false` in `pi-web.json` (no restart required for next turn / next panel mount).
2. Provider-layer: remove Kiro from `webProviderExtensions()` and hide Kiro Models/Auth/Settings/topbar branches; Grok and native providers keep working.
3. Preserve `auth-accounts/kiro/` and normalized quota cache; do not bulk-delete user credentials.
4. No Session JSONL / usage-ledger migration exists for Kiro, so no data rewrite rollback.

## Skills and Commands

Skill search/install/list routes live under `app/api/skills/`; slash-command discovery lives under `app/api/commands/`. Use `lib/npx.ts` for cross-platform `npx` execution.
