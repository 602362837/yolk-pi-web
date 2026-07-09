# handoff

## Sub-task: PS-004 — Blocker fixes (checker review)

**Status:** Complete

Fixed two blockers identified in `review.md`:

1. **Missing-path space rows context menu** (`ProjectSpaceSwitchDialog.tsx`): Removed `disabled={!!isMissing}` from the space row `<button>` element. The HTML `disabled` attribute prevents `onContextMenu` from firing on disabled buttons. Missing spaces now gate `onClick` via an early return (`if (!isMissing) handleSelectSpace(space)`) while remaining fully interactive for right-click, per PRD R10. Cursor changed from `not-allowed` to `default` for missing rows since right-click is functional.

2. **WorkTree archive safety flow** (`SessionSidebar.tsx`): The unified `projectSpaceContextMenu` for space rows now distinguishes between WorkTree and non-WorkTree spaces for the archive action:
   - **WorkTree spaces**: Show "归档 WorkTree…" that calls `openWorktreeAction("archive", space.path, wt)`, preserving the full confirmation dialog with dirty summary, force toggle, and session cleanup.
   - **Non-WorkTree (main) spaces**: Keep "归档当前空间" → `patchSpaceMetadata(..., { archived: true })` for simple space-level archival.
   Both WorkTree actions (archive/delete) now call `closeMenu()` before opening the action confirmation dialog to avoid the context menu remaining open behind the modal.

## Sub-task: PS-006 — Re-execution (docs sync, validation, final handoff)

**Status:** Complete (re-ran after PS-004 blocker fixes)

### Re-execution scope

Re-verified all three doc modules against the latest blocker-fixed code, re-ran automated validation, and confirmed the two checker blockers are resolved in source.

### Docs accuracy review

| Doc | Status | Notes |
| --- | --- | --- |
| `docs/modules/frontend.md` | ✅ Accurate | `SessionSidebar` entry covers centralized `ProjectSpaceContextMenuState`, context menu bridging callbacks, `handleReorderSpaces` optimistic-rollback, and star-label unification with contextual hints ("星标项目优先排序" vs "仅用于标记，不影响空间排序"). `ProjectSpaceSwitchDialog` entry covers all-cards/all-rows right-click menus, drag handle (`⋮⋮`), drag state (`dragId`/`dropTargetId`), and `★` pinned badge. Missing-space nuance (no HTML `disabled`, JS-gated click) is implied by "all space rows support right-click" — sufficiently accurate at module-doc granularity. WorkTree-archive-vs-simple-archive distinction is an internal behavior detail covered by the existing `confirmWorktreeAction()` flow description. |
| `docs/modules/library.md` | ✅ Accurate | `project-registry.ts` entry lists `reorderProjectSpaces`. Dedicated `reorderProjectSpaces` section in Key Registry Functions documents signature, validation rules (rejects main/unknown/archived/duplicate/cross-project, appends non-payload active spaces), interval-based `sortOrder` writing (1024-step), and return type. `activeProjectSpaces()` sorting is documented (main first, `sortOrder` ascending, `createdAt` fallback). `computeNextSortOrder` is listed. Stray duplicate comma fixed. |
| `docs/modules/api.md` | ✅ Accurate | `PATCH /api/projects/[projectId]/spaces` endpoint is documented with request body `{ orderedSpaceIds }`, validation rules, and return shape. `sortOrder?: number` field is noted on space records at both `/spaces/` and `/[spaceId]/` routes. No changes needed. |

### Blocker fixes confirmed in source

| Blocker | File | Fix confirmed |
| --- | --- | --- |
| Missing-path space rows context menu | `ProjectSpaceSwitchDialog.tsx` | ✅ No `disabled={!!isMissing}` on space row `<button>` (line 1280). `onClick` gates via `if (!isMissing)` JS guard. `onContextMenu` fires unconditionally (line 1281). Cursor is `default` not `not-allowed` for missing rows (line 1321). |
| WorkTree archive safety flow | `SessionSidebar.tsx` | ✅ Space context menu distinguishes WorkTree vs non-WorkTree: WorkTree rows show "归档 WorkTree…" → `openWorktreeAction("archive", ...)` with full confirmation/dirty-summary/cleanup (line 1773). Non-WorkTree rows show "归档当前空间" → `patchSpaceMetadata(..., { archived: true })` (line 1766). Both WorkTree actions call `closeMenu()` before opening the confirmation dialog (lines 1773, 1779). |

