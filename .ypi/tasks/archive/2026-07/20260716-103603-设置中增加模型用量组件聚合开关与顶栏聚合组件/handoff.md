# Handoff：实现员 → 主会话（USAGE-AGG-07 完成）

## Subtask

- **ID**: `USAGE-AGG-07`
- **Title**: 完成文档、全量验证与 UI v6 验收
- **Status**: **done**（文档 + 自动验证收口完成；浏览器人工矩阵因环境限制部分未手测，见下）

## 已完成

### 文档（v6 口径，无 accordion / Grok 中心月 / Kiro 默认 single / 总环 / 新 quota API）

| File | 变更摘要 |
| --- | --- |
| `docs/architecture/overview.md` | 顶栏用量改为 N-ring + optional aggregate：外长内短、中心最内层、层 identity/tone、used-arc flow/reduced-motion、`providerPanelsAggregated` 默认 false、互斥挂载、Kiro 统一 1/N |
| `docs/modules/frontend.md` | AppShell 互斥；新增 `ProviderUsagePanelContract` / `ProviderUsageAggregatePanel`；Trigger/GPT/Grok/Kiro/Settings 描述对齐 v6 |
| `docs/modules/api.md` | `web-config` 增加 `usage.providerPanelsAggregated`；明确无新 provider quota routes |
| `docs/modules/library.md` | `pi-web-config` Usage 布尔字段与 partial merge 语义 |
| `docs/integrations/README.md` | Grok/Kiro 顶栏 N-ring、aggregate、中心周、止血 `providerPanelsAggregated=false` |
| `docs/operations/troubleshooting.md` | Aggregate stop-bleed、Compact 保值、双轮询排查、hover/focus 220ms / Escape |

### 测试契约小修

| File | 变更摘要 |
| --- | --- |
| `scripts/test-chatgpt-usage-panel.mjs` | AppShell 断言从已删除的 `ChatGptUsagePanelHost` + 内联 `setModelsConfigOpen` 改为 `openModelsFromProviderUsage` 互斥接线 |

## 自动验证

| Command | Result |
| --- | --- |
| `npm run lint` | **pass**（0 errors；既有 unrelated warnings + `KiroUsagePanel` unused import warning） |
| `node_modules/.bin/tsc --noEmit` | **pass** |
| `npm run test:provider-usage-aggregate` | **pass** |
| `npm run test:provider-usage-compact` | **pass** |
| `npm run test:kiro-config` | **pass** |
| `npm run test:chatgpt-usage-panel` | **pass**（修断言后） |
| `npm run test:grok-usage-panel` | **pass** |
| `npm run test:grok-quota` | **pass**（48） |
| `npm run test:grok-accounts` | **pass**（70） |
| `npm run test:kiro-quota` | **pass**（37） |
| `npm run test:kiro-accounts` | **pass**（28） |
| `npm run test:kiro-refresh-activate-race` | **pass**（4） |
| `next build` | **未运行**（按规范） |

自动测试已覆盖：配置默认 false、互斥挂载、GPT 外周内5h 中心5h、Grok 外月内周中心周、Kiro 1/N、innermost unknown、层 identity/tone/flow/reduced-motion CSS hooks、hover/focus grace、Escape suppression、非 accordion columns、projection 安全 allowlist、Compact ring-first。

## 浏览器 / UI v6 验收说明

- 主会话验收调试端口：**http://localhost:30142**（package.json 默认仍为 30141，未改）。
- 本实现员环境探测：`30142` 进程在听但根路径返回 **HTTP 500**；`30141` 返回 200（可能是另一进程/旧实例）。**未能在 30142 完成完整键鼠/窄屏/Network 人工矩阵。**
- 请主会话或检查员在 **30142 可用** 后按 `checks.md` §10–11 补做：
  1. Desktop Full/Compact/Aggregate：1/2/N rings、层色/stroke、独立 tone、innermost center/unknown、used-arc flow + reduced-motion。
  2. Aggregate：hover/focus 打开、trigger→panel 220ms grace、Tab 进列、Escape 不重开、非 accordion 三列。
  3. 640 / 375 / 320 分栏响应式，不隐藏 provider。
  4. Network：aggregate on/off 每 provider accounts/quota **不翻倍**。
  5. DOM/tooltip/projection 无 accountId / credential / profileArn / raw body/path。

## 止血

- Settings → Usage 关闭 **模型用量组件聚合**，或 `pi-web.json`：`usage.providerPanelsAggregated=false`。
- Compact 偏好、credentials、quota cache **不删除**。

## 剩余风险（给检查员）

1. **浏览器人工矩阵未在 30142 实跑** — 源码/契约测试通过，视觉/hover/Network 需实机确认。
2. `components/KiroUsagePanel.tsx` 仍有 lint unused `KIRO_EXTRA_WINDOWS_DETAIL_NOTE`（非本子任务范围；可顺手清）。
3. 真实 3+ 层 Kiro 窗口与真实多账号状态矩阵依赖现场账号，自动化只覆盖源码投影契约。
4. 30142 当前 500 需主会话确认调试服是否指向本 worktree / 是否热更新失败。

## 主会话下一步

1. 将 `USAGE-AGG-07` 标 **done**，implementationProgress 7/7。
2. 派发 **checker** 做最终 review（重点：30142 浏览器矩阵 + Network + docs 无 v5 残留声明）。
3. 若 30142 异常，先修调试服再人工验收；不要默认改 package.json 端口。
4. 不 commit / push / merge（实现员边界）。

## 决策请求

- 无产品决策阻塞。
- 仅需主会话确认 30142 验收环境与 checker 接手。
