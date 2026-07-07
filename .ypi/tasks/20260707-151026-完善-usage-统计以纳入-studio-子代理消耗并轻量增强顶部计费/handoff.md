# Handoff — blocker fix complete

## Files Changed

- `lib/session-reader.ts` — Added `listAllArchivedSessionMetadata()` for lightweight archived header/metadata scanning without opening/parsing all entries; it preserves `studioChild` metadata and keeps child inclusion opt-in.
- `lib/usage-stats.ts` — Updated `getUsageStatsForSessionRollup()` to use archived metadata scanning first, then open only related parent/Studio child session files via `collectUsageRecords()`.
- `.ypi/tasks/20260707-151026-完善-usage-统计以纳入-studio-子代理消耗并轻量增强顶部计费/handoff.md` — Updated this handoff.

## Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

## Notes / Risks

- Global `getUsageStats()` behavior is unchanged and still uses full archived session listing for aggregate usage.
- Session rollup archived parent/child display metadata from the lightweight scan uses `firstMessage: "(metadata only)"`; usage totals are still computed from the related files only.
- Manual API/UI validation with real archived Studio child data was not run.

## Decisions Needed

- None.
