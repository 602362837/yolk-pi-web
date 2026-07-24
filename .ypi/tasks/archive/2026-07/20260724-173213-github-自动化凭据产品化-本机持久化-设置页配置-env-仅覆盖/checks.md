# Checks：GitHub App 本机凭据产品化

## 验收总门禁

- [ ] 用户已批准 `plan-review.md`。
- [ ] UI 设计员已交付最终 HTML 原型，`ui.md` 已记录路径与用户批准；不是只批准 Markdown 或架构师草案。
- [ ] 实施按 `implementation-plan.json` claim；批准前没有 implementer/生产代码改动。
- [ ] 没有 commit、push、merge。

## 需求覆盖检查

| ID | 检查 | 通过证据 |
| --- | --- | --- |
| C1 | 设置页一次配置 → 停止/重启 `ypi` → 不 export → status 仍 configured | 新进程、空 `YPI_GITHUB_APP_*` 的手工记录 + focused test |
| C2 | 本机 Webhook secret 可用 | 本机 secret 的合法 HMAC 通过，错误 secret/signature 返回 401 |
| C3 | 现有 env 覆盖仍可用 | env-only 全量回归 + 逐字段 env/local matrix |
| C4 | env 不是唯一入口 | 默认 UI CTA、客户指南和 checklist 都指向本机设置页 |
| C5 | API/UI 只给 safe projection | 响应 key allowlist + secret/PEM/path/fingerprint sentinel 扫描 |
| C6 | 私钥可粘贴或选择文件 | 两种输入的浏览器/route 测试；同时提交被拒绝 |
| C7 | 轮换即时生效 | 新 App/key 保存后旧 installation token cache 不再命中 |
| C8 | 删除只影响本机 fallback | config/allowlist/jobs/audit/GitHub/env 均不变；env 完整时仍 configured |
| C9 | checklist/verify 主路径正确 | 前三项引导本机配置；verify 仍无 mutation/queue/scheduler |
| C10 | 文档完成切换 | setup/integration/architecture/api/frontend/library/deploy/ops 无 env-only 陈旧结论 |

## 自动验证

### 核心命令

```bash
npm run test:github-automation
npm run test:github-unattended
npm run test:github-publish-policy
npm run lint
node_modules/.bin/tsc --noEmit
```

不得直接运行 `next build`；仅发布验证才使用 `npm run build`。

### Store 与文件系统

- [ ] 测试使用临时 `PI_CODING_AGENT_DIR`，导入模块前设置，绝不触碰真实 `~/.pi/agent/github-automation`。
- [ ] 根/锁目录 0700，metadata/key/tmp/owner 0600（支持 POSIX mode 时）。
- [ ] metadata 指向固定格式 generation basename；拒绝 absolute、`..`、slash/backslash 与 symlink。
- [ ] key 文件普通文件、尺寸受限、RSA 私钥可解析、fingerprint 相符。
- [ ] 先写 key generation，再原子切 metadata；并发读只看到旧或新 generation。
- [ ] 两进程/并发写串行；活跃 owner lock 不被 stale cleanup 抢走；超时固定错误。
- [ ] metadata malformed/future schema、key missing/mismatch/non-RSA/oversize 均 fail closed。
- [ ] 普通 upsert 不静默覆盖 unknown schema；显式 DELETE 可恢复且不触碰其他 automation 状态。
- [ ] 注入 open/write/fsync/rename/chmod/cleanup 失败不报告假成功；残留 tmp/orphan 不参与读取。

### Resolver 与 runtime

- [ ] local-only 完整 bundle → ready。
- [ ] env-only 既有路径 → ready。
- [ ] App ID/key/webhook 三字段分别测试 env override local；source 准确。
- [ ] 空白 env → local fallback。
- [ ] partial env + valid local → ready；partial env + missing/invalid local → 对应 fail closed。
- [ ] local invalid + env 全覆盖 → effective ready、local warning 可见，不错误阻塞 env 部署。
- [ ] App slug optional，env/local source 正确。
- [ ] local loader 一次使用同一 snapshot，不逐字段读不同 generation。
- [ ] JWT `iss` 与 public-key signature 对 local/env 路径都正确。
- [ ] Webhook runtime 每次取得有效 secret，不缓存旧 local secret。
- [ ] local PUT/DELETE 后 installation token Map 清空；旧 App token 不复用。

### API

- [ ] `GET /api/github-automation/credentials` no-store，只返回 safe status。
- [ ] `PUT` 只接受 multipart、固定字段、单文件和固定尺寸；拒绝 JSON、query secret、server path、未知/重复字段、多文件。
- [ ] paste/file 二选一；同时提交为 400。
- [ ] 首次缺项不写半 bundle；轮换空白/缺字段 preserve local，不复制 env。
- [ ] `DELETE` 要求固定 confirm；删除后返回 effective projection。
- [ ] 成功只在落盘 + cache clear 后返回；失败不乐观报告。
- [ ] 所有 route success/error 都 no-store、固定安全码/文案。
- [ ] `/config` 继续拒绝 secret 字段，schema/revision 不变。
- [ ] `/status`、`/verify` 只读；verify sideEffects 三项始终 false。

### Secret 泄漏防线

为每类值使用不同 sentinel：App ID、Webhook secret、PEM 内容、key basename/绝对路径、fingerprint、JWT、installation token。

允许 sentinel 出现的位置仅限：

- temp agent dir 下 active credential metadata（App ID/secret/internal key basename/fingerprint）；
- temp agent dir 下 active key generation（PEM）；
- 测试进程中必要的 server-only变量。

不得出现：

