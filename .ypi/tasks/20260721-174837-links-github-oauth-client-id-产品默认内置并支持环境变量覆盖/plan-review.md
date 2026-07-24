# 计划审批书：Links GitHub OAuth Client ID 产品默认内置

## 请求审批

本计划把已确认的 GitHub OAuth App Client ID `Ov23li1Cb4aoB9kKQZNq` 内置为 **server-only 产品默认值**。普通用户运行 `ypi` / `npm run start` 时无需再 export；源码开发者和部署方仍可用非空、trim 后的 `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 覆盖。

本轮只完成规划，**未修改生产代码**。请审阅并明确回复“批准/开始实现”或提出修改；未批准前不得进入 implementing。

## 审批材料

- [Brief / 背景、证据与边界](brief.md)
- [PRD / 需求与验收标准](prd.md)
- [UI / 不触发 HTML 原型门禁的判定](ui.md)
- [Design / resolver、数据流、兼容与回滚](design.md)
- [Implement / schemaVersion 2 DAG](implement.md)
- [Implementation Plan JSON](implementation-plan.json)
- [Checks / 自动、安全与人工验收](checks.md)

## PRD 摘要

- 无 env、空字符串或全空白 env：使用产品默认 `Ov23li1Cb4aoB9kKQZNq`。
- 非空 env：trim 后覆盖默认；错误覆盖不静默 fallback。
- 官方运行开箱可用，`GET /api/links` 默认 configured。
- 不新增 Client secret、PAT、`NEXT_PUBLIC_*`、`pi-web.json` 字段或 UI 表单。
- REST/SSE shape、scope `read:user`、固定 GitHub URL、多账号/断开、存储和 LLM auth 隔离不变。
- 保留 test-only forced-null、稳定 503/error code 与防御性未配置 UI。

## UI 门禁结论

**不触发新的 HTML prototype gate。**

计划不修改 `LinksConfig`、Settings IA、布局、组件状态、文案或交互控件；它只让无 env 的用户进入现有已实现的“空态 → 连接 GitHub → Device Flow”路径。现有未配置态不删除、不改文案。若实现阶段出现任何 UI/文案/信息结构 diff，必须停止并补派 UI 设计员产出 HTML 原型，再请求用户审批。

## Design 摘要

- 默认常量放在唯一 server-only resolver `lib/github-link-oauth.ts`，不创建浏览器共享配置入口。
- 优先级：`trim(env)` 非空 > 产品默认；空白不表示 disable。
- 继续进程期缓存；修改 env 后需重启。
- test helper 使用三态：string 强制值、null 强制 fail-closed、undefined 清 cache 并重读 env/default。
- 正常生产 resolver 不返回 null，但 request/poll 的 null guard 和 `github_authorization_not_configured` 保留。
- `/api/links` 仍只投影 configured boolean；Client ID 仅由 server-to-GitHub Device Flow 请求使用。
- 无数据迁移；不写 Links store 新配置、`pi-web.json`、LLM auth 或 session JSONL。

## Implementation Plan 摘要

计划为 schemaVersion 2、4 个子任务、最大并发 2：

1. `DEFAULT-01`：实现产品默认、env 优先、缓存和 test reset/forced-null 契约。
2. `TEST-01`：focused tests 覆盖 exact default、env/trim/blank、configured、fail-closed、浏览器边界。
3. `DOCS-01`：更新 architecture/integrations/deployment/library/API/frontend/troubleshooting；可与 TEST-01 并行。
4. `CHECK-01`：checker 运行 `test:links`、lint、tsc、source scans 和无 env/override live smoke。

实现员不得修改 UI；如认为必须修改，退回 UI 原型审批。`DEFAULT-01` 稳定后才可并发执行 tests/docs，最后经过 checker barrier。

## Checks 摘要

- 自动：`npm run test:links`、`npm run lint`、`node_modules/.bin/tsc --noEmit`。
- 静态：扫描 exact default/env 引用、`NEXT_PUBLIC`、Client secret、旧 Required/export 文档、LLM auth imports。
- API：无 env 时 catalog configured + start 201；env override trim 后生效；响应不含 Client ID/device_code/token。
- UI 回归：无 env 进入既有连接流程；forced-null 保留既有未配置态；DOM 无 exact Client ID/env。
- live UAT：产品默认 App 与测试 override 各完成一次 Device Flow；网络/测试账号不可用时必须明确记录，不能伪造通过。

## 风险与回滚

主要风险是产品 OAuth App Client ID 错误/Device Flow 被关闭、错误 env override、cache 测试串扰和文档残留。通过 exact-value tests、三态 test helper、env cleanup、source scans、live smoke 缓解。

首选 stop-bleed：设置 known-good `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 并重启。代码回滚只恢复 env-only resolver；不删除 `~/.pi/agent/links/`、不迁移到 LLM auth、不撤销 GitHub grants。

## 请用户确认

请确认以下产品/实现口径：

1. 内置默认值为 `Ov23li1Cb4aoB9kKQZNq`；
2. 非空 trim 后 env 覆盖，未设/空白 env 回退默认；
3. 不提供“空 env 显式禁用”；
4. 无 Client secret、浏览器配置、`pi-web.json` 或 UI 表单；
5. 本任务无 UI 生产改动，因此无需新 HTML 原型；
6. 实现按 4 项 DAG 执行，并在 checker barrier 后验收。

**请明确回复“批准，开始实现”或“需要修改：……”**
