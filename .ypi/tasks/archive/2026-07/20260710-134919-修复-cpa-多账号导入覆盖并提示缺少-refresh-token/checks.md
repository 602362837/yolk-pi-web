# checks

## 自动验证

实施后至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

新增/扩展 OAuth account 的定向脚本或测试后也必须运行它；若引入 package script，应记录在 `package.json` 和本文件。不可用真实 token 进行自动测试。

## 行为检查

- [ ] 两条 CPA 凭据使用同一个真实 ChatGPT id、不同 access/refresh：定向 storage 测试已编写但当前环境无法执行；需补跑。
- [x] 每条新 summary 的 `accountId` 是稳定保存账号 id；代码审查确认列表行、API、quota/warmup/failover 均沿用该 id。
- [ ] 实际 stored credential 保留真实 `accountId`；定向 quota 测试已编写但当前环境无法执行，header/cache 另有静态审查证据。
- [x] Pi Codex 请求仍从 access JWT 提取真实 `chatgpt_account_id`；本次未修改 Pi transport，显式 quota/reset/label header 均不使用 storage id。
- [ ] 旧 version 1 metadata + `<legacy-id>.json` 的读取和原路径写回由定向 storage 测试覆盖；测试当前无法执行，其余 route/warmup/failover 为静态调用链审查。
- [x] token refresh 回写显式携带 credential 上的非枚举 storage id；原路径、metadata id 和 cache key 不因 refresh 改变（静态审查，未用真实 token 运行）。
- [x] auto failover、warmup、usage scheduler 使用 summary `accountId` 遍历；相同真实 id 不会折叠候选（静态审查，未实际调度）。
- [ ] CPA 缺 refresh/refresh 为空但 access + 可解析 expires 完整：converter smoke 已通过，但完整转换/保存测试当前无法执行；当前 access 有效时不被本层阻止（静态审查）。
- [x] 无 refresh token 的过期 saved/active credential 现在返回“重新导入或登录”导向的错误；未使用真实 token 验证。
- [ ] CPA 缺 access 或 expires 仍阻断；无效批次测试已编写但当前无法执行，需补跑。
- [x] 路由仍使用 `accountId` 请求字段和原 provider 限制；summary/warning 不含 token（静态审查）。

## UI 门禁与人工验收

- [x] ui-designer 已交付 `cpa-refresh-token-risk-prototype.html`，并链接于 `ui.md` / `plan-review.md`。
- [x] 用户已明确批准 HTML 原型和计划；`events.jsonl` 记录 2026-07-10 06:00:48/06:01:31 的批准及 06:01:37 的进入实现。
- [x] warning 使用非错误样式并在转换成功后可见；保存按钮保持可用。
- [x] error 与 warning 可区分，`role`/`aria-live` 已加入；布局使用响应式网格并保留可读文案（未运行浏览器手工验证）。
- [x] 多账号提示没有显示 access/refresh token，且 modal 的 cancel/close/submitting 防护未被代码改动移除。

## 回归重点

- 登录添加账号 (`accountMode=add`) 与普通登录同步 active auth：静态审查通过，未执行真实 OAuth。
- `/api/auth/accounts/[provider]` GET/POST/PATCH/DELETE 与 `/activate`：静态审查通过，未执行 HTTP 手工验证。
- `/api/auth/quota/[provider]` GET/POST、warmup、usage refresh scheduler、ChatGPT auto-failover：静态审查通过；mocked fetch 定向测试已编写但当前无法执行。
- `reloadRpcAuthState()` 在激活后仍执行：代码未改动，静态审查通过。

## 实际验证记录（2026-07-10）

- `npm run lint` — 通过。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `git diff --check` — 通过。
- `npx --no-install tsx -e ...oauth-account-converters...` — 通过，确认缺 refresh 转换为 `refresh: ""` + warning。
- `node_modules/.bin/tsx lib/oauth-account-storage.test.ts` — 未执行：项目未安装 `tsx` binary。
- `node_modules/.bin/tsx lib/subscription-quota-storage-id.test.ts` — 未执行：项目未安装 `tsx` binary。
- `node --loader ./scripts/ts-extension-loader.mjs ...test.ts` — 失败：当前 Node strip-only loader 不支持项目已有的 TypeScript parameter property。
- `npx --no-install tsx ...test.ts` — 失败：当前依赖安装的 `@earendil-works/pi-coding-agent` package exports 无可解析 main entry。

未使用真实 OAuth token；未完成浏览器/API/refresh/warmup/failover 手工验证。
