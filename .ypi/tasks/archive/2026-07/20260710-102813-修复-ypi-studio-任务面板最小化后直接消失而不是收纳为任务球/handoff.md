# handoff

## WIDGET-STATE

### Files changed

- `components/YpiStudioSessionWidget.tsx` — removes the drawer-focus hide path; a widget now renders whenever it has bound tasks. Ball and panel position observers initialize only after their respective conditional element mounts, re-clamp on presentation/task-count changes, and preserve in-memory position before using the persisted fallback.
- `components/AppShell.tsx` — stops passing a drawer-focused task as a hide instruction to the session widget.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

### Risks / follow-up

- Browser interaction matrix (first collapse, drawer-focused collapsed/expanded, resize, multi-task drag) remains for `QA-REGRESSION`.
- Detail-only cards, workflow rail, responsive interaction refinements, and motion/reduced-motion work are intentionally not included in this subtask.

## WIDGET-CARD-PROGRESS

### Files changed

- `components/YpiStudioSessionWidget.tsx` — makes task cards read-only (removing card click/button/keyboard detail behavior), adds the sole per-card accessible Detail action, and adds a fixed five-station evidence-based workflow rail. The rail only maps completed artifact names, active workflow-step artifact requirements, implementation/runtime projection, and existing task status; it leaves unsupported mappings neutral.
- `app/globals.css` — adds scoped glass Detail button and compact workflow-rail node/line styles, including static text/symbol state cues in addition to color.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `git diff --check` — passed.

### Risks / follow-up

- Browser matrix remains for the next responsive/motion and QA subtasks: inspect long titles and narrow/mobile rail layout; verify pointer/keyboard Detail behavior with actual drawer state.
- Custom artifact/workflow names intentionally remain neutral unless their existing artifact or active-step requirement matches a canonical stage alias; no API/schema inference was added.

### Projection repair — real session `019f4995-50b4-7251-a0b7-1b8228153704`

- `lib/ypi-studio-session-link.ts` — the widget projection now carries the complete task artifact registry's available and meaningful artifacts, matching the Task Detail artifact tab instead of only `progress.completedArtifacts` for the active workflow state. Filename references are normalized to artifact keys to avoid duplicate counts.
- `components/YpiStudioSessionWidget.tsx` — artifact count reads this full projection; the rail gives explicit workflow-state semantics priority over artifact filenames. This prevents planning-time `checks.md` and `review.md` documents from falsely completing runtime Checks/Review while still correctly showing their presence in `产物`.
- `lib/ypi-studio-types.ts`, `docs/modules/frontend.md` — document the additive compact-projection field and evidence precedence.

### Validation

- Queried `/api/sessions/019f4995-50b4-7251-a0b7-1b8228153704/studio-task` on the active local server. Both bound tasks now project all 10 registered artifacts as available and 9 meaningful artifacts as completed, with no `handoff` / `handoff.md` duplicate.
- For the reopened implementing task, the workflow steps resolve as `Brief done → Design done → Implement active → Checks pending → Review pending`; the widget uses those states rather than treating existing planning documents as runtime completion.
- `node_modules/.bin/tsc --noEmit`, `npm run lint`, `git diff --check` — passed.

### Remaining risk

- Custom workflows without recognizable state ids or stage-artifact aliases still intentionally degrade to neutral; no API/schema inference was added.

## WIDGET-RESPONSIVE

### Files changed

- `components/YpiStudioSessionWidget.tsx` — constrains desktop pointer capture to the panel header, keeps the card stack selectable/scrollable, and hardens drag gesture ownership by pointer id and threshold. Ball movement now starts only after the drag threshold; cancelled pointer gestures neither persist position nor accidentally expand the panel.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `git diff --check` — passed.

### Risks / follow-up

- Browser manual matrix remains for `QA-REGRESSION`: verify actual touch scrolling/text selection, three-card layout at 360px, and drawer-focused mobile/desktop states. The mobile sheet intentionally closes when its Detail action opens the full Studio drawer, but drawer focus alone does not alter its availability or the persisted presentation state.

## QA-REGRESSION

### Files changed

- `components/YpiStudioSessionWidget.tsx` — fixes ball urgency fallback so task-level `blocked`/`failed` status receives finite attention treatment even when implementation counts are absent.
- `docs/modules/frontend.md` — documents the actual non-hiding drawer behavior, Detail-only cards, evidence-based five-station rail, header-only drag, independent clamped positions, and motion/reduced-motion contract.
- `checks.md` — records automated/static QA and the real-data browser-test blocker.

### Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `git diff --check` — passed.
- Playwright opened `http://localhost:30142`; application loaded without a widget/runtime crash. The loaded session has no bound Studio task.

### Remaining risk / main-session decision

- Manual acceptance cannot be truthfully completed until the main session supplies or binds a disposable single/multi-task Studio session. Execute the remaining matrix recorded in `checks.md` then; do not mark those cases passed from static review alone.

## QA-REGRESSION rerun — real session `019f4995-50b4-7251-a0b7-1b8228153704`

### Artifacts changed

- `checks.md` — replaces the prior no-test-data blocker with real two-task endpoint and Playwright verification, and records the remaining focused interaction limits.
- `handoff.md` — records this rerun.

### Verification

- Real endpoint `/api/sessions/019f4995-50b4-7251-a0b7-1b8228153704/studio-task` — two bound tasks; each projects 10 available and 9 meaningful completed artifacts, consistent with Task Detail.
- Playwright, desktop and 360px — verified actual rails/artifact labels, collapse → numbered ball → restore, drawer-focused Detail action without widget disappearance, and two-card mobile sheet layout.
- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `npm run test:studio-dag` — passed.
- `git diff --check` — passed.

### Remaining risks / decision

- The real-data blocker is resolved. A final focused pointer/touch drag-persistence and system reduced-motion interaction pass remains if required for release sign-off; the implementation has static coverage for both.
- No API, session-link binding, task ordering, or approval-gate decision is needed from the main session.
