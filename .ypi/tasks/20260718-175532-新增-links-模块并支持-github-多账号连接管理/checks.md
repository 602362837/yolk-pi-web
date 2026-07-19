# Checks：Links / GitHub OAuth Device Flow 多账号连接

## 需求覆盖

| 检查项 | 通过条件 |
| --- | --- |
| 交互式授权是唯一 P0 主路径 | Settings 默认操作为“连接 GitHub”，进入 device-code授权；生产 diff无 PAT输入、导入、reveal或 copy token。 |
| 应用身份与用户凭据概念正确 | 文档/UI说明 OAuth App是产品应用身份，access token是授权后服务端凭据；终端用户无需创建 App或粘贴 token。 |
| 产品-owned OAuth App | backend使用产品提供的 client id；终端用户无 client配置表单；缺失配置 fail closed。 |
| Device Flow | 固定 device-code/token/user endpoints；无 callback、PKCE、loopback listener或粘贴 redirect URL。 |
| 最小权限 | scope固定 `read:user`，客户端不能传 scope；不请求 repo/workflow/org管理权限。 |
| 连接 only | 无 clone、repo/org列表、PR、Issue、Actions、权限引擎、runtime账号选择或 failover。 |
| 多账号 | 两个不同 GitHub numeric user id可同时连接、列表、独立断开。 |
| 重复 identity | 同一 user再授权返回 409，不静默覆盖现有 local secret，不写入新 token。 |
| 独立 domain | 只写 `~/.pi/agent/links/`；不读写 `auth.json`、`auth-accounts`、`auth-api-key-accounts`，不调用 CredentialStore/ModelRuntime/RPC reload。 |
| 断开 | soft-delete metadata、删除本机 active OAuth secret、活动列表移除；不声称已撤销 GitHub远端授权。 |
| UI 原型 | 生产页面符合新批准的 Device Flow HTML，不保留旧 PAT主表单。 |

## OAuth 配置与固定 egress

- [ ] `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`只在 server module读取；没有 `NEXT_PUBLIC_*`镜像、browser config API或 `pi-web.json`字段。
- [ ] client secret不存在于仓库、build输出、env示例浏览器段、API、DOM、日志；Device Flow调用不需要 client secret。
- [ ] 缺 client id返回 `github_authorization_not_configured`，UI提供运维提示但不回退 PAT。
- [ ] `POST https://github.com/login/device/code`固定，body只含 server client id和 `scope=read:user`。
- [ ] `POST https://github.com/login/oauth/access_token`固定，grant_type精确，device_code来自server memory。
- [ ] `GET https://api.github.com/user`固定，Bearer只在server请求header。
- [ ] 客户端提交的 `url/host/scope/clientId/clientSecret/token/redirectUri`均被拒绝。
- [ ] 网络调用有 timeout、size cap、JSON/MIME检查与 redirect rejection/固定 host策略。

## 授权状态机检查

1. Start成功显示 `userCode`、固定 verification URI、过期时间和等待状态。
2. `device_code`不返回浏览器、不写文件；user code是设计上需要显示/复制的短期码，两者检查口径不可混淆。
3. `authorization_pending`继续轮询且不超过GitHub返回的 interval。
4. `slow_down`至少增加5秒或使用GitHub返回的新 interval，不busy-loop。
5. `access_denied`、`expired_token`、`device_flow_disabled`、invalid client、network/timeout/bad response映射稳定安全文案。
6. SSE断线后同一authorization id重连能获得当前snapshot；断线不自动取消后台授权。
7. 用户取消会Abort polling并终止本机状态；终态/TTL后授权session被清理。
8. 服务重启丢失pending session时显示“授权已失效，请重新连接”，不产生ghost connection。
9. token收到后先验证 `/user`，再持久化；`id/login`非法时不写secret。
10. 成功持久化不依赖浏览器仍在线；UI可通过GET connections恢复成功结果。

## Secret 与隐私检查

使用两个不同 sentinel：

- access token：`gho_LINKS_ACCESS_SENTINEL_7f3c...`
- device code：`LINKS_DEVICE_CODE_SENTINEL_91ab...`

检查 sentinel 均不出现在：

- POST start response、SSE帧、GET/DELETE JSON；
- `registry.json`、metadata、events、snapshot；
- server stdout/stderr、Next error、toast/inline error；
- React DOM、data attributes、localStorage/sessionStorage；
- task/session JSONL、usage ledger、测试报告；
- thrown Error.message、captured logger、raw debug payload。

允许 access token出现在：mock token endpoint原始测试夹具、内存 credential对象、最终secret文件；允许 device code只出现在server manager memory与mock request。user code可出现在wire/DOM，因为它是用户必须输入的短期授权码，但终态/切页/过期后必须清除。

secret文件只含allowlisted credential字段，不保存raw token endpoint body、device_code、client id/secret、上游headers或错误。registry只含安全metadata/scopes/timestamps。

## Scope 诚实性

- P0 requested scope精确为 `read:user`。
- granted scopes从token endpoint `scope`解析、trim、去重、稳定排序。
- UI区分“请求范围”与“GitHub返回已授予范围”。
- 不把 `X-Accepted-OAuth-Scopes`、token prefix、HTTP成功或 `/user`字段推断为repo权限。
- 空/缺失granted scope显示“GitHub未返回scope明细”，而不是“无权限”或“权限完整”。
- 页面不出现repo/organization permission selector。

