# 计划审批书：Grok 用量小组件与开关

## 审批结论请求

请审阅并决定是否批准本计划与 HTML 原型。**批准前任务不会进入实现；批准后再由主会话指派实现员。**

## 本轮修订：用户可见文案中文化

根据用户反馈，已将规划和 HTML 原型中的用户可见标签、按钮、状态、错误提示与说明统一为中文；Grok、GPT、Settings、Models、Active、quota、cache、OAuth、API 等专业术语保留。技术方案、范围、实施 DAG、默认值和验收标准均未改变。

请以本次修订后的 [PRD](./prd.md)、[UI 说明](./ui.md)、[Design](./design.md)、[Implement](./implement.md)、[Checks](./checks.md) 与 [HTML 原型](./grok-usage-panel-prototype.html) 为审批依据。

## 目标与范围

为 `grok-cli` 增加类似 GPT 的顶部用量入口，并在 Settings → Grok 增加独立开关。方案只复用现有 Grok OAuth accounts、Activate 和 quota API，不修改 billing、缓存、OAuth、推理或 failover 协议。

详细需求：[PRD](./prd.md) · 调研摘要：[Brief](./brief.md)

## 推荐产品决策

1. `grok.usagePanelEnabled` **默认关闭**，与 GPT 一致，避免升级后自动占位/请求。
2. 顶部顺序：会话统计 → GPT（若开启）→ Grok（若开启）→ 右侧抽屉按钮。
3. 收起态展示中文状态与“月/周”使用率；展开态展示 Active、月/周额度、cache 状态、刷新和已保存账号快速“设为 Active”。
4. v1 不批量查询所有账号 quota；完整 quota 始终对应当前全局 Active。
5. 页面可见时每 30 秒轻量重验证，不带 `refresh=1`；手动刷新和切号后才强制刷新。隐藏页面不轮询。
6. 不加入 GPT 专属 reset credits、warmup、后台 scheduler 或 lock repair。

## UI 审批门禁

本任务涉及顶部可见信息、展开交互和设置开关，已派发 UI 设计员并要求 HTML 原型。

- [UI 说明与状态表](./ui.md)
- [可交互 HTML 原型](./grok-usage-panel-prototype.html)

请重点审批：双组件顺序、收起态 `状态 + 月/周百分比`、Settings 默认关闭、“缓存过期/需重新登录/错误”的中文表达、展开面板快速切换全局 Active 的交互。

## 技术设计摘要

- `lib/pi-web-config.ts`：为 `PiWebGrokConfig` 增加默认关闭的布尔字段，兼容旧配置并严格校验。
- `components/SettingsConfig.tsx`：Settings → Grok 新增 `ToggleField`。
- 从 `ModelsConfig.tsx` 抽取共享 `GrokQuotaView`，供 Models 和新 `GrokUsagePanel` 复用；不复制月/周及内部 `stale/reauth` 状态映射。
- `GrokUsagePanel` 独立管理 accounts/quota/Activate 生命周期，直接消费 `GrokQuotaResultV1`，不把 Grok 强转为 GPT schema。
- `AppShell` 只渲染一个 usage host，同时承载 GPT/Grok，右侧安全留白只计算一次。
- 不新增 API；非 2xx quota 响应仍解析安全投影，错误按固定 code 映射，不展示 secret/原始上游内容。

完整设计：[Design](./design.md)

## 实施计划摘要

| 顺序 | 子任务 | 依赖 |
| ---: | --- | --- |
| 1（可并行） | GROK-USAGE-01 配置与 Settings | — |
| 1（可并行） | GROK-USAGE-02 共享 quota view 与 GrokUsagePanel | — |
| 2 | GROK-USAGE-03 AppShell 顶部共同布局 | 01, 02 |
| 3 | GROK-USAGE-04 测试、文档和浏览器验收 | 03 |

机器可读 DAG、文件和验收条件：[Implement](./implement.md)

## 检查与验收

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-quota
npm run test:grok-accounts
npm run test:grok-global-auth
```

人工验收覆盖：四种 GPT/Grok 开关组合、加载中/实时/缓存新鲜/缓存过期/无账号/需重新登录/错误、刷新/切号并发、320–640px 窄屏、键盘/焦点、Models 共享 quota view 回归、安全字段边界。

完整清单：[Checks](./checks.md)

## 风险与回滚

- 主要风险：双组件留白叠加、轮询绕开服务端 cache、切号后旧响应覆盖新 Active、抽取 Models quota view 回归。
- 缓解：单一 usage host、自动请求不强刷、Abort/request generation、独立 Models 回归。
- 紧急止血：将 `grok.usagePanelEnabled=false` 即可卸载组件并停止浏览器轮询，不影响 Grok 账号、quota cache 或推理。

## 请确认

若同意以上六项推荐产品决策、用户可见文案中文化、技术边界、实施 DAG、检查清单和修订后的 HTML 原型，请明确回复批准；否则请指出需要修改的决策、中文文案或原型状态。批准前保持 `awaiting_approval`，不得进入 `implementing`。
