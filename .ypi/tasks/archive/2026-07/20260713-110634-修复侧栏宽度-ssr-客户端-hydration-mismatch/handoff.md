# handoff

## Implementation Complete — IMP-5

### Summary

Completed automatic and manual verification for the AppShell hydration-safe layout persistence fix. `npm run lint` and `tsc --noEmit` both pass. Static review confirms all four layout values use `createPersistentLayoutStore` + `useSyncExternalStore` with stable server snapshots and explicit `setValue` writes (no `getInitial*` / unconditional persist-on-mount effects). Browser hard-refresh checks against running `http://localhost:30141` showed no hydration console errors and correct preference restore, clamp, legacy migration, and localStorage fault tolerance. No production code changes were required.

### Files Changed

- None (verification-only subtask)
- Artifact updated: `.ypi/tasks/20260713-110634-修复侧栏宽度-ssr-客户端-hydration-mismatch/handoff.md`

### Static Review (checks.md code review)

| Check | Result |
| --- | --- |
| Four stores use `useSyncExternalStore` + `getServerSnapshot` | Pass — `sidebarWidth`, `rightPanelWidth`, `explorerHeight`, `explorerOpen` |
| No `useState(getInitial*)` / typeof-window lazy init anti-pattern | Pass — removed |
| No mount effect that rewrites defaults over prefs | Pass — writes only via store `setValue` (drag/toggle/viewport clamp) |
| `getSnapshot` returns primitive/null with cache | Pass |
| Same-tab notify + filtered `storage` + cleanup | Pass |
| Legacy explorer migrate in client `read` only | Pass — `watchKeys` includes legacy key |
| No `suppressHydrationWarning` / blocking layout script / server prefs | Pass |
| Docs match implementation | Pass — `docs/modules/frontend.md` |

### Verification

| Command / step | Result |
| --- | --- |
| `npm run lint` | Pass (exit 0) |
| `node_modules/.bin/tsc --noEmit` | Pass (exit 0) |
| Hard refresh with `pi-web-sidebar-width=220` | Sidebar computed width `220px`; agent-browser console empty (no hydration mismatch) |
| Persist right panel `400`, explorer height `200`, open `true` | localStorage preserved after reload; no console errors |
| `explorerOpen=false` hard refresh | Preference kept; no hydration warning |
| Invalid values via storage invalidate (`sidebar=9999`, `right=50`, `height=10`) | Applied clamped/fallback widths without crash; raw invalid keys not eagerly overwritten by read path |
| Legacy key only (`pi-web-sidebar-explorer-height=250`, new key absent) | Migrated to `pi-web-preview-explorer-height=250`; legacy removed |
| Simulate localStorage get/set throw | Page stays alive; sidebar still renders |
| Cross-tab `storage` sync | Not dual-tab exercised; same-tab invalidate via `StorageEvent` re-reads without write loop |

### Acceptance (IMP-5)

- [x] lint/tsc 通过
- [x] 控制台无相关 hydration mismatch（agent-browser hard refresh）
- [x] 原交互路径静态+部分浏览器确认无回归（拖拽写入点仍走 store setter）

### Notes / Risks

1. **Post-hydration correction**: First paint still uses server defaults (260/300/null/true), then client snapshot applies prefs — by design; not a mismatch.
2. **Right panel viewport clamp**: Window `resize` still writes clamped width via `setValue`; may rewrite storage on resize (intentional, pre-existing product behavior).
3. **Invalid raw keys**: Read path clamps for render without always rewriting invalid stored strings; user drag/write path persists clamped values. Acceptable and matches design (no mount overwrite).
4. **SSR HTML probe**: Root document shell is small/RSC-oriented; layout CSS vars appear on client-rendered AppShell nodes. Hydration safety is enforced by `getServerSnapshot` contract rather than raw HTML grepping.
5. **Cross-tab**: Filtered `storage` listener implemented; full two-browser-tab manual check not run in this pass.

### Decisions needed from main session

- Mark **IMP-5** done and advance task to checker / review as workflow requires.
- No product decisions; no code fixes needed from this verification pass.
