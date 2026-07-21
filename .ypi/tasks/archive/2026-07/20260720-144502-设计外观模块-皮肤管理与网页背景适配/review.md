# Check Complete：外观模块与 Studio 审批安全

## Scope reviewed

- Appearance domain: contracts/store/image, APIs, force-dynamic bootstrap, CSS surfaces, Settings UI, focused tests, docs.
- APP-09 Studio free-text approval intent: shared fail-closed parser, main/improvement grant gates, extension input + widget regressions.

## Findings Fixed

1. **Settings tree order** — `外观` is now a root leaf **before** Studio (flatten + render), matching PRD/prototype “置于 Studio 前”.
2. **Presentation slider CAS spam** — `AppearanceConfig` now keeps a local draft presentation and debounces (~280ms) complete-object PATCH saves, reducing revision-conflict storms while dragging sliders.
3. **Client MIME gate** — empty browser `file.type` is no longer rejected before the server signature check.
4. **Status a11y** — appearance notice uses `aria-live="polite"`.
5. **APP-07 docs gap** — documented exact-pinned `sharp@0.34.5`, `appearance/` data layout/backup, decoder/conflict/stop-bleed guidance in `docs/integrations/README.md`, `docs/deployment/README.md`, `docs/operations/troubleshooting.md`.

## Remaining Findings

### Blocking for full product acceptance (manual / release)

1. **Browser visual/a11y matrix not executed in this checker session** — fit × 9 anchors, opacity extrema, light/dark, 1920/1366/768/390, terminal/editor solidity, focus/reduced-motion, and side-by-side comparison against `appearance-skins-prototype.html` still need a human/browser pass before final user acceptance.
2. **Native `sharp` publish-platform matrix** — verified in this Node 22 worktree only; packaged install targets remain a release concern (exact pin + shrinkwrap are present).

### Non-blocking residual risks

1. **Settings tree vs delivered HTML prototype order** — prototype currently lists Studio above 外观; implementation follows PRD/product decision (外观 before Studio). If product wants prototype pixel-order instead, re-approve and swap.
2. **No lazy `.tmp/.trash` cleanup yet** — store uses quarantine/rollback; orphan temp cleanup is not implemented. Bounded by quotas and not a split-brain risk, but disk hygiene is weaker than design text.
3. **Monaco/xterm solidity is partial** — terminal/file-viewer roots force solid tokens; Monaco uses its own theme backgrounds (generally opaque). A few elevated portals without the audited class list may still inherit translucent `--bg`.
4. **Presentation edits still race across tabs** — debounce + revision refresh mitigates same-tab slider storms; concurrent tabs still correctly 409 + refresh rather than last-write-wins.
5. **Animated WebP detection** depends on sharp metadata (`pages` / `pageHeight`); static path is covered by tests; add fixture if a platform reports different animation fields.
6. **Lint warnings** — only pre-existing unrelated warnings plus intentional selected identity deps; no errors.

## Verification

| Command | Result |
| --- | --- |
| `npm run test:appearance` | Pass (10/10) |
| `npm run test:studio-dag` | Pass |
| `npm run test:studio-extension-sci` | Pass (13/13) |
| `npm run test:studio-widget-actions` | Pass |
| `npm run lint` | Pass with warnings only (0 errors) |
| `node_modules/.bin/tsc --noEmit` | Pass |

Static coverage highlights:

- Independent appearance store (not `pi-web.json`); upload auto-activate; active delete requires `deactivateActive` and clears `activeSkinId` in one transaction.
- Image pipeline rejects SVG spoof; strips EXIF sentinel; path/source sentinels absent from catalog wire.
- Asset route: opaque id + `full|thumbnail`, private immutable cache, ETag, nosniff; metadata `no-store`.
- Layout `dynamic = "force-dynamic"` + safe opaque bootstrap URLs.
- Studio parser: NFKC + horizontal whitespace, 80 code points, newline reject, negation first, whole-string ZH/EN allowlist; root-cause `排查浮窗批准问题` / quotes / discussion fail closed; main + improvement + extension + widget paths covered.

## Verdict

**Needs work (non-code blockers only for full acceptance).**

Code/implementation quality is **Pass for merge-readiness of the implemented scope**: requirements R1–R13 for server/client contracts, security boundaries, and Studio approval intent are substantially met; automated gates pass; low-risk checker fixes applied.

Do **not** treat product acceptance as complete until:

1. Browser visual/a11y matrix against the approved HTML is signed off, and  
2. Release packaging confirms `sharp` on supported install platforms.

No commit / push / merge performed by checker.
