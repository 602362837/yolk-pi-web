# Checks：自动续跑方案检查清单

## 本轮自动验证覆盖

- [x] DAG `dependsOn` 是调度真源；`execution.groups` 只用于展示。
- [x] running + queued subtasks 不超过 `maxConcurrency` 的 ready selection / claim 行为。
- [x] approval gate：未记录明确 approvalGrant 时 `awaiting_approval -> implementing` 会被拒绝；同一回合明确批准可写入 grant 后进入 implementing。
- [x] 主 Chat 等待态投影：queued/running implementation subtask 会派生 `sessionRuntime.status = waiting_for_studio_children`。
- [x] 失败/等待用户处理态投影：`waiting_for_user` 子 run 会把 subtask 标为 blocked，依赖项 blocked，并派生 `sessionRuntime.status = needs_user`。
- [x] terminal continuation：同一 terminal child run 只投递一次 continuation callback，避免重复唤醒/重复推进。
- [x] 父 session active child run 计数只统计 queued/running，支持 idle timeout 保活判断。

## 自动验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
npm run test:studio-dag
```

结果：全部通过。`test:studio-dag` 在当前 Node 版本输出 `--experimental-loader` warning，不影响测试结果。

## 仍需人工验收场景

1. **Happy path**：创建 3 个 subtasks 的 plan（A -> B/C，maxConcurrency=2），批准后自动跑完，无需用户输入“继续”。
2. **Chat 后台态**：async run 启动后主模型不 streaming，但 Chat/Widget 显示“正在等待并行子任务完成 / 后台仍在工作”。
3. **terminal continuation**：子 run terminal 后，同一主 session 自动收到 continuation，先 collect，再继续 next/claim/dispatch。
4. **自动 checking**：全部 implementation subtasks done/skipped 且无 active run 后，主 session 自动 transition 到 `checking` 并派发 checker。
5. **失败态**：让一个 subtask 失败，确认不会继续派发依赖，Panel/Widget 显示 needs_user/blocked 和 run transcript。
6. **waiting_for_user**：child 触发 extension UI request，确认系统不代答并提示需要用户处理。
7. **Session 生命周期**：主 Chat idle 时 active child run 能保活 continuation；显式 abort/destroy/cancel 仍能终止匹配 child runs。

## 检查员重点审查

- 是否有任何路径绕过 `approvalGrant`。
- continuation prompt 是否足够约束主 session：必须 collect terminal runs，按 maxConcurrency 补槽，不重复派发，不绕过 approval gate。
- UI 是否始终把 Studio 子任务后台工作与主模型 token streaming 区分开。
- 真实浏览器验收中 Panel / Widget / Chat 的文案是否符合“人话控制”，不暴露内部 runtime 术语。
