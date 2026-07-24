# Design：Links GitHub OAuth Client ID 产品默认与 env 覆盖

## 方案摘要

在现有唯一 resolver `lib/github-link-oauth.ts` 内增加产品默认常量，并保持进程期缓存：

```text
trim(process.env.YPI_LINKS_GITHUB_OAUTH_CLIENT_ID)
  ├─ 非空 → env override
  └─ 未设置/空白 → product default Ov23li1Cb4aoB9kKQZNq
```

生产路径始终得到非空 Client ID，因此 `isGithubOAuthConfigured()` 默认为 true。test-only override 继续允许显式 `null` 制造 fail-closed；清除 override 后重新读取 env/default。API、前端、存储和网络协议不变。

## 影响模块与边界

| 模块 | 改动 | 不变边界 |
| --- | --- | --- |
| `lib/github-link-oauth.ts` | 增加产品默认常量；resolver 按 env > default 解析；调整注释/安全错误文案；明确 test reset/forced-null 语义 | 固定 URL、scope、timeout、响应大小、secret 投影、Links/LLM auth 隔离 |
| `scripts/test-links.mjs` | 增加默认/env/trim/空白/configured/DOM-source 边界测试；保留 forced-null 测试 | 临时 agent dir、mock fetch、sentinel 扫描 |
| `app/api/links/**` | 无生产代码改动；通过既有 `isGithubOAuthConfigured()` 自动得到默认 true | wire shape、status、no-store、forbidden body 不变 |
| `components/LinksConfig.tsx` | 无生产代码改动 | 既有空态、Device Flow、未配置防御态不变 |
| 文档 | 将 env 从必填改为可选覆盖；官方运行开箱可用；troubleshooting 纠偏 | 无新设置字段或用户 secret 流程 |

## Server-only 配置契约

建议在 `lib/github-link-oauth.ts` 常量区定义：

```ts
const PRODUCT_DEFAULT_GITHUB_CLIENT_ID = "Ov23li1Cb4aoB9kKQZNq";
const ENV_GITHUB_CLIENT_ID = "YPI_LINKS_GITHUB_OAUTH_CLIENT_ID";
```

- 默认常量无需导出给浏览器或共享 types。
- 该模块只能由 server routes/helpers 引用；不得由 client component 导入。
- Client ID 是 OAuth 公共标识，不是 secret；“server-only”约束用于阻止浏览器成为配置入口，并保证调用固定 GitHub 端点的责任留在服务端。
- 不引入 `server-only` 包导入，以免破坏当前 jiti focused test；通过模块调用边界与 source assertions 约束。

## Resolver 与缓存契约

```text
_cachedClientId === undefined
  → read env
  → env.trim() 非空 ? trimmed env : product default
  → cache string

_cachedClientId is string/null
  → return cache
```

- 正常生产解析不返回 null。
- 现有 `requestDeviceCode()` / `pollAccessToken()` 的 null guard 保留，避免删除稳定错误码和便于故障注入。
- test helper 推荐支持三态：
  - `string`：强制 trimmed test Client ID；空白字符串可按 forced-null 处理，避免伪造无效值；
  - `null`：强制 fail-closed；
  - `undefined`：清除缓存，下一次按 env > product default 重新解析。
- 每个修改 env 的测试使用 `try/finally` 恢复原 env 并清除 resolver cache，避免污染后续 authorization tests。
- env 在首次解析后变化不会热更新；部署文档要求重启进程。

## 数据流

```text
Server process env (optional)              Product source constant
            │ non-empty trim                   │ fallback
            └──────────────┬────────────────────┘
                           ▼
             resolveGithubOAuthClientId()
                           │ cached process-local string
             ┌─────────────┴─────────────────┐
             ▼                               ▼
isGithubOAuthConfigured()             request/poll GitHub
             │ boolean only                    │ client_id only
             ▼                                 ▼
GET /api/links → browser           fixed github.com server fetch
```

浏览器不会获得 Client ID 字段；它只获得配置布尔值。GitHub 按 OAuth Device Flow 协议收到 Client ID，不收到 Client secret。

## API / 文件契约

- **无新增 API 字段、route、状态或错误码。**
- `GET /api/links` 的 `authorizationConfigured` 在正常产品运行中从“依赖 env”变为“默认 true”。
- `POST /api/links/github/authorizations` 请求/响应不变，继续拒绝 client/token/secret/scope/url 字段。
- 不写 `pi-web.json`、`auth.json`、`auth-accounts/`、session JSONL 或 `~/.pi/agent/links/` 新配置文件。
- 不需要数据迁移。

## 文档改动

1. `docs/architecture/overview.md`：记录 env override > 内置默认；空白回退；无显式禁用。
2. `docs/integrations/README.md`：配置表改为 optional override；终端用户开箱可用。
3. `docs/deployment/README.md`：官方运行删除 export 前置条件；源码开发者/部署方 override 示例；重启生效。
4. `docs/modules/library.md`：resolver 契约与 reuse rule 更新。
5. `docs/modules/api.md`：catalog 默认 configured；503 仅防御性/test override。
6. `docs/modules/frontend.md`：Links 不新增配置表单，未配置态仅防御性。
7. `docs/operations/troubleshooting.md`：正常未设 env 不再导致未配置；增加错误 override、旧版本/测试 override、Device Flow disabled 排查。
8. `AGENTS.md` 无需更新：模块导航和不变量没有新增入口。

## 兼容性

- 已设置 env 的部署行为不变，值 trim 后继续优先。
- 未设置或空白 env 的部署从不可用升级为产品默认可用。
- 不支持把空字符串作为禁用；这是明确产品决策，不属于兼容回归。
- 既有 test-only forced-null、503、catalog false 和 UI 未配置态保留。
- OAuth grant、连接 secret 和 metadata 无迁移。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 默认 OAuth App Client ID 拼写错误或 Device Flow 未启用 | 精确值测试；发布前无 env live smoke；env 可立即覆盖并重启 |
| 错误非空 env 覆盖导致授权失败 | 不静默 fallback；安全错误指向 override / Device Flow 配置；清除 env 并重启恢复默认 |
| resolver cache 使测试串扰 | 三态 helper + `try/finally` 恢复 env/cache |
| 默认值进入浏览器 bundle/DOM | 常量只在 server module；source scan `LinksConfig`、routes/wire 无 exact ID/`NEXT_PUBLIC`; 浏览器检查响应 |
| 文档仍要求 export | focused `rg` 审阅相关 docs，删除 Required/官方 export 旧说法 |
| 误耦合 LLM auth | 复用现有 module，不新增 auth/runtime import；原 isolation tests 必须通过 |

## 回滚

1. **运维 stop-bleed**：设置 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID=<known-good-client-id>` 并重启；无需回退代码。
2. **代码回滚**：恢复 env-only resolver；这会重新要求部署方 export，但不触碰连接数据。
3. 不删除 `~/.pi/agent/links/`，不迁移到 LLM auth，不撤销 GitHub 远端 grants。
