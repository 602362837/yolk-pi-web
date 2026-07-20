# Implement：Grok CLI 重新登录

## 实现前提

1. UI 设计员已产出并由用户批准 `grok-cli-reauth-prototype.html`。
2. 用户已批准 [plan-review.md](./plan-review.md) 中的四项产品决策。
3. 主会话已把本文件中的 `ypi-implementation-plan` 保存为任务 implementationPlan，并合法切换到 implementing。
4. 实现员不得扩展到 Kiro/Antigravity/ChatGPT reauth，不得修改 dependency pin。

## 优先阅读文件

1. `AGENTS.md`
2. `docs/integrations/README.md`
3. `docs/modules/frontend.md`
4. `docs/modules/api.md`
5. `docs/modules/library.md`
6. `docs/standards/code-style.md`
7. `app/api/auth/login/[provider]/route.ts`
8. `lib/oauth-accounts.ts`
9. `lib/oauth-account-providers.ts`
10. `lib/grok-account-token.ts`
11. `lib/grok-subscription-quota.ts`
12. `lib/kiro-account-lock.ts`、`lib/antigravity-account-lock.ts`（锁模式参考，不共享 provider 状态）
13. `components/ModelsConfig.tsx`
14. `components/GrokQuotaView.tsx`
15. `components/GrokUsagePanel.tsx`
16. `components/AppShell.tsx`
17. 本任务 `brief/prd/ui/design/checks/plan-review` 与已批准 HTML 原型
18. `node_modules/pi-grok-cli/README.md` 与 `src/auth/oauth.ts` 仅作 installed-package evidence；生产代码不得 deep import

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| GROK-REAUTH-01 | foundation | 1 | — | 建立 Grok reauth 持久化、锁与旧 cache 隔离 | `lib/grok-account-lock.ts`, `lib/oauth-accounts.ts`, `lib/grok-account-token.ts`, `lib/grok-subscription-quota.ts` | 否 |
| GROK-REAUTH-02 | api | 2 | 01 | 扩展 OAuth SSE route 的 Grok-only reauth mode 与安全错误 | `app/api/auth/login/[provider]/route.ts`, `lib/grok-login-errors.ts`（如需要） | 否 |
| GROK-REAUTH-03 | ui | 3 | 02 | 实现 Models 恢复态、账号级 reauth 与 Top-bar 聚焦深链 | `components/ModelsConfig.tsx`, `components/GrokQuotaView.tsx`, `components/GrokUsagePanel.tsx`, `components/AppShell.tsx`, `app/globals.css` | 否 |
| GROK-REAUTH-04 | verification-docs | 4 | 01,02,03 | 增加测试、完成回归、浏览器验收和文档 | `lib/*.test.ts`, `scripts/test-grok-reauth.mjs`, `package.json`, `docs/**` | 否 |

