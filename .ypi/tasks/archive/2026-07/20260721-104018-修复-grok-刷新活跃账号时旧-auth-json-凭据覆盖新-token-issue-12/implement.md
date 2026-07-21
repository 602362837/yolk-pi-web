# Implement：Grok Active 刷新凭据一致性

## 1. 优先阅读

1. `AGENTS.md`
2. `docs/integrations/README.md`
3. `docs/architecture/overview.md`
4. `docs/modules/api.md`
5. `docs/modules/library.md`
6. `docs/standards/code-style.md`
7. `lib/oauth-accounts.ts`
8. `lib/grok-account-token.ts`
9. `lib/grok-account-lock.ts`
10. `lib/web-credential-store.ts`
11. `app/api/auth/login/[provider]/route.ts`
12. `app/api/auth/logout/[provider]/route.ts`
13. `app/api/auth/providers/route.ts`
14. `app/api/auth/accounts/[provider]/route.ts`
15. Kiro/Antigravity token resolver 与 refresh-Activate race 测试

## 2. 人类可读子任务表

| ID | 阶段 | 顺序 | 子任务 | 依赖 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| AUTH-01 | Store | 1 | 拆分 OAuth list、Active metadata 读取与显式接纳 | - | 否 |
| GROK-01 | Resolver | 2 | 实现 Grok 锁内 refresh/mirror 提交与失败收敛 | AUTH-01 | 否 |
| TEST-01 | Verify | 3 | 增加轮换 token 与并发生产路径回归 | GROK-01 | 否 |
| DOC-01 | Docs | 4 | 更新架构/集成/library 文档并完成全量门禁 | TEST-01 | 否 |

本任务集中修改同一凭据一致性边界，建议 `maxConcurrency=1`，避免并行实现对 authority/lock 语义作出冲突假设。

## 3. 执行步骤

### AUTH-01：OAuth store 职责拆分

- 全仓审计 `listOAuthAccounts()` 与 `syncActiveOAuthAccountCredential()` 调用方。
- 提供无 `auth.json`/secret 写副作用的 Active metadata 读取 helper。
- 抽出不取 provider lock 的账号列表投影 core，供已持锁 mutation 使用。
- 取消 public list 的无条件 `auth.json -> existing slot` 同步。
- 将 auth-only bootstrap、成功 login 接纳、OpenAI runtime refresh 接纳、logout Active 清理变成显式调用；bootstrap 不覆盖有效 managed Active。
- Grok 的显式 Active secret 接纳通过 provider lock；避免 public locked wrapper 在已持锁路径中嵌套调用。
- 不改 API wire、metadata schema、opaque id。

### GROK-01：Grok resolver 提交协议

- 删除 Grok token resolver 对带 secret 同步副作用的 list 依赖。
- 在 provider lock 内读取最新 credential 和 Active metadata。
- 上游 refresh 成功后先原子保存新 account credential，再复核 Active 并更新 mirror。
- Active mirror 失败时保留新 account credential并返回固定安全错误；不得继续返回 `refreshed:true`。
- 无需 refresh 但目标为 Active 时执行 mirror convergence，使前一次部分提交可以恢复。
- 保持 non-Active 隔离、single-flight、`forceRefresh`、AbortSignal、0600/0700 和 tmp+rename。

### TEST-01：聚焦回归

建议新增 `scripts/test-grok-refresh-consistency.mjs` 并注册 `test:grok-refresh-consistency`，使用临时 `PI_CODING_AGENT_DIR`、jiti 和受控 OAuth provider fixture 驱动真实生产路径：

1. Active C0 -> C1 两处一致；
2. 一次性 refresh token 连续两次刷新使用 R0 -> R1 -> R2；
3. refresh + list barrier 不回写 C0；
4. refresh A + Activate B 两种顺序；
5. non-Active refresh；
6. 同进程 single-flight 上游调用一次；
7. 上游失败零写入；
8. metadata 损坏刷新前 fail closed；
9. mirror 写失败保留 C1，修复条件后下一次 resolver 收敛；
10. list/API/error/console 不含 sentinel secret。

随后运行现有 Grok、OAuth、Kiro、Antigravity 回归。

### DOC-01：文档与验收

- 更新 saved-account authority、Active mirror 单向关系、list 无 secret 回写、显式 bootstrap/login 接纳和 mirror 部分失败恢复。
- 修正所有“CAS 已保证一致”的过度声明。
- 完成 lint、typecheck、focused tests 和 `checks.md` 人工文件检查。

