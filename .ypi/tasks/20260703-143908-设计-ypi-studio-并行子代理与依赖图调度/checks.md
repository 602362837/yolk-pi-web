# checks

## 需求覆盖检查

- [ ] `awaiting_approval -> implementing` 仍要求 server-recorded approvalGrant；override 不可绕过。
- [ ] **新增：修复已绑定当前聊天但确认消息未写入 `meta.approvalGrant` 的链路问题。**
  - [ ] 绑定当前聊天写入的 context key 必须能被 input hook 的 `recordYpiStudioUserApproval(...)` 找到。
  - [ ] 用户在已绑定 task 的当前聊天发送“确认/开始实现/approve/go ahead”后，task.json 必须出现 `meta.approvalGrant`。
  - [ ] 若 runtime pointer 缺失，但 awaiting_approval task 的 `contextIds` 包含当前 context，也应能兜底记录 approvalGrant。
  - [ ] transition `awaiting_approval -> implementing` 的错误信息应区分“未绑定 / 未记录 grant / grant 属于其他 context”。
- [ ] 未进入 `implementing` 时，claim/start/update running/done/failed/blocked 都失败。
- [ ] 串行、并行、混合依赖均由 `subtasks[].dependsOn` 表示并可调度。
- [ ] schemaVersion 1 旧 plan/progress 能读取；`pending` 显示为 waiting。
- [ ] schemaVersion 2 对重复 id、缺失依赖、自依赖、环给出明确错误。
- [ ] ready 判定只依赖完成/允许跳过的依赖；blocked/failed 依赖会阻塞后继。
- [ ] `maxConcurrency` 限制 queued+running 总数。
- [ ] `ypi_studio_subagent` 默认同步兼容，显式 async 返回 runId 并释放父会话。
- [ ] poll/collect/cancel 可处理 running、completed、failed、cancelled、waiting_for_user、runtime_lost。
- [ ] Studio panel 可同时看到所有 running/queued/waiting/done/failed/blocked/skipped 子任务。
- [ ] Widget 至少展示所有非终态/失败项和全局状态计数。
- [ ] Chat/progress card 不将 display clipping 或 async 未完成误判为失败。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
npm run test:studio-dag
```

建议新增/扩展测试覆盖：

1. approval grant: 已绑定 context 的 awaiting_approval task，用户确认后写入 `meta.approvalGrant`。
2. approval grant fallback: runtime pointer 缺失但 task.contextIds 包含当前 context 时仍能记录 grant。
3. serial: A -> B -> C；只逐步 ready。
4. parallel: A 解锁 B/C/D；maxConcurrency=2 时只 queued 两个。
5. mixed fan-in: B/C done 后 D ready。
6. cycle/missing dependency 保存失败。
7. dependency failed 后后继 blocked，无关分支继续。
8. failed -> ready retry 后可重新进入 queued/running。
9. legacy pending plan 仍能被 summary/UI 展示为 waiting。

## 人工验收

- 打开 awaiting_approval task，绑定当前聊天，发送“确认开始实现”：task.json 应写入 `meta.approvalGrant`，随后可进入 implementing。
- 创建一个包含 6+ 子任务的测试 task：2 个独立并行、1 个 fan-in、1 个后续 checker/localReview。
- 在 awaiting_approval 状态尝试 claim/start：应失败并提示需要用户确认。
- 用户确认后进入 implementing，批量启动两个 async implementer：父会话应立即可继续响应，Widget/Panel 显示两个 running。
- 人为制造一个失败子任务：依赖它的后继 blocked；无关分支继续。
- 测试 cancel running run：run/subtask 状态更新，进程结束，无无限等待。
- 刷新浏览器后 Panel/Widget 仍从 task.json/transcript 显示状态。

## 回归风险重点

- 旧同步 `ypi_studio_subagent` tool call。
- 旧 task detail Implementation tab。
- Session widget task resolution 不应因为 pi_process context 误绑定。
- Approval gate 不应被绑定动作绕过；只有后续用户确认文本才能写 grant。
- Transcript clipping 仍为 neutral display metadata。
- Archive 时仍阻止 running subagents。
- Parent abort/session destroy 的子进程清理。
