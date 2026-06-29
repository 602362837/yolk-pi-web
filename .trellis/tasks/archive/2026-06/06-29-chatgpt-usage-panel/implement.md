# Implementation Plan: ChatGPT Usage Panel

## Checklist

1. Read implementation specs before code changes:
   - `docs/standards/code-style.md`
   - `.trellis/spec/frontend/index.md` and linked frontend spec files
   - `.trellis/spec/guides/index.md` and linked thinking guides as needed
2. Extend web config:
   - Add `PiWebChatGptConfig` to `lib/pi-web-config.ts`.
   - Add default `chatgpt.usagePanelEnabled = false`.
   - Normalize missing/partial `chatgpt` config.
   - Validate `chatgpt` patch.
   - Accept/persist `chatgpt` in `writePiWebConfigPatch()`.
   - Update `app/api/web-config/route.ts` request body typing.
3. Update Settings UI:
   - Add `chatgpt` to `SettingsSection`.
   - Track `chatgpt` and `savedChatgpt` state.
   - Include chatgpt in dirty check, loading, reset, save, setup action config application.
   - Add ChatGPT nav item and section with usage-panel toggle.
4. Extract shared quota display helpers from `ModelsConfig.tsx`:
   - tier labels
   - color mapping
   - refresh time formatting
   - reset countdown formatting
   - optional known-tier filter helper
   - Update Models config imports to use shared helpers.
5. Add `components/ChatGptUsagePanel.tsx`:
   - Load cached active account from `/api/auth/accounts/openai-codex` only when enabled.
   - Do not call `/api/auth/quota/openai-codex` automatically.
   - Show unknown state when no cache exists.
   - Implement collapsed semi-transparent pill with refresh time and pie placeholder/charts.
   - Implement expanded semi-transparent popover with account details, remarks, quota details, reset info, errors, and refresh button.
   - Refresh button calls `/api/auth/quota/openai-codex`, then reloads accounts cache.
6. Wire panel in `AppShell`:
   - Import component.
   - Render only when `webConfig?.chatgpt.usagePanelEnabled`.
   - Place in top-bar right-side area without overlapping right fixed buttons.
   - Ensure settings changes call `loadWebConfig()` and dynamically show/hide the panel.
7. Update docs:
   - `docs/modules/frontend.md`
   - `docs/modules/library.md`
   - `docs/modules/api.md` if web-config contract wording needs the new section.
8. Validate:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Risk Points

- `SettingsConfig.tsx` saves full config; missing the new section in state or `PUT` typing will drop/ignore the setting.
- `AppShell` top-bar right side already reserves room for fixed Preview/Trellis controls; avoid layout overlap.
- Refactoring quota helpers must not break Models modal quota display.
- Manual refresh should update cached account state so Models modal and floating panel stay consistent.

## Rollback

- Revert `chatgpt` config addition and `SettingsConfig` state changes together.
- Remove `ChatGptUsagePanel` import/render from `AppShell`.
- If helper extraction causes issues, restore local helper definitions in `ModelsConfig.tsx` and keep panel-local copies only temporarily.
