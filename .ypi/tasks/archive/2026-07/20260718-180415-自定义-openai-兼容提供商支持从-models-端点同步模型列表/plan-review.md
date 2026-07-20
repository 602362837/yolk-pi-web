# 计划审批书：自定义 OpenAI-compatible provider 同步模型列表

本文件是进入实现前的用户审批入口。PRD、技术设计、实现 DAG、检查计划与 **UI 设计员 HTML 原型** 均已就绪，请审阅后明确批准或要求修改。

## 相关材料

- 背景与固定决策：[`brief.md`](brief.md)
- PRD 与验收标准：[`prd.md`](prd.md)
- UI 设计与门禁状态：[`ui.md`](ui.md)
- **HTML 原型（请先点开）**：[`models-endpoint-sync-prototype.html`](models-endpoint-sync-prototype.html)
- 技术设计：[`design.md`](design.md)
- Implementation Plan：[`implement.md`](implement.md)
- Checks：[`checks.md`](checks.md)

## 用户已确认且方案未改口的决策

1. **预览 + 用户确认写入** 为默认路径。
2. 提供 **「全部新增并写入」快捷按钮**，但必须二次明确确认，禁止静默写盘。
3. **仅限** 已保存的 **自定义 + OpenAI 兼容** provider（`openai-completions` / `openai-responses`）。
4. 写入为 **merge 追加 model id**；保留已有 cost / 手工字段 / overrides；不删除远端缺失的本地模型。
5. 不扫任意 URL：API 只收 provider id，服务端用已保存 baseUrl + 凭据。
6. 不覆盖 built-in 目录、Grok/Kiro/Antigravity、非 OpenAI 协议。

## PRD 摘要

在 Models 配置中为合格 custom provider 增加「从端点同步模型」：

1. 用 provider 自身 Base URL 读 `/models` 或 `/v1/models`；
2. 展示可搜索、可勾选的远端预览（新增可选、已存在可见但不可重复选）；
3. 用户确认后只 merge 新 model id 到 `providers.<id>.models[]`；
4. 快捷「全部新增并写入」仍走确认与结果反馈；
5. 不覆盖价格、手工字段、compat、modelOverrides 或其他 provider。

范围外：自动删除、价格/能力推断、后台自动同步、任意 URL 请求、非 OpenAI 协议。

## UI 摘要（原型已交付）

原型：[`models-endpoint-sync-prototype.html`](models-endpoint-sync-prototype.html)

- Provider detail（API 字段后）独立区块：`从端点同步模型` + `预览远端模型` +「仅新增 / 需确认」标签。
- 二级 preview modal（约 720px）：远端/新增/已存在计数、搜索、全选新增、清空、写入所选、全部新增并写入。
- dirty draft / 未保存 provider / 无效 baseUrl / 非 OpenAI：入口禁用并说明原因；built-in/fixed：无入口。
- 两条写入路径均二次确认；成功结果在 modal 内展示后由用户关闭。
- 覆盖 loading / empty / all-existing / auth / timeout / invalid / stale revision / busy / 375px。

## Design 摘要

### 资格（服务端 fail closed）

```text
saved models.json provider
+ 非 Pi builtinProviders()
+ 非 grok-cli / kiro / google-antigravity
+ api ∈ { openai-completions, openai-responses }
+ valid http(s) baseUrl
```

### URL

- baseUrl 已以 `/v1` 结尾 → `/v1/models`
- 已以 `/models` 或 `/v1/models` 结尾 → 不重复追加
- 其他 path → 先 `/models`，仅 404/405 再试同源 `/v1/models`
- 401/403/429/5xx/timeout/invalid 2xx 不做路径回退
- redirect manual，最多 3 次且仅同 origin

### API

`POST /api/models-config/sync`

- preview：`{ action:"preview", providerId }`
- apply：`{ action:"apply", providerId, previewId, revision, modelIds }`
- 出现 URL/baseUrl/headers/apiKey/path 等额外字段 → 拒绝
- 10s timeout、1MiB body、2000 models、256-byte id
- opaque preview token（约 5 分钟）+ revision + provider fingerprint

### Merge / 存储

- existing id 永不改写；新增只 append `{ id }`
- ModelsConfig PUT、model-price PATCH、sync apply **共享** models.json write lock/revision
- 写前 backup、atomic rename、写后 ModelRuntime 验证，失败回滚

## Implement 摘要

6 项 schemaVersion 2 DAG，`maxConcurrency=2`：

| ID | 内容 |
| --- | --- |
| MODEL-SYNC-01 | 共享 models.json store、revision、wire types |
| MODEL-SYNC-02 | 资格、URL、auth、fetch、preview cache、merge |
| MODEL-SYNC-03 | preview/apply API、写后验证、runtime reload |
| MODEL-SYNC-04 | 按已批准 HTML 实现 Models UI |
| MODEL-SYNC-05 | backend tests + 模块文档（可与 04 并行） |
| MODEL-SYNC-06 | 集成验证与 checker 门禁 |

`MODEL-SYNC-04` 仅在本计划与 HTML 原型获用户批准后可 claim。

## Checks 摘要

计划自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:models-config-sync
npm run test:model-prices
npm run test:web-model-runtime
git diff --check
```

人工重点：两条确认路径、dirty draft 保护、资格拒绝、URL 拼接/404 fallback、redirect 不泄凭据、existing cost 保留、错误重试、窄屏与 a11y、无 secret 投影。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 同步覆盖价格或被旧 draft Save 覆盖 | 共享锁 + revision；UI dirty gate；apply 后 reload |
| built-in 被当 custom | builtin + fixed denylist，服务端再校验 |
| URL 拼接错误 | 纯函数 + mock HTTP 测试 |
| redirect 泄露 Authorization | manual + 同源 + 次数上限 |
| 恶意/超大响应 | timeout / 字节 / 条目 / id 限制 |
| 快捷操作静默破坏 | 必须二次确认 + 结果反馈 |

## 请你审批

- [x] UI 设计员已交付 [`models-endpoint-sync-prototype.html`](models-endpoint-sync-prototype.html)
- [x] [`ui.md`](ui.md) 已链接原型并记录状态
- [ ] **请你批准** HTML 原型与本计划，以便进入 implementing
- [ ] 或说明需要修改的点，我将重新规划/改原型

**当前状态：`awaiting_approval` — 等待你确认方案与原型；批准前不会实现。**

回复示例：

- `批准` / `确认，开始实现`
- `需要修改：……`
