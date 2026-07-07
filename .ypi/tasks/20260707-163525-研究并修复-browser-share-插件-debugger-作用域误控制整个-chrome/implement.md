# implement

## 执行策略

当前任务先等待主会话确认产品取舍，不应直接实现。修正后的推荐实现方向是：保持 persistent debugger target tab-scoped，但不要试图改变 Chrome 原生 debugger infobar；新增 Browser Share 自有 per-tab 标记，并在 popup/web/action badge 中解释和展示实际共享目标。

## 需先阅读的文件

ypi web：

- `docs/architecture/browser-share.md`
- `lib/browser-share-types.ts`
- `lib/browser-share-manager.ts`
- `components/BrowserShareControl.tsx`

插件仓库：

- `/Users/zyj/gitProjects/ypi-browser-share-extension/manifest.json`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.html`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.js`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.css`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/content/snapshot.js`
- `/Users/zyj/gitProjects/ypi-browser-share-extension/scripts/validate.mjs`

## 人类可读 Implementation Plan

| id | phase | title | order | dependsOn | localReview |
| --- | --- | --- | ---: | --- | --- |
| bs-infobar-doc | planning/docs | Document Chrome global infobar constraint | 1 | [] | required |
| bs-tab-marker | extension | Add shared-tab overlay/marker lifecycle | 2 | [bs-infobar-doc] | required |
| bs-status-surfaces | extension-ui/web-optional | Surface target and marker state in popup/action badge/ypi web | 3 | [bs-tab-marker] | required |
| bs-mode-decision | product-optional | Decide whether to add low-warning modes | 4 | [bs-infobar-doc] | required before mode work |
| bs-marker-validation | validation | Add validation and manual matrix for marker/infobar behavior | 5 | [bs-tab-marker, bs-status-surfaces] | required |

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "subtasks": [
    {
      "id": "bs-infobar-doc",
      "title": "Document Chrome global infobar constraint",
      "phase": "planning/docs",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/prd.md",
        ".ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/design.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/README.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/INSTALL.md",
        "docs/architecture/browser-share.md"
      ],
      "instructions": "Record that chrome.debugger can target a tab, but Chrome's native debugger infobar is a global browser warning implemented by Chromium GlobalConfirmInfoBar. Do not promise tab-only native infobar. Update product wording to say Browser Share's own marker identifies the shared tab, while the Chrome warning may appear globally.",
      "acceptance": [
        "Docs no longer describe the Chrome debugger infobar as a per-tab Browser Share signal.",
        "Docs explicitly say ordinary extensions cannot control native infobar location or text.",
        "The shared-tab marker is defined as Browser Share-owned UI, not Chrome-owned UI."
      ],
      "validation": [
        "Review docs for claims about debugger infobar scope",
        "rg -n \"infobar|debugger 提示|debugger warning|Chrome debugger\" docs /Users/zyj/gitProjects/ypi-browser-share-extension/README.md /Users/zyj/gitProjects/ypi-browser-share-extension/INSTALL.md"
      ],
      "risks": [
        "Over-promising that overlay can replace Chrome's global security warning",
        "Leaving stale docs that call the Chrome infobar a tab-specific signal"
      ],
      "parallelizable": false,
      "localReview": "required"
    },
    {
      "id": "bs-tab-marker",
      "title": "Add shared-tab overlay/marker lifecycle",
      "phase": "extension",
      "order": 2,
      "dependsOn": ["bs-infobar-doc"],
      "files": [
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/content/share-marker.js",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/manifest.json"
      ],
      "instructions": "Implement a Browser Share-owned overlay that is injected only into activeShare.tabId. Add idempotent helpers such as injectShareMarker(activeShare), updateShareMarker(activeShare), removeShareMarker(activeShare), and record marker status/errors in activeShare. Use Shadow DOM and a stable root id. Reinject after share creation, refresh snapshot, navigation/action completion, service worker resume, and tab updates for the active shared tab. Remove on stop, replacement, unbind/detach request, expiry, and tab close. Keep injection best-effort and never attach or mark other tabs.",
      "acceptance": [
        "Sharing tab A displays a YPI marker inside tab A only.",
        "Switching to tab B does not create a marker in tab B.",
        "Replacing the share from tab B removes the marker/badge from tab A and shows it on tab B.",
        "Stopping/unbinding/closing the shared tab removes marker state and clears action badge.",
        "Restricted pages report marker injection failure and fall back to popup/action badge without breaking detach."
      ],
      "validation": [
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && npm run build",
        "rg -n \"chrome\\.debugger\\.(attach|sendCommand|detach)|tabs\\.query|setBadgeText|share-marker|YPI marker\" /Users/zyj/gitProjects/ypi-browser-share-extension/src /Users/zyj/gitProjects/ypi-browser-share-extension/manifest.json"
      ],
      "risks": [
        "activeTab permission may not allow content script injection after cross-origin navigation; handle with best-effort status and consider CDP injection while debugger is attached.",
        "Overlay may obstruct page controls; keep it compact and low-interaction.",
        "Some pages cannot be injected; marker must be a signal, not an authorization boundary."
      ],
      "parallelizable": false,
      "localReview": "required"
    },
    {
      "id": "bs-status-surfaces",
      "title": "Surface target and marker state in popup/action badge/ypi web",
      "phase": "extension-ui/web-optional",
      "order": 3,
      "dependsOn": ["bs-tab-marker"],
      "files": [
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.html",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.js",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.css",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "lib/browser-share-types.ts",
        "lib/browser-share-manager.ts",
        "components/BrowserShareControl.tsx"
      ],
      "instructions": "In the extension popup, show shared target title/url, permission mode, bound session, debugger state, and marker status. Explain that Chrome's native debugger warning may be global while Browser Share commands target the shared tab. Keep action badge tab-specific and strengthen its title/tooltip. Optionally project sanitized target/marker metadata to ypi web; fields must be optional and bounded.",
      "acceptance": [
        "Popup clearly distinguishes global Chrome warning from Browser Share's shared-tab marker.",
        "Action badge remains scoped to activeShare.tabId.",
        "ypi web, if changed, accepts old payloads without target/marker fields.",
        "Target metadata is diagnostic only and not used as authorization."
      ],
      "validation": [
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && npm run build",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Too much technical target detail can confuse users; keep tabId/windowId folded or diagnostic.",
        "Web projection increases scope and can be omitted if popup/action badge/overlay are sufficient."
      ],
      "parallelizable": true,
      "localReview": "required"
    },
    {
      "id": "bs-mode-decision",
      "title": "Decide whether to add low-warning modes",
      "phase": "product-optional",
      "order": 4,
      "dependsOn": ["bs-infobar-doc"],
      "files": [
        ".ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/prd.md",
        ".ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/design.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.js",
        "lib/browser-share-extension.ts"
      ],
      "instructions": "Do not implement mode changes unless the main session explicitly chooses them. If chosen, design either on-demand debugger attach/detach or read-only non-debugger mode as a separate product change. Make clear that these modes reduce duration of the global Chrome warning but cannot make it tab-only. Preserve fail-safe behavior: action tools must not silently execute without the expected debugger capability.",
      "acceptance": [
        "Main session explicitly selects or rejects low-warning mode work.",
        "If rejected, persistent debugger remains default with overlay marker.",
        "If selected, a separate plan covers changed tool semantics, approval UX, and capability degradation."
      ],
      "validation": [
        "Product decision recorded before code changes",
        "Review action tool behavior for debugger unavailable states"
      ],
      "risks": [
        "Changing attach lifecycle can break command reliability and safety expectations.",
        "Users may confuse shorter global warning with no debugger capability."
      ],
      "parallelizable": true,
      "localReview": "required before implementation"
    },
    {
      "id": "bs-marker-validation",
      "title": "Add validation and manual matrix for marker/infobar behavior",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["bs-tab-marker", "bs-status-surfaces"],
      "files": [
        "/Users/zyj/gitProjects/ypi-browser-share-extension/scripts/validate.mjs",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/README.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/INSTALL.md",
        ".ypi/tasks/20260707-163525-研究并修复-browser-share-插件-debugger-作用域误控制整个-chrome/checks.md"
      ],
      "instructions": "Extend validation/docs to cover the corrected behavior. Static checks should continue to prevent broad host permissions and raw debugger regressions where practical. Manual validation must assert that Chrome native infobar may be global, while Browser Share overlay/action badge appears only for the shared tab.",
      "acceptance": [
        "Manual test matrix includes tab A/tab B marker isolation, navigation/reload reinjection, replace, stop, unbind, restricted page fallback, and debugger conflict.",
        "Validation does not fail simply because Chrome shows a global debugger infobar.",
        "Build validation still passes."
      ],
      "validation": [
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && npm run build",
        "Manual Chrome two-tab/two-window matrix"
      ],
      "risks": [
        "Automated tests cannot fully assert Chrome browser UI infobar placement; rely on documented manual checks."
      ],
      "parallelizable": false,
      "localReview": "required"
    }
  ]
}
```

## 验证命令

插件仓库：

```bash
cd /Users/zyj/gitProjects/ypi-browser-share-extension
npm run build
rg -n "chrome\.debugger\.(attach|sendCommand|detach)|tabs\.query|setBadgeText|share-marker" src manifest.json
```

ypi web（仅当改 web 状态投影）：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 检查门禁

- 不把 Chrome 原生 debugger infobar 描述成可 tab-only 控制。
- 不隐藏或绕过 Chrome 原生安全提示。
- 不因为 overlay 存在就放松 session binding 和 approval 规则。
- 不在未获主会话确认前改变 persistent debugger 生命周期或新增低警告模式。