## 存储一致性

- [ ] 空目录list返回合法空结果，不创建secret。
- [ ] links/provider/locks目录0700，registry/secret 0600（不支持chmod平台按项目best-effort规范说明）。
- [ ] malformed registry或未知高版本fail closed，不自动覆盖。
- [ ] create secret write失败无metadata；registry write失败清理orphan secret。
- [ ] 同identity并发完成授权最终一条active connection，其余duplicate。
- [ ] duplicate的新token不落本机磁盘，现有secret不变。
- [ ] disconnect quarantine rename/registry write/final unlink任一故障不返回虚假成功；可恢复状态一致。
- [ ] connection/authorization id为opaque random，不含login/user id/token hash，不接受 `/`, `..`, `\\`, URL scheme。
- [ ] list只读metadata，不打开每个secret、不调用GitHub。

## API / SSE 自动验证

建议 `npm run test:links` 覆盖：

- 配置：client id缺失/非法、正常server-only配置。
- Device start：200/JSON、oversize、malformed、wrong verification host、timeout/network。
- Poll：pending→success、多个pending、slow_down、denied、expired、invalid client/device、disabled、429/5xx、abort。
- Identity：valid `/user`、401/403/rate-limit、invalid JSON、oversize、缺 `id/login`。
- Lifecycle：SSE首snapshot、重连、多个subscriber、subscriber断开、cancel、terminal TTL、manager容量上限、server state missing。
- Store/API：two identities、duplicate、concurrent duplicate、disconnect、partial failure、list filtering、no-store。
- Body rejection：token/PAT/client/scope/url/redirect/extra secret-like字段。
- exact response key allowlists与secret sentinel扫描。
- Settings tree pure projection与 `links` exhaustive mapping。

测试必须在动态import前设置临时 `PI_CODING_AGENT_DIR`与测试client id，结束后删除temp dir。

## 前端人工验收

1. Settings tree中 Links为root leaf，Studio → Links → 模型与用量键盘移动正常。
2. 空态主按钮是“连接 GitHub”，没有PAT输入或高级token折叠。
3. client未配置时显示明确不可用状态，不诱导普通用户创建PAT；提供面向部署者的文档链接/说明。
4. 点击连接后自动尝试新开GitHub验证页；popup被拦截时仍有可点击官方链接。
5. user code可键盘选择/复制，有到期倒计时；页面明确“不要把此短期码发送给他人”。
6. waiting/polling状态不会快速闪动或不断播报；reduced motion下无循环位移动画。
7. 拒绝、过期、网络错误后可重新开始；旧EventSource不会覆盖新flow。
8. 成功后显示login/numeric id/上次验证时间/requested+granted scopes，页面中无token。
9. 连接第二个不同账号后两张卡片身份、scope、操作不串号。
10. 重复账号显示冲突并定位现有卡片，不替换；提示可先断开再连接，并说明按需去GitHub撤销多余授权。
11. 取消pending flow后清除code/倒计时；切换Settings view/unmount同样清除浏览器短期状态。
12. 断开确认明确“删除本机凭据，不撤销GitHub远端授权”；取消恢复焦点；busy只锁目标卡片；失败保留卡片。
13. Links操作即时保存，不改变dirty；全局Save/Reset隐藏或disabled并有说明。
14. ≤640px单列，code/外链/状态/卡片操作均可见；light/dark/focus对比正确。

## 自动验证命令

```bash
npm run test:links
npm run test:web-credential-store
npm run test:api-key-accounts
npm run lint
node_modules/.bin/tsc --noEmit
```

不使用 `next build` 做日常验证。真实GitHub UAT需要产品owner提供已开启Device Flow的OAuth App client id和安全测试身份；不可用时必须显式记录，不得伪造通过。

## 重点回归风险

- `SettingsSection`新增成员破坏tree roving tabindex/deep link/exhaustive switch。
- Links被 `/api/web-config` loading/dirty/save阻塞。
- EventSource断线错误取消后台flow或旧flow写回新UI。
- device_code/access token进入generic error/logger/SSE。
- 产品client id未随官方package/runtime注入，导致所有终端用户看到配置缺失。
- duplicate 产生未保存远端token，UI未给GitHub撤销指引。
- disconnect只删metadata或只删secret。
- 文档又把OAuth App误写成用户必须创建的东西。

## Checker blocker

以下任一项必须判定 blocker：

- 主界面仍要求PAT/token输入；
- access token或device_code出现在浏览器、API/SSE、日志、metadata、task/session；
- client secret进入仓库或前端，或Device Flow错误要求终端用户配置secret；
- GitHub host/path/scope可由客户端控制；
- polling不遵守interval/slow_down；
- Links写入LLM auth store或调用ModelRuntime/RPC reload；
- 没有新UI设计员HTML原型/实现偏离未批准原型；
- duplicate静默替换；disconnect虚假成功；
- 范围扩展到PAT主路径、GitHub App安装、repo/clone/PR。