# Implement — Browser Share 绑定后全自动

## 执行前置

- 本文件仅为实现规划，当前未修改生产代码。
- 必须先由 `ui-designer` 交付并由用户批准 `browser-share-full-auto-prototype.html`。
- 主会话必须保存 machine-readable implementationPlan 并取得 plan-review 明确批准后，才能 transition 到 `implementing`。
- 实现涉及两个独立 Git 仓库；不得提交、push 或 merge，不得覆盖无关用户改动。

## 需先阅读

### ypi web

1. [prd.md](prd.md)、[design.md](design.md)、[checks.md](checks.md)、最终 [ui.md](ui.md) 与批准的 HTML 原型。
2. `docs/architecture/browser-share.md`
3. `lib/browser-share-types.ts`
4. `lib/browser-share-manager.ts`
5. `lib/browser-share-extension.ts`
6. `components/BrowserShareControl.tsx`
7. `app/api/browser-share/**`
8. `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`
9. `docs/standards/code-style.md`

### Chrome extension

1. `/Users/zyj/gitProjects/ypi-browser-share-extension/README.md`
2. `/Users/zyj/gitProjects/ypi-browser-share-extension/INSTALL.md`
3. `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.html`
4. `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.css`
5. `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.js`
6. `/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
7. `/Users/zyj/gitProjects/ypi-browser-share-extension/scripts/validate.mjs`

## 人类可读子任务表

| ID | Phase | 标题 | Order | dependsOn | 并行/评审 |
| --- | --- | --- | ---: | --- | --- |
| BSFA-01 | foundation | Web 权限策略、集中命令校验与 focused tests | 10 | — | 首项，local review required |
| BSFA-02 | web-surface | Web health/tool/UI/docs 语义同步 | 20 | BSFA-01 + UI approval | 可与 BSFA-03 并行 |
| BSFA-03 | extension | Chrome 扩展默认全自动、capability 与 popup | 30 | BSFA-01 + UI approval | 可与 BSFA-02 并行，独立仓库 |
| BSFA-04 | integration | 双仓集成验证、回归矩阵与文档收尾 | 40 | BSFA-01/02/03 | 串行收尾，checker required |

建议 `maxConcurrency=2`。BSFA-01 完成后，BSFA-02 与 BSFA-03 文件不重叠，可同时执行；BSFA-04 最后统一验证。

## 详细执行说明

### BSFA-01 — Web 权限策略与测试

- 在 manager 内集中表达 `permissionMode × commandType -> initialStatus/requiresApproval`。
- `interactive` 四类命令均 queued；`readonly` 四类均 pending approval。
- create 缺省改为 interactive（只有显式 readonly 才严格）。
- operator arrays 与 enqueue 使用同一策略。
- manager 集中验证 click/type/scroll/navigate payload，尤其 navigate 仅 http(s)。
- 保留 approval API、terminal idempotency、waiter 与 lifecycle 行为。
- 新增 `scripts/test-browser-share-policy.mjs` 与 package script。

### BSFA-02 — Web 表面

- health version/capability additive 更新。
- 内置 Browser Share agent tool descriptions/guidelines 改为绑定后全自动；严格模式另述。
- `BrowserShareControl` 严格对齐批准 HTML：产品文案、授权边界、全自动无 pending、严格模式保留 pending。
- UI 只读取 operator arrays；不能复制策略判定。
- 更新 architecture/modules docs。

### BSFA-03 — Chrome 扩展

- popup 默认「全自动（推荐）」；严格模式显式次选。
- 全自动创建前要求 Web health full-auto capability；旧 Web 明确升级提示。
- strict 可按既有 persistent debugger 能力兼容。
- 本地 activeShare/operator 初始映射与服务端一致。
- 更新 popup 已绑定摘要、README/INSTALL 与 validate。
- 不改变 debugger target、host permission、snapshot/action 脱敏边界。

### BSFA-04 — 集成与检查

- 跑双仓自动验证。
- 按 checks M1–M7 完成真实 Chrome 验收，至少 M1–M5 必须有证据。
- 检查 Web/extension 版本组合、双 session 隔离、strict approval、debugger conflict、生命周期。
- 若环境不能覆盖 M6/M7，记录精确缺口和复现步骤，不得写“已通过”。
- checker 审查双仓 diff 与文档一致性。

## 验证命令

### ypi web

```bash
npm run test:browser-share-policy
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

### Chrome extension

```bash
cd /Users/zyj/gitProjects/ypi-browser-share-extension
npm run build
git diff --check
```

不要直接运行 `next build`。仅发布/正式构建验证时使用主仓 `npm run build`。

## 检查门禁

- HTML 原型已获用户明确批准。
- 全自动四类命令均不出现 pending approval。
- strict approval/reject 与旧协议保持。
- capability mismatch fail closed。
- session/tab/debugger/sensitive/http(s) 安全边界无回归。
- Web 与 extension 两个仓库都完成验证。
- checker 对照 [checks.md](checks.md) 审查；未完成手工 Chrome 主路径不得宣称完成。

## 回滚

