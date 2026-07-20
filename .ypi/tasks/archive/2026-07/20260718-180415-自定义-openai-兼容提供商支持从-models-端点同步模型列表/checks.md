# Checks：自定义 OpenAI-compatible 模型同步

## 门禁检查

- [ ] UI 设计员已真实派发并读取现有 `ModelsConfig` 设计语言。
- [ ] 任务目录存在 UI 设计员交付的自包含 HTML 原型。
- [ ] `ui.md` 链接该 HTML 原型并记录关键状态。
- [ ] 用户在 `plan-review.md` 审批方案和原型。
- [ ] 审批前任务未进入 implementing，任何实现子任务未被 claim。

> 当前上述 UI 门禁未完成；本文件是实施后的检查计划，不代表已通过。

## 需求覆盖检查

### Provider 范围

- [ ] custom + provider-level `openai-completions` 可同步。
- [ ] custom + provider-level `openai-responses` 可同步。
- [ ] `anthropic-messages` / `google-generative-ai` 不可执行同步。
- [ ] Pi built-in provider 即使在 models.json 有 baseUrl/models/modelOverrides 也不可同步。
- [ ] `grok-cli`、`kiro`、`google-antigravity` 不可同步。
- [ ] 缺失/无效 baseUrl、缺失显式 provider API、未保存 provider 均清晰禁用。
- [ ] Models 全局 dirty 时必须先保存，不能启动同步。

### 预览与交互

- [ ] 点击同步先预览，不直接写文件。
- [ ] 预览显示 remote/new/existing 数量。
- [ ] 搜索按模型 id 工作，长 id 不破坏布局。
- [ ] 新增项可勾选，已存在项不可重复选择。
- [ ] 默认全选新增；支持清空/重新全选。
- [ ] 0 个新增时显示 all-existing 状态，无写入按钮误导。
- [ ] “写入所选”明确确认数量和 merge 语义。
- [ ] “全部新增并写入”仍有确认，不静默写入。
- [ ] cancel、Escape 或关闭预览均零写入。
- [ ] 成功反馈显示新增/跳过数量并刷新左侧模型树。
- [ ] timeout/network/认证/冲突错误提供重试或重新预览。

### Merge 正确性

- [ ] 现有模型对象 deep-equal 保留，包括 cost、api、reasoning、thinkingLevelMap、input、contextWindow、maxTokens、compat 和未知字段。
- [ ] `modelOverrides` deep-equal 保留。
- [ ] provider 的 baseUrl/apiKey/headers/compat/未知字段保留。
- [ ] 其他 provider 和顶层未知字段保留。
- [ ] 新项仅为 `{ id }`，不猜测价格/能力。
- [ ] 新项按远端首次出现顺序追加。
- [ ] 远端重复 id 去重，本地 existing id skip。
- [ ] 远端缺失的本地模型不删除。
- [ ] revision 冲突、preview mismatch/expired 零写入。
- [ ] 写后 ModelRuntime 验证失败恢复 pre-write backup。

## URL 与协议检查

| baseUrl | 预期请求 |
| --- | --- |
| `https://host` | `/models`，仅 404/405 后 `/v1/models` |
| `https://host/` | 同上 |
| `https://host/v1` | `/v1/models` |
| `https://host/v1/` | `/v1/models` |
| `https://host/api` | `/api/models`，仅 404/405 后 `/api/v1/models` |
| `https://host/models` | 原 URL |
| `https://host/v1/models` | 原 URL |

- [ ] query/hash 不进入请求。
- [ ] 401/403 不尝试备用 path。
- [ ] 429/5xx/timeout/network/invalid 2xx payload 不尝试备用 path。
- [ ] redirect manual；同源最多 3 次；跨源拒绝。
- [ ] 请求 body 无 URL/path override 能力。

## 安全与隐私检查

