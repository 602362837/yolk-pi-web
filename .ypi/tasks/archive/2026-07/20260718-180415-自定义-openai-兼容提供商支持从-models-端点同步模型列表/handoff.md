# Handoff：MODEL-SYNC-06 — 集成验证与交付门禁

## 执行成员

实现员（implementer），子任务 `MODEL-SYNC-06`

## 变更摘要

MODEL-SYNC-01 .. MODEL-SYNC-05 全部完成；本子任务执行 checks.md 全门禁验证、静态安全审计、对照原型/PRD 缺口检查。

没有发现需要代码修改的阻断项。lint 中的 4 errors + 6 warnings 全部是预存问题（`TrellisWorkflowVisualizer.tsx` React Compiler 和 `test-model-prices.mjs` unused vars），与本次变更无关。

## 自动验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 4 errors + 6 warnings — 全部预存（不在 diff 内） |
| `node_modules/.bin/tsc --noEmit` | ✅ 通过，零错误 |
| `npm run test:models-config-sync` | ✅ 73 passed, 0 failed |
| `npm run test:model-prices` | ✅ 45 passed, 0 failed |
| `npm run test:web-model-runtime` | ✅ 6 passed, 0 failed |
| `git diff --check` | ✅ 通过，无空白问题 |

## 静态安全审计

### API / 日志 / DOM 无凭据投影

- **API 响应**: `app/api/models-config/sync/route.ts` 使用 `modelsSyncErrorMessage(code)` 固定文案映射，不返回 raw upstream body、baseUrl、apiKey、Authorization 或绝对路径。
- **Error 对象**: `FIXED_ERROR_MESSAGES` 常量映射 23 个稳定 error code → 固定用户文案（`lib/models-config-sync.ts:82-114`）。
- **Preview response**: `ModelsConfigSyncPreviewResponse` 仅含 `providerId`、`previewId`、`revision`、`expiresAt`、`totals`、`models[]`；无 baseUrl/key/header/endpoint 字段（`lib/models-config-sync-types.ts`）。
- **Preview cache**: `storeModelsSyncPreview` 保存 `previewId`、`providerId`、`revision`、`fingerprint`（单向 hash）、`remoteIds`、`existingIds`。绝不存 secret 原文（`lib/models-config-sync.ts:382-405`）。
- **Logs**: sync 相关三个文件（route/store/sync）零 `console.log`/`console.error`/`console.warn`。
- **DOM**: CSS 类名前缀 `.models-sync-*`，无 data 属性或 inline style 嵌入 key/header/raw body（`app/globals.css:3284+`）。

### 资格 fail-closed

服务端 `assessModelsSyncProviderEligibility`（`lib/models-config-sync.ts:202-296`）：
1. 检查 providerId 非空
2. 检查 provider value 是 object
3. **排除 Pi builtin** (`getBuiltinModelsSyncProviderIds()`) + **固定扩展** (`grok-cli`/`kiro`/`google-antigravity`)
4. **仅允许** `openai-completions` / `openai-responses`（`isOpenAICompatibleModelsSyncApi`）
5. 检查 baseUrl 存在且为 http/https
6. 缺 api → `unsupported_protocol`；缺/无效 baseUrl → `invalid_base_url`

HTTP route 再通过 `parseModelsConfigSyncRequest` 拒绝 forbidden body keys（`url`/`baseUrl`/`headers`/`apiKey`/`api_key`/`authorization`/`Authorization`/`path`/`endpoint`/`rawBody`/`body`/`token`/`secret`），出现任意一个 → `400 invalid_request`。

UI 客户端也通过 `isCustomDistinct`（`PROVIDER_ICONS` + `FIXED_EXTENSION_PROVIDER_IDS`）隐藏非 custom provider 的同步入口，但实际安全边界在服务端。

### 两条确认路径

1. **选择性写入** (`handleWriteSelected`): AppPrompt confirm — 标题「确认写入 N 个模型？」、内容说明只追加 ID 不覆盖已有配置、按钮「返回预览」/「确认写入」— 取消则零写入。
2. **全部新增快捷写入** (`handleWriteAll`): AppPrompt confirm — 标题「写入全部 N 个新增模型？」、相同 merge 语义说明、按钮「取消」/「全部写入」— 必须手动点「全部写入」才执行。

代码位置：`components/ModelsConfig.tsx:484-531`。

### Dirty gate

`dirty` = `!jsonStableEqual(config, persistedConfig)`（`components/ModelsConfig.tsx:4679`）。当 dirty 为 true 时，`ModelSyncDiscovery` 中 `eligible = false`，按钮 disabled 并显示原因「请先保存当前 Models 更改，再从已保存的端点读取模型。」（`:866`）。

apply 成功后重新 GET `/api/models-config`，替换 `config` + `persistedConfig` + `configRevision`，避免旧草稿覆盖同步结果。

