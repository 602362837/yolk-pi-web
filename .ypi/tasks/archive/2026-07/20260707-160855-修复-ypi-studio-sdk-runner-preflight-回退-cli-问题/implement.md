# Implement

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "taskId": "20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题",
  "summary": "修复 YPI Studio SDK child runner 在 session JSONL 尚未落盘时写 header 导致 ENOENT 并回退 CLI 的问题，同时增强 fallback/failed 诊断持久化。",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "sdk-child-header-ensure",
      "title": "修复 SDK child session header 创建与写入时机",
      "phase": "implementation",
      "order": 1,
      "dependsOn": [],
      "files": ["lib/ypi-studio-child-session-runner.ts", "lib/types.ts"],
      "instructions": [
        "在 childSessionFile 不存在时创建兼容 session header，而不是 readFileSync 失败。",
        "保留 parentSession/projectId/spaceId/studioChild 字段。",
        "确认 SDK child run 开始后 task run/transcript 含 childSessionId/childSessionFile。"
      ],
      "acceptance": ["强制 sdk 不再因 ENOENT preflight 失败", "生成的 child JSONL header 可被 session-reader 识别为 studioChild"],
      "validation": ["node_modules/.bin/tsc --noEmit"],
      "parallelizable": false
    },
    {
      "id": "runner-error-persistence",
      "title": "持久化 auto fallback 与强制 sdk async 失败诊断",
      "phase": "implementation",
      "order": 2,
      "dependsOn": ["sdk-child-header-ensure"],
      "files": ["lib/ypi-studio-extension.ts", "lib/ypi-studio-tasks.ts", "lib/ypi-studio-transcripts.ts"],
      "instructions": [
        "auto fallback 时将 SDK preflight error 保留到 run warnings/summary，避免被 CLI final snapshot 覆盖。",
        "runner=sdk 且 async preflight/prompt 前失败时，立刻持久化 failed run 与 failed transcript，包含真实 error/terminationReason。",
        "避免 poll/collect 将真实错误覆盖成 runtime_lost。"
      ],
      "acceptance": ["auto fallback 可在 task run 中看到 SDK preflight 错误", "强制 sdk async 失败不再只显示 runtime_lost"],
      "validation": ["node_modules/.bin/tsc --noEmit"],
      "parallelizable": false
    },
    {
      "id": "sdk-runner-validation-docs",
      "title": "补充验证脚本/文档并运行验证",
      "phase": "implementation",
      "order": 3,
      "dependsOn": ["runner-error-persistence"],
      "files": ["scripts/test-ypi-studio-sdk-runner.mjs", "package.json", "docs/modules/library.md", "docs/modules/api.md"],
      "instructions": [
        "增加低成本测试或脚本验证 header helper 能在文件不存在时创建 studioChild header。",
        "必要时增加 npm script。",
        "更新 docs，说明 SDK runner 不依赖外部 CLI，CLI 仅为显式回滚/fallback。",
        "运行 npm run lint 与 node_modules/.bin/tsc --noEmit；如增加测试脚本也运行。"
      ],
      "acceptance": ["验证命令通过", "文档反映 runner 行为与诊断边界"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "parallelizable": false
    }
  ]
}
```
