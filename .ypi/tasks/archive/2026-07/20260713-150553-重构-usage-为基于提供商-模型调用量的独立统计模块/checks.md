# Checks：独立 LLM Usage

## 需求覆盖

- [ ] 调用定义是“可观测 completion 终态”，UI/API 不声称物理 HTTP attempt 精确计数。
- [ ] 主 Chat、ypic、Studio SDK/CLI、env assist、workflow assist、model test、warmup 均有入口测试。
- [ ] compaction/branch summary 通过已批准的 SDK 稳定方案覆盖，或在用户明确接受后列为 known gap。
- [ ] Provider + Model 为主维度；同 model id 不跨 provider 合并。
- [ ] success/error/aborted 与 source 均可过滤/聚合。
- [ ] reasoning 是 output 子集；总 token 不重复计算。
- [ ] cost 使用当次 SDK 值，不按当前模型价格重算。
- [ ] Chat 顶栏 session rollup/context 语义不回归。

## 数据与隐私检查

- [ ] 落盘 schema 只允许 allowlist 字段；无 prompt/output/thinking/tool/artifact/credential/responseId/绝对路径。
- [ ] 数字拒绝 NaN/Infinity/负数；unknown provider/model 不丢记录。
- [ ] 原子写失败不留下可读半文件；最终文件权限遵循本地 agent 数据约束。
- [ ] workspace 仅保存 hash；相同 canonical cwd 得到稳定 key。
- [ ] 单事件超限/JSON 损坏被跳过并计入 coverage，不拖垮整个查询。

## 去重、失败与重试

- [ ] 同 callId 的 final callback 执行 2 次，calls 仍为 1。
- [ ] 同 session JSONL backfill 执行 2 次，calls/费用不变。
- [ ] live capture 与 backfill 并发不双计同一 entry。
- [ ] streaming 100 个 delta 只产生 1 个终态事件。
- [ ] Agent tool loop 的每个 assistant completion 各产生 1 条。
- [ ] fallback/outer retry/failover 的新 completion 各产生事件；内部 SDK retry 标注不可见。
- [ ] error/aborted 带部分 usage 时保留该 usage；0 usage failed call 仍计 calls。
- [ ] recorder 写失败不改变原业务 HTTP/Agent 成败；重试队列有界且可诊断。

## 迁移与兼容

- [ ] active/archive 历史 assistant usage 可幂等 backfill，且不修改 JSONL。
- [ ] 历史 direct/CLI/compaction 缺口显示在 coverage。
- [ ] 老 `pi-web.json` 无新字段时使用安全默认；保存设置不丢旧字段。
- [ ] `/api/usage?sessionId=` 契约与 `test:usage-rollup` 保持。
- [ ] 新 API 有 `kind/schemaVersion`、日期跨度上限、过滤校验与 no-store/动态响应。
- [ ] ledger route 不导入/调用 session inventory（backfill 命令除外）。
- [ ] 关闭 statsSource/新 route 后旧 Usage 页面可恢复，ledger 数据不需迁移回滚。

## 自动验证

实现阶段最低命令：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:usage-rollup
npm run test:llm-usage-store
npm run test:llm-usage-capture
npm run test:llm-usage-backfill
npm run test:llm-usage-api
```

建议新增 fixture：两 provider 同 model、reasoning、cacheWrite1h、partial error、aborted、0-cost local model、unknown model、坏文件、多进程同 eventId、UTC 跨日、本地 timezone 聚合。

## API 人工验收

- [ ] 空目录返回 200 + empty coverage，而非 500。
- [ ] backfill 前后 compare：共同 session 记录的 token/cost/calls 一致。
- [ ] direct assist/warmup 调用只出现在 ledger，不出现在 legacy，coverage 解释一致。
- [ ] 366 天边界、非法日期/过滤、超范围请求返回稳定 400。
- [ ] 响应不包含本机路径、session transcript 或账户标识。

## UI 人工验收（HTML 原型审批后）

- [ ] Provider 展开 model，calls/cost/token/status/source 信息可读。
- [ ] loading/empty/error/retry/partial/backfilling/corrupt/unknown/zero-cost 状态齐全。
- [ ] 日期/workspace/source/status 过滤组合正确，清除过滤恢复。
- [ ] ≤640px 可操作，无关键 coverage 被折叠消失。
- [ ] dialog focus trap、Esc、键盘展开/筛选、对比度和 reduced motion 合格。
- [ ] 明示全局账本与 Chat 顶栏 session rollup 的口径差异。

## 评审阻断项

1. 无 UI Designer HTML 原型或无用户原型审批。
2. SPIKE-01 未解决却宣称“全部 LLM 调用”。
3. 使用 SDK 私有 `_handle*` monkey patch 作为长期方案。
4. 从 delta 累加 usage、reasoning 重复计数或按当前价格回算历史费用。
5. ledger 写失败阻断正常聊天/辅助功能。
6. 新页面隐瞒 historical known gaps 或损坏记录。
