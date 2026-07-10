# review

## Context

Checked implementation of P1 (session reset), P2 (session list skeleton/race), P3 (FileExplorer migration to preview panel) against PRD, design, checks, and handoff. All evidence gathered from static code review of the three changed source files.

## Verification

```bash
$ node_modules/.bin/tsc --noEmit
EXIT_CODE=0  ✅

$ npm run lint
EXIT_CODE=0  ✅
```

## Findings Fixed

None — no in-scope low-risk fixes needed.

## Remaining Findings

### Non-blocking

1. **`selectedCwdProp` alias still used in SessionSidebar for `onCwdChange` syncing** — this is intentional and correct per design: session reset moved to `activeProjectContext`-driven effect, while `onCwdChange`/`handleCwdChange` now only syncs `activeCwd` for FileExplorer and UI. No regression.

2. **`getInitialExplorerHeight` performs one-shot migration** — reads legacy `pi-web-sidebar-explorer-height`, writes new key, then `removeItem` on legacy key. One-way migration is fine for a single deployment; handled correctly.

3. **`handleCwdChange` dep array `[activeCwd, rightPanelMode]`** — callback identity changes when `activeCwd` changes, which can cause extra `onCwdChange` effect re-fires in SessionSidebar. Not a regression (same as before), just note for future optimization.

### Blocking

None.

## Detailed Coverage vs Requirements

### P1 — Session Reset

| Requirement | Evidence | Verdict |
|---|---|---|
| P1-1: Switch clears session + URL `?session=` | `resetOnSpaceSwitch` → `setSelectedSession(null)` + `router.replace("/", {scroll:false})` | ✅ |
| P1-2: New space context for first prompt | `setNewSessionCwd(context.cwd)` + `setNewSessionProjectContext({projectId, spaceId})` | ✅ |
| P1-3: All 8 switch paths unified | Single `useEffect([activeProjectContext])` — any path that sets `activeProjectContext` triggers reset | ✅ |
| P1-4: URL restore not reset | `initialSessionRestored` gate; effect dep `[activeProjectContext]` won't re-fire when `initialSessionRestored` flips true unless context also changes; `spaceContextMatchesSession` prevents reset if context matches restored session | ✅ |
| P1-5: Branch/system/git/panels reset | `resetOnSpaceSwitch` clears `branchTree`, `branchActiveLeafId`, `systemPrompt`, `activeTopPanel`, `gitRefreshKey++`, `gitDirty`, `fileTabs`, `activeFileTabId`, closes rightPanel (files mode) | ✅ |
| `handleCwdChange` trimmed | Only retains `setActiveCwd` + `fileTabs`/`rightPanel` sync; `suppressCwdBumpRef` guard preserved | ✅ |
| `spaceContextMatchesSession` | Pure function comparing only `projectId`+`spaceId`, never cwd strings; handles null session/context gracefully | ✅ |
| Reset effect refs | Uses `selectedSessionRef`/`newSessionProjectContextRef`/`rightPanelModeRef` for stale-closure safety; effect dep only `[activeProjectContext]` | ✅ |

### P2 — Session List Loading State

| Requirement | Evidence | Verdict |
|---|---|---|
| P2-1: Switch shows skeleton | `sessionsSwitching=true` + clear old list → 4-row skeleton with `@keyframes pulse` | ✅ |
| P2-2: Skeleton disables interaction | `pointerEvents: "none"` + `aria-busy: "true"` | ✅ |
| P2-3: Background refresh no skeleton | `loadSessions(false)` — `showLoading=false`, neither `sessionsSwitching` nor list clearing is triggered | ✅ |
| P2-4: Race protection | `loadSessionsTokenRef` incremented each call; all setState calls guarded by token comparison; stale responses discarded silently | ✅ |
| P2-5: Error state preserved | `catch` branch sets `error` with token guard; UI shows error only when `!sessionsSwitching` | ✅ |
| `findProjectSpace` early return | Clears `sessionsSwitching(false)` + `allSessions([])` with token guard (prevents dead skeleton) | ✅ |
| Space change detection | `prevSpaceKeyRef` compares `${projectId}/${spaceId}`; `isSpaceChange` only true when `prevSpaceKeyRef.current` was previously set (not first load) | ✅ |
| Rendering priority | `error && !sessionsSwitching` → `sessionsSwitching` skeleton → `!sessionsSwitching && loading` → empty states → `sessionTree` | ✅ |
| Empty state guards | "No sessions", "No registered projects" all check `!sessionsSwitching` before rendering | ✅ |

### P3 — FileExplorer Migration to Preview Panel

