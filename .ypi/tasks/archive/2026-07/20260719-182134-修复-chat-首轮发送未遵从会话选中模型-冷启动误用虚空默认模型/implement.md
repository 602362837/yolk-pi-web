# Implement — Chat 冷启动模型 pin（计划 B）

## 实现前提

- 用户已批准 [plan-review.md](./plan-review.md)（含计划 B 增量）。  
- 任务由主会话合法进入 `implementing` 后，再指派 **implementer**。  
- **禁止**在 awaiting_approval 改生产代码。  
- 不破坏 MODEL-PIN-3；不用 yolk 覆盖会话 UI 选中；不改无关 UI。

## 优先阅读顺序

1. [brief.md](./brief.md)、[prd.md](./prd.md)、[design.md](./design.md)、[checks.md](./checks.md)、[ui.md](./ui.md)  
2. `AGENTS.md` → `docs/modules/frontend.md`、`docs/modules/library.md`  
3. `lib/session-model-pin.ts`、`lib/pi-web-config.ts`（yolk 类型）  
4. `hooks/useAgentSession.ts`  
5. `lib/rpc-manager.ts`（startRpcSession / set_model）  
6. `lib/agent-session-bootstrap.ts`、`lib/session-reader.ts`  
7. `scripts/test-session-model-pin.mjs`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| MODEL-PIN-CS-01 | helpers-tests | 1 | — | 扩展 pin 纯函数（liveConfirmed）+ yolk 冷启动解析纯函数 + 单测 | `lib/session-model-pin.ts`, `scripts/test-session-model-pin.mjs` | 否 |
| MODEL-PIN-CS-02 | client | 2 | 01 | 修 loadSession / ensureSessionModel / live 死亡清空 | `hooks/useAgentSession.ts` | 否 |
| MODEL-PIN-CS-03 | server | 3 | 01 | 服务端 startRpcSession 冷启动：session 恢复 > yolk specific > settings | `lib/rpc-manager.ts`, 可选 helper 文件, `lib/agent-session-bootstrap.ts` | 与 02 概念可并行，DAG 上接 01 后建议 02→03 或 02∥03 由实现员串行 |
| MODEL-PIN-CS-04 | docs-verify | 4 | 02, 03 | 文档 + lint/tsc/单测 + 手工清单 | `docs/modules/*` | 否 |

