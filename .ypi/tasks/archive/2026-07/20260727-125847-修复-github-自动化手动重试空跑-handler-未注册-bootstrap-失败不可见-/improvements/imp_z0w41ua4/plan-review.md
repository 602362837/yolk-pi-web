# 计划审批书 — IMP-001

## 结论（已复现，非猜测）

Full-agent 启动前的 **secret-injection sentinel 假阳性**：

安全提示句中的 **「installation tokens」** 命中

`/installation[_\s-]?token/i`

→ `runGithubFullAgentMember` 抛出  
`Refusing full-agent run: prompt contains secret injection markers`  
→ sanitize 成 **Internal GitHub automation error**  
→ **无 child session**，parent 保持空壳。

Parent empty binding Session **本身是设计**；问题是 **child 从未启动**，却被口径包装成 Agent 已可用。

本地 jiti 复现：`marker? true`，命中行即 security bullet。

## 修复计划

1. **收紧 sentinel**（assignment/header 形态），保留真 token 拦截  
2. **typed preflight 错误 + 事件 meta**（code/stage/retryable）  
3. **投影口径**：Session 绑定 ≠ Agent 活跃  
4. **回归测试 + 30142 单次 retry**（不 kill 30141）

## 产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md) — 默认无 HTML 原型
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)

## UI 门禁

默认不改 Jobs 布局；仅语义/meta。若实现改可见状态结构，再补原型。

## 请求批准

请确认：

- [ ] 同意按 IMP1-01…04 实施
- [ ] 同意 parent 可继续为空；Agent 活跃看 child/meaningful progress
- [ ] 同意 30142 验收且不 kill 30141
- [ ] 同意本改进完成 **不** 等于 #22 业务完成

批准示例：

```text
确认 IMP-001 计划，按 plan-review 实施
```
