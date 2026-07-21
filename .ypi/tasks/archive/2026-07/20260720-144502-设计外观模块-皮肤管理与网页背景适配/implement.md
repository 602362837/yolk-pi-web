# Implement：外观模块、背景皮肤与 Studio 审批安全

## 实施前硬门禁

1. 主会话确认 `prd.md` §6 的外观产品决策。
2. UI 设计员交付的 `appearance-skins-prototype.html` 已存在；用户明确批准 HTML 原型与 `plan-review.md`。
3. 主会话把下方 schemaVersion 2 implementation plan（APP-01…APP-09）正式保存到 task，并按 Studio 状态机进入批准后的 implementing 流程。

当前只缺用户审批与 implementation plan 正式保存，**不得派发实现员**。Studio 审批误触发修复虽不需要独立 UI 原型，也与外观范围共同受本任务审批门禁约束。

## 实现员 / 检查员先阅读

1. `AGENTS.md`、`docs/standards/code-style.md`
2. `docs/architecture/overview.md`、`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`
3. 本任务 `brief.md`、`prd.md`、`ui.md`、`design.md`、`checks.md`、批准后的 HTML 原型与审批记录
4. `app/layout.tsx`、`hooks/useTheme.ts`、`components/AppShell.tsx`、`app/globals.css`
5. `components/SettingsTreeNavigation.tsx`、`components/SettingsConfig.tsx`
6. `lib/pi-web-config.ts` 与 `app/api/web-config/route.ts`（理解为何 appearance 不进入通用草稿）
7. `app/api/files/upload/route.ts`（只识别不可复用的差异，不复制其大文件/绝对路径行为）
8. `lib/models-config-store.ts`、`lib/links-store.ts`（原子写、锁、权限模式，仅借鉴）
9. `lib/ypi-studio-tasks.ts` 中 `isExplicitYpiStudioApprovalText`、`recordYpiStudioUserApproval`、`recordYpiStudioImprovementApproval`
10. `lib/ypi-studio-extension.ts` input event，以及 `scripts/test-ypi-studio-dag.mjs`、`scripts/test-ypi-studio-extension-sci.mjs`、`scripts/test-ypi-studio-widget-actions.mjs`

## 建议执行顺序

外观主线先冻结 safe contracts/limits 与 storage transaction，再实现图片 pipeline/API。首屏 bootstrap/hook/CSS 和 Settings UI 可在 API 契约稳定后并行，但 CSS surface audit 必须先完成 local review。

