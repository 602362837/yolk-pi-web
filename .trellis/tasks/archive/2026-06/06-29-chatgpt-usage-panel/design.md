# Design: ChatGPT Usage Panel

## Overview

Add an optional ChatGPT usage panel that reads cached active-account quota state and lets users manually refresh the same quota data used by Models config. The feature is controlled by a new `chatgpt` section in `~/.pi/agent/pi-web.json`.

## Config Contract

Add to `lib/pi-web-config.ts`:

```ts
export interface PiWebChatGptConfig {
  usagePanelEnabled: boolean;
}

export interface PiWebConfig {
  worktree: PiWebWorktreeConfig;
  trellis: PiWebTrellisConfig;
  usage: PiWebUsageConfig;
  chatgpt: PiWebChatGptConfig;
}
```

Default:

```json
{
  "chatgpt": {
    "usagePanelEnabled": false
  }
}
```

`writePiWebConfigPatch()` and `PUT /api/web-config` must accept the new `chatgpt` section while preserving existing sections.

## Data Flow

### Read cached state

- Component calls `GET /api/auth/accounts/openai-codex` when the panel is enabled.
- It selects `accounts.find(account => account.active)` or matches `activeAccountId`.
- It reads `activeAccount.quotaCache` for cached quota tiers and `queriedAt`.
- No quota query runs on mount; missing cache displays unknown state.

### Manual refresh

- User clicks refresh in the expanded panel.
- Component calls `GET /api/auth/quota/openai-codex`.
- Existing backend queries the active OAuth credential, updates account quota cache, and returns `SubscriptionQuota`.
- Component then reloads `GET /api/auth/accounts/openai-codex` so account identity and cache match Models config.

## UI Boundaries

### Settings

`components/SettingsConfig.tsx` adds a new left-nav section `ChatGPT` with a toggle:

- Label: ChatGPT 用量悬浮面板
- Description: shows active ChatGPT/Codex account quota in the top bar; refresh is manual.

### Top bar

`components/AppShell.tsx` renders the panel only when:

- `webConfig?.chatgpt.usagePanelEnabled === true`

The panel anchors on the top-bar right side, near session/context stats, and reserves space for right-side Preview/Trellis buttons.

### New component

Add `components/ChatGptUsagePanel.tsx`:

- Collapsed state:
  - semi-transparent pill/button
  - refresh time only (`Unknown` when no cache)
  - one or more pie/donut mini charts for known tiers
  - neutral placeholder pie for no cache / unknown
  - no account remarks/notes
- Expanded state:
  - semi-transparent popover/dropdown
  - active account label / masked id / active status
  - remarks and extra info only here
  - refresh time
  - tier pies with percent used and reset countdown
  - manual refresh button
  - states: loading account cache, refreshing quota, no active credential/account, expired credential, query error

## Shared Helpers

Avoid copying Models quota formatting logic wholesale. Prefer moving reusable quota display helpers from `components/ModelsConfig.tsx` into a shared frontend module, for example:

- `components/chatgpt-usage-utils.ts` or `lib/quota-display.ts`

Reusable helpers/types:

- known tier labels (`five_hour` -> `5h`, `seven_day` -> `7d`)
- `quotaColor(utilization)`
- `formatResetCountdown(resetsAt)`
- `formatQuotaQueriedAt(timestamp)`
- tier filtering for known ChatGPT quota windows

Keep token-bearing data out of client responses; use only sanitized account summaries already returned by accounts route.

## Compatibility

- Existing `pi-web.json` files without `chatgpt` normalize to default disabled config.
- Existing Models config quota UI remains supported and should use the same helper behavior after refactor.
- No new backend route is required unless implementation discovers accounts route does not expose enough cached data. Current evidence shows it does.

## Docs

Update:

- `docs/modules/frontend.md` for `ChatGptUsagePanel` and Settings config addition.
- `docs/modules/library.md` for new `PiWebChatGptConfig` and any shared quota helper module.
- `docs/modules/api.md` only if `web-config` route docs need explicit mention of new ChatGPT config section; no new route expected.
