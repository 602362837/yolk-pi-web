# implement

## 执行步骤

> 本计划供主会话审批后交给实现员执行；当前任务不实施代码。

| Order | ID | Title | Phase | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| 1 | BS-PERSIST-01 | Web wire contract、manager lifecycle/tombstone、API control projection | backend | — | 否 |
| 2 | BS-PERSIST-02 | Extension persistent debugger controller 与 transport heartbeat | extension | BS-PERSIST-01 | 否 |
| 3 | BS-PERSIST-03 | Extension popup/badge 用户可感知 UI | extension-ui | BS-PERSIST-02 | 可与 4 局部并行 |
| 4 | BS-PERSIST-04 | ypi web BrowserShareControl 与 tool guard 文案 | web-ui-tools | BS-PERSIST-01 | 可与 3 局部并行 |
| 5 | BS-PERSIST-05 | 文档、兼容说明、验证与回归修复 | validation | 2,3,4 | 否 |

## 需先阅读的文件

ypi web：

- `docs/architecture/browser-share.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/browser-share-types.ts`
- `lib/browser-share-manager.ts`
- `lib/browser-share-extension.ts`
- `components/BrowserShareControl.tsx`
- `app/api/browser-share/**/route.ts`

Chrome 扩展：

- `~/gitProjects/ypi-browser-share-extension/README.md`
- `~/gitProjects/ypi-browser-share-extension/manifest.json`
- `~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.{html,js,css}`

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
cd ~/gitProjects/ypi-browser-share-extension && npm run build
```

## 检查门禁

- 不提交/发布，除非主会话另行授权。
- 不把扩展项目复制进 ypi web build。
- action tools 不接受 shareId。
- debugger unavailable 时不静默执行 action fallback。
- 实施完成后更新 `docs/architecture/browser-share.md` 和模块文档。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "BS-PERSIST-01",
      "title": "Web wire contract、manager lifecycle/tombstone、API control projection",
      "phase": "backend",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/browser-share-types.ts",
        "lib/browser-share-manager.ts",
        "app/api/browser-share/health/route.ts",
        "app/api/browser-share/shares/route.ts",
        "app/api/browser-share/shares/[shareId]/commands/route.ts",
        "app/api/browser-share/shares/[shareId]/snapshot/route.ts",
        "app/api/browser-share/sessions/[sessionId]/bind/route.ts",
        "app/api/browser-share/sessions/[sessionId]/state/route.ts",
        "app/api/browser-share/commands/[commandId]/result/route.ts",
        "app/api/browser-share/shares/[shareId]/heartbeat/route.ts",
        "app/api/browser-share/shares/[shareId]/route.ts"
      ],
      "instructions": [
        "Add backward-compatible lifecycle/debugger/operator fields to Browser Share wire types.",
        "Extend BrowserShareManager with share runtime updates, terminal tombstones, extension stop handling, and control projection for command polling/heartbeat.",
        "Add heartbeat and share stop routes; enhance commands route to return share projection and 410 tombstone for detached/expired/unbound shares.",
        "Update health capabilities to advertise persistentDebugger/shareHeartbeat/commandControlProjection."
      ],
      "acceptance": [
        "Existing legacy create/snapshot/command flows still type-check.",
        "Unbind/rebind writes a tombstone so extension can release debugger.",
        "Session state exposes lifecycleStatus, operator, persistent debugger fields, and connection projection."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "Manual curl health returns persistentDebugger capability."
      ],
      "risks": [
        "Changing public Browser Share types can break UI consumers; keep new fields optional.",
        "In-memory tombstones disappear on server restart; extension must treat not_found as detach."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "BS-PERSIST-02",
      "title": "Extension persistent debugger controller 与 transport heartbeat",
      "phase": "extension",
      "order": 2,
      "dependsOn": ["BS-PERSIST-01"],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js"
      ],
      "instructions": [
        "Introduce ensureDebuggerAttached/releaseDebugger/syncDebuggerState and chrome.debugger.onDetach handling.",
        "Attach on successful share start and remove per-snapshot/per-command finally detach behavior.",
        "Reuse persistent debugger for snapshots/actions; action commands fail when debugger is unavailable instead of silent content-script fallback.",
        "Add heartbeat to ypi web, handle command response share projection and 410 detachRequested, and send DELETE /shares/[shareId] on stop/tab close.",
        "Persist debugger/operator/transport state in activeShare and recover on service-worker startup/alarm."
      ],
      "acceptance": [
        "Chrome debugger infobar stays visible after share creation and after command completion.",
        "Stopping/ypi unbind/tab close releases debugger.",
        "Debugger conflict produces visible unavailable state and command failure."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build",
        "Manual Chrome unpacked-extension flow."
      ],
      "risks": [
        "MV3 service worker suspension may interrupt heartbeat; use storage/alarm/startup recovery.",
        "Chrome debugger API errors vary by platform/version; preserve user-facing lastError."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "BS-PERSIST-03",
      "title": "Extension popup/badge 用户可感知 UI",
      "phase": "extension-ui",
      "order": 3,
      "dependsOn": ["BS-PERSIST-02"],
      "files": [
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.html",
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.js",
        "~/gitProjects/ypi-browser-share-extension/src/popup/popup.css",
        "~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js"
      ],
      "instructions": [
        "Render active share lifecycle, operator, permission, fixed baseUrl, debugger state, heartbeat, and recent command fields.",
        "Add tab-scoped action badge/title states: CODE, YPI, OFF, ERR or equivalent.",
        "Replace ambiguous stop text with '停止分享并释放 debugger'.",
        "Show explicit no-operator text before bind and session/baseUrl text after bind."
      ],
      "acceptance": [
        "Popup answers who can operate and what they can do in every state.",
        "Badge reflects pending/bound/offline/error states on the shared tab.",
        "Settings baseUrl changes do not alter current activeShare baseUrl."
      ],
      "validation": [
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build",
        "Manual popup state review during pending, bound, offline, debugger error."
      ],
      "risks": [
        "Popup polling every few seconds can mask service-worker state bugs; verify with popup closed too."
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "BS-PERSIST-04",
      "title": "ypi web BrowserShareControl 与 tool guard 文案",
      "phase": "web-ui-tools",
      "order": 4,
      "dependsOn": ["BS-PERSIST-01"],
      "files": [
        "components/BrowserShareControl.tsx",
        "lib/browser-share-extension.ts"
      ],
      "instructions": [
        "Display lifecycle/operator/debugger fields in BrowserShareControl, including authorization scope and debugger unavailable state.",
        "Adjust pill colors/labels for attached, pending, stale/offline, and error states.",
        "Update Browser Share tool promptGuidelines and preflight/result messages so action tools communicate persistent debugger requirements.",
        "Keep read tools scoped to current session and action tools without shareId."
      ],
      "acceptance": [
        "ypi chat UI clearly shows the current session as the only bound operator.",
        "Debugger unavailable/offline states are visible before users approve commands.",
        "Tool output explains command failure caused by debugger loss/conflict."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual ypi binding/approval flow."
      ],
      "risks": [
        "Overly strict preflight may block commands during stale but recoverable heartbeat; prefer clear state and terminal result."
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "BS-PERSIST-05",
      "title": "文档、兼容说明、验证与回归修复",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["BS-PERSIST-02", "BS-PERSIST-03", "BS-PERSIST-04"],
      "files": [
        "docs/architecture/browser-share.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "~/gitProjects/ypi-browser-share-extension/README.md"
      ],
      "instructions": [
        "Update architecture/API/frontend/library docs to describe persistent debugger lifecycle, heartbeat/stop routes, and UI states.",
        "Update extension README security/privacy/troubleshooting sections.",
        "Run validation commands and execute manual acceptance checklist from checks.md.",
        "Fix regressions found during validation without broad unrelated rewrites."
      ],
      "acceptance": [
        "Docs match implemented routes and behavior.",
        "All validation commands pass or blockers are documented.",
        "Manual checklist covers create/bind/command/unbind/tab-close/debugger-conflict/server-restart."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "cd ~/gitProjects/ypi-browser-share-extension && npm run build"
      ],
      "risks": [
        "Manual Chrome validation is required; automated scripts cannot prove persistent debugger infobar behavior."
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {
        "id": "backend-first",
        "subtasks": ["BS-PERSIST-01"]
      },
      {
        "id": "extension-core",
        "subtasks": ["BS-PERSIST-02"]
      },
      {
        "id": "ui-parallel",
        "subtasks": ["BS-PERSIST-03", "BS-PERSIST-04"]
      },
      {
        "id": "final-validation",
        "subtasks": ["BS-PERSIST-05"]
      }
    ]
  }
}
```
