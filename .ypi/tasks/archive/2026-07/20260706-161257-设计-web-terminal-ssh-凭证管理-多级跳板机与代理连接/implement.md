# implement

## 执行原则

- 本文是 implementation plan 草案；主会话应保存计划并切到 `awaiting_approval`，等待用户确认后再实现。
- 不修改现有 local terminal 行为作为第一门禁。
- 先落类型/存储/安全边界，再接入 SSH runner，最后做 UI。
- 所有 secret API 必须先有脱敏与文件权限测试，再允许前端接入。

## 需先阅读的文件

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `components/TerminalPanel.tsx`
- `components/SettingsConfig.tsx`
- `lib/terminal-manager.ts`
- `lib/pi-web-config.ts`
- `lib/allowed-roots.ts`
- `lib/cwd.ts`
- `app/api/terminal/**`
- `app/api/web-config/route.ts`
- `lib/oauth-accounts.ts`（可复用 0700/0600 secret store 模式）

## 实现拆解（人类可读）

| Order | ID | Title | Depends on | Phase | Parallel |
| --- | --- | --- | --- | --- | --- |
| 10 | ssh-contracts-config | 定义 SSH profile/config/credential 类型与 pi-web 兼容扩展 | — | contracts | 否 |
| 20 | credential-vault-api | 实现 credential vault、脱敏 summary、credential API | ssh-contracts-config | security-storage | 可与 profile-api 并行 |
| 30 | profile-api-validation | 实现 profile CRUD、schema 校验、secret 字段拒绝 | ssh-contracts-config | config-api | 可与 credential-vault-api 并行 |
| 40 | known-hosts-manager | 实现 dedicated known_hosts 管理与 scan/trust API | ssh-contracts-config | security-storage | 可与 vault/profile 并行 |
| 50 | ssh-launch-runner | 实现 OpenSSH launch plan、临时文件、ProxyJump、askpass、proxy helper | credential-vault-api, profile-api-validation, known-hosts-manager | runner | 否 |
| 60 | terminal-session-integration | 扩展 terminal-manager 与 sessions API，支持 kind=local/ssh | ssh-launch-runner | terminal-api | 否 |
| 70 | settings-ssh-ui | Settings Terminal 增加 profiles/credentials/known_hosts 管理 UI | credential-vault-api, profile-api-validation, known-hosts-manager | frontend | 可与 terminal-panel-ui 并行 |
| 80 | terminal-panel-ui | TerminalPanel 支持 local/ssh 混合 tab 与 profile picker | terminal-session-integration, profile-api-validation | frontend | 可与 settings-ssh-ui 并行 |
| 90 | tests-docs-security-review | 自动验证、文档更新、安全 review 与手工验收 | terminal-session-integration, settings-ssh-ui, terminal-panel-ui | validation | 否 |

