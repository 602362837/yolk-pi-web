# Checks：Grok Active 刷新凭据一致性

## 1. 需求覆盖

- [ ] Active refresh 成功后，slot 文件与 `auth.json.grok-cli` 同为新 credential。
- [ ] 第二次刷新使用轮换后的 refresh token，不再提交旧的一次性 token。
- [ ] 普通 `listOAuthAccounts("grok-cli")` 不执行 `auth.json -> existing slot` secret 回写。
- [ ] refresh 与 list 受控交错后，新 credential 不回退。
- [ ] refresh A 与 Activate B 两种顺序都形成合法终态。
- [ ] 非 Active refresh 只更新目标 slot。
- [ ] 同进程同 storage id 并发刷新保持 single-flight。
- [ ] 上游失败、metadata 失败和 mirror 失败遵守失败安全规则。
- [ ] auth-only bootstrap、normal login、add、reauth、logout、Activate 行为兼容。
- [ ] API wire、metadata schema、opaque id、Session JSONL 不变。

## 2. 自动验证矩阵

### 2.1 新增生产路径聚焦测试

使用临时 `PI_CODING_AGENT_DIR` 和受控 OAuth fixture，禁止真实网络/真实用户目录：

| 场景 | 关键断言 |
| --- | --- |
| Active C0 -> C1 | resolver 返回 C1；slot/auth 的 access/refresh/expires 都是 C1 |
| R0 一次性轮换 | 第一次 provider 输入 R0、返回 R1；第二次输入必须是 R1、返回 R2 |
| refresh + list barrier | list 在 refresh 窗口执行；最终 slot/auth 无 C0 |
| refresh A + Activate B | 最终 Active/mirror 为 B；A slot 保留 C1 |
| Activate B + refresh A | A 作为 non-Active 只更新自身，mirror 仍为 B |
| non-Active refresh | metadata Active 和 auth 全程不变 |
| same-account single-flight | 同进程并发调用只执行一次 fixture `refreshToken()` |
| upstream failure | slot/auth/metadata byte-level 或结构等价保持 |
| malformed metadata | refresh 前 fail closed，fixture refresh 调用次数为 0 |
| mirror persistence failure | slot 保留 C1；调用返回安全错误；恢复写条件后下一次 resolver 把 mirror 收敛到 C1 |
| privacy | list/API/error/console 序列化不含 sentinel access/refresh、payload、绝对路径 |

并发测试必须使用 deferred/barrier 控制时序，不接受仅靠随机 `sleep` 的偶发竞态测试。

### 2.2 现有回归

```bash
npm run test:grok-refresh-consistency
npm run test:grok-accounts
npm run test:grok-global-auth
npm run test:oauth-accounts
npm run test:kiro-refresh-activate-race
npm run test:antigravity-refresh-activate-race
npm run test:kiro-accounts
npm run test:antigravity-accounts
```

如时间允许，运行：

```bash
npm run test:grok-all
```

### 2.3 静态质量