- [ ] credentials/status/config/verify/webhook/jobs API body 或 header（签名请求 header作为测试输入除外）。
- [ ] React DOM、toast、notice、placeholder、console、hydration state。
- [ ] error.message、safe error details、server logs。
- [ ] `config.json`、deliveries、jobs、repositories issue state、events、runner state。
- [ ] Session JSONL、Studio task/artifacts、agent prompt、child env。
- [ ] Links、`auth.json`、`pi-web.json`、OAuth/API-key account stores。

同时检查 `assertGithubAutomationProjectionSafe` 继续拒绝：exact secret containers、PEM marker、token pattern、绝对本机路径；additive safe boolean/source 字段不能通过“放宽所有 private/secret key”实现。

## UI 人工验收

以用户批准的最终 HTML 为基线，不以当前架构师草案自动视为批准。

### 主路径

- [ ] 默认第一主卡是“本机 GitHub App 凭据”，主按钮“保存到本机”。
- [ ] 未配置用户无需打开 env 高级区即可完成配置。
- [ ] App ID、Webhook password、PEM paste/file label/说明清楚。
- [ ] 保存成功后 password、textarea、File/DOM input 全清空；刷新不回显。
- [ ] 已配置只显示状态/source，不显示原值、masked 片段、文件名/路径、fingerprint。
- [ ] 轮换只填新字段；空白保留；错误后不把 secret 放进 toast。
- [ ] env 全量与混合 source 展示准确；维护 fallback 有当前 env 仍生效提示。
- [ ] local 损坏有可恢复动作，不自动覆盖或展示内容。
- [ ] 删除确认范围准确；删除后 env 仍生效和无 env 两种结果都正确。

### 生命周期与竞态

- [ ] 页面关闭、切换 Settings view、input mode 切换、删除、保存成功均清 transient secret/File。
- [ ] Abort/generation guard 阻止旧请求恢复已清理 state。
- [ ] 双击/并发保存被 busy gate 阻止；多标签页服务端锁仍保证正确。
- [ ] 状态刷新以 server projection 为准。
- [ ] Global Settings Save/Reset 不控制此页，仍显示即时保存语义。

### 可访问与响应式

- [ ] 全键盘可完成输入方式切换、文件选择、保存、验证、删除取消/确认。
- [ ] focus visible；AppPrompt 关闭后恢复 trigger focus；Escape 工作。
- [ ] label/input、button names、`aria-busy`、status/live region 合理。
- [ ] 状态不只靠颜色。
- [ ] ≤640px 单列，无水平溢出；长 env 名/错误码可换行。
- [ ] light/dark 对比度可读；reduced-motion 不运行 shimmer/scan。

## 真实流程验收

在用户提供并批准使用的测试 GitHub App 上执行；若无安全测试资源则明确列为剩余风险，不能使用生产 secret 或伪造结论。

1. 创建测试 App，下载 RSA PEM，设置 Webhook secret。
2. 在 Settings 保存三项，不设置 env。
3. 完全停止 ypi 进程；在确认 shell 无 `YPI_GITHUB_APP_*` 后重新启动。
4. GET status/POST verify：App credential configured；安装前其他项可 pending。
5. 安装 App、关联测试仓库、配置公网 HTTPS。
6. 从 GitHub Recent Deliveries 发送 ping/测试 delivery；应通过 HMAC并形成安全 audit。
7. 轮换 Webhook secret：旧签名失败，新签名成功。
8. 轮换 App key：verify 使用新 key；旧 installation token 不继续被 cache 使用。
9. 设置一个/三个 env override，重启并确认 source/effective；移除 env 后回落 local。
10. 删除 local：env 有/无两条分支分别验收。

## 文档与静态检查

建议检索：

```bash
rg -n "只放服务器环境变量|不会在浏览器收集|不提供密钥输入|每次.*export|配置环境变量并重启|env-only" \
  docs components lib AGENTS.md
rg -n "YPI_GITHUB_APP_(ID|PRIVATE_KEY_FILE|WEBHOOK_SECRET)" \
  docs components lib app
```

- [ ] 客户指南步骤顺序为 Settings local → 安装/allowlist/HTTPS → verify。
- [ ] env 只在高级覆盖章节。
- [ ] 部署文档说明 management UI/API 不应无认证公网暴露，公网 webhook route 与管理面分开。
- [ ] troubleshooting 覆盖 local invalid、权限、轮换、env mixed、删除与 no reveal。
- [ ] API/frontend/library module map 与 AGENTS 导航更新，但 AGENTS 不堆细节。
- [ ] `public/docs/github-app-automation-setup.html`（若由 Markdown 构建/维护）同步，不留下 env-only 静态帮助。

## 回归风险

- [ ] env-only GitHub automation。
- [ ] App JWT / installation token refresh 与 401 retry。
- [ ] Webhook raw-body-before-parse 验签与 1 MiB cap。
- [ ] allowlist config CAS、Project Registry binding、repository deletion active-job gate。
- [ ] machine Assignee 与 Links 隔离。
- [ ] Triage/default-off unattended、residual-risk warning、publisher。
- [ ] Settings GitHub automation polling、repository forms、mode/pause/job actions。
- [ ] P1 child env scrub 不因 local source而删错普通 env或注入本机 secret。

## 停止条件

出现以下任一项，checker/implementer 必须停止并上报，不得猜：

- 需要新增管理 UI 登录/鉴权才能安全发布，但范围未批准。
- 需要把 secret 放入 `/config`、`pi-web.json`、Links、CredentialStore 或 agent context 才能继续。
- HTML 原型未由 UI 设计员交付或未获用户批准。
- generation store/锁无法保证不静默混配，需要改变已批准磁盘契约。
- 真实 GitHub UAT 只有生产 secret 可用。
- 现有用户未提交的工作与计划改动冲突。
