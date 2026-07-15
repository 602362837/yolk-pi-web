# Integrations and Dependencies

## Primary Runtime Dependencies

See `package.json` for exact versions.

| Dependency | Purpose |
| --- | --- |
| `next`, `react`, `react-dom` | Web application framework/runtime. |
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` | In-process pi AgentSession and AI provider integration. |
| `pi-grok-cli` | SuperGrok / X Premium OAuth provider, model catalog, inference, and request adapter. Integrated as a fixed, full extension; Web adds multi-account storage, global Active live reload, optional auto-failover, and quota management on top. |
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
- **Quota service** (`lib/grok-subscription-quota.ts`): Reads monthly/optional weekly usage from the Grok CLI billing endpoint with 60s fresh / 24h stale TTL, single-flight, 401 refresh+retry, and strict allowlist projection. See `GET /api/auth/quota/grok-cli`.
- **ModelsConfig UI** (`components/ModelsConfig.tsx`): Provider-capability-driven OAuth detail renders Grok login methods, multi-account list, active/default-session semantics, session-reference delete protection, and quota cards with fresh/stale/error/reauth states.

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

## Skills and Commands

Skill search/install/list routes live under `app/api/skills/`; slash-command discovery lives under `app/api/commands/`. Use `lib/npx.ts` for cross-platform `npx` execution.
