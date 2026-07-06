# Checks — ChatGPT 自动切号

## 单元测试
- `isChatGptUsageLimitError`：
  - 命中明确 usage limit 文案/错误码。
  - 不命中普通 429、timeout、network、overloaded。
- candidate selector：
  - 排除 active、expired、cooldown、当前 turn 已尝试账号。
  - 新鲜 quota cache 可直接使用。
  - 过期 cache 触发受控 refresh。
  - 按 utilization / lastActivatedAt 排序。
- mutex/global state：
  - 并发两个请求只有一个执行 `activateOAuthAccount`。
  - 第二个请求看到 active changed 返回 `already_switched`。
  - `minSwitchIntervalMs` 生效。
- attempt budget：
  - 每 turn 默认最多 1 次切号 retry。
  - retry 后再次 usage limit 不再无限循环。

## 集成/手工验证
1. 默认关闭：模拟 usage limit，行为与当前一致。
2. 开关开启且有可用账号：模拟 active 账号 usage limit，自动切到候选账号，SSE 有事件，当前 turn retry。
3. 无可用账号：不切号，UI 显示“无可用账号”，原错误保留。
4. 多 session 并发：两个 session 同时失败，只切一次，另一个识别已切换并 retry。
5. 认证失败账号：候选刷新返回 expired 时跳过。
6. quota cache 满额且有 resetsAt：账号进入 cooldown 到 resetsAt 前不再作为候选。

## 常规验证
```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如新增测试脚本，也运行对应测试。