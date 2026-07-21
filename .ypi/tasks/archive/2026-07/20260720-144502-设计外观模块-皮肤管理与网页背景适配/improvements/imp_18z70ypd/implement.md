# Implement：IMP-001 动态壁纸与 MP4

## 实施前硬门禁

1. 用户批准本改进 [`plan-review.md`](plan-review.md) 与 [`appearance-video-skins-prototype.html`](appearance-video-skins-prototype.html)。
2. 主会话冻结 PRD §6 产品决策（ffmpeg vs poster 双文件、limits、仅封面偏好位置等）。
3. 主会话将下方 schemaVersion 2 计划正式写入 improvement/task 状态后再 claim 子任务。
4. **改进师 / 本会话不修改生产代码。**

## 实现员先阅读

1. 主任务 `design.md` / `implement.md` 与已落地代码：`lib/appearance-*`、`hooks/useAppearance.ts`、`components/AppearanceConfig.tsx`、`app/globals.css` appearance 段
2. 本改进 `brief.md` `prd.md` `design.md` `checks.md` 与批准 HTML
3. `docs/standards/code-style.md`、appearance 相关 docs

## 人类可读子任务

| ID | 阶段 | 顺序 | 内容 | 依赖 | 并行 |
| --- | --- | ---: | --- | --- | --- |
| VID-01 | contracts | 1 | kind/duration/limits 契约与 store 路径（webp vs mp4）兼容读取 | — | 否 |
| VID-02 | video-pipeline | 2 | appearance-video 校验 + poster 策略（按批准 A 或 B） | VID-01 | 否 |
| VID-03 | api | 2 | POST 分流、asset Content-Type、catalog 投影字段 | VID-01, VID-02 | 否 |
| VID-04 | playback | 3 | useAppearance video 层、policy、generation、跨标签 | VID-03 | 是 |
| VID-05 | surfaces | 3 | CSS/DOM video layer + poster fallback + data attrs | VID-01 | 是 |
| VID-06 | settings-ui | 4 | AppearanceConfig 按批准 HTML | VID-03, VID-04, VID-05 | 否 |
| VID-07 | tests | 5 | image 回归 + video 矩阵 + 事务/安全 sentinel | VID-03…06 | 否 |
| VID-08 | docs | 5 | architecture/api/frontend/library/integrations/ops | VID-03, VID-06 | 是 |
| VID-09 | validation | 6 | lint/tsc/tests/build 隔离 + checker 视觉/播放矩阵 | VID-07, VID-08 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "VID-01",
      "title": "Extend appearance contracts and store for image|video kinds",
      "phase": "contracts",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/appearance-types.ts",
        "lib/appearance-store.ts"
      ],
      "instructions": "Add AppearanceSkinKind image|video, optional durationMs, video limits constants, and browser-safe projection fields without paths. Keep schemaVersion 1 with missing kind defaulting to image. Store full paths: image .webp, video .mp4, shared .thumb.webp. Validate mime/kind pairing; revision digest includes kind and duration. Active delete still atomic for both asset files. Malformed combinations fail closed without rewrite. Do not break existing image-only indexes.",
      "acceptance": [
        "Old image-only index loads without migration",
        "Video records require video/mp4 and duration bounds when kind=video",
        "Path helpers never mix .webp full with video kind",
        "Quota checks use updated total budget from approved limits",
        "Wire projections never include filesystem paths"
      ],
      "validation": [
        "Temporary PI_CODING_AGENT_DIR store tests for image and video records",
        "Stale revision and active delete for video assets"
      ],
      "risks": [
        "Reader accepts inconsistent mime/kind",
        "Lazy cleanup deletes opposite extension incorrectly"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "VID-02",
      "title": "Implement bounded MP4 validation and poster production",
      "phase": "video-pipeline",
      "order": 2,
      "dependsOn": ["VID-01"],
      "files": [
        "lib/appearance-video.ts",
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json"
      ],
      "instructions": "Implement server-only MP4 validation per approved design: byte cap, ftyp allowlist, bounded moov duration/resolution parse, reject non-mp4/spoofed/overlong/overres. Produce poster/thumbnail WebP using the approved strategy (A: exact-pinned ffmpeg frame extract if approved; B: required poster image field via existing image normalizer). Never re-encode video in P0 unless explicitly approved. Bound concurrency; strip path from errors; stage under appearance .tmp.",
      "acceptance": [
        "Only validated MP4 becomes a video skin",
        "Poster/thumb is metadata-free WebP owned output",
        "Spoofed extension and over-limit videos fail with stable codes",
        "No absolute paths or probe raw strings in thrown public messages",
        "Dependency pins match approved strategy and install on Node 22 dev matrix"
      ],
      "validation": [
        "Fixture matrix short.mp4 / spoof / empty / oversized header cases",
        "Duration and resolution limit tests",
        "Poster output sharp/webp signature check"
      ],
      "risks": [
        "ffmpeg binary missing on publish platform",
        "Incomplete box parse false negatives/positives",
        "Memory spike on large uploads before reject"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "VID-03",
      "title": "Route upload branching and asset Content-Type by kind",
      "phase": "api",
      "order": 2,
      "dependsOn": ["VID-01", "VID-02"],
      "files": [
        "app/api/appearance/skins/route.ts",
        "app/api/appearance/skins/[id]/route.ts",
        "app/api/appearance/skins/[id]/asset/route.ts",
        "app/api/appearance/route.ts"
      ],
      "instructions": "Branch POST by sniffed content to image or video pipeline; keep form key allowlist; auto-activate per product decision; project kind and durationMs. Asset route serves video/mp4 or image/webp from catalog only; retain nosniff, private immutable cache, ETag. Prefer HTTP Range for video if feasible without large refactors; otherwise document limitation. Safe error codes for video_too_long and friends.",
      "acceptance": [
        "Image upload path unchanged in behavior",
        "Video upload creates mp4+thumb and catalog kind=video",
        "Asset responses use correct Content-Type per kind/variant",
        "Unknown fields and path queries fail closed",
        "Revision conflicts return 409 without partial public success"
      ],
      "validation": [
        "API integration tests with temp agent dir",
        "Header and body allowlist tests"
      ],
      "risks": [
        "Buffering entire video before size reject",
        "Wrong Content-Type breaking browser decode"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "VID-04",
      "title": "Client playback policy, video element lifecycle, cross-tab sync",
      "phase": "playback",
      "order": 3,
      "dependsOn": ["VID-03"],
      "files": [
        "hooks/useAppearance.ts",
        "components/AppShell.tsx",
        "lib/appearance-playback-policy.ts"
      ],
      "instructions": "Extend publishAppearanceCatalog for video: poster first, single inert muted loop playsInline video, generation guards, play() failure → poster mode. Policy: pause and detach or pause on reduced-motion, hidden document, optional saveData, user poster-only localStorage. Only visible tab plays. BroadcastChannel and focus revalidate remain; no polling. Release previous src on switch/unmount. Keep image decode path intact.",
      "acceptance": [
        "Never more than one background video element active",
        "Hidden tab does not keep playing",
        "Reduced-motion shows poster only",
        "Stale generation cannot override newer skin",
        "Image skins still decode-before-apply"
      ],
      "validation": [
        "Unit tests for shouldPlayVideo policy table",
        "Manual multi-tab and visibility checks"
      ],
      "risks": [
        "Browser autoplay quirks",
        "Memory leak from uncleared media elements"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "VID-05",
      "title": "CSS/DOM layers for video object-fit and poster fallback",
      "phase": "surfaces",
      "order": 3,
      "dependsOn": ["VID-01"],
      "files": [
        "app/globals.css",
        "app/layout.tsx",
        "components/AppShell.tsx"
      ],
      "instructions": "Add data-appearance-kind and playback state attributes. Keep body::before as image or poster fallback; style fixed video layer with object-fit/position mapping; veil unchanged. SSR bootstrap for video uses poster URL only and force-dynamic. Ensure pointer-events none and stacking under app content. Default no-skin tokens unchanged.",
      "acceptance": [
        "Video background visible under translucent panes",
        "Poster visible when playback poster mode",
        "Four fits and nine anchors apply to video",
        "No path inlined in SSR HTML"
      ],
      "validation": [
        "Visual matrix with mock video",
        "Build artifact path grep with isolated agent dir"
      ],
      "risks": [
        "Stacking conflict with portals",
        "Double veil or black flash on switch"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "VID-06",
      "title": "Settings appearance UI for mixed image/video catalog",
      "phase": "settings-ui",
      "order": 4,
      "dependsOn": ["VID-03", "VID-04", "VID-05"],
      "files": [
        "components/AppearanceConfig.tsx",
        "app/globals.css"
      ],
      "instructions": "Match approved appearance-video-skins-prototype.html: accept list, limits copy, kind badges, duration, video processing states, poster-only toggle if approved, preview behavior, delete copy for active video. Keep immediate-save outside pi-web draft. Stretch disables anchors. aria-live polite status.",
      "acceptance": [
        "Users can upload mp4 and images from the same surface",
        "Video cards show non-color-only kind label",
        "Policy/poster states are announced in text",
        "No success claim before server+publish",
        "Narrow layout and keyboard paths work"
      ],
      "validation": [
        "Browser compare to approved HTML",
        "Keyboard walkthrough"
      ],
      "risks": [
        "Preview double-decodes video",
        "Drag/drop accepts multiple files silently"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "VID-07",
      "title": "Focused tests for video security and image regression",
      "phase": "tests",
      "order": 5,
      "dependsOn": ["VID-03", "VID-04", "VID-05", "VID-06"],
      "files": [
        "scripts/test-appearance.mjs",
        "package.json"
      ],
      "instructions": "Extend test:appearance (or add test:appearance-video invoked by package script) with temp PI_CODING_AGENT_DIR. Cover image regression, mp4 accept/reject matrix, store rollback for mp4+thumb, path sentinels, catalog kind projection, policy pure tests. Never touch real ~/.pi/agent/appearance.",
      "acceptance": [
        "All prior appearance assertions still pass",
        "Video spoof and limit cases covered",
        "Active video delete clears pointer and files",
        "Sentinel path/metadata absent"
      ],
      "validation": [
        "npm run test:appearance",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Fixtures large enough to slow CI",
        "Platform-specific mp4 parse differences"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "VID-08",
      "title": "Document video skins, limits, playback policy, ops",
      "phase": "docs",
      "order": 5,
      "dependsOn": ["VID-03", "VID-06"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": "Document kind split, storage files, routes, limits, muted autoplay and degradation, stop-bleed (ignore video kind / poster only), dependency notes for ffmpeg if any, backup of mp4 assets. Do not claim GIF/remote URL support. AGENTS.md only if navigation entry needed.",
      "acceptance": [
        "Docs match frozen limits and codes",
        "Rollback does not delete user assets",
        "Image-only behavior still described correctly"
      ],
      "validation": [
        "rg for stale mime-only claims that omit video where required",
        "Link check for new modules"
      ],
      "risks": [
        "Docs promise Range support if not implemented"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "VID-09",
      "title": "Integrated validation and checker playback matrix",
      "phase": "validation",
      "order": 6,
      "dependsOn": ["VID-07", "VID-08"],
      "files": [],
      "instructions": "Run lint, tsc, appearance tests, isolated PI_CODING_AGENT_DIR npm run build, and checker review: HTML parity, play/pause policies, multi-tab, light/dark, fits, readability, no audio, image regression, dependency install. Blockers: missing approval, accepts non-mp4, audio leakage, path leaks, split-brain delete, build path freeze, unreadable surfaces.",
      "acceptance": [
        "Automated gates green or pre-existing isolated",
        "Playback policy matrix signed",
        "Static image regression signed",
        "No wire/DOM path leaks"
      ],
      "validation": [
        "npm run test:appearance",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "PI_CODING_AGENT_DIR=$(mktemp -d) npm run build",
        "Manual Settings and full-shell matrix"
      ],
      "risks": [
        "Native/ffmpeg publish matrix",
        "Browser autoplay differences"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      { "id": "foundation", "subtaskIds": ["VID-01"] },
      { "id": "media-api", "subtaskIds": ["VID-02", "VID-03"] },
      { "id": "runtime-surfaces", "subtaskIds": ["VID-04", "VID-05"] },
      { "id": "settings", "subtaskIds": ["VID-06"] },
      { "id": "coverage-docs", "subtaskIds": ["VID-07", "VID-08"] },
      { "id": "closeout", "subtaskIds": ["VID-09"] }
    ]
  }
}
```

## 验证命令

```bash
npm run test:appearance
npm run lint
node_modules/.bin/tsc --noEmit
# closeout only:
PI_CODING_AGENT_DIR="$(mktemp -d)" npm run build
```

不得直接 `next build`。不强制重跑 Studio tests，除非改动触达 `ypi-studio-*`（本改进不应触达）。

## 回滚

忽略 `kind=video` 渲染、隐藏视频上传入口；保留磁盘资产；image 路径保持可用。
