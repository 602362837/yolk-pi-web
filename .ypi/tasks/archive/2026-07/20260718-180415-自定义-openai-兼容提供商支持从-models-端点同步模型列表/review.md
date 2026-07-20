# review

**Verdict: Pass（实现门禁通过）**

检查员独立验收。自动化验证与静态审查满足 PRD / Design / Implement / Checks 的阻断项；浏览器端到端与真实远端 provider 未在本机执行，记为 UAT 残留风险，不作为实现返工 blocker。

## 检查范围

- 对照 `brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` / `ui.md` / `plan-review.md` / `handoff.md`
- 批准 HTML 原型：`models-endpoint-sync-prototype.html`
- 生产 diff：共享 store、sync core、API route、ModelsConfig UI、CSS、model-price 适配、docs、tests
- 实际重跑 checks 计划中的自动命令（不依赖 handoff 断言）

## 门禁材料

| 项 | 状态 |
| --- | --- |
| UI 设计员 HTML 原型 | 有：`models-endpoint-sync-prototype.html` |
| `ui.md` 链接与状态 | 有，指向原型并覆盖关键状态 |
| 用户审批证据 | 有：`task.json` / `events.jsonl` 记录 `awaiting_approval → implementing`，`approvedAt=2026-07-18T10:50:19.259Z`，source=`user-widget` / `approve_plan` |
| MODEL-SYNC-01…06 | 全部 done；当前阶段 `checking` |
| 未 commit / push / merge | 遵守 |
| 未直接 `next build` | 遵守 |

## Findings Fixed

None（检查过程未发现需当场修补的低风险代码缺陷）。

## Remaining Findings

### 阻断 / Blockers

None。

### 非阻断 / Residual risks

1. **浏览器 E2E / 真实远端 UAT 未跑**  
   选择性同步、快捷全量、dirty gate、stale revision 重试、375px 等已由静态代码与 mock HTTP 覆盖；本机未挂真实 custom OpenAI 端点做浏览器回归。建议主会话或用户在本地 mock/真实网关做一次冒烟。

2. **Focus trap 未完整实现**  
   预览 modal 具备 `role="dialog"`、`aria-modal`、Escape（busy 时阻止关闭）、搜索自动聚焦；未见显式 focus trap / 关闭后焦点恢复实现。可访问性缺口，不构成 PRD 安全/merge 阻断。

3. **预存 lint 噪声（与本任务无关）**  
   - `components/TrellisWorkflowVisualizer.tsx`：4 React Compiler errors（blame 2026-06-30，不在本 diff）  
   - `scripts/test-model-prices.mjs`：6 unused-var warnings（blame 2026-07-14 已存在；本任务仅把 applyPricePatch 测试改为 async 链式）

4. **UI 客户端 builtin 集合与 SDK 漂移**  
   UI 用 `PROVIDER_ICONS` keys + fixed denylist 隐藏入口；服务端以 `builtinProviders()` + fixed denylist fail-closed。未来 SDK 新增 builtin 时 UI 可能短暂显示入口，但服务端仍拒绝。可接受防御纵深。

5. **`docs/integrations/README.md`**  
   Implement 列表曾列该文件；最终 integrations 入口未专门扩写 sync 段。核心 invariants 已写入 `docs/architecture/overview.md`、`docs/modules/*`、`docs/operations/troubleshooting.md`，不阻断。

## 需求与设计对照

### 1. 资格 fail-closed

服务端 `assessModelsSyncProviderEligibility`：

- 排除 Pi `builtinProviders()` ids
- 排除 `grok-cli` / `kiro` / `google-antigravity`
- 仅 `openai-completions` / `openai-responses`
- 要求有效 `http(s)` baseUrl；缺 api / 无效 baseUrl fail closed

测试覆盖：custom accept、anthropic/google deny、missing api、builtin、fixed、invalid scheme。

UI：`isCustomDistinct` 隐藏非 custom；`ModelSyncDiscovery` 对 dirty / 非 OpenAI / 无效 baseUrl 禁用并给出原因。

### 2. SSRF / secret 边界

