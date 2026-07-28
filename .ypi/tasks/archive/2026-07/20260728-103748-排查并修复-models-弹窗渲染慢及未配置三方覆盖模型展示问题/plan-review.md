# Plan Review — Models 弹窗性能、覆盖项可见性与竞态收敛

> 状态：**已批准并已实施，等待最终复检交接**。用户已明确确认“确认，开始实现”；该确认同时批准本页链接的计划材料与 [HTML 原型](./models-popup-prototype.html)，UI 方案未作未批准改版。

## 审批摘要

### PRD

- modal shell与本地`models.json`先显示，不等待provider auth catalog。
- OAuth采用**两阶段状态**：`mode=summary`零网络快速返回本地stored/managed状态；成功后后台`mode=verify`有界执行`checkAuth()`。
- provider行可见性、accountCount、Active名称以本地summary/mutation response为权威；后台verify只补同一local revision的verification。
- 仅含`modelOverrides`的raw provider节点从左树隐藏，原始数据完整保留。
- catalog失败只降级active区；models-config GET失败不能伪装空配置并允许覆盖保存。

详见：[prd.md](./prd.md) / [brief.md](./brief.md)

### UI

- 保持现有860px双栏结构。
- active provider区仅新增/保留紧凑本地加载、失败与重试状态。
- background verify慢、失败或超时时保留本地rows，不增加全屏spinner或新的常驻卡片。
- override-only未配置节点不再出现；已配置provider仍从active区出现。
- 黄色“覆盖项不会丢失”卡片仅为原型说明，不进入生产UI。

**HTML原型仍有效，无需因竞态方案改版：** [models-popup-prototype.html](./models-popup-prototype.html)

交互说明：[ui.md](./ui.md)

### Design

- 新增纯可见性helper，严格fail-visible。
- 新增local summary + revision-aware background verify；默认providers route保持兼容完整语义。
- 新增provider verification进程内短TTL cache + state-keyed single-flight + deadline/late-result non-publish。
- `getWebModelRuntime()`按`agentDir + modelsPath`实现init与offline-refresh single-flight。
- all-providers一次计数、managed summary并行。
- 前端config/catalog/detail分lane管理active lifecycle、request generation与AbortController。

详见：[design.md](./design.md)

### 竞态处理（本次补充）

1. **晚到/乱序**：每个请求捕获generation；retry、mutation、provider/account切换先递增generation并abort旧读。即使底层忽略abort，generation不匹配也不能commit。
2. **关闭/重开**：unmount先`active=false`，再generation失效、abort、clear timer、close EventSource；旧实例response不能影响新实例。
3. **后台verify覆盖新状态**：verify携带`basedOnRevision`，只merge same provider + same `localStateRevision`的verification；绝不覆盖新accountCount、Active、localConfigured、顺序或selection。
4. **账号/provider切换**：Codex/Grok/Kiro/Antigravity quota、accounts、API-key config/reveal与login SSE统一校验`lifecycle + providerId + accountId + generation`，不再只有Antigravity受保护。
5. **GET覆盖mutation**：mutation开始前使旧accounts/quota generation失效；成功POST安全投影优先，再发新generation GET收敛。
6. **重复打开/刷新**：同provider+revision共享服务端checkAuth flight并短TTL复用；一个HTTP waiter abort不取消其他waiter。
7. **checkAuth超时**：deadline只截断发布，不能保证第三方停止刷新；底层晚到结果不得写cache/旧response，下一summary读取canonical事实。
8. **runtime冷并发**：同key init/fixed-provider registration/offline refresh分别single-flight；本地summary不等待后台checkAuth。

### Implement

仍为5个子任务：

1. MOP-01 可见性纯函数与测试；
2. MOP-02 admin runtime init/offline-refresh single-flight；
3. MOP-03 local summary、revision-aware verify、server cache/flight与API聚合；
4. MOP-04 Models分lane加载、过滤、详情竞态与失败保护；
5. MOP-05 文档、性能、race matrix与跨provider回归。

MOP-01/MOP-02可并行；之后API → Frontend → Checks串行。机器可读`json ypi-implementation-plan`已更新在[implement.md](./implement.md)，但**尚未由主会话保存到任务implementationPlan**。

### Checks

硬门禁：

- summary路径零`runtime.checkAuth()` / 零provider网络 / 零legacy bootstrap write；
- 同key冷并发只初始化/注册/离线刷新一次；
- 同provider+revision真实`checkAuth()`一次，一个waiter abort不取消shared flight；
- timeout后的late result不缓存、不发布；
- S1慢/S2快、close/reopen、provider A→B、account A→B、old GET→mutation均由新状态获胜；
- hidden overrides保存不丢；config GET失败时Save禁用；
- Grok/Kiro/Antigravity/AnyRouter/OAuth/API-key回归、lint、tsc通过；
- 修改前后记录cold/warm endpoint各5次及浏览器首帧。

完整RACE-01～27矩阵见：[checks.md](./checks.md)

## 已确认方向

1. **展示口径已确认**：仅`modelOverrides`、没有其他provider配置的raw条目从Models左树隐藏，但绝不删除/修改其数据；已认证同名provider仍从active区显示。
2. **认证口径已确认并细化**：首屏先展示本地stored/Active存在；后台可验证真实状态，但不得阻塞首屏，且只能revision-aware合并。
3. **UI口径已确认**：生产UI不加入黄色解释卡片；现有HTML原型的loading/ready/error三态仍覆盖本方案。

## 正式审批证据

- [x] 用户在父会话明确确认：**“确认，开始实现”**。
- [x] 该确认覆盖 [PRD](./prd.md)、[Design](./design.md)、[Implement](./implement.md)、[Checks](./checks.md) 与 [HTML 原型](./models-popup-prototype.html)；原型链接和已批准的双栏/UI 三态均保持不变。
- [x] implementationPlan 已进入执行并推进至收尾复检（MOP-08）。
- [x] 15s verification TTL、8s provider deadline、30s late-flight retention 按本计划的内部并发预算实施；未改变用户可见 UI。

## 已有证据

实施前本机现有服务基线：

| Endpoint | 观测 |
| --- | --- |
| `/api/models-config` | 0.022s |
| `/api/auth/all-providers` | 首次0.267s，后续0.051–0.082s |
| `/api/auth/providers` | 3.044s；复测最高4.123s，warm最低约0.045s |

源码证据：现route逐provider调用`runtime.checkAuth()`；两个provider API冷并发无pending init single-flight；Models顶层fetch无generation/abort，且Codex/Grok/Kiro quota未统一采用Antigravity已有的generation/accountId模式。