```bash
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

不得直接运行 `next build`。

## 3. 文件与安全检查

在 POSIX 平台确认：

- [ ] `auth-accounts/grok-cli/` 为 `0700`。
- [ ] `accounts.json`、slot JSON、`auth.json` 为 `0600`。
- [ ] slot 更新使用同目录 tmp + `rename`，无半写 JSON。
- [ ] `auth.json` 仍只通过 Web `CredentialStore` 修改。
- [ ] metadata 不含 access/refresh/token endpoint secret。
- [ ] 没有新增 token、OAuth payload、绝对路径日志。
- [ ] 错误使用固定安全文本，不透传上游正文。

## 4. 代码审查重点

- [ ] Grok resolver 不再调用会执行 secret 同步的 list。
- [ ] Active metadata helper 不读 `auth.json`、不回填、不写文件。
- [ ] public locked wrapper 与 internal unlocked/projector 分层明确，无非重入 provider lock。
- [ ] list 即使保留 label/metadata cleanup，也绝不写 credential secret。
- [ ] bootstrap 只在没有有效 managed Active 时接纳 auth credential。
- [ ] normal login 的 replace/adopt 是显式意图，不由 GET/list 触发。
- [ ] logout 不依赖普通 list 的 secret 副作用来清理 Active 展示。
- [ ] mirror 写失败不会回滚到 C0，也不会返回成功。
- [ ] valid-token 路径能够修复前次 slot=C1/mirror=C0 的中间态。
- [ ] non-Active 路径不触碰 mirror。

## 5. 人工验收

本任务无 UI 变化，人工验收只确认现有行为无回归：

1. 在临时/测试账号环境添加两个 Grok 账号，Activate A。
2. 触发 A 的强制额度刷新或等价 token refresh，随后立即打开/刷新账号列表。
3. 确认 A 不出现“刷新成功后立即重新登录”；再次刷新仍成功。
4. 刷新 A 的同时 Activate B，确认最终 UI Active 为 B，B 可用于后续请求，A 再次选中时仍保留新 token。
5. 登出再登录，确认 saved account 列表、Active 展示和现有 reload 行为符合原契约。
6. 确认页面、文案、交互和 API response shape 无变化。

人工验收不得打印或复制真实 token；如需文件比对，只比较测试 sentinel 或 hash/字段版本。

## 6. 阻塞条件

出现任一项即阻塞合入：

- Active refresh 返回成功但 slot 与 mirror 不一致。
- 轮换后的新 refresh token 被旧 mirror 恢复。
- list/GET 仍可覆盖已存在 slot secret。
- mirror 失败后旧 refresh token 被回滚，或后续无法收敛。
- provider lock 嵌套导致超时/死锁。
- Kiro/Antigravity/OpenAI 账号基础流程因共享 list 改动回归。
- token、上游正文或绝对凭据路径出现在输出/日志/API。
- 新增 UI 变化但没有 HTML 原型和用户审批。

## 7. TEST-01 验证记录（2026-07-21）

- [x] 新增 `npm run test:grok-refresh-consistency`，以临时 agent dir 和生产 resolver/list/Activate 路径覆盖 Active 提交、R0→R1→R2、list barrier、Activate、non-Active、single-flight、上游/metadata/mirror 失败与 secret 投影边界。
- [x] `npm run test:grok-refresh-consistency`
- [x] `npm run test:grok-accounts`（96 passed）
- [x] `npm run test:grok-global-auth`（7 passed）
- [x] `npm run test:oauth-accounts`
- [x] `npm run test:kiro-refresh-activate-race`（4 passed）
- [x] `npm run test:antigravity-refresh-activate-race`（4 passed）
- [x] `npm run lint`（0 error；7 条既有 warning）
- [x] `node_modules/.bin/tsc --noEmit`
- [x] `git diff --check`

验证临时使用相邻工作树的已安装依赖，随后移除链接；本工作树本身仍没有 `node_modules`。DOC-01 应在文档改动后汇总最终任务级勾选与门禁结论。

## 8. DOC-01 最终验证记录（2026-07-21）

- [x] 更新 `docs/architecture/overview.md`：managed Grok slot 真相、`auth.json` 单向 Active 镜像、锁内 slot-first/mirror-second 提交及部分失败收敛。
- [x] 更新 `docs/integrations/README.md`：普通 list 无 secret 回写、显式 bootstrap/adopt、provider lock 与 safe mirror failure 语义。
- [x] 更新 `docs/modules/library.md`：OAuth store / Grok resolver helper、无副作用投影与非重入锁复用规则。
- [x] `npm run test:grok-refresh-consistency`
- [x] `npm run test:grok-accounts`（96 passed）
- [x] `npm run test:grok-global-auth`（7 passed）
- [x] `npm run test:oauth-accounts`
- [x] `npm run test:kiro-refresh-activate-race`（4 passed）
- [x] `npm run test:antigravity-refresh-activate-race`（4 passed）
- [x] `npm run test:kiro-accounts`（28 passed）
- [x] `npm run test:antigravity-accounts`（29 passed）
- [x] `npm run lint`（0 error；7 条既有 warning）
- [ ] `node_modules/.bin/tsc --noEmit`：**未通过，不可作为任务代码失败结论**。本工作树没有 `node_modules`；临时链接的 `ypi-fixture-runtime` 是 pi SDK `0.80.6`，与项目要求的 `0.80.10` 不匹配，导致 `ModelRuntime` / `CredentialInfo` 等既有 API 类型缺失。必须使用本项目 `package-lock.json` / shrinkwrap 安装的 `0.80.10` 依赖后重跑。
- [x] `git diff --check`
- [x] 临时 `node_modules` 链接已移除，未修改依赖锁文件。

## 9. 残余风险

- **合入前门禁**：在本工作树安装项目精确锁定的依赖（pi SDK `0.80.10`）后，必须重跑 `node_modules/.bin/tsc --noEmit`；当前 `0.80.6` fixture 的类型错误不适用于本次改动，但不能替代真实 typecheck。
- 跨文件提交不是真正数据库事务；设计通过“先保存不可丢的轮换 credential、Active mirror 作为成功条件、后续收敛”处理部分失败。
- 跨进程 `forceRefresh:true` 仍可能在 provider lock 下顺序刷新两次；本任务只保持既有同进程 single-flight，不新增分布式 single-flight。
- 修复无法复活已经被旧版本回退并作废的 refresh token，相关账号仍需重新登录一次。
