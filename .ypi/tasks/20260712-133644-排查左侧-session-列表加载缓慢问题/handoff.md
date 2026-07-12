# Handoff

## 已产出

- `brief.md`：请求链、证据、根因和决策项。
- `prd.md`：范围、兼容性和性能验收标准。
- `ui.md`：当前不触发 UI 门禁及触发边界。
- `design.md`：请求去重、single-flight、增量缓存、索引校验和回滚设计。
- `implement.md`：DAG 实施计划和机器可读 implementation plan。
- `checks.md`：功能、竞态、缓存、性能和人工验收清单。
- `plan-review.md`：用户审批入口。

## 验证与调查

完成静态代码追踪、active session 数量/体量/Studio child/index 覆盖统计和只读 HTTP 长尾探测。未运行 lint/tsc，因为没有生产代码变更；未进行有效 project-space route 的受控基准，需在实现阶段用固定 fixture 补齐。

## 剩余风险

真实长尾各阶段占比尚无服务端 timing 数据；本机 404 探测不能证明完整 route 的具体耗时分布。index 仅覆盖部分 session，不能直接改为 index-only。缓存失效点必须覆盖所有 session 生命周期操作和外部写入。

## 主会话需决策

确认 1 秒最大缓存复用窗口、外部写入可见性要求，以及推荐性能目标是否作为首期非阻塞 benchmark。审批计划后再保存 implementationPlan 并进入实现；当前不得直接实施。