## 机器可读 implementationPlan 草案

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "为 Web Terminal 增加 SSH profiles、credential vault、多级 ProxyJump、SOCKS5/HTTP/custom proxy 与 local/ssh 混合 tab，保持 local terminal 兼容并强化 secret 边界。",
  "strategy": "先定义兼容配置和 secret storage，再实现 OpenSSH runner 与 API，最后接入 Settings/TerminalPanel UI；每阶段以 local terminal 不回归和 secret 不泄露为门禁。",
  "maxConcurrency": 3,
  "execution": {
    "mode": "mixed",
    "maxParallel": 3,
    "groups": [
      {
        "id": "contracts",
        "title": "类型与配置契约",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["ssh-contracts-config"]
      },
      {
        "id": "storage-config-parallel",
        "title": "Credential/Profile/Known hosts 基础设施",
        "relation": "parallel",
        "dependencies": ["ssh-contracts-config"],
        "subtaskIds": ["credential-vault-api", "profile-api-validation", "known-hosts-manager"]
      },
      {
        "id": "runner",
        "title": "OpenSSH 启动器",
        "relation": "serial",
        "dependencies": ["credential-vault-api", "profile-api-validation", "known-hosts-manager"],
        "subtaskIds": ["ssh-launch-runner"]
      },
      {
        "id": "terminal-api",
        "title": "Terminal session API 集成",
        "relation": "serial",
        "dependencies": ["ssh-launch-runner"],
        "subtaskIds": ["terminal-session-integration"]
      },
      {
        "id": "frontend-parallel",
        "title": "Settings 与 TerminalPanel UI",
        "relation": "parallel",
        "dependencies": ["terminal-session-integration"],
        "subtaskIds": ["settings-ssh-ui", "terminal-panel-ui"]
      },
      {
        "id": "validation",
        "title": "测试、文档、安全验收",
        "relation": "serial",
        "dependencies": ["settings-ssh-ui", "terminal-panel-ui"],
        "subtaskIds": ["tests-docs-security-review"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "ssh-contracts-config",
      "title": "定义 SSH profile/config/credential 类型与 pi-web 兼容扩展",
      "phase": "contracts",
      "order": 10,
      "dependsOn": [],
      "files": [
        "lib/pi-web-config.ts",
        "lib/terminal-ssh-types.ts",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "新增 PiWebTerminalSshConfig、TerminalSshProfile、TerminalSshEndpoint、TerminalSshProxyConfig、TerminalCredentialSummary 等类型。",
        "在 DEFAULT_PI_WEB_CONFIG.terminal 中增加 ssh 默认配置：enabled=false、allowCustomProxyCommand=false、defaultKnownHostsPolicy=ask、applyTerminalEnvToSsh=false、profiles=[]。",
        "扩展 normalize/validate/writePiWebConfigPatch，保证旧 pi-web.json 缺少 terminal.ssh 时无迁移脚本也能读取。",
        "明确 profile schema 禁止 secret 字段；credential secret 只能通过 vault API。"
      ],
      "acceptance": [
        "旧 terminal config 能被 normalize 为带 ssh 默认值的新 config。",
        "validatePiWebTerminalConfig 拒绝 profile 中出现 privateKey/password/passphrase/proxyPassword 等 secret 字段。",
        "docs/modules 中记录新增模块和 API 入口。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "SettingsConfig PUT 发送完整 terminal config；类型扩展必须避免破坏现有保存流程。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "credential-vault-api",
      "title": "实现 credential vault、脱敏 summary、credential API",
      "phase": "security-storage",
      "order": 20,
      "dependsOn": ["ssh-contracts-config"],
      "files": [
        "lib/terminal-ssh-vault.ts",
        "app/api/terminal/ssh/credentials/route.ts",
        "app/api/terminal/ssh/credentials/[id]/route.ts",
        "lib/oauth-accounts.ts"
      ],
      "instructions": [
        "创建 ~/.pi/agent/terminal-secrets/ vault，目录 chmod 0700，credential 文件 chmod 0600，Windows 下权限 best-effort。",
        "实现 create/list/update/delete/readSecret；list 只返回 summary 与 has* flags/fingerprint。",
        "实现 credential 被 profile 引用检查，默认禁止删除被引用 credential。",
        "所有错误和日志不包含 secret 值。"
      ],
      "acceptance": [
        "GET credentials 不返回 privateKeyPem/password/passphrase/proxyPassword。",
        "secret 文件不写入 pi-web.json。",
        "删除被引用 credential 返回 409 和引用 profile ids。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "新增或运行轻量脚本验证 vault masking 与文件权限"
      ],
      "risks": [
        "本地文件 vault 不是加密存储；必须在 UI 文案中说明并为未来 OS keychain 留扩展点。"
      ],
      "parallelizable": true,
      "parallelGroup": "storage-config-parallel",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "profile-api-validation",
      "title": "实现 profile CRUD、schema 校验、secret 字段拒绝",
      "phase": "config-api",
      "order": 30,
      "dependsOn": ["ssh-contracts-config"],
      "files": [
        "lib/terminal-ssh-profiles.ts",
        "app/api/terminal/ssh/profiles/route.ts",
        "app/api/terminal/ssh/profiles/[id]/route.ts",
        "app/api/terminal/ssh/profiles/[id]/test/route.ts",
        "lib/pi-web-config.ts"
      ],
      "instructions": [
        "实现 profile CRUD 写入 pi-web.json 的 terminal.ssh.profiles。",
        "校验 host/port/username/label/credentialId/jumpHosts/proxy；拒绝 control chars、newline、NUL、非法端口。",
        "custom ProxyCommand 要求全局 allowCustomProxyCommand 与 profile acknowledgedRisk，且拒绝 secret placeholder。",
        "test validate/resolve 模式返回 redacted plan 与 credential missing warnings。"
      ],
      "acceptance": [
        "profile 可包含 target credential 与多级 jumpHosts credential。",
        "profile API 不接受 secret 字段。",
        "test resolve 不产生长期副作用，并对缺失 ssh binary/custom proxy 风险给出分类错误。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "pi-web.json 写入是整体 patch；并发编辑可能覆盖，首版沿用现有配置写入语义。"
      ],
      "parallelizable": true,
      "parallelGroup": "storage-config-parallel",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "known-hosts-manager",
      "title": "实现 dedicated known_hosts 管理与 scan/trust API",
      "phase": "security-storage",
      "order": 40,
      "dependsOn": ["ssh-contracts-config"],
      "files": [
        "lib/terminal-known-hosts.ts",
        "app/api/terminal/ssh/known-hosts/route.ts",
        "app/api/terminal/ssh/known-hosts/scan/route.ts"
      ],
      "instructions": [
        "使用 ~/.pi/agent/terminal/known_hosts，目录 0700，文件 0600。",
        "实现 known_hosts list/remove/trust 与 ssh-keyscan best-effort scan。",
        "返回 key type、SHA256 fingerprint、host/port summary，不返回不必要原始文件内容。",
        "为 SSH launch config 提供 UserKnownHostsFile 与 HostKeyAlias helper。"
      ],
      "acceptance": [
        "known_hosts 文件独立于 pi-web.json。",
        "scan 失败不破坏 profile 保存，只返回可展示错误。",
        "HostKeyAlias 使用稳定 host:port，避免 session alias 污染 known_hosts。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "ssh-keyscan 不能证明可信，只能辅助 fingerprint 展示；UI 文案必须说明。"
      ],
      "parallelizable": true,
      "parallelGroup": "storage-config-parallel",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "ssh-launch-runner",
      "title": "实现 OpenSSH launch plan、临时文件、ProxyJump、askpass、proxy helper",
      "phase": "runner",
      "order": 50,
      "dependsOn": ["credential-vault-api", "profile-api-validation", "known-hosts-manager"],
      "files": [
        "lib/terminal-ssh-runner.ts",
        "lib/terminal-ssh-vault.ts",
        "lib/terminal-ssh-profiles.ts",
        "lib/terminal-known-hosts.ts",
        "scripts/terminal-proxy-helper.js"
      ],
      "instructions": [
        "检测 ssh/ssh.exe 可执行文件，构造 session-scoped temp dir。",
        "按 target + jumpHosts 生成临时 ssh_config，支持每级独立 User/IdentityFile/credential。",
        "生成多级 ProxyJump；有 proxy 时将 ProxyCommand 作用于第一跳或无跳场景的 target。",
        "实现 SOCKS5/HTTP proxy helper，proxy auth secret 从 0600 context 读取，不进入命令行。",
        "实现 imported private key 临时文件 0600 与 askpass context/helper。",
        "实现 cleanup：close、process exit、startup sweep。"
      ],
      "acceptance": [
        "redacted launch plan 可说明 target/jump/proxy/known_hosts 但不含 secret。",
        "临时 key/config/context 文件权限符合要求并在 session 结束清理。",
        "多级 jump host 使用不同 credential 时生成独立 Host alias 配置。",
        "SOCKS5/HTTP proxy 不依赖外部 nc。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "新增脚本验证 ssh_config 生成、redaction、temp cleanup"
      ],
      "risks": [
        "Password/passphrase askpass 在部分 OpenSSH/平台上可能不稳定；必须有手输 fallback。",
        "Proxy helper 需要谨慎处理 socket 错误和超时，避免挂住 terminal session。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "terminal-session-integration",
      "title": "扩展 terminal-manager 与 sessions API，支持 kind=local/ssh",
      "phase": "terminal-api",
      "order": 60,
      "dependsOn": ["ssh-launch-runner"],
      "files": [
        "lib/terminal-manager.ts",
        "app/api/terminal/sessions/route.ts",
        "app/api/terminal/sessions/[id]/route.ts",
        "app/api/terminal/sessions/[id]/events/route.ts",
        "app/api/terminal/sessions/[id]/input/route.ts",
        "app/api/terminal/sessions/[id]/resize/route.ts"
      ],
      "instructions": [
        "扩展 createTerminalSession input union，kind 缺省为 local。",
        "TerminalSessionInfo 增加 kind/profileId/profileLabel/targetLabel，可选字段保持兼容。",
        "TerminalSession 增加 cleanup callbacks，close/exit 时清理 SSH temp dir。",
        "SSH session 仍要求 terminal.enabled、terminal.ssh.enabled、cwd allowed roots。",
        "events/input/resize/delete routes 保持统一 session id 操作，无需暴露 SSH secret。"
      ],
      "acceptance": [
        "旧 local session API 请求和 UI 仍能工作。",
        "kind=ssh + profileId 可创建 SSH terminal session。",
        "terminal disabled 或 cwd 未授权时 local/SSH 均被拒绝。",
        "关闭 tab/dock 后 SSH 进程和 temp files 被清理。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "手工验证 local terminal 多 tab/split/input/resize/close 不回归"
      ],
      "risks": [
        "terminal-manager 当前假设 shell label 是本地 shell；UI 和 API 需要兼容 SSH label。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "settings-ssh-ui",
      "title": "Settings Terminal 增加 profiles/credentials/known_hosts 管理 UI",
      "phase": "frontend",
      "order": 70,
      "dependsOn": ["credential-vault-api", "profile-api-validation", "known-hosts-manager"],
      "files": [
        "components/SettingsConfig.tsx",
        "components/TerminalSshProfileEditor.tsx",
        "components/TerminalSshCredentialEditor.tsx",
        "components/TerminalKnownHostsPanel.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "在 Terminal section 下新增 SSH enable、profiles、credentials、known_hosts 区块。",
        "实现 profile editor：target、jump chain、proxy、known_hosts、danger toggles。",
        "实现 credential editor：secret fields 不回填，replace secret 显式操作，summary 脱敏展示。",
        "实现 test/scan/trust/delete flows 与错误/风险提示。",
        "保持现有 local terminal shell/env/env assistant 设置可用。"
      ],
      "acceptance": [
        "用户可创建 credential 和 profile，并看见 missing credential/custom proxy/host key warning。",
        "secret 输入保存后 UI 不回显 secret。",
        "删除被引用 credential 时显示引用并阻止默认删除。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "浏览器手工验收 Settings 保存/刷新/错误提示"
      ],
      "risks": [
        "SettingsConfig 已较大；如改动过大，应拆新组件并保持主组件只编排。"
      ],
      "parallelizable": true,
      "parallelGroup": "frontend-parallel",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "terminal-panel-ui",
      "title": "TerminalPanel 支持 local/ssh 混合 tab 与 profile picker",
      "phase": "frontend",
      "order": 80,
      "dependsOn": ["terminal-session-integration", "profile-api-validation"],
      "files": [
        "components/TerminalPanel.tsx",
        "components/TerminalSshProfilePicker.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "扩展 TerminalTabState 和 reducer，使 tab 保存 kind/local cwd 或 SSH profileId/profileLabel。",
        "把 header + 按钮改为 local/SSH picker，默认仍可一键新建 local。",
        "TerminalSessionView 根据 tab.kind 创建 local 或 SSH session。",
        "tab title/tooltip/status 展示 local cwd 或 SSH target summary；不展示 secret。",
        "多 tab/split/move/rename/close 逻辑复用现有 reducer。"
      ],
      "acceptance": [
        "一个 dock 内可同时打开 local tab 和多个 SSH profile tab。",
        "split pane 拖拽、rename、close、fullscreen/collapse 在 mixed tabs 下正常。",
        "active SSH tab 显示 profile/target 状态，错误 banner 可读。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "浏览器手工验收 mixed local/ssh tabs"
      ],
      "risks": [
        "TerminalSessionView useEffect 依赖 tab.cwd/tab.id；新增 profileId/kind 后要避免重复创建 session。"
      ],
      "parallelizable": true,
      "parallelGroup": "frontend-parallel",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "tests-docs-security-review",
      "title": "自动验证、文档更新、安全 review 与手工验收",
      "phase": "validation",
      "order": 90,
      "dependsOn": ["terminal-session-integration", "settings-ssh-ui", "terminal-panel-ui"],
      "files": [
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "docs/operations/troubleshooting.md",
        "scripts/test-terminal-ssh-config.mjs",
        "package.json"
      ],
      "instructions": [
        "更新 API/frontend/library docs，记录 SSH terminal 模块、routes、security boundary。",
        "新增轻量测试脚本覆盖 profile validation、redaction、vault permissions、ssh_config generation、custom ProxyCommand rejection。",
        "执行 lint、tsc、相关测试脚本。",
        "完成手工验收：local 不回归、direct SSH、multi-jump、SOCKS5/HTTP proxy、secret 不落 pi-web、temp cleanup。"
      ],
      "acceptance": [
        "npm run lint 通过。",
        "node_modules/.bin/tsc --noEmit 通过。",
        "新增 terminal SSH 测试脚本通过。",
        "文档明确 pi-web.json 与 vault/secret storage 边界。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "node scripts/test-terminal-ssh-config.mjs"
      ],
      "risks": [
        "真实 SSH/proxy 环境不一定可在 CI 复现；需要本地手工矩阵和 dry-run 测试兜底。"
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

## 验证命令

实现完成后的最低验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
node scripts/test-terminal-ssh-config.mjs
```

手工验证详见 `checks.md`。

## 检查门禁

- Local terminal 旧路径必须先验收通过，才能评审 SSH 功能。
- 任何 API response、UI state、`pi-web.json`、日志中出现 secret 即阻塞。
- custom ProxyCommand 必须默认不可用，且开启路径有强警告。
- known_hosts 默认策略与 UI 文案必须在实现前由主会话确认。
