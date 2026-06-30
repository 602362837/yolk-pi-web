# Design: ChatGPT Usage Auto Refresh

## Background

The existing ChatGPT usage panel is browser-driven: `components/ChatGptUsagePanel.tsx` loads saved accounts from `/api/auth/accounts/openai-codex` and manually refreshes quota through `/api/auth/quota/openai-codex` or `/api/auth/quota/openai-codex?accountId=...`.

The user wants all saved accounts refreshed automatically, with cycle/per-account delays and random salt ranges. A browser-only timer would duplicate work across multiple tabs and can multiply quota requests, increasing rate-limit or risk-control exposure.

## Options

### Option A: Browser-only scheduler

- Each open browser tab schedules auto-refresh independently.
- Simple implementation in `ChatGptUsagePanel.tsx`.
- Problem: multiple tabs duplicate cycles and account requests.
- Browser leader-election via `BroadcastChannel`/`localStorage` locks could reduce duplication but is fragile across suspended tabs, reloads, private windows, and multiple browsers.

### Option B: Backend in-process scheduler with file lock

- Store scheduler state on `globalThis` in the Next.js server process, following existing project patterns such as `globalThis.__piSessions`.
- Add a server module, e.g. `lib/chatgpt-usage-refresh-scheduler.ts`, that owns one timer, one running flag, last run state, and recent errors.
- Use a lock file under the pi agent directory, e.g. `~/.pi/agent/chatgpt-usage-refresh.lock`, to reduce duplicate refresh loops across Node processes.
- The lock file should record at least pid, hostname, createdAt, updatedAt/heartbeat, and owner id.
- Scheduler startup should inspect the lock and remove/replace clearly stale locks before scheduling.
- Expose API endpoints to ensure/start, inspect, and maintain the scheduler, e.g.:
  - `POST /api/chatgpt/usage-refresh/ensure` or call ensure from existing `/api/web-config` reads/writes when enabled.
  - `GET /api/chatgpt/usage-refresh/status` for UI state and lock diagnostics.
  - `POST /api/chatgpt/usage-refresh/repair-lock` for risk-gated manual fault handling.
  - Optional `POST /api/chatgpt/usage-refresh/run` for manual all-account refresh.
- Scheduler reads `pi-web.json` before scheduling/running so config changes take effect without restart.
- Scheduler lists accounts through shared OAuth account helpers and refreshes quota with existing server-side quota functions.
- It refreshes one account at a time using configured per-account interval plus a sampled random salt.
- It schedules the next cycle using cycle interval plus a sampled random salt.
- One lock owner gets one scheduler; all tabs observe the same refreshed cache.

### Option C: Persistent external worker/cron

- Separate daemon or OS cron runs refreshes independent of Next.js requests.
- Strongest isolation and can run when pi-web server is up but no browser has visited recently.
- More operational complexity: install/start/stop, logs, locking, config reload, packaging.

## Recommendation

Use **Option B: backend in-process scheduler with file lock** for this project.

Rationale:

- Avoids duplicate refresh loops from multiple browser tabs.
- Reduces duplicate refresh loops across accidental multiple Node processes.
- Fits current deployment: pi-web is a long-running local/PM2 Next.js server.
- Fits existing project pattern of process-wide runtime registries stored on `globalThis` for hot-reload safety.
- Avoids adding an external daemon or cron.
- Keeps account credentials and quota refresh logic server-side.

## Important Caveats

- File locks need stale-lock handling. A stale lock can happen after a crash or force kill.
- Manual lock repair is risky because deleting a live owner's lock can permit duplicate schedulers. The panel action must show a clear warning and require explicit confirmation.
- Next.js dev hot reload can re-evaluate modules; scheduler state should live on `globalThis` and clear/re-arm timers carefully.
- A serverless deployment would not be suitable for a long-lived scheduler. This project is documented as source/PM2/local Next.js server, so that is acceptable.
- If no request ever hits the server after startup/config change, the scheduler may not be initialized unless hooked into server startup/import paths. A simple ensure call from UI load/settings save is likely enough for current pi-web usage, but a server module imported by a common route can also lazily ensure it.

## Proposed Data Flow

1. User enables auto-refresh and saves ChatGPT settings in `pi-web.json`.
2. `/api/web-config` PUT writes config and calls `ensureChatGptUsageRefreshScheduler()`.
3. When enabled, the scheduler attempts to acquire or renew the lock. Startup treats clearly stale locks as recoverable.
4. When lock ownership is established, the scheduler schedules the next cycle with `cycleInterval + random(cycleSaltMin, cycleSaltMax)`.
5. On cycle start, scheduler lists saved OpenAI Codex accounts.
6. For each account, scheduler calls the same quota-refresh logic used by `/api/auth/quota/openai-codex?accountId=...`, then waits `perAccountInterval + random(perAccountSaltMin, perAccountSaltMax)` before the next account.
7. The quota cache in saved account metadata updates as today, so both Models and the top-bar panel see the same data.
8. Expanded panel can poll or manually refresh scheduler/account status without running its own quota loop.
9. If lock diagnostics indicate likely stale state, the panel can call a repair endpoint after explicit user confirmation.

## Lock Policy Draft

- Lock path: `join(getAgentDir(), "chatgpt-usage-refresh.lock")`.
- Write lock atomically where possible using exclusive create (`wx`) for first acquisition, then regular heartbeat updates by the owner.
- Lock JSON fields: `ownerId`, `pid`, `hostname`, `createdAt`, `updatedAt`.
- Stale if `updatedAt` is older than a dynamic threshold based on the current cycle interval, e.g. `2 * refreshCycleIntervalSeconds`. Do not force all configurations through a fixed minimum fallback; the stale window should follow the user's configured refresh cadence.
- Startup may delete stale locks automatically and retry acquisition.
- Manual repair endpoint should return current lock diagnostics and require a confirmation flag before deleting a non-owned lock.
- If the lock is owned by a live current process, repair should not delete it unless a stronger force flag is intentionally added later.

## Config Shape Draft

```ts
interface PiWebChatGptConfig {
  usagePanelEnabled: boolean;
  autoRefreshEnabled: boolean;
  refreshCycleIntervalSeconds: number;
  refreshCycleSaltMinSeconds: number;
  refreshCycleSaltMaxSeconds: number;
  refreshAccountIntervalSeconds: number;
  refreshAccountSaltMinSeconds: number;
  refreshAccountSaltMaxSeconds: number;
}
```

Suggested defaults:

- `autoRefreshEnabled: false`
- `refreshCycleIntervalSeconds: 1800` (30 minutes)
- `refreshCycleSaltMinSeconds: 0`
- `refreshCycleSaltMaxSeconds: 120`
- `refreshAccountIntervalSeconds: 20`
- `refreshAccountSaltMinSeconds: 0`
- `refreshAccountSaltMaxSeconds: 15`

Suggested validation:

- Cycle interval minimum: 300 seconds.
- Per-account interval minimum: 5 seconds.
- Salt min/max: non-negative integers, max >= min.
- Cycle salt maximum cap: 3600 seconds.
- Per-account salt maximum cap: 300 seconds.