1. Web policy 回滚到旧 interactive 特判，同时撤销 full-auto health capability 和 UI承诺。
2. Extension 回滚默认与 capability/UI；不得保留“全自动”文案连接旧行为。
3. approval/status 路由始终保留，无持久数据迁移。
4. 若只能回滚一侧，capability handshake 必须阻止错误承诺。

---

## Implementation Plan (machine-readable)

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Browser Share binding becomes the default full-auto authorization point: interactive queues all four actions without per-command approval, readonly preserves strict approvals, and Web/Chrome extension surfaces stay capability-versioned and consistent.",
  "strategy": "Implement and test the server policy first; then update Web and the independent Chrome extension in parallel after approved UI HTML; finish with cross-repo integration and real Chrome validation.",
  "maxConcurrency": 2,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "BSFA-01",
      "title": "Implement authoritative full-auto policy, centralized payload validation, and focused tests",
      "phase": "foundation",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/browser-share-manager.ts",
        "lib/browser-share-types.ts",
        "scripts/test-browser-share-policy.mjs",
        "package.json"
      ],
      "instructions": [
        "Create one authoritative manager policy for initial command status and approval requirement; use it from enqueueCommand and operatorForShare.",
        "Define interactive as full auto for click, type, scroll, and navigate; define readonly as strict per-command approval for all four types.",
        "Normalize omitted create request permissionMode to interactive; only explicit readonly selects strict mode.",
        "Move caller-independent payload checks into the manager so direct commands API callers cannot bypass tool checks: required elementId/text, finite scroll values, and http(s)-only normalized navigation URL.",
        "Preserve approval API behavior, terminal idempotency, wait timeout, waiter notifications, unbind/rebind/stop failure, tombstones, retention, and diagnostic privacy.",
        "Add a focused test script and package command covering policy tables, operator projections, payload rejection, cross-session approval, strict approve/reject, timeout/late-result, and lifecycle failure.",
        "Do not change Browser Share action types, add shareId to agent tools, or modify production UI in this subtask."
      ],
      "acceptance": [
        "Interactive commands start queued for all four action types and operator approvalRequiredCommands is empty.",
        "Readonly commands start pending_approval for all four action types and retain approve/reject behavior.",
        "Omitted permissionMode resolves to interactive.",
        "Invalid or non-http(s) payloads fail before command insertion.",
        "Focused tests pass without touching user Browser Share runtime state."
      ],
      "validation": [
        "npm run test:browser-share-policy",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "Policy and operator projection can drift if separate mappings remain.",
        "Over-strict centralized validation could reject historically tolerated direct API payloads; tests must encode the documented contract.",
        "Short timeout tests can be flaky if they assert exact timing rather than terminal state."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["policy single source", "API payload boundary", "lifecycle compatibility"]
      }
    },
    {
      "id": "BSFA-02",
      "title": "Align Web health capability, agent tools, BrowserShareControl, and documentation",
      "phase": "web-surface",
      "order": 20,
      "dependsOn": ["BSFA-01"],
      "relation": "parallel",
      "files": [
        "app/api/browser-share/health/route.ts",
        "components/BrowserShareControl.tsx",
        "lib/browser-share-extension.ts",
        "docs/architecture/browser-share.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "Add an additive health capability for interactive_full_auto_v1 (recommended boolean fullAutoInteractive plus a stable semantics token) and bump the health version consistently.",
        "Update Browser Share tool descriptions, promptSnippet, and promptGuidelines: a bound interactive/full-auto share requires no per-command approval; readonly/strict still does; debugger failure remains fail-safe.",
        "Implement the approved browser-share-full-auto-prototype.html in BrowserShareControl: product labels Full Auto/Every action confirmation, clear current tab/session authorization boundary, no empty approval area for full auto, strict pending cards preserved, and debugger/offline status priority retained.",
        "Render auto/approval command lists from operator data rather than hard-coding command policy in the component.",
        "Update architecture and module maps so API/operator/command lifecycle/default semantics match code.",
        "Do not remove the approval route, pending_approval status, reject path, or terminal timeout."
      ],
      "acceptance": [
        "Health callers can machine-detect full-auto interactive semantics.",
        "Web UI and agent prompt no longer say type/navigate require approval in the default mode.",
        "Strict mode still renders and operates approval cards.",
        "Debugger detached/blocked/failed messaging remains visible and actions remain unavailable.",
        "Documentation and code describe the same mode table."
      ],
      "validation": [
        "npm run test:browser-share-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual compare against the user-approved HTML prototype"
      ],
      "risks": [
        "Raw interactive/readonly names may leak into user-facing text and confuse users.",
        "Removing the pending UI entirely would break strict mode and historical pending commands.",
        "A green full-auto state could visually hide debugger failure unless error priority remains higher."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["approved UI parity", "operator-driven display", "accessibility", "docs"]
      }
    },
    {
      "id": "BSFA-03",
      "title": "Make the Chrome extension default to capability-verified Full Auto and align popup copy",
      "phase": "extension",
      "order": 30,
      "dependsOn": ["BSFA-01"],
      "relation": "parallel",
      "files": [
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.html",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.css",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.js",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/README.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/INSTALL.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/scripts/validate.mjs"
      ],
      "instructions": [
        "Implement the approved prototype mode selector with Full Auto recommended and selected by default, plus explicit Every action confirmation strict mode; keep real radio semantics and keyboard access.",
        "When Full Auto is selected, require the new Web health capability before creating a share; fail closed with a clear update-yolk-pi-web message on old services. Strict mode may continue when existing persistentDebugger capability is available.",
        "Send interactive for Full Auto and readonly for strict; keep active share mode fixed for its lifetime.",
        "Align pending local operator projections, bound operator summary, allowed command text, badge title, and recent status with the server mode table.",
        "Remove stale default-path copy claiming type/navigate still require ypi approval; retain strict-mode approval instructions and troubleshooting.",
        "Keep debugger target activeShare.tabId, optional host permission rules, screenshot/snapshot sanitization, sensitive element refusal, long-poll execution, and detach lifecycle unchanged.",
        "Strengthen validate.mjs only with stable structural/contract checks; avoid brittle full-copy snapshots."
      ],
      "acceptance": [
        "A fresh popup defaults to Full Auto without an extra checkbox action.",
        "Full Auto connected to a Web service without the capability cannot create a falsely advertised share.",
        "Strict mode remains selectable and accurately describes ypi approval.",
        "Popup after binding shows the same autoAllowed/approvalRequired scope returned by Web.",
        "Extension validation passes and default host permissions remain narrow."
      ],
      "validation": [
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && npm run build",
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && git diff --check",
        "Manual keyboard and 375px popup review against the approved HTML prototype"
      ],
      "risks": [
        "A capability check applied to strict mode would unnecessarily break compatibility with old Web services.",
        "Popup-local default and service-worker fallback can disagree if both do not map modes consistently.",
        "Cross-repository changes can be omitted from the final review."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["capability handshake", "default mode", "tab scope", "host permissions", "approved UI parity"]
      }
    },
    {
      "id": "BSFA-04",
      "title": "Run cross-repository integration, compatibility, lifecycle, and real Chrome validation",
      "phase": "integration",
      "order": 40,
      "dependsOn": ["BSFA-01", "BSFA-02", "BSFA-03"],
      "relation": "serial",
      "files": [
        ".ypi/tasks/20260724-162805-browser-share-绑定后零拦截全自动操作-取消-type-navigate-审批/checks.md",
        ".ypi/tasks/20260724-162805-browser-share-绑定后零拦截全自动操作-取消-type-navigate-审批/handoff.md",
        "docs/architecture/browser-share.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/README.md",
        "/Users/zyj/gitProjects/ypi-browser-share-extension/INSTALL.md"
      ],
      "instructions": [
        "Run all Web and extension validation commands and record exact results.",
        "Execute checks.md M1-M7 with real Chrome when available; M1-M5 are required before claiming the feature complete.",
        "Verify default full auto without opening either popup/panel during command execution, strict approve/reject, session isolation, debugger conflict, unbind/replace/stop/tab-close/not-found, and version capability mismatch.",
        "Review both repository diffs for unrelated changes and stale permission copy; do not commit, push, or merge.",
        "Update handoff.md with changed files per repository, validation evidence, manual gaps, rollback notes, and remaining risks.",
        "If a product or security decision differs from the approved plan, stop and return to the main session rather than guessing."
      ],
      "acceptance": [
        "Web focused tests, lint, typecheck, and diff check pass.",
        "Extension build/validation and diff check pass.",
        "Real Chrome proves type and navigate complete in default Full Auto with no pending_approval or Allow once action.",
        "Strict and lifecycle/security regressions are verified or any environment blocker is explicitly documented.",
        "Checker finds no blocker against PRD R1-R13 and the approved HTML prototype."
      ],
      "validation": [
        "npm run test:browser-share-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check",
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && npm run build",
        "cd /Users/zyj/gitProjects/ypi-browser-share-extension && git diff --check",
        "Manual Chrome checks M1-M7 from checks.md"
      ],
      "risks": [
        "MV3 service-worker suspension can make a transport timeout look like an approval regression; inspect command states and heartbeat evidence.",
        "Old extension/new Web and new extension/old Web require separate explicit checks.",
        "Manual browser validation may be blocked by unavailable Chrome or a stale dev server; do not convert a gap into a pass."
      ],
      "parallelizable": false,
      "member": "checker",
      "localReview": {
        "required": true,
        "reviewer": "checker",
        "focus": ["real user flow", "security boundaries", "cross-version compatibility", "dual-repo completeness"]
      }
    }
  ],
  "execution": {
    "groups": [
      {
        "id": "foundation",
        "subtaskIds": ["BSFA-01"]
      },
      {
        "id": "surfaces-parallel",
        "subtaskIds": ["BSFA-02", "BSFA-03"]
      },
      {
        "id": "integration",
        "subtaskIds": ["BSFA-04"]
      }
    ]
  }
}
```
