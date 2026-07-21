# Handoff：Issues #9、#10、#11 规划

## 已完成

- 读取并核对 Issues #9/#10/#11、`AGENTS.md`、architecture/API/frontend/library/integration/style docs，以及相关 route/library/test consumer。
- 产出 `brief.md`、`prd.md`、`ui.md`、`design.md`、`implement.md`、`implementation-plan.json`、`checks.md`、`plan-review.md`。
- UI gate 判定不适用：无前端/文案/信息结构变化，无需 HTML prototype。
- 设计 5 项 schemaVersion 2 DAG，`FIX-01/02/03` 可并行，`maxConcurrency=3`。
- 未修改生产代码，未 commit/push/merge。

## 关键决策

- 上传：服务端 opaque UUID path，原名仅展示；final containment + 0700/0600 + `wx`；cleanup 跳过 symlink。
- OAuth：caller abort 与独立 15 秒 deadline 始终组合；deadline覆盖 body read；主动 cancel 不映射 timeout。
- MP4：完整 top-level box-chain header walk，跳过 payload；`moov` metadata 保留 8 MiB/depth 6/global count 2048；不 raw-search、不加 ffprobe。
- 保持当前源码 Appearance 策略，不借修复改变大小/duration/resolution政策。

## 验证情况

尝试 `test:links`、`test:appearance-video`、lint、tsc，均因未安装完整依赖而未执行：缺 `jiti`、`sharp`、`eslint`、`tsc`。实施前先 `npm install`。

## 主会话下一步

1. 审阅 [plan-review.md](plan-review.md)。
2. 用 Studio 能力保存 `implementation-plan.json`/`implement.md` 中的 implementationPlan。
3. 将任务从 intake/planning 准备到 `awaiting_approval`。
4. 等待用户明确「批准」后再派发 implementer；批准前不得实现。

## ISSUE-11 实现交接

- `lib/appearance-video.ts` 现按完整顶层 ISO BMFF box chain 走到文件尾，仅读取 header 并跳过 `mdat`/`free` payload；只解析真正的 top-level `moov`。
- `moov` metadata 保持 8 MiB 上限、最大深度 6 和全局 2048 box budget；截断、溢出、重复 `moov`、budget/depth 超限均 fail closed。
- `scripts/test-appearance-video.mjs` 新增真实 MP4 中插入 9 MiB `free` 后 tail-`moov` 回归，以及 `mdat` payload 内伪造 `moov` 不被接受的回归。
- `npm run test:appearance` 通过（18 + 16 tests）；其中包含 `test:appearance-video`。首次单独执行 `test:appearance-video` 曾因本机 ffmpeg poster 子进程失败而有一个既有 poster 测试失败，随后在组合 suite 复跑通过。
- `npm run lint` 与 `node_modules/.bin/tsc --noEmit` 仍被缺少 `eslint` / `tsc` 二进制阻塞；未运行 `npm install`，避免修改依赖树。
- delegated member 环境没有 Studio 状态 mutation 工具，无法安全标记 `ISSUE-11` 完成；主会话应在验证记录后更新子任务状态。

## 剩余风险

- 当前 task state 仍显示未保存 implementation plan；delegated member 环境没有 Studio mutation/transition tool，不能安全手改 `task.json`。
- 依赖缺失导致 lint/type-check 未跑。
- 文档内 Appearance 限额与当前源码有漂移，`FIX-04` 必须按源码纠正，但不得把纠正文档变成产品政策变更。

## INTEGRATE 验证记录（2026-07-21）

- 已复核上传 opaque UUID/containment/`wx`/symlink cleanup、OAuth caller-cancel + 独立 15 秒 deadline/body reader、MP4 top-level header-chain + 8 MiB/depth 6/global 2048 budget；未改前端、wire schema、错误 code 或限额政策。
- 已对齐 `docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/integrations/README.md`、`docs/standards/code-style.md`：附件 opaque 存储、GitHub 15 秒组合 deadline、tail-`moov` 边界，以及 Appearance 的 50 MiB 确认/1 GiB ceiling 与非拒绝 duration/resolution 策略。
- 通过：`npm run test:file-upload`；`npm run test:links`（83 passed）；`npm run test:appearance-video`（16 passed）；`npm run test:appearance`（18 + 16 passed）；`npm run test:web-credential-store`（14 passed）；`git diff --check`。
- 阻塞：`npm run lint` 退出 127（`eslint: command not found`）；`node_modules/.bin/tsc --noEmit` 退出 127（`tsc` 不存在）。当前 `node_modules` 缺少对应开发二进制；未运行 `npm install`，避免修改依赖树。主会话须在已批准的依赖安装环境重跑二者。
- delegated member 无 Studio 状态 mutation 工具，未手改 task state；主会话应将 `INTEGRATE` 标记完成或按 lint/tsc blocker 保持 checking。未 commit/push/merge。