# implement

## 执行步骤

1. **新增 child runtime registry**
   - 新建 `lib/ypi-studio-subagent-runtime.ts`。
   - 使用 `globalThis.__ypiStudioSubagentChildRuns` 保存活跃 run handle。
   - 提供按 parent session abort 的函数，内部调用幂等 kill/abort。

2. **重构 `runChildPi()` 输出路径**
   - 删除完整 stdout/stderr Buffer 保存。
   - 用 `StringDecoder` + bounded line buffer 解析 stdout JSONL。
   - 所有 preview/final/transcript/progress 写入前截断。
   - 超出 stdout/stderr/line/final 限制时记录 warning，并按策略终止或丢弃。

3. **加入 timeout 与 kill escalation**
   - 在 child start 后设置 first-event warning、idle timer、max runtime timer。
   - abort/timeout/output-limit 共用 `terminateChild(reason)`。
   - POSIX 使用 detached process group kill；Windows 使用 taskkill fallback。
   - finish/abort/error/close 保证只 resolve 一次，并清理 timer、listener、registry。

4. **接入主 session abort/destroy**
   - `AgentSessionWrapper.send("abort")` 先 abort registry children，再调用 `inner.abort()`。
   - `destroy()` 级联 abort children。
   - `app/api/agent/[id]/route.ts` 对 abort fast path：无 alive session 时不启动新 session。

5. **收紧 transcript/API/UI 投影**
   - `lib/ypi-studio-transcripts.ts` 添加 sidecar 总量上限，`full=1` 不再无限字节。
   - `YpiStudioSubagentTranscript` 展示 truncated/timeout/output-limit warning 和恢复建议。
   - `YpiStudioSessionWidget` 显示 cancelled/failed/stale 短标签。

6. **文档更新**
   - 更新 `docs/architecture/overview.md` 的 YPI Studio 子代理生命周期说明。
   - 更新 `docs/modules/library.md` 中 `ypi-studio-extension` / transcripts / runtime registry 说明。
   - 如 API/类型字段有新增，更新 `docs/modules/api.md` 或相关模块文档。

## 需先阅读的文件

- `lib/ypi-studio-extension.ts`
- `lib/rpc-manager.ts`
- `app/api/agent/[id]/route.ts`
- `app/api/agent/[id]/events/route.ts`
- `lib/ypi-studio-transcripts.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-types.ts`
- `components/YpiStudioSubagentTranscript.tsx`
- `components/YpiStudioSessionWidget.tsx`
- `hooks/useAgentSession.ts`
- `docs/architecture/overview.md`, `docs/modules/library.md`, `docs/modules/api.md`, `docs/modules/frontend.md`

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
```

## 手工/脚本验证建议

- 用临时 fake child 或 test hook 模拟 stdout 单行 > 1MiB，确认不会 `ERR_STRING_TOO_LONG`，run failed 且 warning 明确。
- 模拟持续 stderr > 1MiB，确认截断/终止且 Next.js 进程稳定。
- 模拟 child 无输出超过 idle timeout（测试可用较小 env override），确认 run failed、transcript finalized、parent tool resolve。
- 模拟 child 忽略 SIGTERM，确认 grace 后 SIGKILL/taskkill，stop route 不挂死。
- 浏览器中运行一个真实 `ypi_studio_subagent`，点击 stop，确认 Chat 停止、widget/transcript 显示 cancelled。
- 打开 transcript debug/raw，确认 API 响应有上限且页面不卡顿。

## 检查门禁

- 不能引入 `rpc-manager.ts` 与 `ypi-studio-extension.ts` 循环依赖。
- 不能改变现有 run status 枚举语义；新增字段必须 optional。
- 不能让 abort POST 在 session 未运行时创建新 AgentSession。
- 所有 timers/listeners/child registry handles 必须在 finish/destroy 时清理。
