# 计划审批书：修复聚合用量浮窗主题、环尺寸与动态窗口优先级

## 审批结论请求

请审批本轮**仅规划、尚未实现**的修订方案与 UI 原型。此次修订已移除 GPT/Grok/Kiro 固定窗口布局，改为“实际窗口候选 → 通用 projector”。批准后才进入 implementation；未批准则继续修订。

- UI HTML 原型：[`usage-aggregate-theme-priority-prototype.html`](./usage-aggregate-theme-priority-prototype.html)
- UI 说明：[`ui.md`](./ui.md)
- PRD：[`prd.md`](./prd.md)
- Design：[`design.md`](./design.md)
- Implement：[`implement.md`](./implement.md)
- Checks：[`checks.md`](./checks.md)
- Brief / 证据：[`brief.md`](./brief.md)

## PRD 摘要

1. 每个 provider/account 动态读取实际存在且安全的窗口，不补固定 5h/7d/week/month。
2. provider adapter 只生成无序候选；通用 projector 按可信 duration 短→长布局：外圈最短、内圈更长、中心外圈。
3. only-7d / only-week 等单窗场景只有一个圈；多个可比较窗口才多圈。
4. unknown duration 不猜：单个候选可单圈；多窗口中 unknown/tie 留详情；若没有可安全排序窗口则不任意挑 ring。
5. 主题、高对比中心、trigger 30px / panel 40px（最低 38px）、hover/focus + 220ms、非 accordion 分栏与既有操作全部保留。

> “优先”是按真实周期 duration 的展示顺序，不根据 percent 动态预测限制。

## Design 摘要

- 增加共享 candidate/projector 纯函数契约；不改 API/config/storage。
- 可信 duration 仅来自显式数值或共享 resolver 能识别的规范 token/label。
- 禁止 provider 名、字段/数组/id 顺序、remaining、resetAt、resourceType、percent、`Limits/quota` 猜 duration。
- `centerLayerId=layers[0].id`；outer unknown 不借内圈。
- `:root` / `html.dark` 定义 usage semantic tokens，无新 theme React state。
- provider owner → allowlisted candidate/projection → aggregate shell 的安全边界不变。

## Implement 摘要

5 个串行子任务，`maxConcurrency=1`：

1. 公共动态窗口 candidate/projector、duration resolver 与 center contract；
2. GPT/Grok/Kiro adapter 改为实际窗口候选并删除固定排序/`Limits=90d`；
3. 聚合壳主题、大环、响应式及三家详情状态色；
4. 动态排序、only-one、mixed、unknown/tie 与 UI/安全契约测试；
5. 文档、lint/tsc/focused tests/browser 矩阵。

机器计划见 [`implement.md`](./implement.md) 的 `json ypi-implementation-plan`。

## Checks 摘要

自动门禁覆盖公共 projector permutation/provider-independence、only-7d、only-week、mixed-window、single/multi unknown、tie、负 duration 证据、center、主题/尺寸、安全 allowlist 与既有交互。人工门禁覆盖 light/dark × Desktop/640/375/320 × 动态场景/状态，并检查 hover/focus/Escape、长账号、滚动和 reduced-motion。

## 需要用户确认的决策

- [ ] 接受“adapter 只给实际无序候选，公共 projector 决定圈布局”的统一架构。
- [ ] 接受 unknown/tie 降级：单候选可单圈；多候选只显示可唯一排序窗口，其余详情；all-unknown multi 不显示 ring。
- [ ] 接受外圈/中心=最终最短可比较周期，且不按 percent 动态重排。
- [ ] 接受浮窗列头 40px（最低 38px）、trigger 30px及修订原型的 light/dark/响应式设计。

批准方式：请在后续用户消息明确回复“批准/确认/开始实现”；任何修改意见都会保持任务在审批阶段并继续修订。
