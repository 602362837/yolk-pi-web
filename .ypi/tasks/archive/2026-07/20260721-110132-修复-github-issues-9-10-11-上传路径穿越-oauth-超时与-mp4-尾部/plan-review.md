# 计划审批书：GitHub Issues #9、#10、#11

## 请求审批

本计划修复三个已认领、已采纳的后端问题：通用文件上传路径穿越、GitHub Links Device Flow 外部 signal 关闭 timeout、Appearance 合法 tail-`moov` MP4 被误判。

**当前只完成规划，不修改生产代码。** 主会话保存 implementationPlan 后，本任务可进入 `awaiting_approval`；用户明确批准前不得实现。

## 审批材料

- [Brief / 问题、证据、范围](brief.md)
- [PRD / R1–R10 与验收标准](prd.md)
- [UI / Gate 不适用说明](ui.md)
- [Design / 安全边界、数据流、兼容与回滚](design.md)
- [Implement / 人类表格 + schemaVersion 2 DAG](implement.md)
- [Machine implementation plan](implementation-plan.json)
- [Checks / 自动、人工与 blocker](checks.md)

## PRD 摘要

1. **Issue #9**：客户端 `file.name` 只作展示元数据；上传目录和存储 basename 均为服务端 opaque UUID；最终 `resolve/relative` containment、0700/0600、`wx` 独占写入；cleanup 不跟随 symlink。保持 `{ name, path, size }`、大小/quota/retention。
2. **Issue #10**：每个 GitHub device-code/token/user 请求始终组合 caller cancellation 与独立 15 秒 deadline；同一 deadline 覆盖 fetch 和 body reader；只有内部超时映射 `github_timeout`，主动取消不伪装为 timeout/network。
3. **Issue #11**：按合法 top-level box size 走完整 box chain、跳过 `mdat/free` payload，再在 8 MiB metadata、depth 6、global box count 2048 预算内解析任意位置的 `moov`；禁止 raw `moov` 字符串搜索和新增 ffprobe。
4. 公共 API/SSE/error code/catalog/config/JSONL 均不变，无迁移。

## UI Gate

**不适用。** 无页面、组件、CSS、文案、用户可见信息结构、确认或审批体验变化；合法文件只进入现有成功路径。没有 HTML prototype，也不需要 UI 设计员。

若实现需要新错误 code/copy、附件展示、OAuth 状态或 Appearance 交互，必须停止并重新打开 UI gate。

## Design 摘要

- 上传新增 server-only `lib/file-upload-storage.ts`，route 不再自行用原始名字拼路径。
- OAuth 在 `lib/github-link-oauth.ts` 内建立可清理的 composed deadline；body `reader.read()` 显式与 signal race。
- MP4 顶层 traversal 可跨完整 buffer，但工作量按 box header 数量有界；metadata subtree 仍固定 8 MiB。
- 三条链不共享运行时模块，可安全并行。
- 当前 Appearance 源码策略保持：50 MiB 是确认阈值、1 GiB 是 hard/total ceiling、duration/resolution 当前不是拒绝政策；只修 docs 漂移，不改产品限制。

## Implementation Plan 摘要

计划含 5 个 schemaVersion 2 子任务，最大并发 3：

| ID | 内容 | 依赖 |
| --- | --- | --- |
| `FIX-01` | 上传安全存储与 focused tests | — |
| `FIX-02` | OAuth composed deadline/body cleanup 与 tests | — |
| `FIX-03` | MP4 tail-`moov` bounded parser 与 tests | — |
| `FIX-04` | 文档对齐与跨链静态复核 | 01/02/03 |
| `FIX-05` | focused regression、lint、tsc、smoke、checker | 04 |

实施阶段先并行 `FIX-01/02/03`，各自 local security review 后再整合；不修改前端，不 commit/push/merge。

## Checks 摘要

自动验证：

```bash
npm install
npm run test:file-upload
npm run test:links
npm run test:appearance-video
npm run test:appearance
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

重点 blocker：任何路径逃逸/覆盖/symlink 跟随；caller signal 仍关闭 deadline；body 可永久挂起；cancel 显示 timeout；raw payload `moov` 误识别；移除 metadata/depth/count budget；未审批的 UI/schema/limit scope creep。

## 基线与剩余风险

规划阶段已尝试现有 focused tests、lint、tsc，但当前工作树没有完整 `node_modules`：缺 `jiti`、`sharp`、`eslint`、`tsc`。实施前必须 `npm install` 后重新跑，当前不能声称基线通过。

其他风险：严格 extension 规则影响少数类型推断、abort race 分类、MP4 fixture/extended-size 边界、checker host 缺 ffmpeg。计划已为这些风险指定回归和回滚边界。

## 请用户确认

请明确回复 **「批准」** 或 **「需要修改」**。批准表示同意：

- 上传采用服务端 opaque path + containment/exclusive write；
- GitHub deadline 保持 15 秒并区分主动取消；
- MP4 用 top-level box chain 支持 tail-`moov`，保留固定 metadata budget；
- 不改变当前 Appearance 限额政策；
- 不增加 UI、public schema、error code 或数据迁移。