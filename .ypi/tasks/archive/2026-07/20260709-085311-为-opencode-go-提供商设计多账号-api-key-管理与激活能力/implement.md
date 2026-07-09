# implement

## 执行步骤

1. **先补 UI 原型门禁**：由 UI 设计员基于现有 `ModelsConfig` 产出 HTML 原型，覆盖账号列表、激活、reveal/copy、编辑、删除、legacy 导入、空状态与错误状态；取得用户审批后再进入代码实现。
2. 新增通用但 provider-scoped 的 `lib/api-key-accounts.ts`，实现 `opencode-go` 多账号存储、legacy import、active mirror、reveal、删除回退逻辑。
3. 演进 `/api/auth/all-providers` 与 `/api/auth/api-key/[provider]`，让前端知道 `opencode-go` 已切换到 managed accounts 模式，同时保留旧 summary / POST 兼容。
4. 新增 `opencode-go` 多账号管理路由族：列表、新增、编辑、删除、激活、reveal。
5. 改造 `components/ModelsConfig.tsx`：仅对 `opencode-go` 切新 UI，其它 API-key providers 继续单输入框。
6. 联调运行时镜像与 `reloadRpcAuthState()`，验证切换 active key 后实际调用链切到新 key。
7. 补文档、跑 lint / type-check、做手工回归。

## 需先阅读的文件

- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `components/ModelsConfig.tsx`
- `app/api/auth/all-providers/route.ts`
- `app/api/auth/api-key/[provider]/route.ts`
- `app/api/auth/accounts/[provider]/activate/route.ts`
- `lib/oauth-accounts.ts`
- `lib/rpc-manager.ts`
- `node_modules/@earendil-works/pi-coding-agent/docs/providers.md`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.d.ts.map`（用于确认 `AuthStorage` 仍是一 provider 一 credential）

## Implementation Plan

| ID | Title | Phase | Depends on | Parallel | Local review |
| --- | --- | --- | --- | --- | --- |
| ui-gate | 补齐 `ModelsConfig` HTML 原型并完成审批 | design/ui | - | no | yes |
| account-store | 新增 API-key 多账号存储与 active mirror 服务层 | impl | ui-gate | no | yes |
| api-summary-compat | 演进 provider summary 与 legacy 单 key 兼容路由 | impl | account-store | yes | yes |
| api-managed-routes | 新增 `opencode-go` 多账号管理路由族 | impl | account-store | yes | yes |
| models-config-opencode-go | 改造 `ModelsConfig` 的 `opencode-go` 多账号 UI | impl | ui-gate, api-summary-compat, api-managed-routes | no | yes |
| docs-checks | 同步文档并完成验证 | check | api-summary-compat, api-managed-routes, models-config-opencode-go | no | yes |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "ui-gate",
      "title": "补齐 ModelsConfig 的 opencode-go 多账号 HTML 原型并完成审批",
      "phase": "design/ui",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260709-085311-为-opencode-go-提供商设计多账号-api-key-管理与激活能力/ui.md",
        "components/ModelsConfig.tsx"
      ],
      "instructions": "由 UI 设计员基于现有 ModelsConfig 产出 HTML 原型，至少覆盖空状态、legacy 导入、列表状态、reveal/copy、编辑、删除 active 后 fallback、删除最后一条、错误状态。未获得用户审批前不得进入代码实现。本轮架构规划已定义交互契约，但不能用纯 Markdown 替代 HTML 原型。",
      "acceptance": [
        "存在可预览的 HTML 原型（fenced html 或 .html 文件）",
        "原型明确列出 opencode-go 与其它 API-key providers 的差异",
        "主会话 / 用户明确批准原型后，实施子任务才能开工"
      ],
      "validation": [
        "人工审阅 HTML 原型覆盖面",
        "用户/主会话审批记录写入 plan-review.md 或相关审阅记录"
      ],
      "risks": [
        "如果跳过 UI 原型，ModelsConfig 的信息结构和确认体验很容易与用户预期错位"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "account-store",
      "title": "新增 provider-scoped API-key 多账号存储与 active mirror 服务层",
      "phase": "impl",
      "order": 2,
      "dependsOn": ["ui-gate"],
      "files": [
        "lib/api-key-accounts.ts",
        "lib/rpc-manager.ts"
      ],
      "instructions": "实现可复用的 API-key account store：metadata + per-account secret 文件、0700/0600 权限、masked preview、keyFingerprint、legacy read-through import、activeAccountId 管理、activate/delete/reveal helper、active credential 镜像回 auth.json、调用 reloadRpcAuthState()。保持上游 SDK 不感知多账号。provider 级 allowlist 先只开 opencode-go。",
      "acceptance": [
        "服务层能列出、创建、更新、删除、激活、reveal 单账号记录",
        "legacy 单 key 可幂等导入，不重复生成账号",
        "active mirror 更新后，运行时仍通过 auth.json 读取当前 active key"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "手工或轻量脚本验证 metadata 与 auth.json 的 active 一致性"
      ],
      "risks": [
        "metadata 与 auth.json 更新不一致会导致 UI 和运行时分裂",
        "若不做 keyFingerprint 去重，legacy import 会重复导入"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "api-summary-compat",
      "title": "演进 provider summary 与 legacy 单 key 兼容路由",
      "phase": "impl",
      "order": 3,
      "dependsOn": ["account-store"],
      "files": [
        "app/api/auth/all-providers/route.ts",
        "app/api/auth/api-key/[provider]/route.ts",
        "docs/modules/api.md"
      ],
      "instructions": "扩展 ApiKeyProvider summary，至少增加 authMode（single / managed_accounts），必要时增加 accountCount 与 activeAccountDisplayName。保留 GET summary。POST 对 opencode-go 保持旧的『替换当前 active key』兼容语义。DELETE 在 managed 模式下返回受控 409，而不是粗暴删除全部账号。",
      "acceptance": [
        "现有 provider 列表与 summary 调用点仍可工作",
        "前端能通过 summary 判断 opencode-go 是否进入 managed mode",
        "旧单 key POST 兼容语义保留，DELETE 不会误删全部托管账号"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工请求 /api/auth/all-providers 与 /api/auth/api-key/opencode-go"
      ],
      "risks": [
        "若 DELETE 设计错误，旧入口可能造成用户全部账号被删"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "api-managed-routes",
      "title": "新增 opencode-go 多账号管理路由族",
      "phase": "impl",
      "order": 4,
      "dependsOn": ["account-store"],
      "files": [
        "app/api/auth/api-key/[provider]/accounts/route.ts",
        "app/api/auth/api-key/[provider]/accounts/[accountId]/route.ts",
        "app/api/auth/api-key/[provider]/accounts/[accountId]/activate/route.ts",
        "app/api/auth/api-key/[provider]/accounts/[accountId]/reveal/route.ts",
        "docs/modules/api.md"
      ],
      "instructions": "新增 list/create/update/delete/activate/reveal 路由。列表与 summary 一律不返回明文。reveal 只允许单账号返回 apiKey，必须 no-store，不把 secret 写进错误文本。provider allowlist 先仅支持 opencode-go，避免扩大到全部 API-key providers。",
      "acceptance": [
        "路由完整覆盖新增/编辑/删除/激活/reveal",
        "列表类返回不含明文 apiKey",
        "reveal 仅能按单账号获取明文"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工用 fetch/curl 验证 managed routes"
      ],
      "risks": [
        "若 reveal 路由与列表路由混用，容易把明文泄漏到非预期响应",
        "若 provider allowlist 不严，其他 provider 会误进入未完成的 managed 模式"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "models-config-opencode-go",
      "title": "改造 ModelsConfig 的 opencode-go 多账号管理 UI",
      "phase": "impl",
      "order": 5,
      "dependsOn": ["ui-gate", "api-summary-compat", "api-managed-routes"],
      "files": [
        "components/ModelsConfig.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": "在现有 ModelsConfig 中仅对 authMode=managed_accounts 的 provider 渲染新 UI。v1 只有 opencode-go 进入该模式。实现账号列表、active badge、显示名/描述、reveal/hide、copy、edit、delete、activate、legacy import banner、空状态与错误状态。其它 API-key providers 保持现有单输入框，不做回归性重构。",
      "acceptance": [
        "opencode-go 可在弹窗内完成完整多账号管理",
        "其它 API-key providers 仍保持原单 key 交互",
        "关闭弹窗/切换 provider 后 reveal 明文不残留"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工在 ModelsConfig 验证新增/激活/reveal/copy/编辑/删除流程"
      ],
      "risks": [
        "如果在 ModelsConfig 中硬编码大量 provider 分支，后续扩展会变脆弱",
        "明文 reveal 状态若放错层级，可能在 provider 切换后残留"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "docs-checks",
      "title": "同步文档并完成最终检查",
      "phase": "check",
      "order": 6,
      "dependsOn": ["api-summary-compat", "api-managed-routes", "models-config-opencode-go"],
      "files": [
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md"
      ],
      "instructions": "更新 API、Frontend、Library 模块文档，说明 opencode-go 的 managed accounts 模式、reveal 边界、legacy import 与 active mirror。运行标准验证命令并记录手工验收结论。不要运行 next build。",
      "acceptance": [
        "文档与最终实现一致",
        "lint 与 type-check 通过，或阻塞原因明确",
        "手工验收覆盖 legacy import、activate、reveal、delete fallback 与其它 provider 不回归"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "若文档未同步，后续 agent 容易误以为所有 API-key providers 都已支持多账号"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

补充手工验证建议：

- 打开 `ModelsConfig`，确认 `opencode-go` 显示多账号 UI，其它 API-key provider 仍是单输入框；
- 旧单 key 用户首次进入管理页时，能看到导入的 legacy 账号；
- 新增第二条 key 并激活后，`auth.json` 中 `opencode-go` 条目切到新 active key；
- reveal / copy 仅在单条账号动作时拿到明文；
- 删除 active 且仍有剩余账号时，fallback 自动激活；
- 删除最后一条账号后，provider 回到未配置状态；
- `opencode` provider 行为不受影响。

## 检查门禁

- 没有 UI 设计员 HTML 原型与用户审批，不得进入实现；
- 列表与 summary 响应不能出现明文 apiKey；
- reveal 仅允许单账号接口返回明文；
- `auth.json` active mirror 与 metadata active 状态必须一致；
- 其它 API-key providers 不发生回归；
- 不运行 `next build`，除非主会话另行要求发布验证。