## 4. Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "修复 Grok Active 刷新后的旧凭据回退",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "AUTH-01",
      "title": "拆分 OAuth 列表、Active metadata 读取与显式凭据接纳",
      "phase": "store",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/oauth-accounts.ts",
        "app/api/auth/providers/route.ts",
        "app/api/auth/accounts/[provider]/route.ts",
        "app/api/auth/login/[provider]/route.ts",
        "app/api/auth/logout/[provider]/route.ts",
        "lib/subscription-quota.ts"
      ],
      "instructions": "审计所有 list/sync 调用方；新增无 secret 写的 Active metadata 读取与内部列表投影；取消 list 对 auth.json 到已存在槽位的无条件回写；将 auth-only bootstrap、成功 login/runtime refresh 接纳和 logout Active 清理改为显式边界。Grok secret 接纳受 provider lock 保护，已持锁路径只能调用 internal unlocked/projector，避免非重入死锁。",
      "acceptance": [
        "listOAuthAccounts 不再把 auth.json secret 写入现有 managed slot",
        "legacy auth-only、normal login、logout、OpenAI runtime refresh 行为保持",
        "API wire、metadata schema、opaque id 不变",
        "提供 Grok resolver 可复用的无副作用 Active metadata helper"
      ],
      "validation": [
        "npm run test:oauth-accounts",
        "npm run test:grok-accounts",
        "npm run test:kiro-accounts",
        "npm run test:antigravity-accounts",
        "全仓检查 listOAuthAccounts/syncActiveOAuthAccountCredential 调用方"
      ],
      "risks": [
        "遗漏依赖 list 隐式同步的调用方",
        "public lock wrapper 与 locked mutation 形成嵌套死锁",
        "logout Active 展示语义变化"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "GROK-01",
      "title": "实现 Grok refresh 与 Active mirror 的锁内提交协议",
      "phase": "resolver",
      "order": 2,
      "dependsOn": ["AUTH-01"],
      "files": [
        "lib/grok-account-token.ts",
        "lib/grok-account-lock.ts",
        "lib/web-credential-store.ts"
      ],
      "instructions": "在 Grok provider lock 内读取最新 credential 和 Active metadata；上游刷新后先原子保存新 slot credential，再复核 Active 并更新 auth mirror。Active mirror 写失败必须保留轮换后的 credential、返回安全错误，并允许下一次无需刷新的 resolver 调用重试 mirror convergence。删除 resolver 对有同步副作用 list 的依赖，保持 non-Active、single-flight、forceRefresh、AbortSignal 和权限契约。",
      "acceptance": [
        "Active refresh 成功后 slot 与 auth mirror 为同一新 credential",
        "non-Active refresh 不改变 Active mirror",
        "mirror 失败不回滚新 refresh token且后续可收敛",
        "metadata 不可读时 fail closed且不消费 refresh token",
        "无 credential/upstream/path 泄漏"
      ],
      "validation": [
        "新增 Grok refresh consistency focused test",
        "npm run test:grok-accounts",
        "npm run test:grok-global-auth"
      ],
      "risks": [
        "跨文件提交无法真正原子",
        "有效 token 路径漏掉 mirror repair",
        "错误吞掉导致调用方误判成功"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "TEST-01",
      "title": "覆盖轮换 refresh token、list 与 Activate 并发",
      "phase": "verify",
      "order": 3,
      "dependsOn": ["GROK-01"],
      "files": [
        "scripts/test-grok-refresh-consistency.mjs",
        "package.json",
        "lib/oauth-account-grok.test.ts",
        "scripts/test-grok-accounts.mjs"
      ],
      "instructions": "使用临时 agent dir、jiti、受控 OAuth provider 和 barrier 驱动生产 getGrokAccessToken/list/Activate 路径。覆盖 Active/非 Active、R0→R1→R2 轮换、list 旧快照竞态、Activate 交错、single-flight、上游失败、metadata 失败、mirror 失败恢复及 secret 不出边界；不得只做源码字符串断言。",
      "acceptance": [
        "确定性复现测试在旧代码失败、新代码通过",
        "并发测试验证最终 metadata/slot/auth 三者合法",
        "第二次刷新明确断言使用新 refresh token",
        "失败测试断言旧 token 不被恢复",
        "Kiro/Antigravity refresh-Activate race 无回归"
      ],
      "validation": [
        "npm run test:grok-refresh-consistency",
        "npm run test:grok-accounts",
        "npm run test:grok-global-auth",
        "npm run test:oauth-accounts",
        "npm run test:kiro-refresh-activate-race",
        "npm run test:antigravity-refresh-activate-race"
      ],
      "risks": [
        "sleep-only 并发测试产生偶发性",
        "fixture 注册污染其他测试",
        "测试输出意外打印 sentinel token"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-01",
      "title": "更新 OAuth/Grok 架构文档并完成质量门禁",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["TEST-01"],
      "files": [
        "docs/architecture/overview.md",
        "docs/integrations/README.md",
        "docs/modules/library.md",
        ".ypi/tasks/20260721-104018-修复-grok-刷新活跃账号时旧-auth-json-凭据覆盖新-token-issue-12/checks.md"
      ],
      "instructions": "记录 managed slot 真相、auth Active 单向镜像、list 无 secret 回写、显式 bootstrap/login 接纳、provider lock 和部分失败恢复；运行全部最低门禁并记录结果。",
      "acceptance": [
        "文档不再宣称未满足的 CAS 一致性",
        "shared list 和 Grok refresh 契约与代码一致",
        "最低验证与 focused regression 全部通过"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "文档遗漏 legacy bootstrap 或 mirror failure 语义"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "G1", "subtaskIds": ["AUTH-01"] },
      { "id": "G2", "subtaskIds": ["GROK-01"] },
      { "id": "G3", "subtaskIds": ["TEST-01"] },
      { "id": "G4", "subtaskIds": ["DOC-01"] }
    ]
  }
}
```

## 5. 验证命令

```bash
npm run test:grok-refresh-consistency
npm run test:grok-accounts
npm run test:grok-global-auth
npm run test:oauth-accounts
npm run test:kiro-refresh-activate-race
npm run test:antigravity-refresh-activate-race
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

如共享 store 改动影响更广，追加：

```bash
npm run test:kiro-accounts
npm run test:antigravity-accounts
npm run test:grok-all
```

不要直接运行 `next build`。

## 6. 检查门禁

- 未有生产路径的轮换 token + list barrier 测试，不得判定完成。
- Active mirror 错误仍被吞掉并返回成功，不得判定完成。
- 普通 list 仍能把 `auth.json` secret 写回已存在 slot，不得判定完成。
- 存在 provider lock 嵌套/超时风险且无测试，不得判定完成。
- 若出现任何 UI/交互/文案变化，停止实现并重新走 HTML 原型审批。
