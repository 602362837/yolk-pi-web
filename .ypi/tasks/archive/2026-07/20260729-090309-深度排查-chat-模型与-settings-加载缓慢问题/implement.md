# Implement — 执行计划

> 当前仅规划；用户批准前不得实现生产代码。

## 需先阅读

- `docs/architecture/overview.md`（Models modal / ModelRuntime / Models and tools）
- `docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`
- `docs/integrations/README.md`（0.80.10 CredentialStore + ModelRuntime、AnyRouter）
- `app/api/models/route.ts`
- `hooks/useAgentSession.ts` 模型 effect
- `components/SettingsConfig.tsx` 的 `loadConfig/loadModels` effects
- `components/AppShell.tsx` 的 web config / Models close wiring
- `lib/web-model-runtime.ts`、`lib/web-credential-store.ts`
- `lib/pi-provider-extensions.ts`、`lib/anyrouter-runtime-bridge.ts`
- SDK 0.80.10：`dist/core/model-runtime.js`、`agent-session-services.js`、`resource-loader.js`
- 既有 `scripts/test-web-model-runtime.mjs` 与 #23 archived performance baseline

## 人类可读子任务表

| ID | Phase | 内容 | 依赖 | 本地评审 |
| --- | --- | --- | --- | --- |
| MLP-01 | Evidence | 建立可重复的 cold/warm/concurrent harness 与安全 stage counter；先证明 refresh/read/write 次数 | — | 是 |
| MLP-02 | Server | 新增 model catalog service；`/api/models` 改用 offline admin runtime + available snapshot + epoch/single-flight | MLP-01 | 是 |
| MLP-03 | Provider | 将 AnyRouter global reconcile 从目录 GET 热路径移出并加相等值 no-op/single-flight | MLP-01 | 是 |
| MLP-04 | Client | Chat/Settings 共享 model catalog resource，去掉 defaultModel/view切换重复 fetch | MLP-02 | 是 |
| MLP-05 | Consistency | 接入 models/auth/account/default mutation 的 catalog invalidation；补竞态测试 | MLP-02, MLP-03 | 是 |
| MLP-06 | Conditional | 仅在前五项后仍超标时优化 WebCredentialStore parsed snapshot/read fan-out | MLP-01, MLP-02, MLP-03 | 必须专项评审 |
| MLP-07 | Checks | 性能/纯读/回归验证、文档更新、真实凭据UAT报告 | MLP-04, MLP-05；可含MLP-06 | 是 |

## 关键实现顺序

1. **先测再改**：counter必须能区分 request、runtime、availability round、raw auth read、queue wait、AnyRouter write；先记录现状。
2. **先服务端共享，再客户端去重**：否则客户端缓存只会掩盖服务端每次重建的缺陷。
3. **AnyRouter纯读边界并行收敛**：目录 GET 前后 stat/hash不变是硬门禁。
4. **显式失效最后接全**：搜索所有 models/auth/account/settings default mutation consumer，不能只处理 Models close。
5. **通用CredentialStore改动条件化**：前五项达到目标即不做 MLP-06，降低认证风险。

## 验证命令

