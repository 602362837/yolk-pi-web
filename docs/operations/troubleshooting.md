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

## Models Config Sync (OpenAI-compatible /models discovery)

`POST /api/models-config/sync` discovers remote model ids from a saved custom OpenAI-compatible provider's `/models` or `/v1/models` endpoint. It only supports custom providers with `api: "openai-completions"` or `"openai-responses"` and a valid http(s) baseUrl. Built-in Pi providers, Grok/Kiro/Antigravity, and non-OpenAI protocols are unsupported.

### Sync entry disabled / unavailable

- **"请先保存当前 Models 更改"**: the ModelsConfig has unsaved draft changes. Save first, then sync.
- **"请先保存提供商"**: the provider hasn't been saved yet. Save ModelsConfig, then sync.
- **"仅支持 OpenAI-compatible API"**: provider `api` is `anthropic-messages` or `google-generative-ai`. Only `openai-completions` and `openai-responses` are eligible.
- **Missing/invalid Base URL**: the provider's `baseUrl` is empty or not a valid http/https URL. Set one and save.
- **No sync entry at all**: the provider is a Pi built-in (e.g. `openai`, `zenmux`) or fixed extension (`grok-cli`, `kiro`, `google-antigravity`). These cannot use generic /models sync; manage their models through the standard provider configuration.

### Preview returns no models / auth error