> 注：原计划 A 为 CS-01/02/03；计划 B 将原 docs 顺延为 **CS-04**，新增 **CS-03 服务端兜底**。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "strategy": "sequential-with-early-tests",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "MODEL-PIN-CS-01",
      "title": "扩展 session-model-pin 语义、yolk 冷启动解析与单测",
      "phase": "helpers-tests",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/session-model-pin.ts",
        "scripts/test-session-model-pin.mjs"
      ],
      "instructions": [
        "保持 normalize/resolveDesired/resolveChatDisplay/sessionModelsEqual/withSessionScopedSettingsDefaults/clampThinkingLevelToSupported 行为兼容。",
        "扩展 shouldPinSessionModel 支持 options?: { liveConfirmed?: boolean }：当 liveConfirmed===false 时，只要 desired 有效就返回 true（即使 lastPinned 与 desired 相等）。省略 options 时保持旧 equal 行为。",
        "新增纯函数（名称可微调，需导出可测）：resolveYolkColdStartModel(yolkConfig) → { provider, modelId, thinking } | null。mode!==specific 或缺字段 → null；thinking 取 defaultModel.thinking 或调用方可传入 fallback thinking。",
        "可选：resolveColdStartModelPreference({ recoverable, yolk }) → 'recoverable' | 'yolk' | 'sdk' 优先级纯函数，便于单测锁定 session > yolk > sdk。",
        "文件头注释写清：lastPinned/confirmed 不得来自 path context.model；服务端冷启动默认优先级；Chat set_model 不写 settings。",
        "测试至少覆盖：",
        "1) liveConfirmed=false 且 desired==lastPinned → shouldPin true",
        "2) liveConfirmed=true 且 equal → false",
        "3) liveConfirmed=true 且 unequal → true",
        "4) desired null → false",
        "5) 省略 options 时 equal → false（旧行为）",
        "6) resolveYolkColdStartModel：specific 返回 model+thinking；piDefault → null",
        "7) 优先级：有 recoverable 不选 yolk；无 recoverable + specific → yolk；piDefault → sdk",
        "8) 既有 PIN-3 withSessionScoped 用例全部保留通过",
        "不在此任务引入 React/fetch/真实 SDK。"
      ],
      "acceptance": [
        "npm run test:session-model-pin 全绿。",
        "新 API 类型可被 hooks/rpc-manager 直接使用，无 any 逃生。",
        "MODEL-PIN-3 测试仍通过。"
      ],
      "validation": [
        "npm run test:session-model-pin"
      ],
      "risks": [
        "改变 shouldPin 默认签名导致其它调用方行为变化——检索全仓 shouldPinSessionModel 并更新。",
        "yolk 解析与 pi-web-config 类型重复——可接受轻量输入类型，避免循环依赖。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "MODEL-PIN-CS-02",
      "title": "修复 useAgentSession 冷启动/idle pin 基线",
      "phase": "client",
      "order": 2,
      "dependsOn": [
        "MODEL-PIN-CS-01"
      ],
      "files": [
        "hooks/useAgentSession.ts"
      ],
      "instructions": [
        "loadSession：删除 contextModel → lastPinned 赋值。context 只可用于 selected/display fallback。",
        "loadSession：includeState===true 且无 liveModel 时 lastPinned=null，liveAgentConfirmed=false。保留 liveSessionModel 展示 snapshot 策略，但 pin 正确优先。",
        "引入 liveAgentConfirmedRef（推荐）：set_model 成功、create 成功、get_state running+model、agent_end 且 GET 到 model → true；loadSession 无 live、GET running false、session 清理 → false。",
        "ensureSessionModel：shouldPin(desired, lastPinned, { liveConfirmed: liveAgentConfirmedRef.current })。",
        "handleSend / steer / follow_up：继续 await ensureSessionModel；失败 throw 中止发送。",
        "handleModelChange / 新建 create 成功：lastPinned + liveAgentConfirmed=true。",
        "禁止写 settings；不修改 ChatInput/选择器 UI。",
        "不在此任务实现服务端 yolk（属 CS-03）。"
      ],
      "acceptance": [
        "无 live 时 lastPinned 不为 context.model。",
        "无 live 时发送：set_model 再 prompt，模型为 UI 选择。",
        "有 live 且对齐：可跳过 set_model。",
        "idle/destroy 模拟：confirmed false 后必 set_model。",
        "settings.json 默认不被 Chat 改写。"
      ],
      "validation": [
        "npm run test:session-model-pin",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "liveSessionModel 死后仍在 state 导致误判——必须独立 confirmed ref。",
        "清空 lastPinned 时误清 selected/override——禁止。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "MODEL-PIN-CS-03",
      "title": "服务端冷启动兜底：session 恢复 > yolk > settings",
      "phase": "server",
      "order": 3,
      "dependsOn": [
        "MODEL-PIN-CS-01"
      ],
      "files": [
        "lib/rpc-manager.ts",
        "lib/agent-session-bootstrap.ts",
        "lib/session-model-pin.ts"
      ],
      "instructions": [
        "在 startRpcSession 创建 inner session 并 wrap 之后、return 前，调用 applyWebSessionColdStartDefaults（名称可微调）。",
        "优先级：",
        "1) 从 sessionManager/path 解析 recoverable model；若 getModel 成功 → 确保 runtime 为该模型（必要时 session-scoped set_model）；不要套 yolk。",
        "2) 否则 readPiWebConfig().yolk：mode=specific 且 getModel 成功 → withSessionScopedSettingsDefaults + setModel，并 setThinkingLevel（thinking 来自 yolk，可 clamp）。",
        "3) mode=piDefault 或 yolk 解析失败 → no-op（保留 SDK/settings）。",
        "新建 sessionFile===''：无 recoverable → 直接 yolk/piDefault 分支（与 bootstrap 显式 body model 兼容：body 后续 pin 覆盖）。",
        "若 session header studioChild 或等价标记：跳过用户 yolk 默认（避免污染 Studio 子会话策略）；实现时以代码中可判定字段为准。",
        "所有 setModel 必须 withSessionScopedSettingsDefaults；禁止写 settings.json。",
        "yolk apply 失败推荐 try/catch 降级 + 日志，不阻断 session 创建（design §6.6）。",
        "审计 createConfiguredEmptyAgentSession：避免与 startRpcSession 兜底冲突/重复写 settings；body provider/modelId 仍优先最终结果。",
        "route.ts 可不改；若需契约注释可加一句。",
        "扩展 test:session-model-pin 中纯函数优先级用例即可；真实 startRpcSession 集成可选，不强制连 SDK。"
      ],
      "acceptance": [
        "无可恢复模型 + yolk specific：冷启动 wrapper 初始不为 settings 虚空默认（为 yolk），settings 不变。",
        "有可恢复模型 S：不被 yolk Y 覆盖。",
        "piDefault：允许 SDK/settings。",
        "客户端 pin 仍可覆盖 serverInitial。",
        "PIN-3 行为保持。"
      ],
      "validation": [
        "npm run test:session-model-pin",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "误判 recoverable 导致仍落虚空或错误保留 settings 模型。",
        "Studio child 误套 yolk。",
        "startRpcSession 变慢/变脆——兜底失败应降级。",
        "与 bootstrap 双重 set_model——可接受。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "MODEL-PIN-CS-04",
      "title": "文档同步与回归验证",
      "phase": "docs-verify",
      "order": 4,
      "dependsOn": [
        "MODEL-PIN-CS-02",
        "MODEL-PIN-CS-03"
      ],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "frontend.md useAgentSession：lastPinned 仅 live 确认；context 不用于 skip pin；cold start/idle 发送前必 pin。",
        "library.md session-model-pin + rpc-manager：shouldPin liveConfirmed；冷启动优先级 session > yolk specific > settings；MODEL-PIN-3 仍适用 yolk apply。",
        "overview.md 一句 cold-start 契约；明确两套默认源职责（yolk=Web Chat；settings=CLI/SDK）。",
        "可选：Settings 蛋黄𝝅静态说明一句（ui.md 非强制）。",
        "跑完整验证；handoff 记录手工 H1/H3/H4/H5/H8/H9 结果。"
      ],
      "acceptance": [
        "文档与代码语义一致。",
        "lint/tsc/test:session-model-pin 通过。",
        "无无关文件改动。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:session-model-pin"
      ],
      "risks": [
        "文档写成 yolk 覆盖会话选中——禁止；写清 UI pin 优先。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```

## 建议实现顺序（人类）

1. CS-01 helpers + 红绿测试。  
2. CS-02 客户端 pin。  
3. CS-03 服务端 yolk 兜底。  
4. CS-04 文档 + 全量验证。  
5. handoff 交检查员。

## 验证命令

```bash
npm run test:session-model-pin
node_modules/.bin/tsc --noEmit
npm run lint
```

手工：PRD H1–H10；至少 H1、H3、H4、H5、H8、H9。

## 检查门禁（实现后）

- checker 对照 [checks.md](./checks.md)。  
- 阻断项：context 仍写 lastPinned；无 live 仍 skip set_model；settings 被改写；无可恢复模型时 yolk specific 仍落 settings 虚空；yolk 覆盖会话 UI 选中。

## 回滚

还原相关代码 + 文档；无迁移。

## 明确不做

- 服务端 prompt 内嵌 model 双保险（除非审批加 scope）。  
- 用 yolk **写回** settings 全局默认。  
- 用 yolk **覆盖** 会话 UI 已选模型。  
- UI 选择器改版。  
- Studio 子会话模型策略重写。
