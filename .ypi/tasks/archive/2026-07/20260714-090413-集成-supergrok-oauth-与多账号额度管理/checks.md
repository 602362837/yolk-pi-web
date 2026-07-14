# Checks：SuperGrok OAuth 与多账号额度

## 需求覆盖

- [ ] `grok-cli` 在无既存 session 的冷启动 Auth/Models API 中可见。
- [ ] 主 Chat、恢复 Chat、fork 后会话、Studio SDK child 均加载同一 provider factory。
- [ ] OAuth browser/device/manual/existing/cancel/error 流程均有安全 Web 投影。
- [ ] add-account 不覆盖 active；每次保存使用 opaque storage id。
- [ ] 激活原子更新 sidecar metadata 与 `auth.json` mirror。
- [ ] 已有会话保持 account pin；active 切换只影响新会话默认（待产品确认）。
- [ ] 同账号 refresh single-flight，不同账号互不阻塞；刷新结果写回正确 secret 文件。
- [ ] 月/周 quota 字段映射、TTL、force refresh、stale fallback、401 refresh retry 正确。
- [ ] UI HTML 原型和用户审批记录存在后才实现。

## 自动验证建议

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run build  # 仅最终 release/集成验证，不作日常开发检查
```

新增 focused tests 应覆盖：

- provider bootstrap：fresh process 中 Models/Auth 都看到 `grok-cli`；所有 registry refresh 后 provider 仍存在。
- account store：create/list/activate/delete、active fallback/clear、0600/0700、metadata 无 secret、provider 隔离、原子写失败恢复。
- OAuth SSE：select/auth/device/manual/cancel，响应不含 credential/code/callback URL。
- refresh：过期/未过期、refresh rotation、并发同账号一次刷新、跨账号隔离、fatal refresh 保留凭证并 reauthRequired。
- session binding：active A 创建 session A，激活 B 后 session A 仍取 A，新 session 取 B；resume/fork/Studio child 继承规则。
- billing parser：monthly 正常；weekly 正常/缺失/畸形；NaN/负数/used>limit；日期无效；raw body 不外泄。
- quota cache：fresh hit、single-flight、force、stale-on-5xx/429、24h 过期、401 refresh+单次 retry、no-store。
- non-regression：OpenAI OAuth accounts、xAI/API-key managed accounts 和其他 models 不变。

测试必须用临时 `PI_CODING_AGENT_DIR` / 隔离 auth backend，不读取或写入真实 `~/.pi/agent`、`~/.grok/auth.json`。

## 安全检查

- [ ] 浏览器/API/日志/telemetry 不出现 access、refresh、id token、auth code、callback URL、raw billing payload。
- [ ] OAuth discovery/token endpoint 仍由扩展执行 xAI HTTPS host 校验。
- [ ] account API 只接受 allowlisted provider；路径不从用户输入直接拼接。
- [ ] secret 文件 `0600`、目录 `0700`，写入采用 tmp + rename；metadata 只有 opaque id/label/cache。
- [ ] 错误分类基于 HTTP status/内部 code；上游 response body 只写受控诊断或完全丢弃。
- [ ] quota response `Cache-Control: no-store`，前端不持久化 credential。

## 人工验收

1. 全新环境启动，Models 中看到 Grok CLI，登录第一个账号并选模型完成一次对话。
2. 添加第二账号，不覆盖第一账号；分别刷新额度并核对卡片不串数据。
3. 用账号 A 开会话 A，激活 B 后继续 A，再开会话 B；抓取安全诊断确认请求账号引用隔离（不可显示 token）。
4. OAuth token 过期模拟刷新，两个并发会话同账号只刷新一次；另一个账号不受影响。
5. 模拟 billing weekly 失败、monthly 500、429、401、断网，核对 stale/error/reauth UI。
6. 删除非 active；删除 active；删除有 session 引用账号，核对阻止/迁移确认。
7. 深浅主题、窄屏、键盘、Escape、焦点恢复、屏幕阅读标签。

## 重点回归风险

- Pi provider/OAuth registry 是进程全局，而 `ModelRegistry.registeredProviders` 属于实例；任何不含 Grok 注册的 registry 调用 `refresh()` 都可能 reset 全局动态 provider。检查所有 Web registry 创建/刷新入口。
- 直接使用全局 `auth.json` active token 会破坏并发隔离。
- `pi-grok-cli` 内部 `src/*` 不是公开 export；实现不得依赖内部深路径作为稳定 Web API。
- 完整扩展会附带 Cursor tools、vision、Imagine；必须按审批范围验收，不得静默引入。
