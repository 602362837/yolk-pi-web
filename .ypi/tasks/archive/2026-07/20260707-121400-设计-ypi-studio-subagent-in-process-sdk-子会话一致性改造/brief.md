# brief

## 背景

当前主 Chat 在 `lib/rpc-manager.ts` 中通过 `createAgentSession()` 使用 in-process SDK；YPI Studio 成员子代理在 `lib/ypi-studio-extension.ts` 的 `runChildPi()/resolvePiCli()` 中 spawn `pi --mode json -p --no-session`。这会带来两个长期问题：

- 用户未全局安装 `pi` 或 PATH 不一致时，Studio subagent 启动失败。
- 子代理走 CLI/ephemeral session，和主 Chat 的 SDK 请求路径、auth/model registry、provider session-affinity 行为不一致，也没有可审计的 child session JSONL。

## 目标

设计长期一致性方案：将 YPI Studio subagent runner 改为同进程 `@earendil-works/pi-coding-agent` SDK 子会话，并让 child session、task/run、Sidebar/Project Registry、progress/transcript、cancel/wait、model/thinking 策略、兼容迁移形成稳定契约。

## 关键结论

- 长期方案使用**显式持久化 child session**，每个 Studio run 一个 child JSONL，并在 header 写 `studioChild` 元数据；标准 `parentSession` 指向父 Chat session file。
- `task.json` 仍是 Studio task/run 状态权威；child JSONL 是审计/回放和 provider affinity 载体，不作为 workflow 状态源。
- child SDK runner 默认不注入 YPI Studio / Browser Share 工具；task lifecycle、approval gate、continuation 只能由父 session 通过现有 Studio tools 推进。
- Sidebar 默认不把 child session 混入普通项目历史；可在父 session 下折叠展示或从 Studio run 详情打开只读审计视图。
- 先做 bundled CLI fallback 小修复可快速解除 PATH 风险；SDK runner 分阶段上线并保留 feature flag / fallback。

## 产物

- `prd.md`：需求和验收。
- `ui.md`：SessionSidebar/Widget/Studio Panel 展示建议。
- `design.md`：核心架构设计。
- `implement.md`：分阶段实现拆解与 `ypi-implementation-plan` 草案。
- `checks.md`：自动/人工检查清单。
