# checks

## 需求覆盖检查

- [ ] stdout/stderr 不再完整累积，也不在 finish 时 `Buffer.concat(...).toString()`。
- [ ] stdout 单行、stdout 总量、stderr 总量、final output、live progress、transcript、API response 均有硬上限。
- [ ] 超限时有 warning，run 状态落盘为 failed/cancelled，parent tool promise resolve。
- [ ] 主 session abort/destroy 能级联到活跃 Studio child process。
- [ ] abort 无 alive session 时不会启动新 AgentSession。
- [ ] idle timeout 与 max runtime timeout 能终止无进展 child。
- [ ] UI 能展示 truncated、cancelled、failed、waiting_for_user、timeout/output-limit 信息。

## 质量检查

- [ ] `npm run lint`
- [ ] `node_modules/.bin/tsc --noEmit`
- [ ] `npm run test:studio-policy`
- [ ] 新增 runtime helper 无 import cycle。
- [ ] 所有 timer、AbortSignal listener、child stdout/stderr listener、registry handle 都有清理路径。
- [ ] Windows/POSIX kill 分支均无 shell 注入风险。

## 回归风险

- 正常子代理 run 不应因输出被过早截断而失去最终摘要。
- `waiting_for_user` 既有逻辑不能回退为卡死。
- SSE tool progress 更新仍能被 `hooks/useAgentSession.ts` 识别。
- `YpiStudioSessionWidget` 对旧 task.json 中没有新字段的 run 仍正常渲染。
- Transcript API 对旧 transcript 文件仍可读取。

## 手工验收

1. 真实 Studio 子代理正常完成：progress、transcript、task subagent run 都正常。
2. 运行中点击 stop：2-5 秒内显示 cancelled，主 session 可继续输入。
3. 模拟超大 stdout/stderr：服务端不崩，UI 显示截断/失败。
4. 模拟 idle child：到阈值后自动 failed，任务仍停留当前 workflow 阶段。
5. 刷新页面后，已取消/失败 run 在任务详情和 session widget 中状态一致。
