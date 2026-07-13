# Design：exclusive session rebind

## 方案摘要

把“显式绑定/继续”与“已绑定上下文中的普通 mutation”分开：

- 显式 `bind` 调用统一的 exclusive transfer helper，替换任务的 session 类 context owner。
- 其他 mutation 不再 `contextIds.push()`；它们通过统一 guard 验证请求 context 已是当前 owner。create 是唯一直接初始化 owner 的路径。
- transfer 同步清理旧 runtime pointers、写入新 pointer并记录结构化审计事件。

这样写入模型成为权威，`resolveYpiStudioTaskForSession()` 无需猜测或增加 UI 特判。

## Context 分类与数据模型

在 `lib/ypi-studio-tasks.ts` 集中定义纯函数：

- `isYpiStudioSessionContextId(id)`：匹配 `pi_<sessionId>`、`pi_transcript_<hash>`、`pi_process_<hash>`。`pi_process_*` 虽不作为 widget evidence，仍是 extension 的 session fallback，转移时必须清除。
- 未知/未来的非 `pi_*` context 视为 metadata/外部关联并保留；不要用宽泛 `startsWith("pi_")` 删除未知数据。
- `replaceTaskSessionContext(contextIds, next)`：保留非 session context，移除全部已知 session context，追加且去重 `next`。

当前 extension 每次选择一个优先 key（raw session id 优先、transcript 次之、process 最后），因此无需同时持久化 aliases。session-link 的 exact keys 兼容任一稳定 key。

## Exclusive transfer 算法

在 task mutation lock 内：

1. 校验 active task、非 archived、`contextId` 非空且属于已知 session context 类型；API 无效 context 返回 400 级业务错误。
2. 计算 `previousSessionContextIds`、保留的 non-session contexts 和 `nextContextIds`。
3. 若 next 已是唯一 session owner，则仅确保新 runtime pointer 正确，保持幂等。
4. 否则写入新 `contextIds`；若存在主任务 `meta.approvalGrant` 且其 context 与 next 不同，清除 grant（approvalGate 可保留作阶段审计，新 session 需重新明确批准）。
5. 对每个 removed context：读取 pointer；仅当仍指向当前 task id/key 时 unlink 对应 runtime 文件。
6. 写新 context pointer。
7. 原子写 task.json 并追加 `note`/建议新增 `context_transfer` 事件；event data 只含 `fromContextIds`、`toContextId`、`removedPointerCount`、`approvalGrantCleared`，不需要新公共 API 类型。

任务文件写入、pointer 清理和 event 无法跨文件形成真正事务；以 task.json 为权威，顺序采用“写 task → 清旧 pointer → 写新 pointer → event”。失败时 resolver 仍以 contextIds 决定 widget；pointer 只影响 current/diagnostics。事件记录 pointer cleanup warning 便于排查。

## 普通 mutation 与权限

所有当前 `contextIds.push()` 调用点必须审计并改为统一入口：

- improvement：create、artifact update、plan update、approval、revise；
- main task：record user approval、transition、artifact update、implementation plan update、claim main/improvement subtask、update subtask；
- bind 自身。

规则：

- `createYpiStudioTask`：初始化 owner，无 transfer。
- `bindYpiStudioTaskToContext`：唯一公开 transfer 入口。
- 其余带 context 的 active-task mutation：调用 `assertTaskBoundToContext(record, contextId)`；不得 append 或自动 takeover。
- 当前明确允许无 context 的内部维护路径保持原契约；审批、claim、subagent dispatch 等敏感路径继续要求 context，且必须 bound。
- improvement 属于 main task，不单独拥有 session；其 mutation 使用 main task owner。

这避免 s1 在 A 已转给 s2 后，通过 artifact update/transition 等路径把自己悄悄追加回来。`assertYpiStudioImplementationApproved()` 继续校验 `contextIds.includes(contextId)` 和 grant context 精确匹配，不削弱 approval gate。

## Runtime pointer

新增安全 helper `removeRuntimePointerIfMatches(ctx, contextId, taskId)`，复用与 `cleanupRuntimePointers()` 相同的安全文件名和解析规则。禁止无条件 unlink，因为旧 context pointer 可能已转向另一个 task。

转移后：

- s2 pointer → A；
- s1 pointer 若仍 → A 则删除；
- s1 transcript 历史只出现在 diagnostics，不进入 bound candidates；
- 无需修改 session JSONL。

## API 与 UI 契约

- `PATCH studio/tasks/[taskKey] { action:"bind", contextId }` 请求/响应 shape 不变，语义由 additive bind 改为 exclusive transfer。
- 不新增 unbind API：当前需求只有 takeover；单独 unbind 会产生 ownerless active task及审批产品决策，暂不引入。
- UI 继续调用原 endpoint。可把成功文案维持原样，避免 UI 门禁。
- archived key 继续拒绝 bind。

## Session-link 读取层

`resolveYpiStudioTaskForSession()` 保持“exact contextIds 才是 bound”原则。可增加回归测试，但不建议在 resolver 中按 updatedAt、runtime pointer 或数组末项过滤旧数据：这些推断会隐藏数据问题并可能误判历史任务。

“一个 session 多 task”与“一个 task 单 session owner”可同时成立，不应删除 multi-task API/types/widget。

## 兼容性与惰性修正

- 无 schema version bump；`contextIds: string[]` wire shape 不变。
- 已累积多个 session keys 的任务在下一次显式 bind 时全部归一到新 key，并清理可确认指向该 task 的旧 pointers。
- 不做启动时/读取时全量迁移，因为数组顺序不是正式 owner 字段，自动猜测有误转风险。
- 若用户尚未再次 bind，旧数据仍可能在多个 widget 显示；这是惰性策略的已知窗口。可提供一次性审计脚本作为未来运维项，但不纳入本修复。
- archived task 保持不可变；archive cleanup 继续清 runtime pointers。

## 并发、风险与缓解

- **并发 bind**：必须复用 `withTaskMutationLock`；最后完成的显式 bind 成为 owner，event 提供顺序审计。
- **普通 mutation 竞态**：guard 必须在 lock 内校验，避免校验后 owner 被切换。
- **approval 跨 session**：transfer 清 grant；实现边继续 exact context 检查。
- **process fallback**：纳入 session context 清理，避免 extension current 仍命中旧 process。
- **未知 context 丢失**：采用精确前缀分类并保留未知值。

## 回滚

回滚 helper/guard 后 API 可恢复 append 行为，无数据迁移依赖；已被归一化的旧 context 不自动恢复（它们是错误的多 owner 状态）。若需审计可从 context transfer event 查阅旧 context ids。