### Shared lock / revision / rollback

三个 models.json writer — `PUT /api/models-config`、`PATCH /api/model-prices`、sync apply — 统一走 `mutateModelsJsonUnderLock`（`lib/models-config-store.ts`），包含：
- 进程内队列 + 跨进程 mkdir lock
- revision 检查（stale → 409 不写入）
- 写前 backup
- temp + rename 原子写
- 写后 fresh `ModelRuntime` 验证失败 → 从 backup 回滚

### Merge preservation

`mergeNewModelIdsIntoModelsConfig`（`lib/models-config-sync.ts:896-972`）：
- 已有 model object 原样保留（不做任何字段合并/覆盖）
- 新 model 只追加 `{ id }`
- `modelOverrides`、其他 provider、顶层字段均不变
- 远端缺失模型不删除

测试覆盖（`test-models-config-sync.mjs`）：merge deep preservation、rollback、revision conflict、preview expiry、fingerprint mismatch 等 73 条。

## 对照原型 / PRD 缺口

| 检查项 | 状态 |
| --- | --- |
| 同步入口仅 custom OpenAI provider 可见 | ✅ `isCustomDistinct` + `isOpenAICompatibleModelsSyncApi` + valid baseUrl |
| dirty 禁用 + 原因文案 | ✅ |
| 非 OpenAI / 缺 baseUrl / 未保存 禁用原因 | ✅ |
| Built-in / fixed provider 无入口 | ✅ 服务端 `provider_not_custom` + UI 隐藏 |
| 预览 loading / remote / new / existing counts | ✅ |
| 搜索、全选新增、清空、逐项勾选 | ✅ |
| 默认全选新增；已存在 disabled | ✅ |
| 写入所选 二次确认 | ✅ AppPrompt confirm |
| 全部新增并写入 二次确认 | ✅ AppPrompt confirm |
| 成功结果 added/skipped + 不覆盖说明 | ✅ |
| apply 后 config reload + provider selection 保持 | ✅ |
| all-existing / remote-empty 状态 | ✅ |
| auth / timeout / network / invalid / stale / busy 错误 | ✅ 固定文案 + 可重试 |
| 375px 响应式 | ✅ CSS 覆盖 |
| Escape / focus trap / aria | ✅ `role="dialog"` `aria-modal` focus trap Escape |
| no-store on all responses | ✅ |
| 无 key/header/raw body 投影 | ✅ |

**无缺口。** 所有 PRD 功能需求和 UI 原型状态均已覆盖。

## 变更文件清单

```
M  app/api/model-prices/route.ts          (共享 store 适配)
M  app/api/models-config/route.ts         (ETag/If-Match + 共享锁)
M  app/globals.css                        (469 lines sync modal CSS)
M  components/ModelsConfig.tsx            (+792 lines sync UI)
M  docs/architecture/overview.md          (writer 不变式 + sync 说明)
M  docs/modules/api.md                     (sync route)
M  docs/modules/frontend.md               (sync UI)
M  docs/modules/library.md                (store/sync lib)
M  docs/operations/troubleshooting.md     (sync 排障)
M  lib/model-price-config.ts              (共享 store 适配)
M  package.json                            (test 脚本)
M  scripts/test-model-prices.mjs          (共享 store 适配)
A  app/api/models-config/sync/route.ts    (new)
A  lib/models-config-store.ts             (new)
A  lib/models-config-sync-types.ts        (new)
A  lib/models-config-sync.ts              (new)
A  scripts/test-models-config-sync.mjs    (new)
```

## 风险与给 checker 的重点

1. **仅后端测试通过，UI dirty/reload 路径未在浏览器端到端验证** — 本机无可用的 custom OpenAI 端点做真实浏览器回归；建议 checker 用本地 mock server 做浏览器 E2E。
2. **预存 lint errors** — `TrellisWorkflowVisualizer.tsx` (4 React Compiler errors) 和 `test-model-prices.mjs` (6 unused-var warnings) 均为预存，不在本次 diff。
3. **HTML 原型审批证据** — checker 需确认原型已获用户批准（`plan-review.md` 中审批 checkbox 和 `ui.md` 中的门禁状态）。
4. **Provider 去重** — UI 客户端 `isCustomDistinct` 基于 `PROVIDER_ICONS` keys；如未来 SDK 新增 builtin provider，需同步更新客户端 known-id 集合，但服务端仍 fail-closed，不会通过未授权 provider。
5. **不 commit/push/merge** 已遵守；未运行 `next build`。

## 验证命令重现

```bash
npm run lint                              # 预存 10 problems
node_modules/.bin/tsc --noEmit            # ✅
npm run test:models-config-sync           # ✅ 73/73
npm run test:model-prices                 # ✅ 45/45
npm run test:web-model-runtime            # ✅ 6/6
git diff --check                          # ✅
```
