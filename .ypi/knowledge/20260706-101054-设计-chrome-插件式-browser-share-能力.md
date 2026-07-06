# 设计 Chrome 插件式 Browser Share 能力

- Task: 20260706-084928-设计-chrome-插件式-browser-share-能力
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260706-084928-设计-chrome-插件式-browser-share-能力
- Archived at: 2026-07-06T02:10:54.878Z
- Tags: browser-share, chrome-extension, ypi-web, agent-tools, studio, feature-dev

## Summary
已完成并归档：Chrome 插件式 Browser Share 能力。可复用结论：插件应作为 ypi web 外部独立项目放在 `~/gitProjects/ypi-browser-share-extension` 并单独发布到 GitHub，避免进入 ypi web npm/Next build；多 session 防误分享采用“Chrome 插件生成短期单次分享码 + 用户在目标 chat/session 填码绑定”，agent 工具必须从当前 session 上下文推导绑定，不接受 shareId。ypi web 侧新增 `app/api/browser-share/**`、`lib/browser-share-manager.ts`、`lib/browser-share-extension.ts`，提供 health/create share/bind/state/snapshot/commands/result API 和 browser_share_status/snapshot/get_selection/click/type/scroll/navigate 工具。安全边界：默认 readonly，写/导航/高风险操作需 UI 确认；快照限制长度并过滤 password/payment/token/hidden 字段值，不读 cookie/localStorage。验证通过 lint、tsc、插件 build；插件文档已补充并推送到 GitHub 仓库 `602362837/ypi-browser-share-extension`。

## Reusable knowledge
# Summary

已完成 Chrome 插件式 Browser Share 能力并归档。该能力让用户通过 Chrome MV3 插件显式共享当前页面给指定 ypi chat/session，agent 可读取安全快照，并在授权后执行受控操作。插件已迁移到独立项目 `~/gitProjects/ypi-browser-share-extension`，补充 README 使用文档并推送到 GitHub：`https://github.com/602362837/ypi-browser-share-extension`。

# Reusable knowledge

- 插件不要放进 ypi web 主包；独立项目路径为 `~/gitProjects/ypi-browser-share-extension`，避免进入 npm package / Next build。
- 多 session 防误分享的核心交互是：Chrome 插件点击分享当前页生成短期单次 share code；用户必须在目标 ypi chat/session 的 Browser Share 控件中输入该 code 才完成绑定。
- ypi web bridge 入口：`app/api/browser-share/**`；核心状态管理：`lib/browser-share-manager.ts`；wire types：`lib/browser-share-types.ts`。
- Agent 工具入口：`lib/browser-share-extension.ts`，在 `lib/rpc-manager.ts` 的 extensionFactories 中注册。工具必须从当前 session context 推导绑定，不允许接受任意 `shareId` 跨 session 访问。
- 工具清单：`browser_share_status`、`browser_share_snapshot`、`browser_share_get_selection`、`browser_share_click`、`browser_share_type`、`browser_share_scroll`、`browser_share_navigate`。
- 安全边界：默认 readonly；写入/导航/高风险操作进入 pending approval；UI 支持允许一次/拒绝；插件轮询 queued commands 执行并回传结果。
- 快照采集必须限制长度，并过滤 password/payment/card/cvv/token/secret/otp/hidden 字段值；不读取 cookie/localStorage。
- 插件 manifest 仅使用 `activeTab`、`scripting`、`storage` 与 localhost host permissions，不请求 `<all_urls>`，也不使用 CDP/debugger。
- 验证命令：主项目 `npm run lint`、`node_modules/.bin/tsc --noEmit`；插件 `cd ~/gitProjects/ypi-browser-share-extension && npm run build`。
- 后续改进：当前 action command 同步是 popup/轻量轮询驱动；可升级 Chrome alarms/offscreen document、WebSocket 或 SSE 以获得更实时后台执行。

# Source artifacts

- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/brief.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/prd.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/ui.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/design.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/implement.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/checks.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/handoff.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/review.md`
- `.ypi/tasks/20260706-084928-设计-chrome-插件式-browser-share-能力/summary.md`
- `docs/architecture/browser-share.md`
- `~/gitProjects/ypi-browser-share-extension/README.md`

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