- Body allowlist + `MODELS_CONFIG_SYNC_FORBIDDEN_BODY_KEYS`（url/baseUrl/headers/apiKey/path/endpoint/token/secret 等）→ `invalid_request`
- 只从已保存 models.json + Web CredentialStore 取目标
- `redirect: "manual"`，同源最多 3 次，跨源 `redirect_blocked`
- 10s timeout、1MiB body、2000 models、256-byte id
- 固定 error message map；preview 响应无 endpoint/key/header/raw body
- preview cache 仅 fingerprint + remote/existing ids；sync 路径无 console 日志

测试覆盖：forbidden keys、401 不路径回退、同源/跨源 redirect、oversize、invalid JSON、auth 优先序、OAuth `unsupported_auth`。

### 3. Merge 只追加

`mergeNewModelIdsIntoModelsConfig`：

- 已有 model object 不改写
- 新项只 append `{ id }`
- 其他 provider / modelOverrides / 顶层不变
- 远端缺失本地模型不删除

测试：deep preservation、other provider 保留、no-new no-mutate、order/skip unknown。

### 4. Preview 零写 / Apply 校验 / 回滚

- preview 不写盘（测试断言）
- apply 校验 previewId + revision + providerId + fingerprint + selected ⊂ remote
- `mutateModelsJsonUnderLock`：共享写锁、revision CAS、写前 backup、atomic rename
- 写后 fresh ModelRuntime 验证失败 → backup rollback → `verification_failed`
- live reload partial 只 warning，不回滚已验证磁盘写入

三个 writer（ModelsConfig PUT、model-price PATCH、sync apply）共用 store 锁。

### 5. UI / 原型一致性

- Provider detail API 字段后同步区 +「仅新增 / 需确认」
- 二级 720px modal；counts / search / 全选新增 / 清空 / 默认全选新增 / existing disabled
- **写入所选** 与 **全部新增并写入** 均 AppPrompt 二次确认；取消零写
- dirty → 禁用 +「请先保存…」
- apply 成功后 GET reload config + revision，保持 provider 选中
- loading / empty / all-existing / error+retry / stale→重新预览 / busy 防重复 / success / 窄屏 CSS / reduced-motion

未在浏览器实机点验，但源码与原型/PRD 主路径对齐。

### 6. 文档

- `docs/modules/api.md`：sync route
- `docs/modules/library.md`：store + sync
- `docs/modules/frontend.md`：ModelsConfig sync 行为
- `docs/architecture/overview.md`：sync invariants
- `docs/operations/troubleshooting.md`：排障表

准确表达：不支持 built-in/fixed/non-OpenAI、不推断价格/能力、不任意 URL、不删除本地。

## Verification（本轮实际执行）

| 命令 | 结果 |
| --- | --- |
| `npm run test:models-config-sync` | ✅ 73 passed, 0 failed |
| `npm run test:model-prices` | ✅ 45 passed, 0 failed |
| `npm run test:web-model-runtime` | ✅ 6 passed, 0 failed |
| `node_modules/.bin/tsc --noEmit` | ✅ 零错误 |
| `git diff --check` | ✅ 无空白问题 |
| `npm run lint` | ⚠️ 4 errors + 6 warnings，全部预存且不在本任务功能文件 |

## Checker 阻断项复核

| # | 项 | 结论 |
| --- | --- | --- |
| 1 | 无 HTML 原型或用户审批 | Pass |
| 2 | API 接受任意 URL | Pass（拒绝） |
| 3 | built-in/fixed/non-OpenAI 可同步 | Pass（fail-closed） |
| 4 | existing model 被覆盖 | Pass（deep preserve） |
| 5 | 写路径不共享锁 | Pass（共享 store） |
| 6 | secret 投影 | Pass |
| 7 | 快捷写入绕过确认 | Pass |
| 8 | stale preview/revision 仍写盘 | Pass |

## Verdict

**Pass**

原因：安全边界、merge 语义、共享存储协调、确认路径、dirty gate、测试与类型检查均满足实现门禁；残留项仅为浏览器 UAT、a11y focus-trap 完善和预存 lint，不要求实现返工。

## 主会话下一步

1. 将任务自 `checking` 合法 transition 到 feature-dev 下一状态（通常 `review` / `ready` / `user_acceptance`，以工作流合法边为准）。
2. 可选：本地 mock OpenAI `/models` 做浏览器冒烟（两条确认、dirty、stale、375px）。
3. 不在本检查中 commit / push / merge。
