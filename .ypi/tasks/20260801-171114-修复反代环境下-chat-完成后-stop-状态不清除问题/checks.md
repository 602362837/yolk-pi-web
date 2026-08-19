# Checks：Chat SSE 终态可靠收敛

## 当前规划检查

- [x] 已定位 Stop 由 `agentRunning` 驱动，而非按钮自身故障。
- [x] 已确认正常终态只依赖 `agent_end`。
- [x] 已确认 SSE 重连不重放历史事件，也不查询权威状态。
- [x] 已确认 Chat SSE 缺少项目已有的 `X-Accel-Buffering: no` / `no-transform` 模式。
- [x] 已确认 `/api/agent/:id` 顶层 `running` 是 wrapper alive，不是 turn active。
- [x] 已纳入 `state.isStreaming`、`studioChildRunCount`、初始 connect-before-prompt 竞态。
- [x] 已定义不修改 JSONL/API command/model runtime 的边界。
- [ ] UI designer HTML 原型与用户审批（当前 blocker）。
- [ ] implementationPlan 保存到 task state（当前 delegated 环境无 Studio tool）。
- [ ] 状态推进 `awaiting_approval`（被 UI gate 与工具缺失阻塞）。

## 需求覆盖检查

| 需求 | 自动验证 | 人工验证 | Blocker 条件 |
| --- | --- | --- | --- |
| R1 anti-buffering headers | route contract | 浏览器 Network / Nginx | 缺 `no-transform` 或 `X-Accel-Buffering` |
| R2 additive connected snapshot | wire/privacy test | SSE frame inspect | 泄露路径/内容/凭据 |
| R3 subscribe-before-snapshot | ordering/race test | code review | 存在 await/check-before-subscribe window |
| R4 activity 判定 | pure helper tests | `/api/agent` inspect | 使用顶层 `running` 判 active |
| R5 断线补偿 | fake disconnect tests | DevTools offline/online | idle 后仍永久 Stop |
| R6 重连 snapshot | reconnect matrix | remote proxy reconnect | active 时闪回 Send |
| R7 watchdog | fake timers | 尾帧扣留代理 | idle 常驻轮询或过早结束 |
| R8 幂等终态 | late end/dedupe test | 声音/回调观察 | 重复 sound/onAgentEnd/message |
| R9 abort | abort race test | 点击 Stop | active 无法中止或 idle 无法自愈 |
| R10 Studio children | count projection tests | Studio child run | child 活动时错误 idle |
| R11 UI 不变 | HTML gate | desktop/375px 对比 | 新 UI 或布局漂移 |
| R12 文档 | source/doc search | 运维 walkthrough | 未说明 proxy/affinity 边界 |

## 自动验证

### Focused tests

```bash
npm run test:agent-sse-recovery
npm run test:ypic-cli
```

`test:agent-sse-recovery` 至少验证：

1. SSE headers 精确包含 `no-cache, no-store, no-transform` 与 `X-Accel-Buffering: no`。
2. 普通连接的 listener 在 runtime snapshot 前注册。
3. snapshot wire 只有 allowlisted primitive fields。
4. `isStreaming=true` → streaming。
5. `isStreaming=false, child>0` → waiting for Studio children。
6. `isStreaming=false, child=0` → idle。
7. 初始 `turn_start` idle snapshot 不结束尚在 preflight 的 optimistic turn。
8. 已 active 的连接断开，重连 idle snapshot 能终态补偿。
9. 重连 active snapshot 保持 running。
10. 无 error 但 `agent_end` 扣留时，watchdog idle probe 能补偿。
11. probe 失败/超时保持 running，后续可重试。
12. 旧 session/generation probe 响应不提交。
13. synthetic end 后迟到真实 `agent_end` 不重复完成。
14. abort 后 `agent_end` 丢失仍能收敛。
15. idle/unmount/session switch 清除 timer、EventSource、AbortController。
16. `ypic` 对 additive `connected.state` 兼容。

### 项目最低门禁

```bash
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

禁止用 bare `next build` 作为常规开发验证。

## 人工验收矩阵

### A. 本地直连基线

1. `npm run dev`，直接访问 `http://localhost:30141`。
2. 普通短回复：Stop → Send，消息只出现一次。
3. 长流式回复：生成期间保持 Stop，结束后 Send。
4. 工具调用：tool 运行期间不提前 idle。
5. 点击 Stop：中止后恢复 Send。
6. 连续发送 5 个 turn：无卡死、无重复提示音。