> 单 writer 顺序执行。01–03 修改共享 auth/UI 状态机，不建议并行写入同一 worktree。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "strategy": "serial safety-first DAG",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "GROK-REAUTH-01",
      "title": "建立 Grok 原位重新授权持久化、并发锁和旧 quota 隔离",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/grok-account-lock.ts",
        "lib/oauth-accounts.ts",
        "lib/grok-account-token.ts",
        "lib/grok-subscription-quota.ts",
        "lib/oauth-account-grok.test.ts"
      ],
      "instructions": [
        "参照 Kiro/Antigravity 建立 Grok process + cross-process provider lock；不要共享其他 provider 的锁状态。",
        "让 Grok Activate、credential refresh/read-write 和 reauthenticate commit 遵循同一非重入锁层级，避免旧 refresh 在重新登录后覆盖新 credential。",
        "在 OAuth account store 增加受约束的原位 reauthenticate helper：lock-time 验证目标存在、校验 Grok credential、保留 opaque id/label/extraInfo/createdAt/lastActivatedAt/Active 指针，更新 diagnostic id 和 updatedAt。",
        "credential 与 metadata 使用 same-dir tmp+rename、0600；对跨文件第二阶段失败做 best-effort rollback，不记录 secret/path。",
        "目标仍为 Active 时更新 CredentialStore mirror；非 Active 绝不改 auth.json。",
        "reauth 成功后失效 token flight；为 quota 增加 generation invalidation，并删除内存与持久化 account cache entry，阻止旧 in-flight 结果回写。",
        "保持 accountMode=add、import、activate、delete 和其他 provider 行为兼容。"
      ],
      "acceptance": [
        "同一 storage id 原位替换且 metadata 用户字段保留。",
        "非 Active reauth 不改变 Active/auth.json；Active reauth 保持 Active 并镜像新凭据。",
        "目标在 commit 前被删除返回 not found 且不重新创建。",
        "旧 refresh 与 reauth 的两种先后顺序都不会让旧 credential 赢回。",
        "旧 quota memory/persisted/in-flight 数据不会在新 credential 下出现。",
        "文件权限和 secret 边界保持。"
      ],
      "validation": [
        "npm run test:grok-accounts",
        "npm run test:grok-quota",
        "npm run test:grok-global-auth",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "非重入锁内调用 list/sync 形成死锁",
        "credential 与 metadata 双文件部分成功",
        "旧 quota flight 在 invalidation 后重新持久化",
        "错误 rollback 覆盖并发 Activate"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "lock hierarchy",
          "active CAS",
          "atomic write/rollback",
          "cache generation",
          "secret safety"
        ]
      }
    },
    {
      "id": "GROK-REAUTH-02",
      "title": "扩展 OAuth SSE login route 的 Grok-only reauth mode",
      "phase": "api",
      "order": 2,
      "dependsOn": [
        "GROK-REAUTH-01"
      ],
      "files": [
        "app/api/auth/login/[provider]/route.ts",
        "lib/grok-login-errors.ts",
        "scripts/test-grok-reauth.mjs"
      ],
      "instructions": [
        "严格解析 accountMode：空、add、reauth；reauth 要求 provider=grok-cli 且 accountId 非空，拒绝歧义/未知参数。",
        "OAuth 开始前读取目标账号做 preflight；OAuth 成功提交时由 store helper lock-time 再验证。",
        "reauth 与 add 一样使用 isolated in-memory CredentialStore/ModelRuntime，成功前不碰 durable Active。",
        "成功调用原位 reauthenticate helper；仅目标仍为 Active 时 await reloadRpcAuthState。",
        "SSE success 只投影安全账号摘要、active boolean 和固定消息。",
        "为 Grok login/add/reauth 统一安全错误映射，不原样透传可能含 upstream response text 的 Error.message。",
        "保持 POST token/code callback contract、abort cleanup 和已有 add/login 兼容。"
      ],
      "acceptance": [
        "reauth 缺 target、目标不存在、provider 非 Grok、未知 mode 均 fail closed 且零写入。",
        "OAuth 取消/失败零写入。",
        "Active 成功 reload；非 Active 不 reload/不切 Active。",
        "响应无 credential、raw body、callback URL/code、路径。",
        "现有 add 和无 mode 登录仍工作。"
      ],
      "validation": [
        "npm run test:grok-reauth",
        "npm run test:grok-accounts",
        "npm run test:web-model-runtime",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "SSE 已开始后才发现非法 target",
        "错误 mapper 仍泄漏第三方 response text",
        "reload 失败与 durable commit 状态表达不一致",
        "accountId 被误当路径"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "strict query contract",
          "isolated login store",
          "safe SSE projection",
          "abort cleanup"
        ]
      }
    },
    {
      "id": "GROK-REAUTH-03",
      "title": "实现 Models Grok 恢复态、账号级重新登录和 Top-bar 聚焦深链",
      "phase": "ui",
      "order": 3,
      "dependsOn": [
        "GROK-REAUTH-02"
      ],
      "files": [
        "components/ModelsConfig.tsx",
        "components/GrokQuotaView.tsx",
        "components/GrokUsagePanel.tsx",
        "components/AppShell.tsx",
        "app/globals.css",
        ".ypi/tasks/20260720-111824-为-grok-cli-增加重新登录功能/grok-cli-reauth-prototype.html"
      ],
      "instructions": [
        "严格按已批准 HTML 原型实现，不自行改变账号行层级或确认文案。",
        "managed OAuth provider 在 loggedIn=false 但 accountCount>0 时仍出现在已有账号区域；状态文案区分未连接与已有账号待恢复。",
        "Grok quota load/effect/render 在 saved accounts 存在时运行并解析 401 安全投影，展示 reauth CTA。",
        "为 Grok account row 和 GrokQuotaView 提供同一 target-aware reauth controller；不向其他 provider 暴露未批准能力。",
        "确认 Active/非 Active 影响后再显示 browser/device/existing；用真实 upstream option id 自动回答 select_request，不匹配时 fallback。",
        "实现目标级 busy、cancel、success、error、deleted/conflict；成功后保留选择、reload accounts/provider status 并 force-refresh 新 quota。",
        "Active 与非 Active 使用不同成功文案，且说明无法可靠校验同一 xAI 身份。",
        "GrokUsagePanel 只请求 AppShell 打开 Models 并传 provider/account focus；Models 消费一次性 focus，不直接从 top panel 启动 OAuth。",
        "处理 provider change/unmount/EventSource cleanup、focus restore、375px 响应式和 reduced-motion。"
      ],
      "acceptance": [
        "失效 Grok saved accounts 在 Models 中可见并可恢复。",
        "每个 Grok account 可原位重新登录；选中账号 banner CTA 等价。",
        "点击登录方式只需一次选择；未知上游 options 安全降级。",
        "失败/取消保留账号和 Active；成功不创建重复 slot。",
        "Top-bar reauth link 打开并聚焦 Grok/target，不自动弹外部 OAuth。",
        "375px、键盘、焦点、alert/status 与已批准原型一致。"
      ],
      "validation": [
        "npm run test:grok-usage-panel",
        "npm run test:grok-reauth",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器按 checks.md 验证有效/失效 Active/失效非 Active/取消/失败/冲突/窄屏"
      ],
      "risks": [
        "Models 左侧 provider 分类回归",
        "账号行按钮过密或窄屏溢出",
        "旧 account quota 响应闪回",
        "EventSource 未清理",
        "Top-bar focus context 下次打开残留"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "approved prototype fidelity",
          "managed invalid-provider visibility",
          "target identity",
          "a11y/responsive",
          "race guards"
        ]
      }
    },
    {
      "id": "GROK-REAUTH-04",
      "title": "完成 Grok reauth 自动测试、文档、回归与用户流验证",
      "phase": "verification-docs",
      "order": 4,
      "dependsOn": [
        "GROK-REAUTH-01",
        "GROK-REAUTH-02",
        "GROK-REAUTH-03"
      ],
      "files": [
        "scripts/test-grok-reauth.mjs",
        "package.json",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md"
      ],
      "instructions": [
        "新增 focused reauth test script，优先执行真实 store helper/故障注入，避免只有源码字符串断言。",
        "覆盖 active/non-active、metadata preserve、target deleted、OAuth failure zero-write、refresh race、quota generation、safe projection 和 provider scope。",
        "运行既有 Grok accounts/quota/global-auth/usage-panel/failover/provider tests，确认无回归。",
        "使用真实浏览器按已批准原型验证 Models 与 top-bar standalone/aggregate 流程；记录截图或明确步骤结果。",
        "更新 API、frontend、library、integration docs；说明 slot replacement、identity limitation、lock/cache boundary 和 rollback。",
        "不运行 next build；仅 release 明确要求时使用 npm run build。"
      ],
      "acceptance": [
        "lint、typecheck、focused reauth 与既有 Grok 回归全部通过。",
        "浏览器人工验收覆盖 checks.md 且与 HTML 原型一致。",
        "文档不声称可强校验 xAI 同一身份。",
        "未改 Kiro/Antigravity/Codex reauth 行为，未改依赖 pin。",
        "无生产构建污染、无 secret 日志/fixture。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:grok-reauth",
        "npm run test:grok-provider",
        "npm run test:grok-accounts",
        "npm run test:grok-quota",
        "npm run test:grok-global-auth",
        "npm run test:grok-usage-panel",
        "npm run test:grok-failover-adapter",
        "npm run test:grok-failover-runtime"
      ],
      "risks": [
        "测试只验证静态源码而未覆盖 durable race",
        "使用真实 OAuth 测试时误写用户账号",
        "文档遗漏 identity/cache 风险",
        "UI 只测 standalone 未测 aggregate"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "requirements coverage",
          "security/privacy",
          "real user flow",
          "regression suite",
          "docs accuracy"
        ]
      }
    }
  ],
  "execution": {
    "groups": [
      {
        "order": 1,
        "subtaskIds": [
          "GROK-REAUTH-01"
        ]
      },
      {
        "order": 2,
        "subtaskIds": [
          "GROK-REAUTH-02"
        ]
      },
      {
        "order": 3,
        "subtaskIds": [
          "GROK-REAUTH-03"
        ]
      },
      {
        "order": 4,
        "subtaskIds": [
          "GROK-REAUTH-04"
        ]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-reauth
npm run test:grok-provider
npm run test:grok-accounts
npm run test:grok-quota
npm run test:grok-global-auth
npm run test:grok-usage-panel
npm run test:grok-failover-adapter
npm run test:grok-failover-runtime
```

## 手工验证环境

- 使用临时 `PI_CODING_AGENT_DIR` 做 store/API 故障注入；不得使用真实用户 credential fixture。
- 真实 OAuth 只由用户在明确同意后执行，并使用可识别的测试账号；录屏/截图不得包含 callback URL、device code、token 或完整账号 id。
- 浏览器覆盖 Models、standalone usage、aggregate usage、375px、键盘。

## 评审门禁

1. checker 必须确认已批准 HTML 原型存在且实现一致。
2. checker 必须重点审查 lock hierarchy、旧 refresh/quota race 和 Active/non-Active auth.json 差异。
3. 任一需要“强制同一 xAI 身份”的新要求必须退回产品决策，不能用 refresh hash 冒充稳定 identity。
4. 若实现把 reauth 开放给 Kiro/Antigravity，属于范围扩展，必须退回审批。
5. 实现员自报测试通过不能替代 checker 独立检查。

## 回滚

1. 隐藏 reauth UI/深链，停止新流程。
2. route 拒绝 `accountMode=reauth`，保留 add/login。
3. 已成功更新的账号仍是合法 saved account，保留数据，不做反向迁移。
4. 必要时再回滚 store helper；优先保留无副作用的锁/cache generation 安全改进。
