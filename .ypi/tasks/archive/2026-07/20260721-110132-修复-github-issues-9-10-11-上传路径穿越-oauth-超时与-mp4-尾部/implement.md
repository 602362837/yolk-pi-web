# Implement：Issues #9、#10、#11

## 先阅读

1. `AGENTS.md`、`docs/standards/code-style.md`
2. 本任务 `brief.md`、`prd.md`、`ui.md`、`design.md`、`checks.md`、`plan-review.md`
3. `docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/integrations/README.md`
4. 上传：`app/api/files/upload/route.ts`、`components/ChatInput.tsx`（只确认 response consumer，不改 UI）
5. OAuth：`lib/github-link-oauth.ts`、`lib/links-authorization-manager.ts`、`lib/links-api-helpers.ts`、`scripts/test-links.mjs`
6. MP4：`lib/appearance-video.ts`、`lib/appearance-types.ts`、`app/api/appearance/skins/route.ts`、`scripts/test-appearance-video.mjs`、`scripts/test-appearance.mjs`

## 实施原则

- 三条修复链先并行，契约均保持不变；不要为了共享少量代码制造跨领域 helper。
- 先写能重现问题的 focused test，再改实现。
- 不修改前端；若发现必须增加 UI/error copy，停止并重新打开 UI gate。
- 不执行 git commit/push/merge。
- 当前缺 `node_modules`，实施开始先 `npm install`。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | ---: | ---: | --- | --- | --- |
| FIX-01 | upload-security | 1 | 上传 opaque 存储、containment/exclusive write、symlink-safe cleanup 与测试 | — | 是 |
| FIX-02 | oauth-deadline | 1 | GitHub caller abort + 15秒 deadline、body-reader 清理与测试 | — | 是 |
| FIX-03 | mp4-parser | 1 | MP4 top-level box-chain、tail-`moov` 与 malformed/budget 测试 | — | 是 |
| FIX-04 | docs-integration | 2 | 对齐 API/library/architecture/integration/test 文档并做跨链静态复核 | FIX-01, FIX-02, FIX-03 | 否 |
| FIX-05 | validation | 3 | focused suites、lint、tsc、manual smoke、checker 安全评审 | FIX-04 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 3,
  "subtasks": [
    {
      "id": "FIX-01",
      "title": "Harden general file upload storage against path traversal and overwrite",
      "phase": "upload-security",
      "order": 1,
      "dependsOn": [],
      "files": [
        "app/api/files/upload/route.ts",
        "lib/file-upload-storage.ts",
        "scripts/test-file-upload.mjs",
        "package.json"
      ],
      "instructions": "Add a server-only upload storage helper and make the route persist bytes only through it. Generate full opaque UUID upload directories and storage basenames; optionally retain only a strictly allowlisted short ASCII alphanumeric extension. Never use the client basename as a path. Before writing, resolve the candidate and require it to be a strict child of the new upload directory; create directories 0700 and files 0600 with exclusive wx semantics and bounded collision retries. Preserve response {name,path,size}, size/quota/retention, and old upload cleanup compatibility. Harden cleanup to use lstat and skip symlink entries so it cannot follow a local symlink outside the upload root. Return a fixed path-free failure instead of String(error). Add an isolated temp-root test script covering POSIX/Windows traversal, absolute paths, NUL/control/encoded separators, extension edge cases, duplicate names, collision/overwrite, permissions, symlink cleanup, response shape, and outside sentinels.",
      "acceptance": [
        "No client filename component can affect a directory or storage basename outside the strict optional extension allowlist",
        "resolve/relative containment and wx prevent escape and overwrite even if naming logic regresses",
        "Traversal, absolute-path, Windows-path, NUL, duplicate-name, collision, and symlink tests leave the outside sentinel unchanged",
        "The API keeps name/path/size and existing limits/retention; ChatInput requires no change",
        "Errors do not expose absolute paths or syscall details",
        "npm run test:file-upload passes"
      ],
      "validation": [
        "npm run test:file-upload",
        "rg -n 'path.join\\(targetDir, originalName\\)|writeFileSync\\(targetPath' app/api/files/upload lib/file-upload-storage.ts",
        "Manual ordinary attachment upload and returned-path read"
      ],
      "risks": [
        "Over-sanitizing extension breaks file-type inference",
        "Random collision retry accidentally falls back to overwrite",
        "Cleanup follows symlinks or removes old compatible directories"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FIX-02",
      "title": "Enforce GitHub OAuth upstream deadline with caller cancellation and body cleanup",
      "phase": "oauth-deadline",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/github-link-oauth.ts",
        "scripts/test-links.mjs"
      ],
      "instructions": "Replace init.signal ?? timeout with a per-request deadline helper that always creates a 15-second internal timer, composes it with the optional caller signal without requiring AbortSignal.any, tracks which source aborted first, and disposes all listeners/timers. Pass the combined signal to fetch and explicitly race bounded reader.read calls against it so a stalled custom/body stream also terminates; cancel and release the reader on every exceptional path. Map only internal deadline expiry to github_timeout; preserve caller AbortError/cancel semantics so links-authorization-manager can exit without a false failed state. Keep fixed endpoints, redirect rejection, 64 KiB cap, JSON parsing, stable codes, and secret-safe errors. Add a resettable test-only timeout override and focused mocked tests for fetch hang with/without caller signal, body hang, caller-before-timeout, timeout-before-caller, success cleanup, oversize and existing error mappings.",
      "acceptance": [
        "Every device-code, token-poll, and identity request has a deadline even when a caller signal is supplied",
        "A stalled fetch and a stalled body stream settle as github_timeout",
        "Caller cancellation is not reported as timeout or network failure and does not create a false authorization failure",
        "Reader, timer, and abort listeners are cleaned after all outcomes",
        "No token, device code, URL, raw body, abort reason, or path enters an error/wire projection",
        "npm run test:links passes"
      ],
      "validation": [
        "npm run test:links",
        "npm run test:web-credential-store",
        "Static review of lib/links-authorization-manager.ts abort checks and lib/links-api-helpers.ts 504 mapping"
      ],
      "risks": [
        "A mocked Response stream does not observe fetch signal unless reader reads are explicitly raced",
        "Timer fires after success due to missing dispose",
        "Abort source race misclassifies user cancel as timeout"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FIX-03",
      "title": "Parse bounded MP4 metadata when moov is located after large media payloads",
      "phase": "mp4-parser",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/appearance-video.ts",
        "scripts/test-appearance-video.mjs",
        "scripts/test-appearance.mjs"
      ],
      "instructions": "Refactor MP4 traversal so top-level boxes are read from offset zero across the full buffered file by validated declared sizes, jumping over mdat/free payloads rather than scanning bytes. Support 32-bit and extended sizes with safe-integer/overflow/end checks and size=0 semantics. Locate only a real top-level moov, then recurse within a maximum 8 MiB metadata budget, depth 6, and one global 2048-box budget. Preserve encrypted-sample rejection and numeric metadata output. Do not use indexOf/raw tail searches and do not add ffprobe. Build fixtures by inserting a legal free box before the real moov of a short ffmpeg clip so moov starts before, around, and after 8 MiB; add false moov-in-mdat, truncated/overflow/size-zero, excessive metadata/depth/count tests. Preserve current source policies: 50 MiB confirmation threshold, 1 GiB hard/storage ceiling, and no duration/resolution rejection changes.",
      "acceptance": [
        "Valid head and tail moov clips, including moov after 8 MiB, return duration/width/height",
        "The parser jumps box payloads and never accepts a moov string embedded in mdat",
        "Malformed sizes, truncation, metadata over 8 MiB, depth over 6 and count over 2048 fail closed in bounded time",
        "No new public error code, schema, process dependency or UI state is introduced",
        "Existing poster/store/playback tests remain green",
        "npm run test:appearance-video and npm run test:appearance pass"
      ],
      "validation": [
        "npm run test:appearance-video",
        "npm run test:appearance",
        "rg -n 'indexOf\\(|includes\\(.*moov|ffprobe' lib/appearance-video.ts"
      ],
      "risks": [
        "Incorrect insertion fixture changes chunk offsets and produces a false negative",
        "Per-recursion box counters accidentally multiply the global budget",
        "Removing the absolute 8 MiB stop also removes the metadata budget"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FIX-04",
      "title": "Integrate contracts and align upload, Links, and Appearance documentation",
      "phase": "docs-integration",
      "order": 2,
      "dependsOn": [
        "FIX-01",
        "FIX-02",
        "FIX-03"
      ],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/standards/code-style.md"
      ],
      "instructions": "Document the general upload opaque-path/containment/exclusive-write boundary and new helper/test; document that GitHub calls always combine caller cancellation with a 15-second deadline through body consumption; document MP4 full top-level header-chain traversal with an 8 MiB metadata budget and tail moov support. Correct directly related stale docs so Appearance reflects current source behavior (50 MiB confirmation threshold, 1 GiB hard/total ceilings, duration/resolution compatibility fields rather than rejection limits). Do not expand AGENTS.md because no top-level module/navigation entry changes. Run cross-consumer searches to confirm no frontend or wire contract update was missed.",
      "acceptance": [
        "API, library, architecture, integration and test docs match the implemented behavior",
        "Docs do not claim caller signals disable timeout or tail moov is unsupported",
        "Docs distinguish 50 MiB confirmation from 1 GiB hard ceiling and do not invent duration/resolution rejection",
        "No frontend docs or HTML prototype are added because UI gate remains inapplicable",
        "No unrelated architecture sections are rewritten"
      ],
      "validation": [
        "rg -n '10s timeout|10 秒|50 MiB|30s|1920|MAX_BOX_SCAN_BYTES|files/upload' docs AGENTS.md",
        "git diff --check",
        "Review all changed docs against source constants"
      ],
      "risks": [
        "Documentation correction accidentally becomes an unapproved product-limit change",
        "Duplicating implementation detail in AGENTS.md",
        "Leaving contradictory limits in another module map"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FIX-05",
      "title": "Run integrated validation and checker security review",
      "phase": "validation",
      "order": 3,
      "dependsOn": [
        "FIX-04"
      ],
      "files": [],
      "instructions": "Install dependencies if absent, run all focused suites, lint and TypeScript, and perform the three existing-flow smoke checks from checks.md. Checker must review upload containment/permissions/symlink behavior, OAuth abort-source classification and resource cleanup, MP4 top-level parsing/budgets/false positives, API compatibility, docs alignment and scope discipline. Report environment or unrelated failures exactly; do not mark tests passed when dependencies are absent. Do not commit, push or merge.",
      "acceptance": [
        "Focused upload, Links and Appearance suites pass",
        "npm run lint and node_modules/.bin/tsc --noEmit pass or unrelated failures are isolated with evidence",
        "Outside-file sentinels, secret sentinels and malformed-media matrix pass",
        "No frontend production file, public schema, config or persistent-data migration changed",
        "Checker finds no security blocker and records residual risks"
      ],
      "validation": [
        "npm run test:file-upload",
        "npm run test:links",
        "npm run test:appearance-video",
        "npm run test:appearance",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "Dependencies remain unavailable",
        "ffmpeg fixture generation is unavailable on checker host",
        "A platform-specific Windows path or permission case is only unit-tested, not manually reproduced"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 3,
    "groups": [
      {
        "id": "parallel-fixes",
        "subtaskIds": ["FIX-01", "FIX-02", "FIX-03"]
      },
      {
        "id": "integration-docs",
        "subtaskIds": ["FIX-04"]
      },
      {
        "id": "closeout",
        "subtaskIds": ["FIX-05"]
      }
    ]
  }
}
```

## 验证命令

```bash
npm install
npm run test:file-upload
npm run test:links
npm run test:appearance-video
npm run test:appearance
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

不要直接运行 `next build` 做日常验证。

## 检查门禁

- `FIX-01/02/03` 均需 local security review 后才能进入文档整合。
- checker 必须按 `checks.md` 的 blocker 规则逐项判断。
- 若实施需要改前端、增加 error code/copy 或改变产品限额，停止并回到 planning/UI gate。
- 主会话保存 implementationPlan 并取得用户明确批准后，才能派发 implementer。