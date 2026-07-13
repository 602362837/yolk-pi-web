# Review：为 xAI 提供商参照 OpenCode Go 增加多 API Key 管理

## Verdict

**Pass** — 实现完整覆盖 PRD/Design/Checks 范围内需求；无平行实现、无 xAI auto-failover 范围蔓延；secret 边界与隔离测试合格；lint / tsc / focused tests 全部通过。手工浏览器验收未在本轮执行，记为非阻塞残留风险，建议主会话在用户验收阶段完成。

## Scope reviewed

| Artifact / area | Result |
| --- | --- |
| plan-review / PRD / Design / Implement / Checks | 对照完成 |
| `lib/api-key-accounts.ts` allowlist | Pass |
| API routes（注释 + 通用分派复用） | Pass |
| `components/ModelsConfig.tsx` 泛化 | Pass |
| docs（library / api / frontend / operations / deployment） | Pass |
| `lib/api-key-accounts.test.ts` + runner | Pass |
| Failover scope creep | Pass（无 xAI 接入） |
| Secrets / no-store / temp agent dir | Pass |
| HTML 原型 `ui-prototype.html` | 存在；实现为既有 `ApiKeyAccountsDetail` 复用，与原型“完全复用 managed UI、无 OpenCode failover 控件”一致 |

## Findings Fixed

None. 检查过程中未发现需要当场修复的低风险缺陷；未改生产代码。

## Remaining Findings

### Non-blocking

1. **手工浏览器验收未执行**  
   checks.md 手工清单（legacy 导入展示、reveal 关闭后脱敏、active disable/delete 文案与回退、opencode-go / single-key 无回归）依赖 live Settings UI + 真实或一次性 Key。实现员 handoff 已声明未跑；本检查员同样未做浏览器验收。  
   **建议**：主会话进入用户验收时按 checks.md 手工清单走一遍；不阻塞代码审查通过。

2. **既有并发 metadata 写入风险（范围外）**  
   Design/Checks 已记录：跨进程 `accounts.json` 无事务锁。本轮未扩大语义，不要求修复。

3. **focused tests 未覆盖 enable/disable 动作路径**  
   覆盖 allowlist、summary 不导入、legacy 幂等、create/activate/update/mirror/reveal、delete fallback/last-clear、跨 provider 指纹隔离。enable/disable 仍走通用服务层（opencode-go 既有路径），风险低；可选后续补测，非本轮阻塞。

### Blocking

None.

## Checklist vs checks.md

| Item | Status |
| --- | --- |
| `xai` 与 `opencode-go` 均为 managed；其他不变 | Pass（allowlist + 测试） |
| all-providers / provider GET managed summary；summary 不触发 legacy import | Pass（既有 `isManagedApiKeyProvider` 分派 + 测试） |
| 首次 accounts GET 导入；重复不重复 | Pass（测试） |
| create/edit/activate/enable/disable/delete/reveal 通用路由 + provider 隔离 | Pass（代码复用；CRUD/mirror/隔离有测；enable/disable 未单测但无 xAI 专属分支） |
| active update/activate 写回 `auth.json`；删除回退/最后一项清除 | Pass（测试） |
| Settings → Models → xAI 与原型一致、无残留 OpenCode-specific 文案 | Pass（静态）：disable 对话框改用 `provider.displayName`；failover 文案已移除；`revealedKeys`/edit 状态在 `provider.id` 变化时清空。浏览器对照未跑 |
| 本轮未增加 xAI auto-failover | Pass：`lib/opencode-go-account-failover.ts` / `pi-web-config` 无 xAI 接线；文档明确 xAI 仅手动切换 |
| `accounts.json` 无明文；secret 0600；reveal `Cache-Control: no-store` | Pass（测试权限断言 + reveal route 头） |
| 跨 provider 同 fingerprint 不去重 | Pass（测试） |
| 文档列出两 provider 且不暗示 xAI failover | Pass |
| 陈旧 `v1 only opencode-go` 文案 | Pass（`lib`/`app`/`components`/`docs` 无残留） |

## Design / architecture compliance

- **最小扩展**：仅 `MANAGED_ACCOUNT_PROVIDERS` 加入 `"xai"`；无 xAI 专属存储/API/组件复制。
- **数据流**：summary 轻量、list 读时 legacy import、CRUD 写 `auth-api-key-accounts/xai/`、active mirror + reload 契约保持。
- **回滚**：移除 allowlist 即可回 single 模式；不自动删 account store — 与 design 一致。
- **UI 门禁**：任务目录含 `ui-prototype.html`；实现为复用既有 managed UI + 去掉 OpenCode Go failover 文案，符合已批准方案方向。未在本环境复验用户审批事件原文；若主会话确认审批记录缺失，属流程问题而非代码缺陷。

## Code quality notes

- `ApiKeyAccountsDetail` 在 provider 切换时重置 edit/reveal 等状态，修复了潜在跨 provider 明文/表单残留。
- 测试通过 `PI_CODING_AGENT_DIR` 临时目录 + `getAgentDir()` 断言，避免触碰真实 `~/.pi/agent`；`finally` 清理 temp dir。
- `scripts/run-api-key-accounts-test.mjs` 用 jiti + `@` alias，与项目其他 focused runner 风格一致；`jiti` 已在依赖树中。

## Verification

| Command | Result |
| --- | --- |
| `npm run lint` | **PASS**（exit 0，无 findings） |
| `node_modules/.bin/tsc --noEmit` | **PASS**（exit 0，无输出） |
| `npm run test:api-key-accounts` | **PASS** — 12/12 |
| `rg` stale `v1 only opencode-go` under lib/app/components/docs | **PASS** — 无匹配 |
| Failover scope static search | **PASS** — 无 xAI 接入 failover |
| Manual browser checklist | **Not run**（非阻塞） |

## Files reviewed (implementation evidence)

| Path | Review note |
| --- | --- |
| `lib/api-key-accounts.ts` | allowlist `opencode-go`, `xai` |
| `lib/api-key-accounts.test.ts` | 新建隔离生命周期测试 |
| `scripts/run-api-key-accounts-test.mjs` | focused runner |
| `package.json` | `test:api-key-accounts` |
| `app/api/auth/api-key/[provider]/route.ts` | 注释更新 |
| `app/api/auth/api-key/[provider]/accounts/route.ts` | 注释更新 |
| `components/ModelsConfig.tsx` | provider 泛化 + failover 文案清理 |
| `docs/modules/{library,api,frontend}.md` | managed providers 列表更新 |
| `docs/operations/troubleshooting.md` | xAI 路径 + 无 auto-failover |
| `docs/deployment/README.md` | managed store 说明 |

## Decisions for main session

1. 可将任务从 checking 推进（不由检查员自行 `user_acceptance`）。
2. 用户验收阶段执行 checks.md 手工浏览器清单；若仅有文档/代码验收也可先关闭实现侧门禁，但应在 summary 中注明“UI 手工未自动化”。
3. 不要 git commit/push（Studio 规则）；由主会话决定提交时机。
4. 无需返工实现员；无需架构师/UI 设计员重开，除非用户验收发现与原型不一致的体验问题。
