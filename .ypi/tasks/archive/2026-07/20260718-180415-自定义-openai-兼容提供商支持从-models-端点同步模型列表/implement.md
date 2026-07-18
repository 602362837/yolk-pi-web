# Implement：自定义 OpenAI-compatible 模型列表同步

## 实现前提

- 用户已批准 [plan-review.md](./plan-review.md) 和 UI 设计员交付的 HTML 原型。
- 主会话已合法把任务 transition 到 `implementing`。
- 当前任务仍未满足上述门禁；任何子任务都不得提前 claim。

## 优先阅读顺序

1. `AGENTS.md`
2. `docs/architecture/overview.md`
3. `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`
4. `docs/integrations/README.md`、`docs/standards/code-style.md`
5. `components/ModelsConfig.tsx`
6. `app/api/models-config/route.ts`、`app/api/models-config/test/route.ts`
7. `lib/model-price-config.ts`、`lib/web-model-runtime.ts`、`lib/web-credential-store.ts`、`lib/web-auth-config-value.ts`
8. Pi 0.80.10 `docs/models.md` 与 `docs/custom-provider.md`
9. 本任务 `brief.md`、`prd.md`、`ui.md`、`design.md`、`checks.md` 和已审批 HTML 原型

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| MODEL-SYNC-01 | foundation | 1 | — | 建立共享 models.json store、revision 与同步 wire types | `lib/models-config-store.ts`, `lib/models-config-sync-types.ts`, `lib/model-price-config.ts`, `app/api/models-config/route.ts` | 否 |
| MODEL-SYNC-02 | backend-core | 2 | 01 | 实现资格、URL、auth/header、fetch、preview cache 与 merge 核心 | `lib/models-config-sync.ts` | 否 |
| MODEL-SYNC-03 | api | 3 | 01, 02 | 增加 preview/apply API 与写后验证/runtime reload | `app/api/models-config/sync/route.ts`, `lib/models-config-sync.ts` | 否 |
| MODEL-SYNC-04 | ui | 4 | 03 | 按已审批 HTML 原型实现 Models 同步入口、预览和确认体验 | `components/ModelsConfig.tsx`, `app/globals.css` | 是（与 05） |
| MODEL-SYNC-05 | backend-tests-docs | 4 | 03 | 增加针对性 backend tests 与 API/library 文档 | `scripts/test-models-config-sync.mjs`, `package.json`, `docs/**` | 是（与 04） |
| MODEL-SYNC-06 | integration-check | 5 | 04, 05 | 集成验证、UI 回归、风险审查和交付 | 相关改动文件、任务 handoff/review | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "strategy": "parallel-ready DAG with UI approval barrier",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "MODEL-SYNC-01",
      "title": "建立共享 models.json 存储协调层和同步 wire types",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/models-config-store.ts",
        "lib/models-config-sync-types.ts",
        "lib/model-price-config.ts",
        "app/api/models-config/route.ts"
      ],
      "instructions": [
        "从 model-price-config 提取或复用 JSONC strip、raw read、opaque revision、atomic temp+rename、backup 能力到共享 models-config-store；增加进程队列和跨进程 mkdir write lock。",
        "让 model-price patch、ModelsConfig PUT 和后续 sync apply 使用同一 models.json 写锁；避免 nested lock，并保留 model-price-config 既有导出兼容。",
        "GET /api/models-config body 保持原配置 shape，增加 no-store 与 ETag/revision header；PUT 支持 If-Match 并返回 additive revision。",
        "ModelsConfig route 继续执行 cost 缺失费率规范化，但写入必须原子化；parse error fail closed，不得退化为覆盖空 providers。",
        "定义 preview/apply/error client-safe types、OpenAI API allowlist 和边界常量；wire types 禁止 baseUrl/apiKey/headers/path/rawBody 字段。"
      ],
      "acceptance": [
        "三个 models.json writer 共享协调层，revision 冲突不会静默覆盖。",
        "旧 GET body 与 PUT success 调用保持兼容；新客户端可使用 ETag/If-Match。",
        "malformed models.json 不会被空对象覆盖。",
        "model-price 既有 revision/backup/atomic 语义和测试不回归。",
        "同步 wire type 不包含 secret 或 endpoint 投影。"
      ],
      "validation": [
        "npm run test:model-prices",
        "node_modules/.bin/tsc --noEmit",
        "针对 shared store 做临时 agent dir 并发/revision/parse-error 测试"
      ],
      "risks": [
        "提取 model-price helper 时改变 backup 或 JSONC 行为",
        "锁重入造成死锁",
        "无 If-Match 的旧调用方兼容策略不清导致破坏"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "all models.json writers share the lock",
          "malformed config fail-closed",
          "no secret projection"
        ]
      }
    },
    {
      "id": "MODEL-SYNC-02",
      "title": "实现 OpenAI-compatible 模型发现与最小 merge 核心",
      "phase": "backend-core",
      "order": 2,
      "dependsOn": [
        "MODEL-SYNC-01"
      ],
      "files": [
        "lib/models-config-sync.ts",
        "lib/models-config-sync-types.ts",
        "lib/models-config-store.ts",
        "lib/web-credential-store.ts",
        "lib/web-auth-config-value.ts"
      ],
      "instructions": [
        "资格判定必须排除 builtinProviders() ids 和 grok-cli/kiro/google-antigravity，且仅接受 provider-level openai-completions/openai-responses + valid http(s) baseUrl。",
        "实现 endpoint candidate 纯函数：已含 /v1、/models、/v1/models 不能重复；其他 path 生成 /models 与 /v1/models 候选。",
        "只在 404/405 路径回退；manual redirect 最多 3 次且同 origin；跨 origin 拒绝。",
        "按 auth.json api_key 优先、models.json apiKey fallback 的顺序解析 key；使用相同 config-value 语义解析 headers；不支持 generic custom OAuth。",
        "实现 10s timeout、1MiB body、2000 model、256-byte id、JSON/OpenAI data[] schema、去重和固定安全错误码。",
        "实现 globalThis bounded preview cache：opaque id、5min TTL、max 20、revision/provider fingerprint/remote ids；绝不存 secret 原文。",
        "实现纯 merge：existing object untouched；selected new ids 依远端顺序 append {id}；其他 provider/modelOverrides 不变。"
      ],
      "acceptance": [
        "无请求参数可控制 URL、path、headers 或 key。",
        "baseUrl 拼接覆盖 root、/v1、custom prefix、already-models 四类。",
        "跨源 redirect 不发送第二跳凭据。",
        "远端重复 id 去重且首次顺序稳定。",
        "existing cost/compat/unknown fields 在 deep comparison 中完全保留。",
        "错误对象和 cache 不含 key/header/raw response。"
      ],
      "validation": [
        "npm run test:models-config-sync",
        "node_modules/.bin/tsc --noEmit",
        "用本地 mock HTTP server 验证 404 fallback、401、429、500、timeout、redirect、oversize、invalid JSON"
      ],
      "risks": [
        "header merge 次序与 Pi 实际请求语义不一致",
        "fetch 自动 redirect 泄露 Authorization",
        "provider 指纹误存 secret 原文",
        "错误 detail 意外携带 upstream body"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "SSRF boundary",
          "redirect credential safety",
          "merge preservation"
        ]
      }
    },
    {
      "id": "MODEL-SYNC-03",
      "title": "增加模型同步 preview/apply API 和写后验证",
      "phase": "api",
      "order": 3,
      "dependsOn": [
        "MODEL-SYNC-01",
        "MODEL-SYNC-02"
      ],
      "files": [
        "app/api/models-config/sync/route.ts",
        "lib/models-config-sync.ts",
        "lib/web-model-runtime.ts",
        "lib/rpc-manager.ts"
      ],
      "instructions": [
        "实现单一 POST route，严格区分 action=preview/apply 并拒绝额外 URL/key/header/path 字段。",
        "preview 只返回 providerId、previewId、revision、expiresAt、counts 和 allowlisted model rows。",
        "apply 校验 preview/provider/revision/fingerprint/selected subset；在共享写锁内重读和 merge。",
        "写前备份、atomic write 后用 fresh provider-aware ModelRuntime 验证 config load 和新增 model lookup；失败原子回滚。",
        "写入成功后 best-effort reload live ModelRuntime；部分 reload 只返回固定 warning，不输出 session/path/provider secret。",
        "所有响应 no-store；将服务错误映射到稳定 HTTP status：400/401/403/404/409/413/422/429/502/504。"
      ],
      "acceptance": [
        "preview 不写磁盘；cancel/invalid apply 零写入。",
        "apply 只改一个 provider.models[]，stale revision 返回 409。",
        "preview 过期/进程重启后要求重试，不回退到盲写。",
        "验证失败恢复 pre-write 文件。",
        "API snapshot 无 baseUrl、apiKey、Authorization、custom header、raw body、absolute path。"
      ],
      "validation": [
        "npm run test:models-config-sync",
        "npm run test:web-model-runtime",
        "npm run test:model-prices",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "写后 runtime 验证使用缓存 runtime 导致假阳性",
        "reloadRpcAuthState 失败被误判为磁盘写失败",
        "HTTP status 与 UI retry 分类不一致"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "preview zero-write",
          "rollback on verification failure",
          "wire privacy"
        ]
      }
    },
    {
      "id": "MODEL-SYNC-04",
      "title": "按已审批 HTML 原型实现 Models 同步交互",
      "phase": "ui",
      "order": 4,
      "dependsOn": [
        "MODEL-SYNC-03"
      ],
      "files": [
        "components/ModelsConfig.tsx",
        "app/globals.css",
        "components/AppPromptProvider.tsx"
      ],
      "instructions": [
        "本子任务只有在 ui-designer HTML 原型和用户审批均完成后才可 claim；实现必须逐项对照原型。",
        "ModelsConfig 保存 persisted snapshot + ETag revision，派生全局 dirty；dirty 时同步入口禁用并提示先保存。",
        "仅 custom provider detail 出现同步区域；OpenAI 协议可用，非 OpenAI/缺 baseUrl/未保存状态显示明确禁用原因。",
        "实现 preview modal：loading、counts、search、new/existing、checkbox、select all new、clear、empty/all-existing/error/retry。",
        "默认选择全部新增；写入所选与全部新增快捷操作都通过 AppPrompt 明确确认，不静默写。",
        "apply 成功后重新 GET models-config/ETag，替换 draft 和 persisted snapshot并保持 provider selection；展示 added/skipped 结果。",
        "覆盖 Escape、focus trap/restore、键盘、aria、窄屏、长模型 id、busy 防重复提交。"
      ],
      "acceptance": [
        "用户可预览、搜索、勾选并确认写入。",
        "快捷按钮一键选择全部新增并经确认写入。",
        "非目标 provider 无可执行入口或有清晰禁用原因。",
        "Models dirty 时不会启动 server sync，避免 stale draft 覆盖。",
        "所有关键状态和文案与批准原型一致。",
        "DOM 不出现 key/header/raw upstream error。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证 desktop/640px/375px、键盘、loading/error/empty/all-existing/success/conflict"
      ],
      "risks": [
        "ModelsConfig 单文件很大，局部状态和现有 modal z-index/focus 冲突",
        "apply 后 reload 丢失 selection 或产生旧草稿覆盖",
        "快捷操作绕过确认"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "approved prototype parity",
          "dirty-state protection",
          "confirmation semantics"
        ]
      }
    },
    {
      "id": "MODEL-SYNC-05",
      "title": "补齐 backend 定向测试与模块文档",
      "phase": "backend-tests-docs",
      "order": 4,
      "dependsOn": [
        "MODEL-SYNC-03"
      ],
      "files": [
        "scripts/test-models-config-sync.mjs",
        "package.json",
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "新增 test:models-config-sync，使用临时 agent dir 和本地 mock HTTP server，不访问真实 provider。",
        "覆盖 eligibility deny、URL candidates、404 fallback、redirect、auth/header resolution、payload bounds、preview expiry、revision conflict、merge preservation、rollback。",
        "回归 model-price writer 与 ModelsConfig PUT 的共享锁/revision 语义。",
        "更新 API route map、ModelsConfig UI、shared store/sync service、architecture models.json writer invariants、集成和故障排查。",
        "文档明确不支持 built-in/fixed/non-OpenAI、不同步能力/价格、不接受任意 URL。"
      ],
      "acceptance": [
        "targeted test 可重复、无外网依赖、无 secret fixture 输出。",
        "测试证明已有 cost/unknown fields/other providers 不变。",
        "文档与最终 route/body/status/limits 一致。",
        "AGENTS.md 仅在顶层导航变化时更新，不堆积实现细节。"
      ],
      "validation": [
        "npm run test:models-config-sync",
        "npm run test:model-prices",
        "npm run test:web-model-runtime",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "只做源码字符串断言，未真实跑 HTTP/文件并发",
        "文档误称支持自动删除/价格同步",
        "测试日志打印 fixture key"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "behavioral tests",
          "no external network",
          "docs accuracy"
        ]
      }
    },
    {
      "id": "MODEL-SYNC-06",
      "title": "完成集成验证和交付门禁",
      "phase": "integration-check",
      "order": 5,
      "dependsOn": [
        "MODEL-SYNC-04",
        "MODEL-SYNC-05"
      ],
      "files": [
        "components/ModelsConfig.tsx",
        "app/api/models-config/sync/route.ts",
        "lib/models-config-sync.ts",
        "lib/models-config-store.ts",
        "docs/**",
        ".ypi/tasks/20260718-180415-自定义-openai-兼容提供商支持从-models-端点同步模型列表/handoff.md",
        ".ypi/tasks/20260718-180415-自定义-openai-兼容提供商支持从-models-端点同步模型列表/review.md"
      ],
      "instructions": [
        "运行 checks.md 全部自动检查，记录环境限制和已有非本任务 warning。",
        "用本地 mock provider 完成选择性同步、全部新增、all-existing、stale revision、auth/timeout/retry 的浏览器验收。",
        "对照批准 HTML 原型进行 UI parity 和可访问性检查。",
        "审计 API/日志/DOM/preview cache，确认无 key/header/raw body/baseUrl 投影。",
        "审计 git diff，确认未修改 fixed provider、SDK catalog、settings.json、无关 provider 或生产构建产物。"
      ],
      "acceptance": [
        "lint、tsc、targeted sync、model-price、web-model-runtime 测试通过。",
        "人工验收覆盖 PRD 全部主路径和错误路径。",
        "checker 独立确认 merge preserve 与 SSRF/redirect 边界。",
        "没有 commit/push/merge，未直接运行 next build。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:models-config-sync",
        "npm run test:model-prices",
        "npm run test:web-model-runtime",
        "git diff --check"
      ],
      "risks": [
        "仅后端测试通过但 UI dirty/reload 路径仍可覆盖配置",
        "真实 provider 差异被过度兼容导致协议范围扩张",
        "checker 未复核 UI 原型审批状态"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": [
          "end-to-end PRD coverage",
          "security/privacy audit",
          "prototype approval evidence"
        ]
      }
    }
  ],
  "execution": {
    "groups": [
      {
        "order": 1,
        "subtaskIds": [
          "MODEL-SYNC-01"
        ]
      },
      {
        "order": 2,
        "subtaskIds": [
          "MODEL-SYNC-02"
        ]
      },
      {
        "order": 3,
        "subtaskIds": [
          "MODEL-SYNC-03"
        ]
      },
      {
        "order": 4,
        "subtaskIds": [
          "MODEL-SYNC-04",
          "MODEL-SYNC-05"
        ]
      },
      {
        "order": 5,
        "subtaskIds": [
          "MODEL-SYNC-06"
        ]
      }
    ]
  }
}
```

## 计划验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:models-config-sync
npm run test:model-prices
npm run test:web-model-runtime
git diff --check
```

不得直接运行 `next build`；仅发布验证时使用 `npm run build`。

## 评审门禁

1. UI 设计员 HTML 原型和用户审批缺一不可；`MODEL-SYNC-04` 不得提前 claim。
2. 实现员不能以“只追加 id”作为跳过 revision/锁/写后验证的理由。
3. checker 必须独立验证：built-in/fixed provider deny、任意 URL 注入拒绝、跨源 redirect 拒绝、existing model deep preservation。
4. 任何扩展到非 OpenAI 协议、自动删除、自动价格/能力推断、后台同步均需退回用户审批。

## 回滚顺序

1. 隐藏 Models 同步入口，保留手工编辑。
2. 移除 sync route 与 preview cache，不删除已追加模型。
3. 保留共享 store 的并发安全改进；若其自身回归，再整体回滚 ModelsConfig/model-price writer 适配。
4. 用户通过现有 Models UI 手工删除不需要的新 id；不做自动批量逆向操作。