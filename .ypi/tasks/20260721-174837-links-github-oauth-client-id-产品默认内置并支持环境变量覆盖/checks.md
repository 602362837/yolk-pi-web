# Checks：Links GitHub OAuth Client ID 产品默认与 env 覆盖

## 需求覆盖检查

| 检查项 | 通过条件 |
| --- | --- |
| 产品默认 | env 未设置时 resolver 精确返回 `Ov23li1Cb4aoB9kKQZNq`；configured=true |
| env 优先级 | 非空 env trim 后覆盖默认；请求中的 `client_id` 使用覆盖值 |
| 空白语义 | unset / empty / whitespace 均回退默认，不表示 disable |
| 开箱可用 | 无 env 的 `GET /api/links` 报告 GitHub configured；authorization start 不返回 not-configured |
| 防御性 fail-closed | test-only forced null 仍产生 `github_authorization_not_configured` / 503 |
| server-only | 无 `NEXT_PUBLIC_*`、Client ID API 字段、React state、DOM 文案、`pi-web.json` 字段或 client component import |
| 无 secret | 无 Client secret 读取、文档、请求或 UI；Device Flow 固定 scope/url 不变 |
| 隔离 | Links 仍不导入 LLM auth store、CredentialStore、ModelRuntime、RPC reload |
| 文档 | 官方运行无需 export；env 被描述为可选覆盖，空白回退，修改后重启 |
| UI 门禁 | production diff 不含 `components/LinksConfig.tsx` / Settings UI / CSS；否则退回规划并补 HTML 原型 |

## 自动验证

```bash
npm run test:links
npm run lint
node_modules/.bin/tsc --noEmit
```

focused test 至少覆盖：

1. 原 env 不存在 + cache reset → exact product default。
2. env=`"  custom-client  "` + reset → `custom-client`。
3. env=`""`、空白 + reset → product default。
4. 默认与 env override 下 `isGithubOAuthConfigured() === true`。
5. test helper `null` → `resolve=null`、configured=false、start 抛稳定 not-configured。
6. test helper `undefined` → 清 cache 并重新读取 env/default。
7. 每个 env 用例 `finally` 恢复原值/cache；后续 Device Flow mock tests 不受影响。
8. 现有 sentinel、fixed URL/scope、forbidden body、no PAT、no LLM auth import 回归全部继续通过。
9. `LinksConfig.tsx` 和浏览器 wire types/routes 不含 exact product default，不导入 resolver，不增加 Client ID 字段。

## 静态安全与契约扫描

```bash
# 找到所有产品默认/env 引用，逐项确认 server-only 或文档用途
rg -n 'Ov23li1Cb4aoB9kKQZNq|YPI_LINKS_GITHUB_OAUTH_CLIENT_ID' \
  lib app components scripts docs AGENTS.md

# 不得新增浏览器公开配置
rg -n 'NEXT_PUBLIC_.*(LINKS|GITHUB.*CLIENT)' app components lib

# 不得新增 Client secret 配置/使用；既有 forbidden-body 文案可保留
rg -n 'YPI_LINKS.*SECRET|GITHUB_OAUTH_CLIENT_SECRET|process\.env\..*CLIENT_SECRET' \
  lib app components docs

# 检查旧文档是否仍要求官方用户 export / Required=Yes
rg -n 'not configured|尚未配置|missing configuration|Required|export YPI_LINKS_GITHUB' \
  docs/integrations/README.md docs/deployment/README.md docs/modules \
  docs/operations/troubleshooting.md docs/architecture/overview.md
```

允许 exact Client ID 出现在 server-only `lib/github-link-oauth.ts`、focused tests 和说明默认值的项目文档中；不得出现在 client component、API response schema 或 HTML。

## API 人工验收

### A. 无 env 默认路径

1. 确认启动 shell 未设置 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`，重启开发/生产 server。
2. `GET /api/links`：GitHub `authorizationConfigured=true`，响应不含 Client ID/env 名。
3. `POST /api/links/github/authorizations`：返回 201 与 user-facing Device Flow 字段；不返回 `clientId`、`device_code`、token。
4. 在 GitHub 官方页面完成一次测试账号授权，确认连接保存与既有多账号 UI 正常。

### B. env 覆盖路径

1. 使用已启用 Device Flow 的测试 OAuth App：
   ```bash
   YPI_LINKS_GITHUB_OAUTH_CLIENT_ID='  <test-client-id>  ' npm run dev
   ```
2. 完成一次 Device Flow；服务端 GitHub request 使用 trim 后值。
3. 浏览器 Network 仅能看到本产品 API 的安全响应，看不到 Client ID 或 server-to-GitHub request body。
4. 清除测试 env 并重启，恢复产品默认。

### C. 错误覆盖与防御态

- 非空错误 env 不应静默 fallback；应走既有安全 `github_client_invalid` / Device Flow disabled 错误。
- 通过 focused test override（不是生产 env）强制 null，确认 catalog false、503 和既有未配置 UI 仍有效。

## UI 回归（无新原型）

- 无 env：Settings → Links 直接显示既有空态/连接按钮，而不是未配置态。
- 连接、设备码、成功、多账号、duplicate、disconnect 既有路径无视觉/交互回归。
- forced-null 测试态仍显示既有 warning/disabled；不改文案。
- DOM 搜索 exact Client ID、env 名、`device_code`、access token：均无结果（user code 允许显示）。
- 若出现任何实际 UI diff，当前“无 UI gate”结论失效，必须先补 HTML 原型审批。

## 文档检查

- `docs/integrations/README.md` 配置表把 env 标记为 Optional override。
- `docs/deployment/README.md` 官方运行示例不再 export；开发者覆盖示例保留。
- `docs/operations/troubleshooting.md` 不再说“env 未设置即未配置”；说明旧版本、test override、错误非空 override、Device Flow disabled 与重启。
- API/library/frontend/architecture 文档统一 env > default、blank > default、无显式 disable。
- 文档不把 Client ID 称为 secret，也不建议 `NEXT_PUBLIC_*` / `pi-web.json` / UI 配置。

## Checker 重点

1. exact default 是否只在 server-only source、tests、docs。
2. cache/test helper 是否能可靠区分 reset 与 forced-null。
3. env cleanup 是否不会污染后续 tests。
4. API wire、固定 scope/url、503 稳定码与 Links/LLM auth 隔离是否保持。
5. 实现是否无 UI production diff；若有，阻塞并要求 HTML prototype + 用户审批。
6. 文档是否仍有“官方必须 export”的陈旧说明。
7. live smoke 是否真实运行；缺网络/测试账号时明确标为 UAT 未完成，不得伪造通过。

## 阻塞条件

- 默认值不精确或 env 覆盖/trim/空白语义不符合 PRD。
- 产品 Client ID 进入 API/DOM/`NEXT_PUBLIC_*`/`pi-web.json` 或 UI 配置表单。
- 新增 Client secret、PAT 或 LLM auth 耦合。
- 删除 forced-null 防御测试、503 错误码或未配置 UI。
- 未经原型审批发生 UI/文案/信息结构变化。
- `npm run test:links` 失败，或 lint/tsc 出现本任务相关错误。

## 回滚验收

- 首选通过非空 env 覆盖到 known-good Client ID 并重启，连接数据不变。
- 代码回退 resolver 后，既有 `~/.pi/agent/links/` metadata/secrets 仍可读。
- 不删除 Links 数据、不改写 `auth.json`、不自动撤销远端 GitHub grant。
