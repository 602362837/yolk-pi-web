# Architect Handoff

## 已产出

- `brief.md`：根因证据与目标决策
- `prd.md`：范围、兼容性和性能验收
- `ui.md`：无需 UI prototype 的门禁结论
- `design.md`：有界增量 JSONL metadata scanner 设计及 active/archive/Studio child/Usage 边界
- `implement.md`：5 子任务 DAG 与机器可读 implementation plan
- `checks.md`：自动、内存、API 和人工回归清单
- `plan-review.md`：用户审批入口

## 核心结论

Pi SDK `buildSessionInfo()` 的 `allMessages[]` 和 `allMessages.join(" ")` 是已确认根因。仅从返回值删除 `allMessagesText` 或增加 1 秒 cache 不能消除首次扫描峰值。最终实现必须跳过正文 token，不得以整行 `JSON.parse` 假装完成超大单行的有界扫描。

## 主会话下一步

1. 保存 `implement.md` 的 `ypi-implementation-plan` 为 task implementationPlan。
2. 汇总/展示 `plan-review.md` 并切到 `awaiting_approval`。
3. 等待用户明确批准后才派发实现。

无阻塞产品决策；实现需锁定 firstMessage 上限，推荐 API 最多 100 字、内部规范化扫描预算 1–4 KiB，并以展示前 50 字兼容为门禁。
