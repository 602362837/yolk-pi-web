# 优化 Browser Share New Chat 绑定与 Chat 直接操作 Tab 交互

- Task: 20260706-103256-优化-browser-share-new-chat-绑定与-chat-直接操作-tab-交互
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260706-103256-优化-browser-share-new-chat-绑定与-chat-直接操作-tab-交互
- Archived at: 2026-07-06T05:28:50.300Z
- Tags: feature-dev, browser-share, chrome-extension, studio

## Summary
已完成 Browser Share New Chat 绑定与直接操作 tab 的 MVP。关键结论：New Chat 绑定应采用“懒创建真实空 session + 复用首条 prompt”的方式，避免 draft transfer 复杂度；首条消息后用第一条用户消息截断刷新标题，并保持 manual name 优先。Browser Share action tools 不应只返回 queued，而应等待 terminal 状态，默认 90 秒超时，并通过 onUpdate 暴露 pending_approval/queued/running/terminal。扩展侧采用 content-script 执行 + service worker background long-poll/alarms transport；popup 只做状态/手动控制，不再依赖常驻。Chrome debugger/CDP 可增强截图/坐标输入/导航/DOM/AX，但不能消除 extension 与 ypi web 间命令通道，因此本轮 deferred，不启用 debugger 权限。另修复了 Studio awaiting_approval→implementing 因绑定/上下文抖动导致无法继续的问题：允许在同次 transition 中基于明确批准 reason 记录 approvalGrant，再走原有断言。

## Reusable knowledge
# Summary

完成 Browser Share New Chat 绑定与直接操作 tab 的 MVP：支持 New Chat 先绑定再发送首条消息，action tools 等待 terminal 结果，extension 改为后台 long-poll/alarms 传输，popup 仅做状态/手动控制。

# Reusable knowledge

- **New Chat 绑定模式**：优先采用“懒创建真实空 session + 直接绑定 share code + 首条 prompt 复用同一 session”，不要做 draftId transfer。
- **标题刷新策略**：预创建 session 在首条消息后立即用第一条用户消息截断做 title seed；不要覆盖用户手动命名，后续可替换成模型总结。
- **命令闭环**：`click/type/scroll/navigate` 不应只返回 queued，需等待 `succeeded/failed/rejected/timeout` terminal 状态，并通过 `onUpdate` 推送进度。
- **安全边界**：agent tools 仍不得接受 `shareId`；绑定必须从当前 session 上下文推导。默认 readonly；interactive 下 `type/navigate` 仍需批准。
- **扩展实现选择**：MVP 采用 content-script + service worker background long-poll/alarms；popup 不是命令执行前提。
- **Debugger 结论**：Chrome `debugger`/CDP 能增强截图、导航、坐标输入、DOM/AX 读取，但不能消除 ypi web ↔ extension 命令通道；需高风险权限，因此本轮 deferred。
- **Studio 审批门禁经验**：`awaiting_approval -> implementing` 若完全依赖前置 hook 记录 grant，容易被绑定/上下文抖动卡死；可在同次 transition 中基于显式批准 reason 记录 approvalGrant，再复用原有断言链。

# Source artifacts

- `brief.md`
- `prd.md`
- `design.md`
- `implement.md`
- `checks.md`
- `handoff.md`
- `review.md`

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
