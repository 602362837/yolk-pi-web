# Checks

## 需求覆盖

- [x] 新建绑定 subtask 的 implementer child，侧栏主标题包含准确 `subtask.id` 与 title。（`studioChildSessionTitle` + projection isolation test）
- [x] 新建绑定 subtask 的 checker child，规则一致。（shared helper + same-task projection fixture）
- [x] 同一 task 下两个不同 subtask child 同时出现时，各自标题不因投影缓存而串用。（`projectStudioChildDisplay` cache key isolation test）
- [x] 无 subtask 的 architect/improver child 不出现伪编号，显示 member + task title fallback。
- [x] task detail 缺失/归档/读取失败时，header 有 subtaskId 的 child 至少显示 id，列表不报错。
- [x] 新 child JSONL 的最新 `session_info.name` 与共享 helper 规则一致。（runner 调用 `studioChildSessionTitle`；sdk-runner test 校验 helper 契约）
- [x] 存量 child 无需回写 JSONL，刷新列表后通过投影得到新标题。（设计与实现：读时投影；无 migration）
- [x] 同一 step 重跑可通过现有 detail/tooltip 的 run short id 区分。（主标题不含 run id；detail/tooltip 路径保留）

## 截断检查

- [x] 所有主标题长度 `<= SESSION_TITLE_MAX_LENGTH`（50）。
- [x] 长 id + 长 title 时先保留 id，再截 title。
- [x] 无 subtask 的长 task title 不因 member 前缀丢失关键标题部分。
- [x] 中文、连续英文、空白折叠、空 title/id 均有确定结果。
- [ ] 窄侧栏行高、ellipsis、hover 与点击行为不变。（**手工缺口**：未在本子任务启动真实浏览器 SDK child run）

## 自动验证

已新增 `scripts/test-session-title.mjs` 与 `npm run test:session-title`，覆盖：

- subtask id + title；
- 只有 subtask id；
- 无 subtask 的 member + task title；
- 50 字符优先级；
- 普通 session fallback 不回归；
- 同一 task 不同 subtask/run 的投影隔离。

实现后运行：

```bash
npm run test:session-title
npm run test:studio-sdk-runner
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验收

1. 用户先审批 UI 设计员 HTML 原型。 — **已完成（2026-07-13 批准）**
2. 启动开发服务器，创建至少两个绑定不同 subtask 的 Studio child run。 — **未在 TITLE-CHECKS 内执行**（需主会话/真实模型凭证）
3. 在侧栏核对主标题、badge、detail 和 tooltip；缩窄侧栏验证 ellipsis。 — **未在 TITLE-CHECKS 内执行**
4. 创建无 subtask 的 architect/improver run，确认不出现 step id。 — **单元覆盖；真实 UI 未跑**
5. 打开一个历史 child，确认未改 JSONL 也能显示新投影标题。 — **投影路径单测覆盖；真实 UI 未跑**
6. 检查新 child JSONL 的 `session_info`，确认与主标题契约统一。 — **runner 已接入共享 helper；真实 child 写入未跑**

## 回归风险

- `projectStudioChildDisplay` 缓存键遗漏 `subtaskId` 或 `runId`。 — 已纳入 cache key 并加隔离测试
- runner 与 sidebar 只共享部分字符串逻辑，未来再次漂移。 — 已统一到 `studioChildSessionTitle`
- 为兼容持久名称而把 `YPI Studio/member/runId` 全塞入 50 字符主标题，反而挤掉 step/title。 — 已不采用该 envelope
- 普通 session 标题 fallback 被 Studio helper 意外影响。 — 回归测试覆盖

## 门禁

- [x] UI 设计员 HTML 原型已产出并链接到 `ui.md`。
- [x] 用户已明确审批 HTML 原型与计划。
- [x] implementationPlan 已由主会话通过 Studio task action 保存。
- [x] TITLE-PROJECTION / TITLE-CHECKS 已实现并通过自动验证；真实侧栏 SDK child 手工验收仍为可选后续。

## TITLE-CHECKS 验证记录（2026-07-13）

自动：

- `npm run test:session-title`
- `npm run test:studio-sdk-runner`
- `npm run lint`
- `node_modules/.bin/tsc --noEmit`

手工/SDK 缺口（需主会话后续确认，不阻塞本自动子任务）：

- 未启动真实 SDK child run / 浏览器侧栏窄宽验收（可能依赖模型凭证与 live Studio 调度）。
- 未打开生产/历史 child JSONL 做人工 spot-check；依赖读时投影单测与代码路径审查。
