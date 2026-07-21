# Handoff：外观模块与 Studio 审批安全

## APP-08 集成审查（2026-07-20）

已审查当前完整工作区 diff（含未跟踪的 appearance API、store、image pipeline、hook、Settings UI 与 focused tests）。实现范围符合已批准的背景皮肤 P0 和 Studio 文本审批安全边界：没有将二进制资产并入 `pi-web.json`，没有复用通用文件上传接口，也没有改变 Widget 的 typed approval action。

### 交付内容

- `lib/appearance-types.ts`、`lib/appearance-store.ts`、`lib/appearance-image.ts`：集中限制、metadata-only catalog、CAS/锁/回滚事务，以及 exact-pinned `sharp` 的 JPEG/PNG/static WebP 规范化。
- `app/api/appearance/**`：catalog、切换、上传、编辑、删除和 opaque asset API；metadata `no-store`，资产 private immutable/ETag/nosniff。
- `app/layout.tsx`、`hooks/useAppearance.ts`、`app/globals.css`、`components/AppShell.tsx`：force-dynamic safe bootstrap、decode-before-apply/cross-tab sync 和 active-only 背景/surface tokens。
- `components/AppearanceConfig.tsx`、`components/SettingsConfig.tsx`、`components/SettingsTreeNavigation.tsx`：Settings → 外观即时保存 UI、root leaf、上传/切换/参数/确认删除。
- `lib/ypi-studio-tasks.ts` 及 Studio scripts：NFKC + horizontal whitespace normalization、80 code-point bounded anchored allowlist；讨论、引用、诊断和否定文本 fail closed，主/改进计划继续共用 gate。
- `scripts/test-appearance.mjs` 与 `package.json`：isolated agent-dir focused test command；`sharp@0.34.5` 已记录在 lock/shrinkwrap。
- `docs/architecture/overview.md`、`docs/modules/{api,frontend,library}.md`：appearance 和 Studio approval contracts。

### 验证

- `git diff --check` — passed.
- `npm run test:appearance` — passed (10/10).
- `npm run test:studio-dag` — passed.
- `npm run test:studio-extension-sci` — passed (13/13).
- `npm run test:studio-widget-actions` — passed.
- `npm run lint` — passed with 7 pre-existing warnings only (`ChatMinimap.tsx` and archived/model-price test files); no errors.
- `node_modules/.bin/tsc --noEmit` — passed.
- `PI_CODING_AGENT_DIR="$(mktemp -d)" npm run build` — passed. Existing webpack critical-dependency warnings remain in session export/provider extensions/Studio extension; the appearance routes were emitted as dynamic routes.

### Remaining risks / follow-up

1. This delegated integration review did not run the browser visual/accessibility matrix against the approved HTML (fit/9 anchors, opacity extrema, narrow viewport, terminal/editor solidity, focus/reduced motion). A checker/main session should perform it before acceptance.
2. `docs/integrations/README.md`, `docs/deployment/README.md`, and `docs/operations/troubleshooting.md` do not yet document the new exact `sharp` runtime dependency, appearance storage backup/disk limits, decoder failures, or stop-bleed guidance required by APP-07. Treat this documentation gap as a closeout item.
3. Native `sharp` worked in this Node 22 build environment, but supported published install-platform matrix verification remains a release concern.
4. No commit, push, merge, task-state transition, or product decision was performed by this member.
