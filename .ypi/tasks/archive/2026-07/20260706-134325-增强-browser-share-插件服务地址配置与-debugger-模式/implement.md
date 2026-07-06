# Implement — Browser Share 服务地址配置与 debugger/CDP 模式

> 本文只规划实施，不实现代码。实现前主会话需确认 debugger 权限发布方式、截图是否进入本轮、是否允许同步修改外部扩展仓库。

## 已纳入决策建议

- 服务地址配置属于外部 Chrome 扩展 popup；默认仍为 `http://localhost:30141`。
- 新 share 使用当前保存的 baseUrl；active share 固化创建时 baseUrl。
- 非默认 origin 通过 optional host permission / runtime permission 请求；不默认使用 `<all_urls>` host_permissions。
- Debugger/CDP 是实验 opt-in；推荐标准插件不含 `debugger`，另提供 debugger build/manifest 或经实测可行的 optional permission。
- ypi web 不直接调用 Chrome debugger；继续通过现有 session-scoped Browser Share bridge 通信。
- 截图默认不自动上传；若实现必须独立 opt-in/审批。

## 需先阅读的文件

### ypi web

- `docs/architecture/browser-share.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `app/api/browser-share/**`
- `lib/browser-share-types.ts`
- `lib/browser-share-manager.ts`
- `lib/browser-share-extension.ts`
- `components/BrowserShareControl.tsx`

### external extension

- `~/gitProjects/ypi-browser-share-extension/README.md`
- `~/gitProjects/ypi-browser-share-extension/manifest.json`
- `~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
- `~/gitProjects/ypi-browser-share-extension/src/content/snapshot.js`
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.html`
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.css`
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.js`
- `~/gitProjects/ypi-browser-share-extension/scripts/validate.mjs`

## 建议实施顺序

1. 先做扩展 baseUrl 设置与 transport 统一，解决用户反馈的固定地址问题。
2. 同步 ypi web health/types/state 的兼容字段，为新扩展上报能力做准备。
3. 确认 debugger 权限发布方式后实现 CDP attach/capture 和 fallback。
4. 再把 CDP 状态展示到 ypi web，并让 agent tool summary 包含 capture/debugger 摘要。
5. 最后更新文档并跑 web + extension 验证矩阵。

## Implementation Plan

### 人类可读子任务表

| id | phase | order | title | dependsOn | parallelizable |
| --- | --- | ---: | --- | --- | --- |
| `extension-base-url-settings` | extension-config | 10 | popup 服务地址设置、URL 规范化、health test、host permission | — | true |
| `extension-base-url-transport` | extension-config | 20 | service worker 全链路使用 baseUrl，active share 固化地址 | `extension-base-url-settings` | false |
| `web-browser-share-compat-fields` | web-compat | 30 | ypi web health/capabilities 与 snapshot/debugger 可选字段兼容 | — | true |
| `debugger-permission-strategy` | extension-debugger | 40 | 确认并实现 debugger 权限/build 策略 | — | false |
| `extension-cdp-capture` | extension-debugger | 50 | CDP attach/detach 与受限调试快照采集 | `debugger-permission-strategy`, `web-browser-share-compat-fields` | false |
| `extension-cdp-actions` | extension-debugger | 60 | CDP click/type/scroll/navigate 与 fallback | `extension-cdp-capture`, `extension-base-url-transport` | false |
| `web-debugger-state-ui-tools` | web-compat | 70 | ypi web 状态展示、manager sanitize、tool summary | `web-browser-share-compat-fields`, `extension-cdp-capture` | true |
| `docs-validation-handoff` | validation | 80 | 文档、自动验证、手工验收与交接 | all above | false |

### 机器可读计划

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "taskId": "20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式",
  "summary": "Enhance Browser Share extension with configurable ypi web base URL and design/implement an opt-in debugger/CDP mode that enriches snapshots and browser actions without weakening session-scoped binding.",
  "strategy": "Deliver service-address configuration first, then backward-compatible ypi web metadata, then gated CDP support with DOM fallback and explicit safety documentation.",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "service-address",
        "title": "Extension service address configuration",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["extension-base-url-settings", "extension-base-url-transport"]
      },
      {
        "id": "web-compat",
        "title": "ypi web compatibility fields",
        "relation": "parallel",
        "dependencies": [],
        "subtaskIds": ["web-browser-share-compat-fields"]
      },
      {
        "id": "debugger",
        "title": "Opt-in debugger/CDP mode",
        "relation": "serial",
        "dependencies": ["web-browser-share-compat-fields"],
        "subtaskIds": ["debugger-permission-strategy", "extension-cdp-capture", "extension-cdp-actions", "web-debugger-state-ui-tools"]
      },
      {
        "id": "validation",
        "title": "Docs and validation",
        "relation": "serial",
        "dependencies": ["service-address", "debugger"],
        "subtaskIds": ["docs-validation-handoff"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "extension-base-url-settings",
      "title": "Add popup service address settings",
      "phase": "extension-config",
      "order": 10,
      "dependsOn": [],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.html",
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.css",
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.js",
        "~/gitProjects/ypi-browser-share-extension/manifest.json",
        "~/gitProjects/ypi-browser-share-extension/scripts/validate.mjs"
      ],
      "instructions": [
        "Add a service address section to the popup with input, save-and-test, reset-to-default, and status display.",
        "Normalize URLs by trimming, requiring http/https, removing trailing slashes, and preserving reverse-proxy path prefixes.",
        "Store baseUrl and lastHealth in chrome.storage.local; default to http://localhost:30141 when missing or invalid.",
        "For non-default origins, request runtime host permission based on optional_host_permissions; do not add <all_urls> to default host_permissions.",
        "Update validation script to enforce no accidental broad default host permission."
      ],
      "acceptance": [
        "Default localhost behavior works without user configuration.",
        "A valid custom baseUrl can be saved only after a successful health check or with a clearly displayed failed state.",
        "Invalid URL schemes are rejected before storage.",
        "Permission denial for a non-default origin is surfaced and prevents accidental requests."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build",
        "Manual popup save/test with localhost default, custom port, invalid URL, and permission denied origin"
      ],
      "risks": [
        "Chrome match-pattern rules for ports may require implementation adjustment after real browser testing.",
        "Popup UI space is limited; settings should remain concise."
      ],
      "parallelizable": true,
      "localReview": [
        "Verify manifest does not default to <all_urls> host access.",
        "Verify baseUrl with path prefix produces /prefix/api/browser-share/health, not double slashes."
      ]
    },
    {
      "id": "extension-base-url-transport",
      "title": "Use configured baseUrl across extension transport",
      "phase": "extension-config",
      "order": 20,
      "dependsOn": ["extension-base-url-settings"],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.js"
      ],
      "instructions": [
        "Introduce a single apiUrl(path, baseUrl?) helper used by createShare, refreshSnapshot, fetchCommands, postCommandResult, and popup health checks.",
        "Persist the baseUrl used at createShare into activeShare and prefer activeShare.baseUrl for all calls belonging to that share.",
        "Expose both settings baseUrl and activeShare baseUrl through YPI_GET_STATE so the popup can explain address changes.",
        "If settings change while activeShare exists, keep current share on its original baseUrl or ask the user to stop/regenerate."
      ],
      "acceptance": [
        "create share, snapshot upload, long-poll commands, and command results all use the configured baseUrl.",
        "Changing baseUrl after a share is active does not send results to the new service unexpectedly.",
        "Old activeShare records without baseUrl still fall back safely to getBaseUrl()."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build",
        "Manual end-to-end share with custom baseUrl and then switch settings while active"
      ],
      "risks": [
        "Storage migration bugs may break existing active shares.",
        "Reverse-proxy subpath concatenation can be easy to get wrong."
      ],
      "parallelizable": false,
      "localReview": [
        "Search service-worker.js for raw DEFAULT_BASE_URL or string-concatenated /api calls.",
        "Confirm activeShare.baseUrl is shown in popup state."
      ]
    },
    {
      "id": "web-browser-share-compat-fields",
      "title": "Add backward-compatible Browser Share capability and debugger metadata fields",
      "phase": "web-compat",
      "order": 30,
      "dependsOn": [],
      "files": [
        "app/api/browser-share/health/route.ts",
        "app/api/browser-share/shares/route.ts",
        "app/api/browser-share/shares/[shareId]/snapshot/route.ts",
        "app/api/browser-share/commands/[commandId]/result/route.ts",
        "app/api/browser-share/sessions/[sessionId]/state/route.ts",
        "lib/browser-share-types.ts",
        "lib/browser-share-manager.ts"
      ],
      "instructions": [
        "Extend health response with version 2 and capabilities while preserving ok/service/version fields for old clients.",
        "Add optional captureMode, viewport, debugger summary, element bounds, axRole, axName, selector, frameId, debuggerRef, and source/baseUrl metadata to types.",
        "Sanitize all new fields in BrowserShareManager with numeric bounds, length limits, and array limits.",
        "Include optional capture/debugger/source fields in session state without changing existing bound/status/tab/snapshot structure."
      ],
      "acceptance": [
        "Old extension requests without new fields still work.",
        "New debugger metadata is accepted and bounded but raw DOM/AX tree is not stored.",
        "State endpoint can project captureMode/debugger/source for UI."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual POST snapshot with extra fields and verify bounded state response"
      ],
      "risks": [
        "Unbounded CDP-derived payloads could increase memory usage if sanitization is incomplete.",
        "Types must remain optional to avoid breaking existing UI."
      ],
      "parallelizable": true,
      "localReview": [
        "Confirm no route trusts client-provided raw objects without whitelist sanitization.",
        "Confirm health response remains JSON-compatible for current popup load()."
      ]
    },
    {
      "id": "debugger-permission-strategy",
      "title": "Implement the approved debugger permission/build strategy",
      "phase": "extension-debugger",
      "order": 40,
      "dependsOn": [],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/manifest.json",
        "~/gitProjects/ypi-browser-share-extension/package.json",
        "~/gitProjects/ypi-browser-share-extension/scripts/validate.mjs",
        "~/gitProjects/ypi-browser-share-extension/README.md"
      ],
      "instructions": [
        "Before implementation, confirm with the main session whether debugger is a separate build/manifest or a single extension permission.",
        "Recommended path: keep the standard manifest without debugger and add a debugger manifest/build validation path for advanced users.",
        "If attempting optional debugger permission, verify in Chrome that chrome.permissions.request supports it; otherwise fall back to debugger build.",
        "Make the popup able to detect whether debugger API is available and show a clear message when not supported."
      ],
      "acceptance": [
        "Standard build has no debugger permission.",
        "Debugger-capable build or optional permission path is explicit and documented.",
        "Validation fails if debugger accidentally appears in the standard manifest."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build",
        "If added: cd ~/gitProjects/ypi-browser-share-extension && npm run build:debugger",
        "Manual Chrome load of the selected debugger-capable path"
      ],
      "risks": [
        "Chrome may not allow debugger as optional permission.",
        "Single-manifest debugger permission may create unacceptable install/update warnings."
      ],
      "parallelizable": false,
      "localReview": [
        "Inspect generated/active manifest before loading into Chrome.",
        "Confirm README warns about Chrome debug infobar and DevTools conflicts."
      ]
    },
    {
      "id": "extension-cdp-capture",
      "title": "Add CDP attach/detach and bounded debugger snapshot capture",
      "phase": "extension-debugger",
      "order": 50,
      "dependsOn": ["debugger-permission-strategy", "web-browser-share-compat-fields"],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "~/gitProjects/ypi-browser-share-extension/src/content/snapshot.js",
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.js"
      ],
      "instructions": [
        "Add a small debugger manager around chrome.debugger.attach/sendCommand/detach for activeShare.tabId only.",
        "Attach only when debugger mode is enabled for the share; detach on stop share, tab close/inaccessible, and finally blocks after one-shot captures where possible.",
        "Collect CDP-derived viewport, element bounds, AX role/name, selector/debuggerRef summaries, and warnings; merge with existing DOM sanitized snapshot.",
        "Do not upload raw DOMSnapshot, raw AX tree, cookies, localStorage, hidden values, or form values.",
        "If CDP capture fails, upload a DOM fallback snapshot with captureMode debugger_fallback and lastError."
      ],
      "acceptance": [
        "Debugger mode share can produce a snapshot with captureMode=debugger and bounded details.",
        "Attach failure does not prevent normal DOM sharing.",
        "Stop share detaches debugger and clears active debugger state.",
        "Screenshot data is not uploaded unless a separately approved screenshot option is implemented."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build:debugger",
        "Manual debugger share on a normal page",
        "Manual attach conflict test with DevTools open or another debugger attached"
      ],
      "risks": [
        "CDP domain behavior varies across Chrome versions.",
        "Merging CDP nodes with DOM element IDs may be approximate on complex/iframe pages.",
        "Detached/reattached lifecycle bugs can leave Chrome showing debug state."
      ],
      "parallelizable": false,
      "localReview": [
        "Audit every sendCommand result before it is uploaded for field whitelist and length limits.",
        "Confirm detach runs in stop/error paths."
      ]
    },
    {
      "id": "extension-cdp-actions",
      "title": "Use CDP for Browser Share actions with content-script fallback",
      "phase": "extension-debugger",
      "order": 60,
      "dependsOn": ["extension-cdp-capture", "extension-base-url-transport"],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "~/gitProjects/ypi-browser-share-extension/src/content/snapshot.js"
      ],
      "instructions": [
        "When debugger is enabled and attached, execute click via element bounds center and Input.dispatchMouseEvent, scroll via wheel events, type via focus/click plus Input.insertText, and navigate via Page.navigate with bounded lifecycle wait.",
        "Keep existing content-script and chrome.tabs.update paths as fallback for every command type.",
        "Preserve sensitive-field refusal before type/click when target is marked sensitive.",
        "Always post a terminal result with captureMode/debugger metadata and best-effort post-action snapshot."
      ],
      "acceptance": [
        "Existing readonly/interactive approval behavior is unchanged because ypi web still gates commands before extension polling.",
        "CDP action success and fallback failure both return clear messages.",
        "Post-action snapshot reflects the latest page state when possible."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build:debugger",
        "Manual click/type/scroll/navigate in debugger mode",
        "Manual fallback by forcing attach failure or disabling debugger mode"
      ],
      "risks": [
        "Coordinate clicks may be wrong under zoom/scroll/iframes if viewport math is incomplete.",
        "Type via CDP can interact badly with IME/composition; fallback must remain."
      ],
      "parallelizable": false,
      "localReview": [
        "Check coordinate calculations include scroll and deviceScaleFactor assumptions.",
        "Confirm sensitive field refusal cannot be bypassed by CDP mode."
      ]
    },
    {
      "id": "web-debugger-state-ui-tools",
      "title": "Expose Browser Share capture/debugger status in ypi web UI and tool summaries",
      "phase": "web-compat",
      "order": 70,
      "dependsOn": ["web-browser-share-compat-fields", "extension-cdp-capture"],
      "files": [
        "components/BrowserShareControl.tsx",
        "lib/browser-share-extension.ts",
        "lib/browser-share-manager.ts",
        "lib/browser-share-types.ts",
        "docs/modules/frontend.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "Display captureMode, debugger attached/error status, and source baseUrl/origin in BrowserShareControl when present.",
        "Include capture/debugger summaries in browser_share_status and compact action results without expanding raw payloads.",
        "Ensure browser_share_snapshot remains bounded and readable when elements include bounds/AX fields.",
        "Do not add shareId/baseUrl/tabId to agent tool parameters."
      ],
      "acceptance": [
        "Bound panel clearly shows DOM vs CDP/fallback state.",
        "Agent status/snapshot results include useful debugger detail but no raw CDP data.",
        "Old DOM snapshots render as before."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual BrowserShareControl state check with DOM and debugger snapshots"
      ],
      "risks": [
        "Large element summaries could bloat agent context if compact result is not capped.",
        "UI labels must not imply debugger mode is active when capture fell back."
      ],
      "parallelizable": true,
      "localReview": [
        "Inspect tool schemas for accidental cross-session parameters.",
        "Confirm compactCommandResult still limits element previews."
      ]
    },
    {
      "id": "docs-validation-handoff",
      "title": "Update docs and complete validation/handoff",
      "phase": "validation",
      "order": 80,
      "dependsOn": [
        "extension-base-url-settings",
        "extension-base-url-transport",
        "web-browser-share-compat-fields",
        "debugger-permission-strategy",
        "extension-cdp-capture",
        "extension-cdp-actions",
        "web-debugger-state-ui-tools"
      ],
      "files": [
        "docs/architecture/browser-share.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "~/gitProjects/ypi-browser-share-extension/README.md",
        ".ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/checks.md"
      ],
      "instructions": [
        "Document service address setup, permission prompts, reverse-proxy path behavior, and trusted-network security boundary.",
        "Document debugger/CDP mode, build/permission choice, fallback behavior, no raw CDP exposure, and screenshot opt-in policy.",
        "Run web lint/typecheck and extension validation builds.",
        "Complete the manual checks matrix or report blockers."
      ],
      "acceptance": [
        "Docs match implemented routes/types/UI behavior.",
        "Web validation passes.",
        "Extension standard build passes, and debugger build passes if implemented.",
        "Manual checks cover default localhost, custom baseUrl, permission denial, debugger attach/fallback, and session-scoped safety."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build",
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build:debugger || echo 'debugger build not implemented/approved'"
      ],
      "risks": [
        "Manual Chrome validation requires reloading the unpacked extension after manifest changes.",
        "If main session defers debugger, debugger subtasks should be marked skipped rather than partially implemented."
      ],
      "parallelizable": false,
      "localReview": [
        "Confirm no production code was committed without updating docs.",
        "Confirm checks.md accurately records any skipped debugger/screenshot scope."
      ]
    }
  ]
}
```

## 验证命令

ypi web repo：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

外部扩展 repo：

```bash
cd ~/gitProjects/ypi-browser-share-extension
npm run build
# 如果实现 debugger build：
npm run build:debugger
```

不要用 `next build` 做常规开发验证。

## 检查门禁

- 默认 localhost 分享与绑定不回归。
- 自定义地址全链路生效，并且 active share 不因设置变更串服务。
- 标准插件默认无 `debugger` 权限、无 `<all_urls>` host_permissions。
- debugger/CDP 只在用户显式启用后 attach 当前分享 tab。
- CDP 失败能降级 DOM 模式且状态可见。
- 截图默认不上传；如实现，必须单独 opt-in/审批。
- Agent tools 仍只从当前 session 推导 Browser Share 绑定，不接受跨会话参数。
- 文档明确 ypi web 暴露到公网不是本任务承诺的安全场景。