| Requirement | Evidence | Verdict |
|---|---|---|
| P3-1: FileExplorer moved to preview panel | Rendered in `AppShell.tsx` right panel `files` mode, top of `<div ref={previewContentRef}>`; removed from `SessionSidebar.tsx` entirely (no `FileExplorer` import, no section render) | ✅ |
| P3-2: Sidebar top selection area unchanged | `⌘` button with project name/subtitle/WT badge/chevron + `ProjectSpaceSwitchDialog` modal preserved; workspace menu actions intact | ✅ |
| P3-3: Collapsible in preview panel | Toggle button with rotate arrow; `explorerOpen=false` → only title row, FileExplorer not mounted; `explorerOpen=true` → full file tree + resize handle | ✅ |
| P3-4: Reload on space switch | `explorerCwd = activeCwd ?? activeProjectContext?.cwd ?? null`; `FileExplorer` internal `useEffect([cwd])` triggers reset on cwd change | ✅ |
| P3-5: All capabilities preserved | Refresh button (2s green checkmark), file tree expand/collapse, `onOpenFile=handleOpenFile`, `onAtMention=handleAtMention`, resize drag handle | ✅ |
| Only files mode | Rendered inside `rightPanelMode === "files"` branch; studio/trellis branches untouched | ✅ |
| localStorage migration | `getInitialExplorerHeight()` reads legacy `pi-web-sidebar-explorer-height` once, clamps to `MIN_EXPLORER_HEIGHT`, writes to `pi-web-preview-explorer-height`, removes legacy key; `pi-web-preview-explorer-open` for fold state | ✅ |
| Resize handler rewrite | `handleExplorerResizePointerDown` uses `previewContentRef` for `maxHeight` calculation; `MIN_EXPLORER_HEIGHT=120`, `MIN_PREVIEW_HEIGHT=120` | ✅ |
| Props cleanup | `explorerRefreshKey`, `onOpenFile`, `onAtMention` removed from SessionSidebar Props interface and JSX; `explorerRefreshKey` self-consumed in AppShell via effect | ✅ |
| SessionSidebar `explorerRefreshKey` effect | Removed — no residual `setExplorerKey()` calls in sidebar worktree handlers | ✅ |
| No residual refs | `rg explorerRefreshKey` → only AppShell.tsx (3 hits, all internal); `rg "FileExplorer\|explorerOpen\|explorerHeight\|explorerKey\|explorerRefresh\|explorerResizing\|explorerSectionRef\|explorerRefreshTimerRef" SessionSidebar.tsx` → zero hits | ✅ |

## Cross-Cutting Concerns

| Concern | Status |
|---|---|
| P1 + P3 interaction: Reset closes right panel → FileExplorer unmounts → re-open shows new space | ✅ `resetOnSpaceSwitch` sets `rightPanelOpen=false` (files mode); `explorerCwd` recomputed from `activeCwd`/`activeProjectContext` on next open |
| `explorerOpen` state preserved across reset | ✅ Not touched by `resetOnSpaceSwitch`; persisted to localStorage |
| P2 + P3: No shared state | ✅ P2 only touches session list rendering, P3 only touches preview panel |
| `activeCwd` syncing preserved | ✅ `handleCwdChange` still called via sidebar `onCwdChange` effect → `setActiveCwd` → explorerCwd downstream |
| `@keyframes pulse` exists | ✅ `app/globals.css:422` |
| Invariants | ✅ No changes to `lib/normalize.ts`, SSE/JSONL, Project Registry, WorkTree, API routes |
| `lib/workspace-title.ts` | ✅ Only additive change: `spaceContextMatchesSession` + `SessionInfo` type import |

## Manual Regression Required

Per checks.md, the following cannot be verified by static analysis alone:

- **8-path switch matrix** (#1-#8): dialogs, context menus, worktree create/delete/archive, git clone, URL restore, auto-select
- **Fast consecutive switches** (5+): verify token-based race protection under throttled network
- **Resize handle behavior**: min/max clamp with `previewContentRef` in narrow windows
- **Reset + re-open**: verify right panel re-opens after switch with FileExplorer reflecting new space
- **Dark/light theme**: visual consistency of explorer title row and resize handle
- **Narrow window**: no explorer artifacts when preview panel is closed

## Verdict

**PASS** — no blocking issues found.

All three phases (P1, P2, P3) are implemented faithfully to the design and PRD. The two verification commands (`tsc --noEmit`, `npm run lint`) pass cleanly. Props cleanup is complete with no residual references. The remaining verification items are manual regression tests enumerated in checks.md that require a running dev server.

Recommendation: proceed to manual regression testing per checks.md, then merge if green.
