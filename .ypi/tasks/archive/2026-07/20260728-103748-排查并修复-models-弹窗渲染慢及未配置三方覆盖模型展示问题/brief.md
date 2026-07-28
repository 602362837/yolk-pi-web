# Brief — Models 弹窗性能与覆盖项可见性

## 任务目标

排查左下角 **Models** 弹窗打开后内容迟滞的原因，并修复 `models.json` 中仅用于第三方/内置模型覆盖、但提供商本身未配置时仍污染左侧模型树的问题；本阶段只做规划，不改生产代码。

## 已确认现状

### 入口与渲染路径

- `components/AppShell.tsx:1375`：左下角 Models 按钮仅设置 `modelsConfigOpen=true`。
- `components/AppShell.tsx:2198`：打开时才挂载 `ModelsConfig`。
- `components/ModelsConfig.tsx:5694-5730`：挂载后并发请求：
  1. `GET /api/models-config`；
  2. `GET /api/auth/providers`；
  3. `GET /api/auth/all-providers`。
- `components/ModelsConfig.tsx:6158`：左侧 `models.json` 树无条件遍历全部 `providers`，模型子项只读取 `provider.models`，完全不读取 `modelOverrides`。

### 性能证据（本机现有 30141 服务，2026-07-28）

| 请求 | 观测耗时 |
| --- | --- |
| `/api/models-config` | 0.022s，约 9KB |
| `/api/auth/all-providers` | 首次 0.267s；后续约 0.051–0.082s |
| `/api/auth/providers` | 3.044s；连续复测出现 4.123s / 0.400s / 0.045–0.056s |

结论：现有数据规模下，主要迟滞来自 OAuth provider summary 路径而不是 `models.json` 或当前 DOM 数量。`app/api/auth/providers/route.ts` 对每个 OAuth provider 执行 `runtime.checkAuth()`，该语义可能刷新/验证认证；Models 首屏只需要本地配置状态，却承担了潜在网络/刷新成本。

### 冷启动放大因素

- `/api/auth/providers` 与 `/api/auth/all-providers` 同时调用 `getWebModelRuntime()`。
- `lib/web-model-runtime.ts` 的管理 runtime 只有“完成后缓存”，没有按 cache key 的初始化 Promise；冷并发请求可能各自创建 runtime、注册固定 provider、执行 bridge reconcile/refresh。
- `app/api/auth/all-providers/route.ts` 对 managed provider summary 在循环内逐个 `await`，并对每个 provider 用 `all.filter()` 重算 model count；当前只有 36 个 provider，尚非主因，但可顺手消除串行与 O(P×M)。

## 覆盖项展示问题的可复现形态

当前本机 `models.json` 有 20 个 provider；其中 google、huggingface、nvidia、openrouter、vercel-ai-gateway、zai 等多个条目没有 `models` / Base URL / API Key，仅含 `modelOverrides`。这些通常由模型价格或手工覆盖功能写入。

当前行为：

- 左树显示这些 provider 名称；
- 因 UI 只读取 `models[]`，provider 下没有任何模型；
- 未配置认证时它们也不是可操作的 active provider；
- `google-antigravity` 等已认证 provider 还可能同时出现 OAuth 行与 raw config 行，形成重复。

推荐口径：

1. **raw config 行**仅隐藏“除 `modelOverrides` 外没有任何配置字段”的 provider；未知字段存在时不隐藏（fail-safe）。
2. 隐藏只影响导航投影，不删除、不重写 `modelOverrides`。
3. provider 如果已认证/已有 managed account，继续通过 OAuth/API Key 的 active 行显示；不再额外显示 override-only raw config 重复行。
4. 包含 `models[]`、Base URL、API、API Key、headers、compat 或其他未知配置字段的 provider 继续显示。

## 性能假设与优先级

| 假设 | 证据 | 优先级 |
| --- | --- | --- |
| `runtime.checkAuth()` 使 summary 请求进入刷新/网络路径 | `/api/auth/providers` 45ms–4.1s 波动；源码明确调用 checkAuth | P0 |
| 两个 runtime API 冷并发重复初始化固定 providers | cache 无 single-flight；前端并发两个请求 | P0 |
| 左树将 override-only provider 当可操作配置渲染 | 源码无条件遍历；本机数据有大量纯覆盖条目 | P0 |
| 全量模型行 DOM 导致当前迟滞 | 当前仅约 20 provider / 17 custom model 行，不支持该结论 | 暂不做虚拟化 |
| 6313 行组件/图标 import 导致“点击后”慢 | `ModelsConfig` 被 AppShell 静态 import，模块成本主要发生在页面加载而非点击后 | 暂不拆包 |

## 约束

- 不改变 `models.json` 存储格式、revision/CAS、原子写和备份语义。
- 不读取或暴露 key/token/raw credential。
- 不把认证有效性验证伪装成首屏本地状态；进入具体 provider 后仍由账号/额度接口验证。
- 不破坏 Grok/Kiro/Antigravity/AnyRouter 固定 provider 注册与 managed account 语义。
- 本任务触发 UI 门禁；原型见 [models-popup-prototype.html](./models-popup-prototype.html)，需用户审批后才能实现。

## 待审批决策

1. 是否接受“**仅 `modelOverrides` 的未配置 provider 从 Models 左树隐藏，但原始数据保留**”作为展示口径。
2. 是否接受 Models provider summary 改为**本地 stored/account 状态**，不在列表请求中主动 `checkAuth()`；真实可用性在进入详情/调用额度时验证。
