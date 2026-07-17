# Summary：IMP-001 改进规划（等待审批）

## 完成内容（improver）

将用户验收反馈收敛为可批准的改进计划（**未改生产代码**）：

- 固定 0.3.0 `quotaKey → group` 映射与 **max(used) 保守聚合**
- 顶栏 **Flash 外环 + Opus 内环**；缺组安全降级
- 详情 / Models **组 accordion**
- Failover **保持 model-aware，不 group-aware**
- 测试 DAG AG-G01…G05、回滚与 checks

## 产物

| 文件 | 作用 |
| --- | --- |
| `brief.md` | 反馈与决策摘要 |
| `prd.md` | 范围与验收 |
| `design.md` | 映射/聚合/双环/failover 设计 |
| `ui.md` | 原型链接与状态矩阵 |
| `antigravity-grouped-quota-prototype.html` | UI 设计员 HTML（已有） |
| `implement.md` | 实现 DAG |
| `checks.md` | 验证清单 |
| `plan-review.md` | **用户审批入口** |

## 下一步

1. 主会话请用户审阅 `plan-review.md` + HTML 原型。  
2. 明确批准后派发实现员（按 AG-G01…G05）。  
3. 未批准前禁止生产实现。
