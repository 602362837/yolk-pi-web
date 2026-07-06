# Implement Plan — ChatGPT 自动切号

## Phase 1：配置与纯逻辑
- 修改 `lib/pi-web-config.ts`：新增 `PiWebChatGptFailoverConfig`、默认值、normalize/validate/patch 支持。
- 修改 `components/SettingsConfig.tsx`：ChatGPT 设置区新增“额度耗尽时自动切换账号”开关。
- 新增 `lib/chatgpt-account-failover.ts`：实现错误识别、quota 判断、候选排序、global state/mutex 的纯逻辑。
- 更新 `docs/modules/library.md`、`docs/modules/frontend.md`。

## Phase 2：运行时接入
- 修改 `lib/pi-types.ts`，补充需要的 agent continue/state 类型。
- 修改 `lib/rpc-manager.ts`：
  - `AgentSessionWrapper` 增加 failover turn state。
  - 订阅事件时捕获 assistant error message。
  - agent end 后调用 failover 模块。
  - 成功/失败/跳过时向 listeners 发 `chatgpt_account_failover` 事件。
  - 成功切号后移除最后 assistant error 并 retry 一次。

## Phase 3：前端提示
- 修改 `hooks/useAgentSession.ts` 或现有 SSE 处理：识别 `chatgpt_account_failover`。
- 修改 `components/ChatWindow.tsx` / message status 区：展示轻量提示，例如“ChatGPT 账号额度耗尽，已切换到 xxx 并重试”。
- 可选：触发 `ChatGptUsagePanel` 重新加载账号列表/active quota。

## Phase 4：文档与测试
- 单元测试覆盖 failover selector、错误识别、attempt budget、mutex already-switched 行为。
- 手工验证多 session 并发：两个 session 同时模拟 usage limit，仅一个真正切号，另一个识别 already_switched 并 retry。

## 注意事项
- 不在 MVP 自动消费 reset credit。
- 默认关闭。
- 所有失败路径必须回退到原错误，不吞掉真实错误。
- 锁内逻辑要短；quota refresh 可控，避免长时间阻塞其他 session。