# 计划审批书 — Chat 模型与 Settings 加载缓慢

## 审批状态

**待主会话 / 用户审批，尚未进入实现。** 本任务未改生产代码。

## 根因摘要

1. `GET /api/models` 每次创建全新 provider-aware runtime，绕过项目已有 admin runtime cache/single-flight。
2. SDK fixed provider按顺序加载；每次 `registerProvider()` 还启动 detached refresh。availability每轮重复逐provider认证读取，而 WebCredentialStore把同一 `auth.json` 的所有read串行排队。
3. AnyRouter fixed factory在每次目录请求中做global bridge reconcile，并无条件重写bridge/auth；实测一次 `/api/models` 前后 `auth.json` 大小不变但mtime改变。
4. Chat在`defaultModel`从未知变specific时重复fetch；Settings初始yolk及多个view切换也重复fetch；两者无共享flight。
5. 当前 `/api/web-config` warm为约3ms，不能把Settings壳层慢直接归因于它；需确认用户所说Settings究竟是整页还是模型控件。

详见 [brief.md](./brief.md)。

## PRD 摘要

- `/api/models` 成为离线、共享、纯读catalog；wire shape不变。
- 同epoch server/client各只有一个flight；成功mutation显式失效。
- 目录GET不得写auth/AnyRouter bridge，不得发provider网络。
- warm p95≤500ms、isolated cold≤3s、8并发不线性放大。
- inference/Studio runtime隔离、认证锁与原子写语义不变。

详见 [prd.md](./prd.md)。

## Design 摘要

- 新增server `model-catalog-service`：offline admin runtime、available snapshot、epoch/single-flight、短burst cache。
- `/api/models` 不再创建session services，不再调用额外`getAvailable()`。
- AnyRouter target runtime注册与global mirror repair分离，并做fingerprint/no-op。
- 新增client共享catalog resource供Chat与Settings订阅。
- 先instrumentation；只有前述修复后仍超标才考虑通用WebCredentialStore parsed snapshot优化。

详见 [design.md](./design.md)。

## Implementation 摘要

计划7项：证据基线 → server catalog与AnyRouter并行收敛 → client共享resource与mutation失效 → 条件性credential优化 → 全量检查。机器可读DAG见 [implement.md](./implement.md)。

## Checks 摘要

覆盖cold/warm/8并发、Chat+Settings请求数、GET文件纯读、mutation竞态、AnyRouter Active、无provider网络、pending归零、provider/account回归、lint/tsc。

详见 [checks.md](./checks.md)。

## UI 门禁

P0保持现有视觉/信息结构，**不触发UI原型门禁**。如果希望增加超时、Retry、降级banner或skeleton，必须先请求ui-designer输出HTML原型并由用户审批；当前无HTML。详见 [ui.md](./ui.md)。

## 需要审批的决策

1. 是否批准P0按“纯内部性能修复、无UI变化”实施？
2. 是否同意 AnyRouter catalog GET停止隐式repair写，改为server cold bootstrap/显式mutation repair + safe degrade？
3. 是否确认 WebCredentialStore通用缓存仅作为测量后条件项，不默认实施？
4. 请确认“Settings慢”指：A. 整个`正在加载设置…`；B. 默认模型/模型策略控件；C. 左下角Models弹窗。若为A，需要补现场HAR后再扩范围。

批准后建议主会话保存 implementationPlan，并把任务切换到 `awaiting_approval -> implementing`；未批准前不得实现。
