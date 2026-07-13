# 计划审批书：YPI Studio 任务 session 独占转移

## 待审批结论

将 Studio task 的 session 归属改为**单活跃 owner**：session2 显式继续/绑定任务 A 时，服务端原子移除 A 的旧 session keys，清理仍指向 A 的旧 runtime pointers，并把 A 绑定到 session2。session1 随后不再进入 session-link bound candidates，也不再显示 A 浮窗。

## 根因

当前 bind 及多个 mutation 路径只向 `contextIds` 追加；session-link 又正确地把 exact context 命中视为 bound，因此同一任务累积属于多个 session。读取层无法可靠猜测数组中哪个是当前 owner。

## 推荐设计

1. 只有显式 bind/continue 可以执行 exclusive transfer。
2. create 初始化 owner；其他 mutation 必须验证当前 context 已 bound，不得隐式 append/抢占。
3. `pi_<sessionId>`、`pi_transcript_<hash>`、`pi_process_<hash>` 作为 session 类 key 一并替换；未知非 session context 保留。
4. transfer compare-before-delete 旧 pointers，写新 pointer并记录审计。
5. 跨 session 不复用 approval grant；新 owner 必须重新明确批准，现有 approval gate 不放宽。
6. 旧累积数据不在读取时猜 owner；下一次显式 bind 惰性归一化。archived task 不变。
7. 保留“一个 session 可绑定多个不同 task”的 multi-task widget 能力。

## UI 门禁

不触发：不新增 UI、文案、确认流程或信息结构；现有绑定入口和 widget 渲染不变，仅修正后端数据后旧 session 不再错误显示。若实现提出 owner 展示/转移确认/unbind 控件，必须退回规划并补 UI 设计员 HTML 原型审批。

## 实施与验证

实施分为 ownership 原语、统一 mutation、focused tests、文档、完整验证五步。重点验收 create@s1 → bind@s2 → s1 无浮窗/s2 有浮窗、旧审批不可复用、runtime pointer 一致、并发 bind 最终单 owner、multi-task session 不回归。

## 相关产物

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 门禁判断](ui.md)
- [Design](design.md)
- [Implementation Plan](implement.md)
- [Checks](checks.md)

## 请用户确认

请确认是否批准按以上方案进入实现。特别请确认两点：

- 普通 mutation 不具备隐式 takeover 权限，只有显式 bind/continue 能转移 owner；
- 存量多 owner 任务采用“下一次显式 bind 惰性修正”，不做自动全量迁移。

批准后再进入 implementing；当前阶段不修改生产代码。