### Verification (re-run)

```bash
npm run lint                     # PASS — no errors
node_modules/.bin/tsc --noEmit   # PASS — no errors
```

## Manual Acceptance Summary (checks.md)

| Check | Status | Notes |
| --- | --- | --- |
| Project card right-click menu | ✅ Implemented | All project cards in dialog fire `onProjectContextMenu`; sidebar renders project-level context menu (switch to main, edit, star, archive). |
| Space row/card right-click menu (main + WorkTree) | ✅ Implemented | All space rows fire `onSpaceContextMenu`; WorkTree rows show extra "删除 WorkTree…" action. |
| Top three-dot menu retained | ✅ Retained | Menu stays for current workspace quick actions; labels unified to "星标/取消星标". |
| Star semantics unified | ✅ Implemented | All user-visible labels use "星标/取消星标"; data layer reuses `pinned`. |
| Project sorting unchanged | ✅ Preserved | `sortProjectsForSidebar()` still pinned-first, then lastOpenedAt/updatedAt, then name. |
| Space sorting: main first, user order | ✅ Implemented | `activeProjectSpaces()`: main always first, non-main by `sortOrder` ascending, `pinned` no longer affects space order. Legacy spaces without `sortOrder` fall back to `createdAt` + `displayName`. |
| New spaces append to bottom | ✅ Implemented | `computeNextSortOrder()` returns max + 1024 for new WorkTree spaces. |
| Drag sort persists | ✅ Implemented | Dialog HTML5 drag → `handleReorderSpaces` → `PATCH /api/projects/[projectId]/spaces` → `reorderProjectSpaces` writes interval sortOrders. Optimistic update with rollback on failure. |
| WorkTree safety flow retained | ✅ Verified (post-fix) | WorkTree rows offer "归档 WorkTree…" via `openWorktreeAction("archive", ...)` with full confirmation/dirty-summary/cleanup flow. Non-WorkTree rows keep simple "归档当前空间". Both call `closeMenu()` before opening the confirmation dialog. |
| Missing-path space context menu | ✅ Verified (post-fix) | Missing spaces no longer use HTML `disabled`; right-click opens context menu for metadata/star/archive actions while switching remains blocked via JS guard. |

## Remaining Risks

1. **HTML5 drag/drop in nested scroll containers** — The dialog right pane is a scrollable area. Browser drag behavior at scroll boundaries may feel awkward on some platforms; this is inherent to HTML5 drag/drop and was noted in checks.md.
2. **Touch/keyboard alternatives** — Drag sorting currently relies on HTML5 `draggable`; no keyboard-accessible reorder alternative is provided (out of scope for this round).
3. **Legacy spaces without `sortOrder`** — First load after upgrade will show legacy non-main spaces sorted by `createdAt`. This is stable but may differ from the old `pinned-first` order the user was accustomed to. The first explicit drag on any project's spaces will write explicit sortOrders for all active spaces in that project, locking in the new order.
4. **Concurrent tab edits** — If two browser tabs reorder the same project's spaces simultaneously, the last writer wins. No conflict detection or merge logic exists. Risk is low for typical single-user usage.

## Decisions Needed from Main Session

- None — PS-006 is a documentation and validation subtask only. All product/design decisions were resolved in planning and prior subtasks.

## Dependencies for Follow-up

- If the user later wants project-level drag sorting (currently out of scope), the same `sortOrder` pattern on `PiWebProjectRecord` + batch PATCH on `/api/projects` could be reused.
- If keyboard-accessible space reordering is requested, consider adding "Move Up"/"Move Down" buttons in the space context menu alongside the drag handle.