```bash
npm install
npm run test:web-model-runtime
npm run test:models-provider-auth-summary
npm run test:models-config-races
npm run test:anyrouter-provider
npm run test:anyrouter-accounts
npm run test:api-key-accounts
npm run test:web-credential-store
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

新增建议：

```bash
npm run test:model-catalog-performance
npm run test:model-catalog-races
npm run test:model-catalog-read-purity
```

性能脚本必须使用临时 `PI_CODING_AGENT_DIR`、fake provider/可控延迟，不访问真实网络或用户 credential。30142 仅做隔离服务验证，不直接 `next build`。

## 评审门禁

- MLP-02：确认没有把 admin runtime用于 inference。
- MLP-03：确认 AnyRouter Active slot authority/锁顺序/显式mutation repair不变。
- MLP-05：搜索并列出所有 invalidation caller；漏一个即不通过。
- MLP-06：需证明前五项后仍超标，并专项审阅跨进程修改、plaintext生命周期与command-key语义。
- 若实现者新增任何可见 loading/error/retry UI，立即停止并请求 ui-designer HTML 原型与用户审批。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "Chat 与 Settings 模型目录加载性能收敛",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "MLP-01",
      "title": "建立模型目录性能与副作用证据基线",
      "phase": "evidence",
      "order": 1,
      "dependsOn": [],
      "files": [
        "scripts/test-model-catalog-performance.mjs",
        "scripts/test-model-catalog-read-purity.mjs",
        "lib/web-model-runtime.ts",
        "lib/web-credential-store.ts",
        "lib/anyrouter-runtime-bridge.ts"
      ],
      "instructions": "添加测试/诊断专用安全计数器和临时数据目录 harness，记录 cold/warm/8并发下 runtime init、availability refresh、credential raw-read/queue-wait、AnyRouter reconcile/write。不得输出路径、credential或provider账号标识；先保存变更前基线。",
      "acceptance": [
        "测试能稳定复现重复runtime/refresh/read与GET触发mirror写",
        "所有测试使用临时PI_CODING_AGENT_DIR且网络为零",
        "计数器默认关闭或只在测试hook下启用"
      ],
      "validation": [
        "node scripts/test-model-catalog-performance.mjs",
        "node scripts/test-model-catalog-read-purity.mjs"
      ],
      "risks": [
        "instrumentation改变调度时序",
        "日志泄露本地身份信息"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "MLP-02",
      "title": "实现离线共享 model catalog service",
      "phase": "server",
      "order": 2,
      "dependsOn": ["MLP-01"],
      "files": [
        "lib/model-catalog-service.ts",
        "app/api/models/route.ts",
        "lib/web-model-runtime.ts",
        "scripts/test-model-catalog-performance.mjs",
        "docs/modules/api.md",
        "docs/modules/library.md"
      ],
      "instructions": "将/api/models切到fixed-provider admin runtime，明确allowNetwork:false，以epoch+single-flight+短burst cache发布不可变safe projection；读取getAvailableSnapshot而非触发额外getAvailable refresh。保留现有响应字段和cwd校验，不加载项目扩展。失败pending必须清理，旧generation不得发布。",
      "acceptance": [
        "同epoch并发只初始化/刷新一次",
        "catalog请求零provider网络",
        "响应字段/model-thinking投影兼容",
        "warm p95和8并发达到PRD目标"
      ],
      "validation": [
        "npm run test:web-model-runtime",
        "node scripts/test-model-catalog-performance.mjs",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "共享runtime目录陈旧",
        "误将admin runtime扩散到session inference",
        "SDK detached refresh未被观测到"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "MLP-03",
      "title": "收敛 AnyRouter cold reconcile 与无条件镜像写",
      "phase": "provider",
      "order": 3,
      "dependsOn": ["MLP-01"],
      "files": [
        "lib/pi-provider-extensions.ts",
        "lib/anyrouter-runtime-bridge.ts",
        "lib/api-key-accounts.ts",
        "scripts/test-model-catalog-read-purity.mjs",
        "docs/integrations/README.md",
        "docs/modules/library.md"
      ],
      "instructions": "分离target runtime provider注册与agentDir全局bridge repair；重复装载使用single-flight/fingerprint并对bridge/auth相等值零写。保留显式账号/config mutation的锁内reconcile、Active authority与AnyRouter provider→auth.json锁顺序。bridge缺失冷启动必须有明确安全恢复或降级，不得靠每次catalog GET偷偷写。",
      "acceptance": [
        "连续和并发/api/models前后auth/bridge内容与mtime不变",
        "Active mutation仍原子重建bridge/auth",
        "load失败可重试且不阻塞其他provider",
        "AnyRouter focused suites通过"
      ],
      "validation": [
        "npm run test:anyrouter-provider",
        "npm run test:anyrouter-accounts",
        "node scripts/test-model-catalog-read-purity.mjs"
      ],
      "risks": [
        "旧安装缺bridge时AnyRouter暂不可用",
        "fingerprint漏掉authority变化",
        "锁顺序回归"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "MLP-04",
      "title": "Chat 与 Settings 共享客户端 model catalog resource",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["MLP-02"],
      "files": [
        "hooks/useModelCatalog.ts",
        "hooks/useAgentSession.ts",
        "components/SettingsConfig.tsx",
        "components/AppShell.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": "建立模块级generation/single-flight/last-good资源；Chat和Settings订阅同一目录。移除useAgentSession私有fetch与Settings按view重复fetch；defaultModel变化只重算selection，不重取目录。Models close统一invalidate一次。保持现有视觉和错误位置，不新增UI。",
      "acceptance": [
        "Chat mount+web-config specific default只有一个目录flight",
        "同时打开Settings仍共享flight",
        "四个模型相关Settings view切换不重取",
        "旧响应/卸载后响应不能覆盖新generation"
      ],
      "validation": [
        "npm run test:models-config-races",
        "node scripts/test-model-catalog-races.mjs",
        "npm run lint"
      ],
      "risks": [
        "模块级资源跨modal生命周期残留",
        "错误状态被last-good掩盖",
        "selection seed时序变化"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "MLP-05",
      "title": "接全模型目录 epoch 失效与竞态保护",
      "phase": "consistency",
      "order": 5,
      "dependsOn": ["MLP-02", "MLP-03"],
      "files": [
        "lib/model-catalog-service.ts",
        "app/api/models-config/route.ts",
        "app/api/models-config/sync/route.ts",
        "app/api/model-prices/route.ts",
        "app/api/auth/**/route.ts",
        "lib/api-key-accounts.ts",
        "lib/rpc-manager.ts",
        "scripts/test-model-catalog-races.mjs"
      ],
      "instructions": "搜索models/auth/account/default写入口，在持久化与验证成功后、成功响应前推进catalog epoch；失败/取消不推进。测试旧generation晚到、mutation并发、外部原子替换与default revision。不要用auth mtime作为唯一失效依据。",
      "acceptance": [
        "失效矩阵中每类成功mutation都有覆盖测试",
        "旧generation不能回填",
        "失败mutation不清last-good",
        "live RPC auth reload既有语义不变"
      ],
      "validation": [
        "node scripts/test-model-catalog-races.mjs",
        "npm run test:models-config-sync",
        "npm run test:oauth-accounts",
        "npm run test:api-key-accounts"
      ],
      "risks": [
        "漏掉写入口导致stale目录",
        "失效发生过早发布半成品",
        "循环依赖"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "MLP-06",
      "title": "条件性优化 WebCredentialStore 读扇出",
      "phase": "conditional-hardening",
      "order": 6,
      "dependsOn": ["MLP-01", "MLP-02", "MLP-03"],
      "files": [
        "lib/web-credential-store.ts",
        "lib/web-credential-store.test.ts",
        "scripts/test-web-credential-store.mjs"
      ],
      "instructions": "仅当MLP-02/03后counter仍未达标才执行。实现按authPath+文件fingerprint的parsed snapshot/read coalescing；写仍保留进程队列和跨进程锁，mutation后更新或失效snapshot，外部原子替换可检测；list不解析key，read仅解析目标credential。先提交专项设计评审，不得自行放宽一致性。",
      "acceptance": [
        "有前置性能证据证明此项必要",
        "并发read共享raw parse且不串行重读",
        "跨进程替换与mutation后立即读得到新值",
        "command/env/literal语义和secret边界不变"
      ],
      "validation": [
        "npm run test:web-credential-store",
        "node scripts/test-model-catalog-performance.mjs",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "缓存旧credential",
        "plaintext进程内生命周期扩大",
        "外部写fingerprint碰撞"
      ],
      "parallelizable": false,
      "localReview": true,
      "optional": true
    },
    {
      "id": "MLP-07",
      "title": "完成性能、纯读、回归与文档验收",
      "phase": "checks",
      "order": 7,
      "dependsOn": ["MLP-04", "MLP-05"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        ".ypi/tasks/20260729-090309-深度排查-chat-模型与-settings-加载缓慢问题/checks.md"
      ],
      "instructions": "运行focused/provider/lint/tsc与隔离30142 cold/warm/8并发。记录Server-Timing/counter、GET前后文件纯读、请求结束后pending归零。若可安全获得真实凭据环境，只记录标量UAT；确认Settings壳层与模型控件口径。更新架构/API/frontend/library/integration文档。",
      "acceptance": [
        "PRD性能阈值和纯读门禁全部通过",
        "无provider网络、无secret/path日志",
        "UI无信息结构变化",
        "文档与失效矩阵一致"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check",
        "node scripts/test-model-catalog-performance.mjs",
        "node scripts/test-model-catalog-read-purity.mjs",
        "node scripts/test-model-catalog-races.mjs"
      ],
      "risks": [
        "只测warm掩盖cold问题",
        "真实凭据UAT误泄露信息",
        "30141与30142环境混淆"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      ["MLP-01"],
      ["MLP-02", "MLP-03"],
      ["MLP-04", "MLP-05"],
      ["MLP-06"],
      ["MLP-07"]
    ]
  }
}
```

## 回滚方案

- 代码回滚 catalog service/client resource 即可，无数据迁移。
- AnyRouter 回滚时只恢复显式 cold repair代码，不删除managed slots或bridge。
- MLP-06 独立提交/独立回滚；不与P0功能绑成不可拆分变更。
