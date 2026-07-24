# Brief：Links GitHub OAuth Client ID 产品默认内置

## 背景

当前 Links / GitHub Device Flow 已经使用产品方 OAuth App，但 `lib/github-link-oauth.ts` 只从 server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 读取 Client ID。环境变量缺失时，`GET /api/links` 报告 `authorizationConfigured=false`，Settings → Links 禁用连接按钮；因此 `ypi` / `npm run start` 的普通终端用户仍需部署方先 export，与“产品方持有 OAuth App、终端用户开箱连接”的产品定位不一致。

## 已确认决策

- 产品默认 Client ID：`Ov23li1Cb4aoB9kKQZNq`，对应已启用 Device Flow 的产品 OAuth App。
- 解析优先级：非空、trim 后的 `process.env.YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` > 产品默认值。
- env 未设置或仅空白时使用产品默认值；**空字符串不表示禁用**。
- 不增加 Client secret、`NEXT_PUBLIC_*`、`pi-web.json` 字段或 UI 配置表单。
- Links 继续与 LLM 认证、CredentialStore、ModelRuntime 和 RPC auth reload 完全隔离。

## 现状证据

- `lib/github-link-oauth.ts` 是唯一 Client ID 解析入口，当前缺失 env 时缓存 `null`。
- `app/api/links/route.ts` 只向浏览器投影 `authorizationConfigured` 布尔值和连接数，不返回 Client ID。
- `app/api/links/[provider]/authorizations/route.ts` 复用同一 server-only adapter；请求体禁止 client/token/scope/secret 字段。
- `components/LinksConfig.tsx` 已有空态、连接态和防御性的未配置态，无 Client ID 输入或展示。
- `scripts/test-links.mjs` 已有 Client ID override、未配置 fail-closed、`NEXT_PUBLIC` 缺失及 Links/LLM auth 隔离检查，可在原套件增量扩展。
- 部署、集成、API、library 和 troubleshooting 文档仍把 env 描述为必填，需同步纠正。

## 目标

让官方 `ypi` / `npm run start` 在未设置 env 时即可启动 GitHub Device Flow，同时保留源码开发者和部署方使用 server-only env 覆盖产品默认 OAuth App 的能力。

## 非目标

- 不变更 OAuth scope、GitHub 固定端点、Device Flow 状态机、连接存储或 API wire shape。
- 不新增显式生产禁用开关；如未来需要运维禁用，另行设计。
- 不移除防御性的 `github_authorization_not_configured` 错误码或现有未配置 UI。
- 不新增 GitHub repo/org/PR/Issue 能力，不改变多账号与断开语义。

## 主要风险

- 默认 Client ID 错误或 GitHub 侧关闭 Device Flow，会使所有未覆盖部署失败；通过 focused tests、发布前 live smoke 和 env 覆盖回滚缓解。
- 缓存导致运行时修改 env 不立即生效；保持现有进程期缓存语义并在文档要求重启。
- 测试若不能显式制造 fail-closed，会丢失 503/未配置回归覆盖；保留 test-only `null` override，并增加“清除 override 后重读 env/default”的测试语义。
