# PRD：YPI Studio 任务 session 独占归属

## 目标与用户价值

用户在新聊天继续既有 Studio 任务时，任务应明确“交棒”给新聊天。旧聊天不再出现该任务浮窗，也不能继续审批或驱动子代理，避免两个编排上下文同时推进同一任务。

## 范围内

1. **单活跃 session owner**：active task 的 session 类 context 只能保留当前 owner。
2. **显式转移**：`PATCH ... { action: "bind", contextId }`（UI 继续/绑定入口）触发 exclusive rebind。
3. **读取结果**：转移后，session1 的 session-link `tasks[]` 不含任务 A；session2 包含任务 A。
4. **runtime pointer 一致性**：新 owner pointer 指向 A；被移除且仍指向 A 的旧 pointer 被删除。
5. **权限不弱化**：审批 grant 与实现转换必须匹配当前 bound context；旧 context 不得审批、claim 或调度子代理。
6. **兼容旧数据**：旧任务若累积多个 session context，不在只读扫描时猜 owner；下一次显式 bind 原子归一化。

## 范围外

- 一个 session 可绑定多个不同 task 的现有 multi-task 语义。
- 新增 unbind API、转移确认弹窗、owner 标签或历史归属页面。
- archived task rebind（继续拒绝）。
- 全量数据迁移或自动依据数组顺序猜测 owner。

## 需求与验收标准

### R1 创建与转移

- create@s1 后 A 的 session owner 为 s1。
- bind/continue@s2 后，A 的 session 类 `contextIds` 只包含 s2 的当前 key；明确约定保留未知/非 session context。
- 重复 bind@s2 幂等，不产生重复 context、无意义 revision 或重复 transfer event。

### R2 浮窗

- 转移前：s1 widget 有 A。
- 转移后刷新/重查：s1 widget 无 A，s2 widget 有 A。
- transcript 中历史提及 A 不得让 s1 重新进入 `tasks[]`，只可留 diagnostics。
- 同一个 session 绑定多个不同 task 的返回和排序保持不变。

### R3 审批与执行安全

- awaiting_approval 阶段从 s1 转移到 s2 后，s1 不能记录审批；s2 必须提供新的明确批准后才可进入 implementing。
- 历史 approval grant 不得跨 session 复用。转移时清除主任务的 session-bound grant（保留事件审计）。
- claim/update/subagent dispatch 只接受当前 bound context，不能通过普通 mutation 隐式把旧 session 重新加回。

### R4 runtime pointer

- transfer 写入 s2 pointer。
- 对从任务移除的 context，仅当其 pointer 当前仍指向 A 时删除，避免误删已指向其他 task 的 pointer。
- stale s1 pointer 不得令 `current`/approval 查找把 A 当成 s1 当前任务。

### R5 边界

- archived task bind 继续报错，archive cleanup 行为不变。
- 无 context 创建的 task 保持可读，首次显式 bind 建立 owner。
- `pi_process_*` 是 fallback session runtime context，按 session 类处理；未知前缀作为非 session metadata 保留。
- task.json 写入与事件记录应处于同一任务 mutation lock，防止并发 bind 丢更新。

## UI 门禁

不触发。此次仅修正服务端绑定语义；现有“绑定到当前聊天”入口、文案、组件结构与操作步骤不变。用户可见结果只是旧 session 不再错误显示浮窗，属于既有交互的正确化，不需要 HTML 原型。若实现阶段提出转移确认、owner 展示或新 unbind 控件，则必须退回规划并派发 UI 设计员。

## 未决问题

无阻塞产品问题。推荐采用“仅显式 bind 建立/转移 owner；普通 mutation 必须验证 owner，不能隐式 rebind”的安全语义。