Studio 审批修复 `APP-09` 是独立基础设施支线，可与 `APP-01` 并行：先冻结短句长度和中英文整句 allowlist 测试矩阵，再替换 parser，并验证扩展 input、主计划、改进计划和 Widget 回归。最后由 APP-08 汇总 focused tests、docs、依赖发布验证和 checker 视觉/安全验收。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | ---: | ---: | --- | --- | --- |
| APP-01 | contracts-storage | 1 | appearance 类型、limits、index/revision、锁与事务 store | — | 否 |
| APP-09 | approval-safety | 1 | Studio 审批短句/整句意图 parser、主/改进服务端门禁与回归测试 | — | 是 |
| APP-02 | image-api | 2 | 图片安全规范化、catalog/mutation/asset API | APP-01 | 否 |
| APP-03 | runtime | 3 | layout 首屏 bootstrap、useAppearance、跨标签同步 | APP-01, APP-02 | 是 |
| APP-04 | surfaces | 3 | 全局背景层与 semantic surface 透明/实色分类适配 | APP-01 | 是 |
| APP-05 | settings-ui | 4 | 按批准 HTML 实现 Settings 外观、上传/参数/删除 | APP-02, APP-03, APP-04 | 否 |
| APP-06 | tests | 5 | store/image/API/runtime/Settings focused tests 与故障注入 | APP-02, APP-03, APP-04, APP-05 | 否 |
| APP-07 | docs | 5 | appearance + Studio approval architecture/API/frontend/library/dependency/deployment/ops 文档 | APP-02, APP-05, APP-09 | 是 |
| APP-08 | validation | 6 | lint/tsc/tests/build依赖验证、浏览器/checker 门禁 | APP-06, APP-07, APP-09 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "APP-09",
      "title": "Harden YPI Studio user-input approval intent detection",
      "phase": "approval-safety",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-tasks.ts",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-ypi-studio-extension-sci.mjs",
        "scripts/test-ypi-studio-widget-actions.mjs"
      ],
      "instructions": "Replace APPROVAL_TEXT_RE arbitrary-substring behavior with a pure fail-closed approval intent parser shared by main-plan and improvement-plan user-input grants. Normalize with Unicode NFKC plus bounded whitespace handling; reject multiline/multi-part or over-limit text; check Chinese/English negation, wait, and revision intent first; then accept only an anchored allowlist grammar for short explicit approval commands. Preserve common valid commands such as 确认开始实现/批准开始实现/确认，开始实现 and explicit English approve/proceed forms. Discussion, quoted approval terms, investigation feedback including 排查浮窗批准问题, questions, negation, and long prose must not match. Do not strip quotation markers or extract a matching clause from longer text. Preserve approvalGrant schema, inputHash, source, task status/binding/material/revision/time gates, extension input behavior, and typed user-widget approval actions. Add table-driven parser tests plus server-side persistence/transition tests for main and improvement plans, extension input integration, and widget regression. Freeze the exact length limit and phrase matrix in local review.",
      "acceptance": [
        "No arbitrary occurrence of 确认/批准/同意/approve/proceed creates an approval grant",
        "Short explicit Chinese and English approval commands remain compatible",
        "Discussion, quoted terms, investigation reports, questions, negation, wait/revise intent, multiline and over-limit input fail closed",
        "Rejected main-plan input leaves approvalGrant absent and implementing transition blocked",
        "Rejected improvement input leaves instance approval absent; explicit input still obeys material/UI/context gates",
        "Widget approve actions and approvalGrant wire/event schemas are unchanged"
      ],
      "validation": [
        "npm run test:studio-dag",
        "npm run test:studio-extension-sci",
        "npm run test:studio-widget-actions",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Allowlist remains too broad and permits quoted or diagnostic prose",
        "Allowlist becomes too narrow and rejects established explicit replies",
        "Main task is fixed while improvement approval still uses unsafe semantics",
        "Text parser changes accidentally affect typed widget approvals"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "APP-01",
      "title": "Define appearance contracts and transactional skin storage",
      "phase": "contracts-storage",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/appearance-types.ts",
        "lib/appearance-store.ts"
      ],
      "instructions": "Implement browser-safe appearance types, centralized limits, fit/position/readability validators, default projection, and a server-only store under getAgentDir()/appearance. Use opaque ids, metadata-only schema-v1 index, canonical opaque revision, process queue plus cross-process mkdir lock, 0700/0600 permissions, same-directory temp+fsync/rename, upload asset commit rollback, delete quarantine rollback, and lazy cleanup that never removes referenced assets. Active delete must atomically set activeSkinId=null and remove the catalog entry when explicitly authorized. Unknown schemas and malformed index fail closed without overwrite. Never return absolute paths or internal hashes.",
      "acceptance": [
        "No appearance directory produces the current default appearance with no migration",
        "Index/catalog never stores image bytes, data URLs, arbitrary paths, or untrusted CSS",
        "Every mutation uses expected revision and returns 409 rather than silent overwrite",
        "Upload and active/non-active delete transactions cannot leave an index pointing at missing assets",
        "Malformed/unknown schema is not rewritten",
        "Limits and presentation validation are centralized and browser-safe projections contain no paths"
      ],
      "validation": [
        "Temporary PI_CODING_AGENT_DIR store tests",
        "Concurrent mutation and stale revision tests",
        "Injected index/rename/unlink failure rollback tests",
        "Unix permission assertions where supported",
        "Wire key allowlist/path sentinel scan"
      ],
      "risks": [
        "Crash between asset rename and index rename",
        "Stale lock recovery deleting a live lock",
        "Lazy cleanup confusing trash with referenced files"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "APP-02",
      "title": "Add bounded image normalization and appearance APIs",
      "phase": "image-api",
      "order": 2,
      "dependsOn": ["APP-01"],
      "files": [
        "lib/appearance-image.ts",
        "app/api/appearance/route.ts",
        "app/api/appearance/skins/route.ts",
        "app/api/appearance/skins/[id]/route.ts",
        "app/api/appearance/skins/[id]/asset/route.ts",
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json"
      ],
      "instructions": "After owner approval of the dependency decision, add an exact-pinned compatible image decoder/processor (recommended sharp) and normalize JPEG/PNG/static WebP to metadata-free bounded WebP full + thumbnail. Reject SVG/XML/HTML/GIF/animation/AVIF-unless-explicitly-approved, bad signatures, decode failures, >20MiB, >40MP, and catalog/storage quota excess. Auto-orient, do not upscale, cap long edge at 4096, generate <=360px thumbnail, and bound processing concurrency. Add GET catalog, PATCH active, POST multipart upload, PATCH skin, DELETE skin, and opaque-id asset routes with body/key allowlists, revision CAS, safe errors, no-store metadata, immutable private assets, ETag and nosniff. Upload success auto-activation must match the approved UI decision. Do not reuse /api/files/upload and do not expose original/absolute paths or decoder raw errors.",
      "acceptance": [
        "Only actual decoded allowlisted static images become skins",
        "Stored full/thumbnail are owned WebP outputs without source metadata",
        "Request filename and Content-Type cannot bypass decoder validation or affect storage paths",
        "Catalog/mutation responses expose only allowlisted metadata and app-local asset URLs",
        "Asset route resolves catalog id + fixed variant only and sets private immutable cache, ETag and nosniff",
        "All quota/conflict/security errors are stable and path-free",
        "Native dependency installs in supported Node 22 development and packaged install matrices"
      ],
      "validation": [
        "Image fixture matrix: jpeg/png/webp/svg/gif/animated/truncated/spoofed/large dimensions",
        "Metadata sentinel stripped from normalized output",
        "Route body/key/cache-header tests",
        "Upload/delete transaction integration with temp agent dir",
        "npm packaging/dependency installation smoke before release validation"
      ],
      "risks": [
        "Native image dependency unavailable on a published target",
        "formData buffering before byte rejection",
        "Decoder error or metadata leaking to response/log",
        "Processing queue causing memory spikes"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "APP-03",
      "title": "Implement first-paint appearance bootstrap and client synchronization",
      "phase": "runtime",
      "order": 3,
      "dependsOn": ["APP-01", "APP-02"],
      "files": [
        "app/layout.tsx",
        "hooks/useAppearance.ts",
        "components/AppShell.tsx"
      ],
      "instructions": "Read only a safe server bootstrap in RootLayout, force dynamic rendering so build-time local appearance is never embedded, and write bounded html data attributes/CSS custom properties using opaque app-local asset URLs. Keep the existing pi-theme localStorage bootstrap orthogonal. Add a module-local useSyncExternalStore-style appearance store: hydrate from DOM, refresh catalog, preload/decode new full images before document mutation, use AbortController/generation guards, notify same-tab listeners, BroadcastChannel other tabs, and revalidate on focus/visibility without polling. AppShell consumes the store rather than piggybacking on /api/web-config. API/decode failure must leave the old effective background and Chat usable.",
      "acceptance": [
        "Persisted active skin is represented on first render without a default-background flash caused by post-mount fetch",
        "Build output never freezes or exposes the build machine agent appearance/path",
        "Theme toggle changes auto veil/surfaces but not active skin",
        "Old decode/fetch cannot overwrite a newer switch",
        "Same-tab and BroadcastChannel tabs converge; focus revalidate handles missed events",
        "No image bytes/base64 enter React state, localStorage, session or pi-web.json"
      ],
      "validation": [
        "SSR bootstrap tests for none/active/malformed/missing asset",
        "Hydration and stale generation tests",
        "BroadcastChannel fallback/focus refresh tests",
        "Network failure and Image.decode failure manual matrix",
        "Production build artifact grep for local paths/skin ids using isolated temp data"
      ],
      "risks": [
        "RootLayout static optimization captures local state",
        "Hydration mismatch from DOM mutation",
        "Broadcast loops or duplicate fetches",
        "Image decode unavailable in test environment"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "APP-04",
      "title": "Adapt global background and semantic surfaces safely",
      "phase": "surfaces",
      "order": 3,
      "dependsOn": ["APP-01"],
      "files": [
        "app/globals.css",
        "components/AppShell.tsx"
      ],
      "instructions": "Implement a fixed pointer-events-none full-viewport image layer plus independent theme-aware veil. Map cover/contain/stretch/original and numeric position without destructive cropping. Audit existing var(--bg*) consumers and classify ordinary pane, elevated overlay, and tool-solid surfaces; only while appearance is active, derive translucent semantic tokens from panelOpacity while keeping text/border/accent stable. Ensure app-shell-root no longer hides the image. Keep Settings/AppPrompt/popovers highly opaque and Monaco/xterm/high-density file tooling solid. Do not use element opacity, backdrop blur, scroll listeners, background-attachment fixed, or continuous animation. Default/no-skin tokens must remain unchanged; reduced motion disables any switch transition.",
      "acceptance": [
        "Background is visible across full AppShell without intercepting input",
        "No active skin is visually equivalent to current light/dark UI",
        "Main panes show controlled translucency while elevated/tool surfaces remain readable",
        "Four fit modes and nine anchors respond to viewport/sidebar/right-panel changes without config writes",
        "Light/dark auto veil is correct and fixed light/dark tones remain deterministic",
        "Reduced motion has no background crossfade"
      ],
      "validation": [
        "CSS surface inventory review against AppShell/Chat/Sidebar/right panel/Settings/prompt/popovers/editor/terminal",
        "Visual matrix at 1920x1080, 1366x768, 768x1024 and 390x844",
        "Light/dark, fit/anchor, panel opacity extrema and reduced-motion screenshots",
        "Pointer/focus/scroll interaction regression"
      ],
      "risks": [
        "Nested translucent surfaces compound unexpectedly",
        "Third-party Monaco/xterm backgrounds become transparent",
        "Pseudo-layer stacking conflicts with portals/view transitions",
        "Low-contrast background at minimum panel opacity"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "APP-05",
      "title": "Implement the approved Settings appearance skin manager",
      "phase": "settings-ui",
      "order": 4,
      "dependsOn": ["APP-02", "APP-03", "APP-04"],
      "files": [
        "components/AppearanceConfig.tsx",
        "components/SettingsTreeNavigation.tsx",
        "components/SettingsConfig.tsx",
        "app/globals.css"
      ],
      "instructions": "Implement only the user-approved appearance-skins-prototype.html. Add stable root SettingsSection appearance and update exhaustive ancestor/flatten/render/keyboard mappings. AppearanceConfig owns immediate catalog operations, upload/drop processing states, default/skin selection, rename, four fit modes, 3x3 radiogroup, overlay tone, bounded overlay/panel controls, conflict refresh, and active/non-active delete confirmations through AppPrompt with focus restoration. Use thumbnails in the catalog and full asset only for effective preview. Appearance stays outside PiWebConfig dirty equality/PUT; hide or disable generic Save/Reset on this view and state immediate-save semantics. Cover narrow screen, keyboard, aria-live, non-color active/error status and reduced motion exactly as approved.",
      "acceptance": [
        "Settings tree and deep-link include appearance without breaking existing sections",
        "Upload/switch/rename/edit/delete states match the approved HTML and never claim success before server response/decode",
        "Stretch disables position with an explanation; 3x3 anchors are keyboard accessible",
        "Active delete explicitly says it returns to default and invokes the atomic API path",
        "Appearance operations do not mark or save the pi-web.json draft",
        "Light/dark, <=640px, focus restore, live status and reduced motion meet the prototype"
      ],
      "validation": [
        "Browser comparison against approved appearance-skins-prototype.html",
        "Settings tree pure/exhaustive regression",
        "Keyboard/screen-reader walkthrough",
        "Conflict, decode error, upload quota and delete failure manual flows",
        "DOM/Network scan for paths, source metadata and image data URLs"
      ],
      "risks": [
        "Generic Settings footer remains misleading",
        "Draft parameter changes race with a different tab",
        "Drag/drop accepts multiple or wrong files",
        "Preview differs from real AppShell surfaces"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "APP-06",
      "title": "Add focused appearance security, transaction, runtime, and UI tests",
      "phase": "tests",
      "order": 5,
      "dependsOn": ["APP-02", "APP-03", "APP-04", "APP-05"],
      "files": [
        "scripts/test-appearance.mjs",
        "package.json"
      ],
      "instructions": "Add npm run test:appearance using a temporary PI_CODING_AGENT_DIR established before dynamic imports. Cover pure presentation mapping/validation, store revision/concurrency/rollback/permissions, image fixture decoding and metadata stripping, API key/cache/privacy projection, SSR bootstrap, stale client generation/Broadcast behavior where practical, and Settings tree appearance mapping. Include distinctive absolute-path, EXIF, SVG external URL and malicious filename sentinels and assert they are absent from responses/index/normalized metadata/errors/log fixtures. Fault-inject index rename and asset/trash moves. Never touch real ~/.pi/agent/appearance.",
      "acceptance": [
        "Focused tests never use the real user appearance directory",
        "Format spoofing, SVG/animation, byte/pixel/catalog/storage limits are covered",
        "Stale revision and concurrent upload/delete cannot corrupt index or active pointer",
        "Faults do not report false success and recovery leaves valid JSON/assets",
        "Path/metadata/external-URL sentinel scan passes",
        "No-skin/theme/Settings regressions stay covered"
      ],
      "validation": [
        "npm run test:appearance",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Native decoder fixtures make tests platform-specific",
        "Fault injection misses fsync/rename boundary",
        "JSDOM cannot model Image.decode or CSS visual output"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "APP-07",
      "title": "Document appearance and Studio approval safety contracts",
      "phase": "docs",
      "order": 5,
      "dependsOn": ["APP-02", "APP-05", "APP-09"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md",
        "AGENTS.md"
      ],
      "instructions": "Document the background-skin-only P0 boundary, theme orthogonality, safe first-paint flow, dedicated appearance layout/schema/revision/transactions, exact routes/cache policy, image normalization/limits, surface opacity categories, cross-tab convergence, corruption fallback and rollback. Also update the YPI Studio library/API approval contract: user-input grants require a bounded anchored explicit-command parser, discussion/quotation/investigation/negation fail closed, main and improvement paths share the helper, typed widget actions and existing status/binding/material/revision/time gates remain authoritative, and historical grants are not migrated. Dependency docs must record the exact image processor pin and supported runtime/platform assumptions. Deployment/ops covers data backup, disk limits, decoder install failures, stale lock/orphan cleanup and stop-bleed that ignores active appearance without deleting assets. AGENTS gets concise navigation only if appearance is a major entry point.",
      "acceptance": [
        "Docs distinguish appearance store from pi-web.json and general uploads",
        "Docs never present SVG/GIF/remote URL/full theme as implemented",
        "Routes, storage, cache, privacy and limits match code",
        "Build-time bootstrap leakage prevention and native dependency requirements are explicit",
        "Rollback preserves user assets and does not touch sessions/models",
        "Studio docs no longer describe arbitrary approval keyword matching and preserve typed widget action semantics",
        "AGENTS remains navigational"
      ],
      "validation": [
        "rg for stale route/schema/limit values",
        "rg for accidental reuse of /api/files/upload or pi-web appearance draft",
        "Documentation link/path check"
      ],
      "risks": [
        "Published package support differs from dependency docs",
        "Stop-bleed guidance deletes assets instead of disabling rendering",
        "Detailed design duplicated in AGENTS"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "APP-08",
      "title": "Run integrated validation and checker visual/security review",
      "phase": "validation",
      "order": 6,
      "dependsOn": ["APP-06", "APP-07", "APP-09"],
      "files": [],
      "instructions": "Run minimum validation, focused appearance tests, Studio approval parser/service/extension/widget regressions, a release-style npm run build only after routine checks and only to verify dynamic bootstrap/native packaging, then checker review. Compare production UI to the approved HTML and inspect first paint, all fit/anchor modes, light/dark, opacity extrema, screen matrix, editor/terminal solidity, keyboard/focus, reduced motion, network/cache headers, API wire allowlists, disk permissions/transactions and dependency install. Verify the exact false-positive phrase 排查浮窗批准问题, quoted/negative/discussion inputs, explicit Chinese/English commands, main/improvement grants, transition blocking, and typed widget approvals. Any missing prototype approval, approval substring false-positive, path/metadata leak, invalid format acceptance, active delete split-brain, build-time local data capture, unreadable critical surface or unsupported publish platform is a blocker.",
      "acceptance": [
        "lint, tsc, test:appearance and Studio approval regression scripts pass or unrelated pre-existing failures are isolated",
        "Approved HTML prototype is matched across main states and responsive/theme matrix",
        "No active skin preserves current visual behavior",
        "No paths/source metadata/SVG external content/image bytes leak across wire or DOM",
        "First-paint bootstrap is dynamic and package install supports declared platforms",
        "Checker reports no blocking transaction, readability, performance or accessibility issue"
      ],
      "validation": [
        "npm run test:appearance",
        "npm run test:studio-dag",
        "npm run test:studio-extension-sci",
        "npm run test:studio-widget-actions",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run build",
        "Manual Settings -> 外观 and full AppShell matrix"
      ],
      "risks": [
        "Native package build succeeds locally but not on a published target",
        "Visual checks miss a portal or third-party tool surface",
        "Release build reads real agent data if test isolation is wrong",
        "Unrelated repository validation failures"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      { "id": "foundation", "subtaskIds": ["APP-01", "APP-09"] },
      { "id": "image-api", "subtaskIds": ["APP-02"] },
      { "id": "runtime-surfaces", "subtaskIds": ["APP-03", "APP-04"] },
      { "id": "settings", "subtaskIds": ["APP-05"] },
      { "id": "coverage-docs", "subtaskIds": ["APP-06", "APP-07"] },
      { "id": "closeout", "subtaskIds": ["APP-08"] }
    ]
  }
}
```

## 验证命令

日常最小验证：

```bash
npm run test:appearance
npm run test:studio-dag
npm run test:studio-extension-sci
npm run test:studio-widget-actions
npm run lint
node_modules/.bin/tsc --noEmit
```

仅在 APP-08 做 release/package 验证：

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" npm run build
```

不得直接运行 `next build`。构建验证必须隔离 agent dir，检查发布产物不含真实本机 appearance id/path。

## 评审门禁

- 已交付的 UI designer HTML + 用户审批是实现前 P0 gate。
- APP-09 local review 必须先冻结审批短句长度、整句 allowlist 与正负中英文矩阵；不得以增加黑名单替代整句匹配，也不得修改 Widget action 语义。
- APP-01 local review 冻结 schema/revision/transaction/limits 后才进入 decoder/API。
- APP-02 必须先证明 native dependency 的发布兼容与图片安全，再允许 UI 联调。
- APP-04 必须完成 surface inventory，不能用全局元素 `opacity` 粗暴实现。
- APP-05 只能实现已批准原型，不自行改变 auto-activate、fit 或删除语义。
- checker 必须覆盖 Studio 真实误触发句/明确中英文命令/主与改进 grant/Widget CTA，以及 active delete 故障、首屏动态 bootstrap、路径/metadata sentinel 和关键 surface 对比度。

## 回滚

运行时 stop-bleed：忽略 active appearance data attribute并使用原 semantic tokens；隐藏 Settings 外观入口。保留 `<agentDir>/appearance/`，不自动迁移或删除。API 可临时只读/503。回滚不改 `pi-web.json`、models、sessions 或 project registry。

Studio 审批 parser 若出现兼容回归，只能回退到更小的已测试整句 allowlist，并引导使用 Widget CTA；不得恢复任意子串匹配。既有 `approvalGrant` 不迁移、不批量删除。
