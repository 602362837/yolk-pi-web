# Summary

已完成 YPI Studio subagent in-process SDK 子会话一致性改造。

## 完成内容

- 新增真实 in-process SDK child runner，接入 `runner=sdk/auto`，保留 CLI fallback。
- child session 生成持久 JSONL，并写入 `studioChild` header；run/transcript/API 投影填充 `runner`、`childSessionId`、`childSessionFile`、`requestAffinity`。
- SDK child profile 接入 `createYpiStudioChildGuardExtension` 与工具过滤，防止递归 Studio/subagent/browser 工具调用和 approval gate 绕过。
- Session/API/Sidebar/Chat 支持 Studio child 默认隐藏、父级折叠展示与只读审计视图。
- 更新配置、文档、handoff 与检查产物。

## 验证

- `npm run lint` — Pass
- `node_modules/.bin/tsc --noEmit` — Pass
- `npm run test:studio-policy` — Pass
- `npm run test:studio-dag` — Pass
- Checker 复查：Pass

## 后续建议

生产前可补一轮真实 provider end-to-end smoke：启动真实 Studio SDK child、检查 child JSONL header、wait/cancel 与 Sidebar 审计链路。
