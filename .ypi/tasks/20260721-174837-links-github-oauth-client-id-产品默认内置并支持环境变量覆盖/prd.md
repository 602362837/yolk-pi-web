# PRD：Links GitHub OAuth Client ID 产品默认内置并支持 env 覆盖

## 目标与用户价值

普通用户安装并运行 `ypi` 或 `npm run start` 后，无需 export Client ID、创建 OAuth App 或填写配置，即可在 Settings → Links 发起 GitHub Device Flow。源码开发者和部署方仍可使用 server-only env 切换到自己的 OAuth App。

## 用户与场景

1. **终端用户**：未设置任何 Links env，直接连接 GitHub。
2. **源码开发者**：用自己的 Device-Flow-enabled OAuth App Client ID 测试。
3. **部署方**：通过进程 env 覆盖产品默认应用身份，且配置不进入浏览器或持久化设置。
4. **测试/故障注入**：仍可显式强制未配置，以验证 503 和防御性 UI。

## 范围内

- 在 server-only Links OAuth 模块内内置产品默认 Client ID `Ov23li1Cb4aoB9kKQZNq`。
- 解析、缓存和测试 override 语义调整。
- focused tests：默认值、env 覆盖、trim、空白回退、configured 状态、浏览器边界。
- 更新 architecture / integrations / deployment / library / API / frontend / troubleshooting 文档。

## 范围外

- Client secret、PAT、Authorization Code callback、`NEXT_PUBLIC_*`。
- `pi-web.json` 配置字段或 Settings Client ID 表单。
- 显式禁用开关；空字符串 env 不作为禁用信号。
- OAuth scope、GitHub URL、REST/SSE shape、存储、多账号、disconnect 或 LLM auth 改动。

## 需求与验收标准

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 产品默认值 | 未设置 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 时，resolver 返回 `Ov23li1Cb4aoB9kKQZNq`，`isGithubOAuthConfigured()` 为 `true`。 |
| R2 | env 覆盖 | env 为非空字符串时，trim 后的值覆盖产品默认；首尾空白不进入 GitHub 请求。 |
| R3 | 空白回退 | env 未设置、`""` 或全空白时都回退产品默认；不提供“空 env 显式禁用”。 |
| R4 | 开箱可用 | 官方 `ypi` / `npm run start` 不要求用户 export Client ID；`GET /api/links` 默认报告 GitHub authorization configured。 |
| R5 | server-only | 产品默认值和 env resolver 仅位于 server-only Links 模块；不得出现在 `NEXT_PUBLIC_*`、`pi-web.json`、React state、DOM 文案或 `/api/links` wire fields。Client ID 会按 OAuth 协议仅由服务端发送到固定 GitHub 端点。 |
| R6 | 无 secret | 不增加、读取、发送或文档要求 Client secret；Device Flow 继续只使用 Client ID。 |
| R7 | 测试故障注入 | focused tests 仍可强制 resolver 返回 `null`，覆盖 `github_authorization_not_configured`；另有清除 override 后重新解析 env/default 的方式，且测试恢复进程 env/cache。 |
| R8 | 兼容性 | REST/SSE 类型、错误码、scope `read:user`、固定 GitHub URL、连接存储和 Links/LLM auth 隔离保持不变。 |
| R9 | 文档 | 用户文档删除“官方运行必须 export”的要求；开发/部署文档说明 env 是可选覆盖、修改后需重启；troubleshooting 说明未配置态只应在故障注入/旧版本等异常场景出现。 |
| R10 | 安全回归 | `npm run test:links` 的 sentinel、forbidden body、无 PAT、无 `NEXT_PUBLIC`、无 LLM auth import 检查继续通过。 |

## 产品语义澄清

- GitHub OAuth Client ID 是公开应用标识，不按 secret 处理；但本产品仍将其作为 **server-only 运行配置入口**，不新增浏览器可配置能力。
- 非空但错误的 env 是明确覆盖，应由 GitHub 返回 `github_client_invalid` / Device Flow 错误；系统不在失败后静默改回产品默认，避免掩盖部署配置错误。
- 解析结果保持进程期缓存；运行中修改 env 后需重启。
- `github_authorization_not_configured`、catalog `authorizationConfigured=false` 和现有 UI 未配置态保留为防御性/测试能力，不再是官方默认运行路径。

## 未决问题

无。默认值、优先级、空白语义和安全边界均已由用户确认。