### B. 真实远程反代

代理需先保留当前生产配置复现，再应用推荐配置验证。记录：

- 浏览器 Network 中 SSE response headers；
- 首个 assistant delta 到达时间；
- `message_end` / `agent_end` / `connected.state` timing；
- `/api/agent/:id` 的 `state.isStreaming` 与 child count；
- Stop 恢复 Send 所需时间。

通过标准：回复结束后不刷新，目标补偿窗口内恢复 Send。

### C. 尾帧缓冲模拟

通过测试代理放行 assistant deltas，但扣留最后一个 `agent_end` frame，连接保持打开：

1. 内容完整显示。
2. watchdog 查询到 `isStreaming=false`。
3. 自动恢复 Send。
4. 随后放行迟到 `agent_end`。
5. 不重复声音、回调、消息或 usage 刷新风暴。

### D. 断线/重连

1. 运行中 DevTools 切 offline 2–5 秒后恢复。
2. 若服务端仍 active：保持 Stop，继续收到后续输出。
3. 若服务端在断线期间完成：重连 snapshot/probe 后恢复 Send。
4. probe 期间切换到另一 session：旧结果不能改变新 session。

### E. 初始连接竞态

人为延迟 prompt POST，让 SSE `connected.state.isStreaming=false` 先到：

- 前端不得先显示 Send 并允许第二次 prompt；
- POST preflight 成功后正常进入 active；
- 最终只完成一次。

### F. Studio

1. 启动异步 Studio child，使主模型 turn 先结束。
2. snapshot / agent_end 显示 child count > 0。
3. Chat 保持 `waiting_for_studio_children`，不恢复普通 idle。
4. child terminal + continuation 完成后才恢复 Send。

### G. Responsive / UI 原型

在 desktop 与 375px 宽度对比批准的 HTML：

- Stop/Send 样式不变；
- 控件不跳位；
- 无新 banner/toast/copy；
- reconnect active 不闪 Send；
- recovered idle 直接恢复现有 controls。

## 质量检查

### 正确性

- [ ] 单一 activity 公式：`isStreaming || studioChildRunCount > 0`。
- [ ] 真实 event 与补偿 snapshot 共享终态函数。
- [ ] per-turn terminal guard 是 compare-and-set，而非仅 React state 判断。
- [ ] initial/reconnect/resume 连接原因明确。
- [ ] 所有 async 提交验证 session id + generation。

### 资源与性能

- [ ] idle 零 watchdog timer / runtime probe。
- [ ] running 最多一个 in-flight probe。
- [ ] unmount/session switch abort 并清 timer。
- [ ] 无 listener、EventSource、timeout 泄漏。
- [ ] probe 失败有界退避，不形成请求风暴。

### 隐私与兼容

- [ ] connected snapshot 无 path/cwd/file/prompt/systemPrompt/model/auth/tool/message。
- [ ] 旧客户端忽略新增字段仍可运行。
- [ ] `test:ypic-cli` 通过。
- [ ] 无 JSONL/config/schema 迁移。

### 可维护性

- [ ] runtime activity 判定在纯 helper，不在多处手写。
- [ ] 非显然 race/ordering 有靠近代码的注释。
- [ ] docs 与最终常量/间隔/行为一致。
- [ ] 不扩成全站 SSE 重构。

## 回归风险

1. **误提前 idle**：最高风险，重点测 connect-before-prompt 与慢 preflight。
2. **Studio child 误清**：必须 child count 优先。
3. **重复终态副作用**：声音、callback、reload、usage。
4. **旧异步结果污染新 session**：generation/abort。
5. **轮询开销或泄漏**：running-only + single-flight。
6. **多实例无粘性**：SSE/GET 落不同进程会得到不一致 wrapper；部署需 affinity。
7. **网关完全不支持 streaming**：应用补偿不能替代正确代理。

## 最终 Blockers

出现任一项不得进入 review/completed：

- UI HTML 原型或用户审批缺失；
- 正常运行时出现 Send 闪烁/可重复发送；
- 仍能复现回复完成后永久 Stop；
- Studio child 活动时错误 idle；
- probe 失败会清 running；
- 同一 turn 重复完成副作用；
- idle 常驻 polling；
- snapshot 泄露非必要数据；
- 只做源码字符串断言，没有状态时序测试；
- 未完成真实远程反代验收。
