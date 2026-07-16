# PRD：聚合用量浮窗主题、动态窗口优先级与环尺寸修复

## 目标与用户价值

让聚合用量 UI 根据当前 provider/account **实际返回的窗口**自动形成单圈或多圈，而不是假设每家永远具有固定窗口。用户在任一主题和视口下都能把外圈/中心理解为当前可安全比较窗口中的最短周期，同时不会因未知周期、缺失窗口或输入顺序看到伪造的优先级。

## 范围内需求与验收标准

### FR-1 动态候选窗口

- GPT/Grok/Kiro adapter 必须从当前账号的实际 allowlisted quota 数据逐项产生窗口候选；不得为不存在的 5h、7d、week、month 或其他周期补层。
- provider adapter 只提供候选字段（id、label、percent、可信 duration/evidence、同 bucket 安全 fallback），不得决定 layer index、外/内圈或 center。
- 公共 projector 统一完成安全过滤、周期比较、layer 构造和 center 选择。
- percent 只影响该层 tone，不参与排序。

**验收：** GPT only-7d 为 7d 单圈；Grok only-week 为周单圈；同一批 mixed-window 候选无论输入顺序或 provider 均得到相同短→长布局。

### FR-2 通用短→长排序

- 最终 `layers` 语义统一为 outer→inner = 真实周期 duration 短→长。
- duration 证据只能来自上游明确数值或共享 resolver 可识别的规范 period token/label；provider 名、数组/字段位置、remaining、resetAt 距离、resourceType、percent 和泛化 `Limits/quota` 文案均不得成为 duration。
- 通用 projector 应处理分钟/小时/天/周/月/年及带数值周期（如 90m、2h、7d）；月/年只作为稳定排序 rank，不宣称精确计费毫秒。
- 同 duration 的多个不同窗口没有可靠径向先后，不得用 id 或数组位置伪造顺序。

**验收：** mixed-window 乱序输入按 duration 升序输出；`Limits` 不再等于 90d；测试中改变 provider 或候选输入顺序不改变布局。

### FR-3 unknown duration 降级

- 仅有一个安全窗口时，无需排序，可显示单圈，即使 duration 无法识别。
- 多窗口时，只有 duration 可信且 rank 唯一的窗口可以参加圈排序；unknown duration 和并列冲突窗口进入详情。
- 多窗口过滤后仅剩一个可排序窗口时显示该单圈；一个也不剩时不任意挑选，ring 为空并显示安全 fallback，所有窗口仍可在详情查看。
- UI 应用固定安全文案说明“另有窗口仅在详情展示”，不得暴露原始 payload/error。

**验收：** single unknown→单圈；known+unknown→known 单圈/多圈 + 详情提示；all unknown multi→无 ring/fallback + 详情，且重排输入不改变结果。

### FR-4 中心摘要跟随最终外圈

- `centerLayerId` 固定等于最终 `layers[0].id`；renderer 通过 id 查找，不读最后一层也不 silent fallback。
- 外圈 percent=`null` 时中心保留该窗口 label 并显示 `—`；仅允许使用同一 bucket 的安全 remaining fallback，不得借任一内圈值。
- 单圈场景中心自然跟随该实际窗口，例如 only-7d 显示 7d，only-week 显示周。
- 中心 label/value 在 light/dark 均使用高对比度前景。

**验收：** center/aria/title/tests/docs 都描述“最终外圈=最短可比较周期”；非法 center fail loud。

### FR-5 聚合浮窗跟随全局主题

- panel、header、badge、close、provider column、column header、trigger/segment hover/open/focus 与 provider detail 状态使用全局变量或 usage semantic tokens。
- 浅色主题不得保留固定夜间背景 `rgba(11,15,25,.98)` 或固定深色按钮 `#1e293b`。
- warning/danger/success 文本和 banner 在 light/dark 分别可读；切换主题不重挂 provider owner、不增加请求。

**验收：** 两种主题下 surface、文字、边框、按钮、环中心、unknown/detail-only 提示和 focus-visible 清晰。

### FR-6 浮窗环尺寸与响应式

- 顶栏 aggregate trigger 保持 30px。
- 浮窗 provider 列头环目标 40px，最低 38px，且不得被 flex 压缩。
- Desktop 1–3 列；640px 最多 2 列；375/320px 单列；panel viewport clamp、内部滚动，320px 无页面级横滚。
- 长账号文本 ellipsis；无 ring fallback 和 detail-only 提示也不能破坏列头对齐。

### FR-7 保留既有能力与安全

- provider 顺序 GPT→Grok→Kiro；每家独立 owner/projection/detail；无跨 provider 总环。
- 层身份色与 solid/dashed/dotted、逐层 warning/danger、unknown muted arc、SVG mask 流光、reduced-motion。
- hover/focus、共同 open reason、220ms grace、Escape 防重开、非 accordion 分栏。
- Refresh/Activate/Models、GPT Reset/scheduler/lock、race guard 与 aggregate/standalone 单实例轮询。
- projection 禁止 accountId、credential、profileArn、raw body/error/path。

## 范围外

- quota API/schema、账号数据、缓存 TTL、轮询、failover、配置项变更。
- 用 reset 倒计时反推窗口 duration，或根据 percent 动态重排。
- 跨 provider 计算、刷新全部、standalone hover-only 改造。

## 非功能要求

- 公共 projector 为纯函数，无 React state/fetch；相同候选集合应得到确定结果。
- 不引入持续 JS 动画或额外网络请求。
- 主题切换只走 CSS variables；SSR/hydration 结构不变。

## UI 原型与审批

实现前必须审批修订后的 HTML 原型，至少可切换：

- light / dark；
- only-7d / only-week / mixed-window / unknown-duration；
- normal / outer unknown / warning / danger；
- Desktop / 640 / 375 / 320；
- trigger 30px 与 panel 40px（实现最低 38px）对照。