- **"端点拒绝了凭据" (401/403)**: the endpoint rejected the API key. Check the Key in your provider config. For local servers without auth, ensure a dummy key is configured (Pi's model availability rules require a key).
- **"无法解析该提供商的已保存凭据"**: no API key is saved for this provider. Configure one in auth.json (Settings → Models) or via `apiKey` in models.json.
- **"未找到 /models 或 /v1/models" (404/405)**: the provider's baseUrl does not expose a standard OpenAI model list endpoint. Verify the baseUrl is correct and the service supports `GET /models` or `GET /v1/models`.
- **"读取模型列表超时"**: the endpoint did not respond within 10 seconds. Check the service is running and reachable.
- **"远端模型列表超过安全读取上限"**: the response exceeded the 1 MiB safety limit or contained more than 2000 models.
- **"端点返回的不是可识别的 OpenAI 模型列表"**: the response did not match the expected `{ data: [{ id, owned_by? }] }` shape.

### Apply fails with stale revision

- **"Models 配置已发生变化，请重新预览后再写入"**: another write (e.g. model price save, ModelsConfig save) changed models.json after the preview. Re-preview and re-select models.
- **"预览已过期"**: the 5-minute preview TTL expired. Click "预览远端模型" again.

### Apply succeeds but new models don't appear in selector

- The server performs a best-effort live `ModelRuntime` reload after a successful sync. If the reload is partial (`runtimeReload: "partial"`), open sessions may need a refresh (close and reopen the model selector, or start a new chat). The disk write is already committed — the models are in `models.json`.
- Run `node scripts/test-models-config-sync.mjs` to verify the backend sync pipeline (store, eligibility, URL candidates, fetch/redirect, auth, merge, revision, rollback).

### URL path behavior

| Saved baseUrl | First request | Fallback (only on 404/405) |
| --- | --- | --- |
| `https://host` | `/models` | `/v1/models` |
| `https://host/v1` | `/v1/models` | _(none, single candidate)_ |
| `https://host/api` | `/api/models` | `/api/v1/models` |
| `https://host/models` | _(as-is)_ | _(none)_ |
| `https://host/v1/models` | _(as-is)_ | _(none)_ |

401/403, 429, 5xx, timeout and network errors do **not** trigger path fallback — only 404/405.

### Rollback

1. Hide the sync UI entry by reverting `components/ModelsConfig.tsx` changes — manual model editing continues to work.
2. Remove `app/api/models-config/sync/route.ts` — preview cache is in-memory only and disappears on restart.
3. Do **not** delete models already added by sync; users can manually delete unwanted `{ id }` entries in ModelsConfig.

## Managed API-key accounts (OpenCode Go, xAI)

Allowlisted providers store multi-account metadata and secrets under `~/.pi/agent/auth-api-key-accounts/<provider>/`:

- OpenCode Go: `~/.pi/agent/auth-api-key-accounts/opencode-go/`
- xAI: `~/.pi/agent/auth-api-key-accounts/xai/`

Each directory holds `accounts.json` (masked previews, fingerprints, active id, optional disable metadata) and per-account `<accountId>.json` secret files (mode 0600). Metadata never contains plaintext keys. Accounts are provider-scoped; matching fingerprints across providers are not shared or deduped.

Both providers support **manual** multi-key management in Settings → Models (add/edit/activate/enable/disable/delete/reveal). Only OpenCode Go has optional automatic failover (`opencodeGo.autoFailover`). **xAI does not auto-failover** — users must activate the desired key manually.

## OpenCode Go Auto Failover & Account Recovery

The optional OpenCode Go auto-failover feature (`opencodeGo.autoFailover` in `~/.pi/agent/pi-web.json`) automatically switches the globally active **OpenCode Go** managed API-key account when a request fails with a quota/billing error or a permanent `Invalid/Missing API key` error. It does **not** apply to xAI, and it does **not** trigger on transient 429/rate-limit, network errors, or 5xx.

### Symptoms when failover triggers

- A chat message fails with a quota-exhausted or API-key error, then the agent **retries automatically** with a different account.
- A lightweight notice appears in the chat: "OpenCode Go account switched … Retrying…" or "OpenCode Go account disabled … Switching…"
- In Settings → Models → OpenCode Go, an account may show as **DISABLED** with reason `Account unusable: Invalid API key` (auto-disabled by the system).
- The `active` badge moves to a different account in the managed-account list.

### Rollback: disable auto failover

**Method 1 — Settings UI (recommended):**
1. Open Settings → OpenCode Go managed API keys.
2. Turn off the **OpenCode Go auto failover** toggle.
3. The change is saved immediately to `pi-web.json` and takes effect for new turns without a server restart.

**Method 2 — Config file:**
1. Edit `~/.pi/agent/pi-web.json`.
2. Set `opencodeGo.autoFailover.enabled` to `false`.
3. If the server is running, the next agent turn picks up the change; no restart is required.

After disabling, the feature stops all automatic switching. Manually choosing which account is active (via the Activate button in Settings) continues to work as before.

### Recovering an auto-disabled account

When an account is permanently unusable (invalid/missing API key), the failover system **persistently disables** it so it won't be retried. Recovery steps:

1. **Fix the key**: In Settings → Models → OpenCode Go, click **Edit** on the disabled account, replace the API key with a valid one, and save.
2. **Re-enable**: Click **Enable** on the account. This restores the account's eligibility to be activated or participate in failover; it does **not** automatically make it active.
3. **Activate** (optional): Click **Activate** to make this account the globally active one.

> The Enable action clears all `disabled*` metadata fields and records `enabledAt` / `enabledBy: "user"`. After enabling, the account is treated identically to a never-disabled account.

### Verifying account state from the filesystem

OpenCode Go failover inspects managed account metadata at `~/.pi/agent/auth-api-key-accounts/opencode-go/`:
- `accounts.json` — metadata for all accounts, including `disabled`, `disabledReason`, `disabledBy`, `autoDisabledReason`, `enabledAt`, `enabledBy`.
- `<accountId>.json` (mode 0600) — per-account secret; never inspect this file casually.

xAI multi-key state (manual only) uses the same layout under `~/.pi/agent/auth-api-key-accounts/xai/`; it is independent of the OpenCode Go store and is not read by auto-failover.

A disabled account has `disabled: true` in `accounts.json`. An enabled account either has `disabled: false` or the field is absent (old metadata defaults to enabled).

### No migration required

Old managed account metadata (created before this feature) does **not** have `disabled` fields. The code treats missing `disabled` as **enabled** — no startup migration, no data-loss risk, and no manual intervention needed for existing accounts.

### Multi-process caveat

The failover lock is **process-level** (`globalThis.__piOpencodeGoFailover`). In single-process deployments (default `next start`, `ypi`) this is sufficient. If you run multiple Node processes behind a load balancer or use PM2 in `cluster` mode, concurrent quota failures across processes can still cause multiple activations. Mitigation:
- The per-turn budget (`maxAccountSwitchesPerTurn=1`) and cooldown still limit damage.
- Disable auto failover if cross-process race conditions become a practical issue.
- A future v2 may add file-system or external locking for multi-process deployments.

## Grok Global Active Auto Failover

Optional Grok failover (`grok.autoFailover` in `~/.pi/agent/pi-web.json`, default off) rotates the **global Active** Grok OAuth account when an assistant error is an explicit quota/usage/credits/monthly/weekly exhaustion or an explicit rate-limit / too-many-requests shape. Manual Models Activate is **not** a lock: a manually activated account can still be rotated when eligible. Historical session header `grokAccountStorageId` is ignored at runtime.

### Expected behavior

- Activate B in Models: ordinary live/new Grok sessions use B on the **next** provider request; in-flight requests keep their original token.
- With auto-failover enabled, an eligible limit error on B switches Active to C once, reloads live wrappers, and retries the same turn once.
- Concurrent sessions: at most one actual switch; the other session retries with the new Active and does not cascade to a third account.
- Chat shows a sanitized notice. Only `switched` / `already_switched_by_other_session` may say Retrying; no-candidate / budget / fixed-token bypass are terminal.

### Does **not** trigger

Bare HTTP status alone, fuzzy help text that merely mentions limit/rate, network/timeout/5xx, auth/reauth, context overflow, content filter, or model unavailable.

### Rollback

1. Settings → Grok → turn off **明确限额或限流时自动切换可用账号**, or set `grok.autoFailover.enabled` to `false` in `pi-web.json`.
2. Takes effect on the next turn; no restart required.
3. ChatGPT/OpenCode Go/Kiro/Antigravity failover state is independent (`__piChatGptFailover` / `__piOpencodeGoFailover` / `__piKiroFailover` / `__piAntigravityFailover` vs `__piGrokFailover`).

### Fixed token bypass

If `GROK_CLI_OAUTH_TOKEN` (or related fixed env tokens) override managed OAuth for actual requests, auto-failover refuses to report a fake switch and surfaces a display-safe notice without leaking the token.

## Kiro Provider, Quota, Auto Failover & Compact Top-bar

Kiro is a fixed Web provider (`pi-kiro-provider@0.2.2` via jiti) with independent OAuth multi-account, AWS GetUsageLimits quota, and Path B auto-failover. It does **not** share Grok/ChatGPT classifier or quota modules.

### Kiro missing from Models / Auth after cold start

1. Confirm `pi-kiro-provider` is installed and listed in `next.config.ts` `serverExternalPackages` with `jiti`.
2. Confirm the process loaded `webProviderExtensions()` / `ensureWebProvidersBootstrapped()` — opening Chat is **not** required; cold `/api/models` and `/api/auth/providers` should list `kiro`.
3. If only Grok appears, check server logs for a per-provider jiti load failure; a Kiro load error must not take down Grok, but Kiro will be absent until the package/load issue is fixed.
4. After any code path that still constructs a catalog without `createWebAgentSessionServices` / `getWebModelRuntime`, migrate it so fixed providers register on the **target** `ModelRuntime`. Do not call removed `ModelRegistry.create()` or `createWebProviderAwareModelRegistry()`.

### Quota shows “额度暂不可用” / unavailable

- Endpoint is only `https://q.<validated-commercial-region>.amazonaws.com/` + `AmazonCodeWhispererService.GetUsageLimits`. Arbitrary credential URLs are rejected.
- Unsupported region, `ValidationException` after the single fallback body, empty/malformed buckets, or schema drift all project **unavailable** (never fake 0%). Chat and account management still work.
- Stale cache may still render last-success numbers with a stale warning; **auto-failover candidates require fresh/live remaining > 0** (fail-closed on stale/unknown/reauth).
- 401: server force-refreshes the account token once and retries GetUsageLimits once. Persistent reauth surfaces “需登录” and blocks failover candidates.
- Manual force refresh: Models/top-bar refresh with `?refresh=1`.

### Auto-failover does not switch

1. Settings → Kiro → enable **明确限额或限流时自动切换可用账号** (`kiro.autoFailover.enabled`).
2. Error must be an explicit AWS quota reason / explicit rate-limit shape. Hard-negatives that **never** switch: `INSUFFICIENT_MODEL_CAPACITY`, bare 429/403, network/timeout/5xx, auth/reauth, context/content/model errors.
3. Need another account with readable credential and fresh/live primary remaining > 0.
4. Per-turn budget is 1 switch + 1 retry; concurrent sessions share `globalThis.__piKiroFailover` so only one real Activate occurs.

### Rollback / stop-bleed

1. Settings → Usage: turn off **模型用量组件聚合** (`usage.providerPanelsAggregated=false`) to leave the aggregate path and restore standalone Full/Compact immediately; Compact preference is retained and re-applies. Optionally turn off **顶部额度组件简要显示** (`usage.providerPanelsCompact=false`). Settings → Kiro: turn off usage panel and auto-failover if needed.
2. Provider-layer: remove Kiro from `webProviderExtensions()` and hide Kiro UI/API branches; Grok/Antigravity continue.
3. Keep `~/.pi/agent/auth-accounts/kiro/` credentials and `.quota-cache.json`; do not bulk-delete. Aggregate/compact flags never delete credentials or quota cache.
4. Failover state is independent of GPT/Grok/OpenCode/Antigravity (`__piKiroFailover` vs `__piGrokFailover` / `__piChatGptFailover` / `__piOpencodeGoFailover` / `__piAntigravityFailover`).

## Antigravity Provider, Per-Model Quota, Auto Failover & Top-bar

Antigravity is a fixed Web provider (`@yofriadi/pi-antigravity-oauth@0.3.0` via jiti, provider id `google-antigravity`) with independent OAuth multi-account, fixed `fetchAvailableModels` per-model quota, and model-aware Path B auto-failover. It does **not** share Grok/Kiro classifier or quota modules and does **not** use `pi-antigravity-rotator`.

### Antigravity missing from Models / Auth after cold start

1. Confirm `@yofriadi/pi-antigravity-oauth@0.3.0` is installed and listed in `next.config.ts` `serverExternalPackages` with `jiti`.
2. Confirm the process loaded `webProviderExtensions()` / `ensureWebProvidersBootstrapped()` — opening Chat is **not** required; cold `/api/models` and `/api/auth/providers` should list `google-antigravity`.
3. If only Grok/Kiro appear, check server logs for a per-provider jiti load failure; an Antigravity load error must not take down the others.
4. After any code path that still constructs a catalog without `createWebAgentSessionServices` / `getWebModelRuntime`, migrate it so fixed providers register on the **target** `ModelRuntime`. Do not call removed `ModelRegistry.create()` or `createWebProviderAwareModelRegistry()`.
5. OAuth callback must bind `127.0.0.1:51121` only. Web forces `PI_OAUTH_CALLBACK_HOST=127.0.0.1` before first package import; do not widen to non-loopback. Remote browsers use Models manual redirect-URL paste.

### Quota shows unavailable / invalid project / reauth

- Endpoint is only `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` with server-side `{"project":"<projectId>"}`. Arbitrary credential URLs/headers are rejected.
- `remainingFraction` is remaining ratio; used percent is `100 × (1 − remaining)`. Invalid/missing remaining is rejected (never fake 0%).
- Empty/malformed models map, invalid project (403), network/timeout project as unavailable/access denied/invalid project with fixed safe copy.
- Stale cache may still render last-success model windows with a stale warning; **auto-failover candidates require fresh/live matching-model remaining > 0** (fail-closed on stale/unknown/reauth/unmapped).
- 401: server force-refreshes the account token once and retries once. Persistent reauth surfaces “需登录” and blocks failover candidates.
- Default project `rising-fact-p41fc` alone never proves the account/model is healthy.
- Manual force refresh: Models/top-bar with `?refresh=1`.

### Auto-failover does not switch

1. Settings → Antigravity → enable **明确限额或限流时自动切换可用账号** (`antigravity.autoFailover.enabled`).
2. Error must be explicit RESOURCE_EXHAUSTED / quota exhausted/exceeded / quota reset markers / rate_limit_exceeded / too many requests. Hard-negatives that **never** switch: bare 429 / `Cloud Code Assist API error (429)`, 401/403, auth/token/project, network/timeout/abort, 5xx/capacity, context/content/model.
3. Need another account with readable credential and **fresh/live quota for the current public model’s accepted keys** (`remainingFraction > 0` via the fixed 0.3.0 mapping). Quota only on other models is not enough — including **same UI group** siblings (e.g. Opus 4.5 remaining does not prove Opus 4.6 usable). Failover is **not group-aware**; top-bar group remaining is display-only.
4. Per-turn budget is 1 switch + 1 retry; concurrent sessions share `globalThis.__piAntigravityFailover` so only one real Activate occurs.

### Top-bar shows two rings / one ring / “多模型”

- **Two independent rings** (Flash | Opus side-by-side) when both priority groups have safe data. Each ring is a single-layer group unit with **conservative** max(used); they are **not** concentric period outer/inner layers.
- **One independent ring** when only one priority group is present (do not invent a fake 0% sibling).
- **“多模型/详情”** when no priority group is present but other groups/models have data, or loading/reauth/unavailable paths need safe copy. `resetTime` is display-only and never becomes duration evidence.
- Do not invent a total/average percent across groups or models. Period multi-layer N-ring (5h/7d) is unrelated to Flash/Opus grouping.

### Rollback / stop-bleed

1. Settings → Antigravity: turn off usage panel and auto-failover. Settings → Usage: optionally turn off aggregate/compact.
2. UI-only: stop multi `ringUnits` rendering and fall back to flat multi-model detail-only; group helpers may remain unused. Do not delete credentials/cache.
3. Provider-layer: remove Antigravity from `webProviderExtensions()` and hide Antigravity UI/API branches; Grok/Kiro continue. When removing aggregate column 4, keep GPT→Grok→Kiro contract.
4. Keep `~/.pi/agent/auth-accounts/google-antigravity/` credentials and `.quota-cache.json`; do not bulk-delete.
5. Failover state is independent (`__piAntigravityFailover` vs Kiro/Grok/GPT/OpenCode).

### Compact top-bar looks wrong

- Compact is **global** and **standalone-only**: one `usage.providerPanelsCompact` switch affects all enabled provider triggers together when aggregate is off.
- When aggregate is on, Compact is disabled in Settings but its boolean is not rewritten; turn aggregate off to re-apply Compact.
- Provider visibility remains independent (`chatgpt|grok|kiro|antigravity.usagePanelEnabled`).
- Host order is always GPT → Grok → Kiro → Antigravity inside a single `.app-top-usage-panel` with one right-padding reserve.
- Standalone Full/Compact use shared N-ring (not text summary chips); click still opens the same detailed popover (refresh / Activate / Models recovery preserved).
- Ring layout comes from actual account windows + shared projector (short→long outer→inner, center = outermost). Missing windows are not filled with empty 5h/7d/week/month tracks.

### Aggregate top-bar looks wrong / double polling

- Aggregate is **global**: `usage.providerPanelsAggregated` (default false). When true, AppShell mounts only `ProviderUsageAggregatePanel` — never CSS-hide standalone panels.
- Open is hover/focus (not click-primary accordion). Leaving both trigger and panel schedules a fixed **220ms** close; Escape uses focus-suppression so restore focus does not instantly reopen.
- Panel is non-accordion provider columns (1–4 desktop in GPT→Grok→Kiro→Antigravity order, ≤640px max 2, ≤420px single); there is no total ring/percent and no “refresh all”.
- Theme: panel/close/column/status colors must follow light/dark usage tokens (`--usage-panel-*` / status tokens in `app/globals.css`). Fixed night surfaces like `rgba(11,15,25,.98)` or `#1e293b` close buttons are regressions.
- Ring sizes: aggregate trigger 30px; column-header rings target 40px (minimum 38px, not flex-shrunk below). Center text uses high-contrast tokens; outer unknown percent stays label + `—` (or same-bucket remaining) and never borrows an inner layer.
- Network: each enabled provider should still own one accounts/quota client instance. If requests double, confirm aggregate/standalone JSX mutual exclusion and that disabled providers are not mounted.
- Safe stop-bleed: `usage.providerPanelsAggregated=false` (credentials/cache/Compact preference untouched).

### Aggregate / N-ring shows wrong windows or center

- Providers only emit **actual present** safe candidates; the shared projector decides single/multi rings. Do not expect fixed GPT `[5h,7d]` or Grok `[week,month]` layouts.
- Outer = shortest **trusted** duration; center always follows final outer (`layers[0]` / `centerLayerId`).
- Single window (e.g. GPT only-7d, Grok only-week, single unknown-duration) is a single ring with that window as center.
- Multi-window unknown duration or same-duration ties stay in detail with “另有窗口仅在详情展示”; all-unknown multi shows no ring + safe “详情” fallback (not array-order center).
- Antigravity is special: priority model **groups** render as **independent side-by-side rings** (Flash | Opus), not period concentric layers. Non-priority multi-model remains detail-only (“多模型”). `resetTime` is never duration evidence.
- Duration evidence is only explicit positive duration or strict period tokens/labels (`5h`, `7d`, `weekly`, `90m`, …). `Limits`, `quota`, remaining, resetAt, resourceType, percent, provider name, and array/field/id order are **not** duration — Kiro must not treat `Limits` as 90d; Antigravity must not treat `resetTime` as duration.
- When live provider data cannot prove duration for multi-window **period** accounts, detail-only degradation is correct; do not loosen evidence just to force multi-rings. Do not encode model groups as concentric period layers.


## YPI Studio DAG and Async Runs

- `studio.subagents.runner` in `~/.pi/agent/pi-web.json` controls new Studio subagent runs: `auto` (default rollout), `sdk` (force SDK and fail instead of using CLI if unavailable), or `cli` (legacy rollback). The runner is read when a new run starts; already running CLI children are not migrated or interrupted by config changes.
- Studio subagents using the legacy CLI runner first resolve the bundled `@earendil-works/pi-coding-agent/dist/cli.js` from the web app dependency and only fall back to `pi` on `PATH` if no local CLI is found. If child startup fails with `ENOENT`, verify the package dependency is installed before requiring a global `pi` install.
- If a task is bound to the current chat but `awaiting_approval -> implementing` is blocked, inspect `.ypi/tasks/<task>/task.json`: `contextIds` should include the current Studio context and `meta.approvalGrant` should be written only after a later explicit user confirmation.
- If a queued/running async subagent disappears after server restart or dev hot reload, poll/collect may mark the run as `runtime_lost`; retry the affected subtask instead of assuming the whole task failed. For rollback, set `studio.subagents.runner` to `cli`; child sessions already written by SDK runs remain hidden audit records and do not need deletion.
- If child audit sessions appear in ordinary history during debugging, remove `includeStudioChildren=1` from the session-list request or reset the UI debug view. The underlying JSONL can remain for audit/replay.
- Use `npm run test:studio-dag` for DAG scheduling regressions and `npm run test:studio-policy` for approval/policy regressions.
- UI truncation flags on subagent transcripts are display limits, not failure signals; use run status, `result.isError`, and termination reason for severity.

## Usage ledger and session rollup

Two retained paths — do not confuse them:

| Surface | API | Data | Config |
| --- | --- | --- | --- |
| Sidebar **Usage** modal | `GET /api/usage/calls` | Immutable `usage-events/v1/` | Independent of `includeArchived` |
| Chat top-bar chips | `GET /api/usage?sessionId=` | Selected session (+ Studio children) JSONL | `usage.includeArchived` |

### Date range looks wrong in Usage

Ledger dates are **server-local** day bounds, not browser-local and not UTC day labels:

1. `from`/`to` → local `00:00:00.000` … `23:59:59.999` (`lib/local-date-range.ts`)
2. Store scans intersecting **UTC** partitions only as a candidate index
3. Query keeps events only when `occurredAt` is inside the inclusive instants
4. `byDay` and `range.timezone` use the same local calendar semantics

If a single local day still shows neighbor-day traffic after upgrade, confirm the server process timezone and that `/api/usage/calls` response `range.timezone` matches expectations. Focused regression: `npm run test:llm-usage-query` (also with `TZ=Asia/Shanghai`).

### `/api/usage` returns 400

Missing `sessionId` is intentional: global Session-scan aggregation is retired. Use `/api/usage/calls` for global stats, or pass `sessionId` for top-bar rollup. External clients that called the old no-session route must migrate.

### Old `usage.statsSource` / missing ledger writes

Retired field is ignored on read and stripped on the next Settings usage save. Ledger recording is always on; old `"legacy"` values must not disable the recorder. There is no UI switch back to Session 统计.

### Top bar vs Usage modal numbers differ

Expected: top bar is session_rollup (one chat + Studio children from JSONL); Usage modal is the call ledger (workspace/date/source filtered events). Different stores and scopes by design.

### Coverage / corrupt counts not shown in UI

Wire `coverage` remains on `/api/usage/calls` for ops; the Usage UI no longer renders coverage banners, known gaps, or corrupt-file footers. Inspect the JSON response or server logs when diagnosing capture gaps.

## Model Price Configuration

### Pricing data flow

1. Users open Settings → 模型价格 to see all models with price status (缺价/已配置/内置/免费).
2. For missing-price models, users can hand-edit prices in a drawer (input/output/cache-read in USD/1M tokens), optionally mark as explicitly free, and save.
3. **Intelligent suggestions** (智能填写): select target models → `POST /api/model-prices/suggest` fetches OpenRouter catalog → deterministic matching first, then AI-assisted extraction for remaining models → users review evidence, confidence, and warnings → explicit confirm → `PATCH /api/model-prices` writes to `models.json`.

### Write target

Prices are saved directly to `~/.pi/agent/models.json`:
- Built-in/extension models: `providers.<p>.modelOverrides.<model>.cost`
- Custom models: `providers.<p>.models[<match>].cost`
- Explicit free: writes `cost.{input,output,cacheRead}=0` + records in `pi-web.json` `usage.explicitFreeModels[]`

### Concurrency

The PATCH API uses an opaque revision hash derived from the file content. If two concurrent saves race, one will get HTTP 409 and the UI will prompt to reload and re-apply changes (user draft is preserved).

### Backup and rollback

Before every write, the existing `models.json` is copied to `models.json.backup`. If a write fails mid-operation, the original file is preserved and the temp file is cleaned up. To restore the previous configuration:

```bash
cp ~/.pi/agent/models.json.backup ~/.pi/agent/models.json
```

Then reload Settings to pick up the restored prices.

### JSONC comments

If `~/.pi/agent/models.json` contains JSONC comments (`// ...`), they will be **lost on the first write** because the service writes clean JSON. A backup is always saved beforehand. If preserving comments is critical, avoid using the model price settings page on a commented file until the JSONC round-trip issue is resolved.

### Custom providers missing from model selector

If the shared model selector only shows managed/built-in providers and every Custom provider from Settings → Models disappears:

1. Check whether Pi rejected the whole `models.json`. From a Node process that can import the Web helpers, create a provider-aware runtime via `createWebAgentSessionServices(...)` / `getWebModelRuntime(...)` and inspect runtime/catalog load errors (do not call removed `ModelRegistry.create()`).
2. A common failure is incomplete custom `cost` objects, for example only `input`/`output`/`cacheRead` without required `cacheWrite`. Pi schema validation then drops **all** custom providers/models, not just the invalid entry.
3. Repair by adding the missing rate(s) on each custom model cost, typically `"cacheWrite": 0` when cache-write pricing is unused, then reload `/api/models`.
4. Write paths now normalize this for custom models:
   - Settings → Models save via `PUT /api/models-config`
   - Model price patch via `lib/model-price-config.ts` `mergePriceChanges`
5. After a bad write, restore from the latest backup under `~/.pi/agent/` (`models.json.pi-price-backup` or a dated `models.json.bak-*`) if needed.

### Suggest API failure modes

- OpenRouter catalog fetch fails → only AI-assisted matching attempted (if evidence exists from other sources)
- AI assistant fails → only deterministic matches returned; unresolved targets listed explicitly
- No default model configured → AI-assisted phase skipped with warning
- All sources fail → `unresolved` array contains all targets; manual entry remains available
- Network timeout/oversized response → per-source graceful degradation; partial results returned

### Price source allowlist

The only currently allowed price source is `https://openrouter.ai/api/v1/models`. Arbitrary URL fetch, proxy, or browser-based scraping is not supported. To add a new source, update `ALLOWLIST_URLS` and `ALLOWED_SOURCE_HOSTS` in `lib/model-price-sources.ts`.

### Test

Run `node scripts/test-model-prices.mjs` for focused validation of price config, merge, revision, JSONC strip, suggest validation, and PATCH batch limits.

## Memory Diagnostic Snapshots

When the Yolk Pi Web process memory grows (potentially to multiple GiB after days of uptime), generate a bounded read-only diagnostic snapshot to gather evidence for offline analysis. This is a diagnosis tool only; it does **not** fix or clean up leaks, abort sessions, force GC, or take heap snapshots.

- **Primary entry**: Settings → 诊断 / Diagnostics → 生成内存诊断快照. The UI shows file metadata (path/size/duration, schema version, partial/compacted badges) only and never renders the full JSON. A `409 busy` state means another capture is in progress on the same process.
- **Compatibility entry**: `curl -i -X POST http://localhost:30141/api/diagnostics/memory-snapshot`. The response is metadata only (`filePath`, `fileName`, `bytes`, `durationMs`, `partial`, `compacted`, `sectionSummary`, …); the full JSON is never returned over HTTP.
- Inspect the file on disk with `jq`:
  ```bash
  jq . "$(printenv HOME)/.pi/agent/diagnostics/<fileName from API response>"
  jq '.process.memoryUsage, .runtime.agentSessions.registryTotal, .findings' "...path..."
  ```
  With `PI_CODING_AGENT_DIR` override the directory is `<PI_CODING_AGENT_DIR>/diagnostics/`.
- **Multi-snapshot comparison**: collect snapshots at low memory, while growing, and after growth, then compare `capturedAt`, `process.memoryUsage.rss`/`heapUsed`, `runtime.agentSessions.aliveCount`/`registryTotal`, per-session `totalContentBytes`, `runtime.studio.childRunTotal`/`pendingContinuationTotal`, `runtime.sessionPathCache.total`, and `findings[]` trends. The snapshots are self-describing JSON and can be diffed with `jq`/normal tools.
- **Privacy before sharing**: the file may contain local workspace/session paths and identifiers (to help correlate), but it does **not** contain message content, tool args/results, system prompts, response ids, terminal buffers, browser snapshots, env vars, or credentials. Review and redact paths before sharing; each file includes a `privacy` block with a share-before-review warning.
- **Known limitation**: OpenAI Codex WebSocket debug stats are recorded **only for known active openai-codex sessions** via public getters (numeric/boolean fields only). The diagnostic does not enumerate the third-party private WebSocket cache/map, so the per-session stats may undercount the full set of cached sessions.
- **Cleanup**: there is no automatic retention, file list, or download center. Delete files manually when no longer needed:
  ```bash
  rm ~/.pi/agent/diagnostics/memory-*.json   # review before deleting
  ```
- If capture returns `409 snapshot_in_progress` from the UI or curl, another capture is in flight on the same process — retry shortly. The single-flight lock is process-level (`globalThis.__piMemoryDiagnosticSnapshotInFlight`); a crashed mid-capture process resets the lock on next start (the lock lives in memory, not on disk).
- If capture returns `500 snapshot_too_large`, even the compact form (samples removed, totals kept) exceeded the 5 MiB cap; retry after restarting the process or open the file-less error as evidence that the in-process state is exceptionally large.
- `partial: true` is expected when a section threw or the 5s deadline expired before later sections started; `sectionSummary` shows which sections have errors, and `errors[]`/`truncation[]` in the file explain the partial result.
- Use `npm run test:memory-diagnostics` for focused schema/marker/caps/deadline/size/atomic-write/lock regressions.
