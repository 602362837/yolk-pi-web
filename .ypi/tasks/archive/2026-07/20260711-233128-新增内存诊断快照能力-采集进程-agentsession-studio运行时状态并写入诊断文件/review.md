# review — 内存诊断快照

## Verdict

**Pass** — 可进入 `ready`。

实现完整覆盖 PRD/Design/Checks 主路径：只读有界采集、schema v1 原子落盘、POST 元数据 API、Settings Diagnostics 五态 UI、文档与 focused tests。检查中发现并修复 2 个低风险问题；无阻塞项。

## Findings Fixed

1. **content-block 上限按 session 累计，而非按 message（R3）**  
   `lib/rpc-manager.ts` 的 `tallyMessageContent` 曾把 `blocksScanned` 放在 session 级 `ContentTallyState` 上，导致前几条消息扫满 100 blocks 后后续消息长度估算被饿死。已改为**每 message 独立**计数，符合「每 message 最多 100 content block」。

2. **Settings 连续触发的响应竞态**  
   `DiagnosticsPanel` 在前一次 fetch 已返回、后一次已开始时，旧响应仍可能覆盖新状态。已加 `requestGenRef` generation 守卫，过期响应不再写 state。

## Remaining Findings

### 非阻塞

1. **人工 smoke 未在本 worktree 的 dev server 上完成**  
   旧 `localhost:30141` 实例未加载新 route（会 404）。focused test 已覆盖 collector/锁/落盘/schema。需用户用本 worktree 重启 `npm run dev` 后做 Settings + curl smoke（非代码缺陷）。

2. **focused tests 使用 `fakeRuntime` 注入，不加载真实 owner 模块**  
   因 Node TS stripper 无法解析部分 owner 语法。marker/caps/只读性对 owner projection 以静态审查确认；真实投影的端到端 marker fixture 未在自动化中跑。可接受残余风险，建议后续若引入可 strip 的 projection 单测再补。

3. **诊断文件无自动 retention**（设计内）— 文档已说明手动 `rm`。

### 阻塞

None。

## 对照 checks.md

| 类别 | 结论 |
| --- | --- |
| 需求覆盖 R1–R9 | 通过：POST 201 元数据、schema v1、各 section、findings heuristic 措辞、Settings diagnostics、文档导航 |
| 安全 / 脱敏 | 通过：投影 allowlist；OpenAI Codex 仅 known-session 公开 getter 数值/布尔，省略 response id / error 字符串；API/UI 不回完整 JSON；env marker 测试通过 |
| 只读性 | 通过：projection 路径无 destroy/abort/cleanupExpired/reset/GC/listAll/startRpc |
| 有界 / 故障 | 通过：5s deadline、caps、5 MiB compact fallback、单飞 409、原子写失败清理（测试 + 代码） |
| UI | 通过：五态、disabled loading、元数据+复制路径、隐私 callout、无 JSON 预览/文件列表；与 ui-prototype 主路径一致 |
| 文档 | 通过：AGENTS + api/library/frontend/overview/troubleshooting 与实现一致 |

## Verification

```text
npm run test:memory-diagnostics  →  memory-diagnostics tests: all passed
npm run lint                     →  0 error / 0 warning
node_modules/.bin/tsc --noEmit   →  exit 0
git diff --check                 →  exit 0
```

未运行 `next build`（按约束）。未 commit / push / merge。

## 建议主会话

- 将任务状态切到 **ready**。
- 提醒用户：用本 worktree 重启 dev server 后执行一次 Settings → 诊断 与 curl smoke 即可完成人工验收。
- 无需返工实现员；无产品决策待批。
