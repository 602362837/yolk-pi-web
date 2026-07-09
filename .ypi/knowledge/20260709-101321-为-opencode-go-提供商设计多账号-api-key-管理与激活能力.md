# 为 opencode go 提供商设计多账号 API Key 管理与激活能力

- Task: 20260709-085311-为-opencode-go-提供商设计多账号-api-key-管理与激活能力
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260709-085311-为-opencode-go-提供商设计多账号-api-key-管理与激活能力
- Archived at: 2026-07-09T02:13:21.361Z
- Tags: feature-dev, provider-config, opencode-go, api-key-accounts, knowledge, studio

## Summary
完成并归档：为 opencode-go 提供商实现多账号 API Key 管理与激活能力。关键可复用结论：对上游 `AuthStorage`/`ModelRegistry` 仍保持“一 provider 一当前凭证”契约时，新增多账号能力的低风险方案是应用侧自管账号池，并将 active key 镜像回 `auth.json`；多账号元数据与单账号 secret 分文件存储，列表/summary 只返回脱敏预览，单账号 reveal 接口返回明文且必须 `no-store`；legacy 单 key 通过指纹幂等导入，不触碰 provider summary 路径；旧 `DELETE /api/auth/api-key/[provider]` 在 managed 模式下应返回受控 409，避免误删全部账号；前端只对 `authMode=managed_accounts` 的 provider 切换为多账号 UI，Description 适合使用多行文本并在展示时保留换行。

## Reusable knowledge
# Summary

已完成 `opencode-go` 多账号 API Key 管理与激活能力，并归档为可复用实现模式。

# Reusable knowledge

- 若上游 SDK 仍以“一 provider 一当前 credential”为契约，Web 侧新增多账号时，优先采用**应用自管账号池 + active mirror 回写 `auth.json`**，避免侵入 `AuthStorage`/`ModelRegistry`。
- 推荐存储：`accounts.json` 保存元数据（displayName、description、masked preview、fingerprint、activeAccountId），每个账号单独 secret 文件保存明文 key；目录/文件权限分别为 `0700/0600`。
- 安全边界：列表/summary 不返回明文；reveal 仅支持单账号读取，响应加 `Cache-Control: no-store`；前端 reveal 状态在切换 provider/关闭后清空。
- legacy 单 key 迁移应做**按 keyFingerprint 幂等导入**，且不要在普通 provider summary 请求中隐式触发。
- managed 模式下，旧 `DELETE /api/auth/api-key/[provider]` 应返回受控 `409`，避免误删全部托管账号。
- 前端通过 `authMode=managed_accounts` 决定是否切到多账号 UI；Description 字段适合多行文本框，展示时应 `pre-wrap` 保留换行。

# Source artifacts

- `brief.md`
- `prd.md`
- `design.md`
- `ui.md`
- `plan-review.md`
- `implement.md`
- `checks.md`
- `handoff.md`
- `review.md`

## Source artifacts
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
