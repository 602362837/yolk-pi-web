# implement

## 实施原则

- 先完成 ypi web 侧 bridge、session 绑定、只读快照，再做操作命令。
- 插件作为平级独立项目开发，不进入主项目打包。
- 每一步都保持“分享码绑定到当前 session”这一安全交互。
- 设计确认前不得实现。

## 分阶段计划

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-06T00:00:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "实现 Chrome 插件式 Browser Share：平级 MV3 插件 + ypi 本地 bridge + 分享码绑定到指定 chat/session + agent 只读/操作工具。",
  "strategy": "先定义协议和 web bridge，再做只读插件与绑定 UI，最后加入受控操作与安全确认。",
  "maxConcurrency": 2,
  "scheduler": { "mode": "dag", "strategy": "ready_fifo", "failFast": true, "defaultFailurePolicy": "block_dependents" },
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      { "id": "contracts", "title": "协议与类型", "relation": "serial", "dependencies": [], "subtaskIds": ["contracts"] },
      { "id": "web-readonly", "title": "ypi web 只读 bridge", "relation": "parallel", "dependencies": ["contracts"], "subtaskIds": ["manager-api", "bind-ui"] },
      { "id": "extension-readonly", "title": "插件只读 MVP", "relation": "serial", "dependencies": ["manager-api"], "subtaskIds": ["extension-shell"] },
      { "id": "agent-readonly", "title": "agent 观察工具", "relation": "serial", "dependencies": ["manager-api", "bind-ui", "extension-shell"], "subtaskIds": ["agent-readonly-tools"] },
      { "id": "actions", "title": "受控操作", "relation": "parallel", "dependencies": ["agent-readonly-tools"], "subtaskIds": ["command-queue", "approval-ui", "extension-actions"] },
      { "id": "docs-validation", "title": "文档与验证", "relation": "serial", "dependencies": ["command-queue", "approval-ui", "extension-actions"], "subtaskIds": ["docs-validation"] }
    ]
  },
  "subtasks": [
    {
      "id": "contracts",
      "title": "定义 Browser Share 类型与协议",
      "phase": "contracts",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "member": "implementer",
      "files": ["lib/browser-share-types.ts", "docs/architecture/browser-share.md"],
      "instructions": ["定义 shareCode/shareId/session binding/page snapshot/command/result/approval 类型", "明确敏感字段过滤与长度限制"],
      "acceptance": ["协议能表达分享码创建、绑定、快照、命令、确认、结果"],
      "validation": ["tsc --noEmit"]
    },
    {
      "id": "manager-api",
      "title": "实现 ypi web Browser Share manager 与 API",
      "phase": "server",
      "order": 20,
      "dependsOn": ["contracts"],
      "relation": "parallel",
      "member": "implementer",
      "files": ["lib/browser-share-manager.ts", "app/api/browser-share/**"],
      "instructions": ["使用 globalThis 管理短生命周期 share/session/command", "实现 health、create share、bind session、snapshot、state、command/result API"],
      "acceptance": ["分享码单次使用且过期", "session 只能读取自身绑定 share"],
      "validation": ["npm run lint", "tsc --noEmit"]
    },
    {
      "id": "bind-ui",
      "title": "实现 ChatInput Browser Share 绑定 UI",
      "phase": "frontend",
      "order": 30,
      "dependsOn": ["contracts"],
      "relation": "parallel",
      "member": "implementer",
      "files": ["components/ChatInput.tsx", "components/ChatWindow.tsx", "hooks/useAgentSession.ts"],
      "instructions": ["在当前 chat 输入分享码绑定", "展示当前 session 的连接状态和解绑入口"],
      "acceptance": ["用户能明确看到分享绑定到当前 chat/session"],
      "validation": ["npm run lint", "tsc --noEmit"]
    },
    {
      "id": "extension-shell",
      "title": "创建平级 Chrome MV3 插件只读 MVP",
      "phase": "extension",
      "order": 40,
      "dependsOn": ["manager-api"],
      "relation": "serial",
      "member": "implementer",
      "files": ["../ypi-browser-share-extension/**"],
      "instructions": ["创建 manifest/popup/service-worker/content snapshot", "点击分享生成分享码", "采集当前 tab 快照并过滤敏感字段"],
      "acceptance": ["unpacked extension 可加载", "插件可生成分享码并被 ypi session 绑定"],
      "validation": ["插件项目 npm run build 或等效检查"]
    },
    {
      "id": "agent-readonly-tools",
      "title": "注册 agent 只读浏览器工具",
      "phase": "agent-tools",
      "order": 50,
      "dependsOn": ["manager-api", "bind-ui", "extension-shell"],
      "relation": "serial",
      "member": "implementer",
      "files": ["lib/rpc-manager.ts", "lib/browser-share-extension.ts", "components/ToolPanel.tsx"],
      "instructions": ["注册 browser_share_status/snapshot/get_selection", "工具从当前 sessionId 推导绑定"],
      "acceptance": ["agent 在绑定 session 中能读取页面快照，未绑定 session 得到明确错误"],
      "validation": ["npm run lint", "tsc --noEmit"]
    },
    {
      "id": "command-queue",
      "title": "实现浏览器操作命令队列",
      "phase": "actions",
      "order": 60,
      "dependsOn": ["agent-readonly-tools"],
      "relation": "parallel",
      "member": "implementer",
      "files": ["lib/browser-share-manager.ts", "app/api/browser-share/**"],
      "instructions": ["实现 click/type/scroll/navigate command lifecycle", "高风险操作进入 pending_approval"],
      "acceptance": ["命令具备 queued/pending_approval/running/succeeded/failed 状态"],
      "validation": ["npm run lint", "tsc --noEmit"]
    },
    {
      "id": "approval-ui",
      "title": "实现操作确认 UI",
      "phase": "frontend",
      "order": 70,
      "dependsOn": ["agent-readonly-tools"],
      "relation": "parallel",
      "member": "implementer",
      "files": ["components/ChatWindow.tsx", "components/BrowserSharePanel.tsx"],
      "instructions": ["显示待确认操作摘要", "支持允许一次/拒绝/降级权限"],
      "acceptance": ["未经确认的高风险命令不会发送到插件"],
      "validation": ["npm run lint", "tsc --noEmit"]
    },
    {
      "id": "extension-actions",
      "title": "插件执行受控操作",
      "phase": "extension",
      "order": 80,
      "dependsOn": ["command-queue"],
      "relation": "parallel",
      "member": "implementer",
      "files": ["../ypi-browser-share-extension/**"],
      "instructions": ["轮询命令并在 content script 中执行 click/type/scroll/navigate", "回报结果和错误"],
      "acceptance": ["可对 elementId 执行低风险操作并回报结果"],
      "validation": ["插件项目 npm run build 或等效检查"]
    },
    {
      "id": "docs-validation",
      "title": "文档、测试与手工验收",
      "phase": "validation",
      "order": 90,
      "dependsOn": ["command-queue", "approval-ui", "extension-actions"],
      "relation": "serial",
      "member": "checker",
      "files": ["docs/architecture/browser-share.md", "docs/modules/api.md", "docs/modules/frontend.md", "docs/modules/library.md"],
      "instructions": ["补充架构、API、前端、库文档", "执行主项目 lint/tsc 与插件构建", "手工验证多 session 不会误绑定"],
      "acceptance": ["两个 session 同时打开时，分享码只绑定输入该码的目标 session"],
      "validation": ["npm run lint", "tsc --noEmit"]
    }
  ]
}
```
