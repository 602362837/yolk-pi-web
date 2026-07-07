# checks

## 需求覆盖检查

- [ ] 无全局 `pi` 时，CLI fallback 能解析 bundled `dist/cli.js`。
- [ ] SDK runner 能创建持久 child session JSONL。
- [ ] child header 含 `studioChild`，并关联 parentSession/taskId/runId/member/subtaskId。
- [ ] `task.json` 仍是 Studio run/status 权威；header status 仅展示/审计。
- [ ] child 不注入 `ypi_studio_task` / `ypi_studio_subagent` / `ypi_studio_wait`。
- [ ] approval gate 仍阻止未确认任务进入 implementing 或 claim/start 实现子任务。
- [ ] SessionSidebar 默认不把 child sessions 当普通 root 历史展示。
- [ ] SDK events 能更新 progress/transcript/onUpdate/wait/cancel。
- [ ] `resolveYpiStudioMemberPolicy()` precedence 不变。
- [ ] 旧 transcript/run records 无 childSessionId 仍可读。

## 自动验证

实现阶段建议运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
npm run test:studio-dag
```

新增/扩展测试建议：

- session-reader child header parse/filter。
- runner config `auto/sdk/cli` normalize。
- policy followMain/toolInput/memberConfig 不变。
- child guard block Studio recursive tools。
- runtime cancel/finalizer 的纯函数或 mock AgentSession 测试。

## 手工验收

1. 临时确保 PATH 没有全局 `pi`，旧 CLI fallback 仍可启动 child。
2. 设置 runner=sdk，启动 architect sync run：检查 child JSONL、task.subagents、transcript sidecar。
3. 启动 async implementer run 后调用 `ypi_studio_wait`：检查 running → terminal 投影。
4. 取消 running child：检查 runtime registry、task.json、transcript、header status。
5. 在 awaiting_approval 状态下尝试 start implementer：必须失败。
6. 尝试让 child 创建/切换 Studio task：工具不可用或被 block。
7. Sidebar 普通历史不新增 child root；父 session 展开可见 Studio child。
8. 旧任务详情和旧 transcript route 正常显示。

## 回归风险

- `startRpcSession()` 对 child session 的处理不能把它作为普通主 Chat 注入 Studio tools。
- header patch 必须保留标准 `type/version/id/timestamp/cwd/parentSession` 和 project link。
- `auto` fallback 不得在 child prompt 已执行后重复执行 CLI。
- display/truncation metadata 不能被 UI 当成失败。
- Project Registry 不能从 child sessions 合成新项目或 legacy unassigned。
