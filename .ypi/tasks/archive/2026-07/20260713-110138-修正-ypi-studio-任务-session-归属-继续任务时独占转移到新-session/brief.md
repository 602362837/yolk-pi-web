# Brief：YPI Studio 任务 session 独占归属

## 问题

任务 A 在 session1 创建后，由 session2 执行“继续/绑定”时，`contextIds` 仍保留 session1 并追加 session2。session widget 以 exact context key 命中作为 bound 证据，因此两个 session 都会显示任务 A。

## 根因

- `bindYpiStudioTaskToContext()` 和 `lib/ypi-studio-tasks.ts` 多个 mutation 路径只执行去重追加，不表达“所有权转移”。
- `resolveYpiStudioTaskForSession()` 正确地把 `contextIds` 中 exact `pi_<sessionId>` / `pi_transcript_<hash>` 视为明确绑定；读取层没有足够信息判断累积数组中哪个才是当前 owner。
- runtime pointer 是按 context 独立写入的；新绑定只写新 pointer，旧 pointer 未同步清除。

## 目标

- active task 默认只有一个 session 类 context owner。
- 显式 bind/continue/takeover 原子地把任务转移到新 session，清除旧 session 绑定与指向该任务的旧 runtime pointers。
- 审批和执行仍必须由当前 bound context 完成，不允许旧 session 借 stale pointer 或历史 approval grant 操作。
- 已累积多 context 的旧任务在下一次显式 bind 时惰性归一化。

## 非目标

- 不改变一个 session 同时绑定多个任务的 multi-task widget 能力。
- 不新增归属展示、转移确认、unbind 按钮或 UI 信息结构。
- 不修改 archived task，不做全仓库启动时批量迁移。
- 不把 transcript mention 降级为绑定证据，也不放宽 approval gate。