- [ ] preview/apply body 严格 allowlist；`url/baseUrl/headers/apiKey/path` 等额外字段被拒绝。
- [ ] 只从 `getAgentDir()/models.json` 和 Web CredentialStore 读取目标。
- [ ] API response 不含 key、Authorization、自定义 header、完整 baseUrl、raw body、绝对路径。
- [ ] 服务端错误/log 不打印 request headers、credential、provider 原始对象或 upstream body。
- [ ] preview cache 不保存 secret 原文，仅保存 fingerprint 和安全模型 id。
- [ ] fixture key 不出现在测试 stdout/stderr。
- [ ] OAuth credential 不被当作 generic custom bearer token。
- [ ] hop-by-hop/自动管理 header 不发送。
- [ ] 响应 size、模型数、id 长度、timeout 均有固定上限。
- [ ] `Cache-Control: no-store` 覆盖 preview、apply 和错误响应。

## 并发与存储检查

- [ ] ModelsConfig PUT、model-price PATCH、sync apply 共用 models.json 写锁。
- [ ] 进程内并发和跨进程 lock 均有测试。
- [ ] stale revision 返回 409，不 last-write-wins。
- [ ] malformed models.json fail closed，不写 `{ providers: {} }`。
- [ ] temp 与 target 同目录，rename 原子；最佳努力 0600。
- [ ] backup 在写前产生；rollback 不留下半写文件。
- [ ] apply 成功后 ModelsConfig 重新读取 config + ETag，旧 draft 不可再次覆盖。

## 自动验证

计划新增：

```bash
npm run test:models-config-sync
```

该测试应使用临时 agent dir + 本地 mock HTTP server，覆盖：

1. custom/builtin/fixed/protocol eligibility；
2. URL candidate 纯函数；
3. `/models` 404 → `/v1/models`；
4. 401/403、429、5xx、timeout、network；
5. same-origin/cross-origin redirect；
6. invalid JSON/schema、oversize、too many、invalid id；
7. auth.json key 优先和 models.json fallback/header 解析；
8. preview TTL/mismatch/subset；
9. merge deep preservation；
10. revision conflict、atomic rollback、shared writer lock。

完整命令：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:models-config-sync
npm run test:model-prices
npm run test:web-model-runtime
git diff --check
```

禁止直接运行 `next build`。

## 人工验收矩阵

### 浏览器尺寸

- [ ] 桌面 860px Models modal。
- [ ] 640px。
- [ ] 375px。

### 状态

- [ ] 默认可同步。
- [ ] dirty disabled。
- [ ] unsupported API disabled。
- [ ] missing baseUrl/credential disabled/error。
- [ ] loading。
- [ ] remote empty。
- [ ] all existing。
- [ ] mixed new/existing。
- [ ] long list + search。
- [ ] preview error + retry。
- [ ] apply busy 防重复提交。
- [ ] success。
- [ ] stale revision → 重新预览。

### 键盘与可访问性

- [ ] 入口可 Tab/Enter/Space 激活。
- [ ] modal 有 `role="dialog"`、可感知标题、focus trap 和 focus restore。
- [ ] Escape 关闭非 busy modal；busy 时有明确策略。
- [ ] checkbox 有关联 label；状态不只靠颜色。
- [ ] error 使用可感知 alert/status；结果反馈可被辅助技术读取。
- [ ] reduced-motion 下无必要动画。

## 回归风险

- [ ] 手工 Add provider / Add model / Rename / Delete / Save 无回归。
- [ ] `POST /api/models-config/test` 单模型测试无回归。
- [ ] Model Prices 的 list/patch/suggest 无回归。
- [ ] `/api/models` 和 Chat model selector 可看到新增项。
- [ ] Grok/Kiro/Antigravity Models 账号和 quota 区域无变化。
- [ ] OAuth/API-key provider picker 不出现同步入口。
- [ ] `settings.json` 默认模型不变，当前 Session 模型不被切换。
- [ ] 未生成 `.next` release build 污染，未 commit/push/merge。

## Checker 重点阻断项

出现任一情况必须拒绝通过：

1. 没有 UI 设计员 HTML 原型或没有用户审批证据；
2. API 接受任意 URL/baseUrl/path；
3. built-in/fixed/non-OpenAI provider 可执行同步；
4. existing model 被远端字段覆盖；
5. sync 与 model-price/ModelsConfig writer 不共享并发保护；
6. key/header/raw body 出现在 API、DOM、log 或 preview cache；
7. 快捷写入绕过明确确认；
8. stale preview/revision 仍然写盘。