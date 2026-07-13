# Summary：YPI Studio 任务 session 独占归属

## 问题

session1 创建任务 A 后，session2 继续/绑定 A 时 `contextIds` 只追加不转移，导致两个 session 同时显示 A 浮窗。

## 方案

- 显式 bind/continue → exclusive transfer（单活跃 session owner）
- 普通 mutation 仅校验已 bound，禁止隐式 append/抢占
- transfer 时清跨 session approval grant；compare-before-unlink 旧 runtime pointer
- 存量多 owner 任务在下一次显式 bind 时惰性归一化

## 交付

- `lib/ypi-studio-tasks.ts`：ownership 原语 + exclusive bind + mutation guards
- `scripts/test-ypi-studio-session-ownership.mjs` + `npm run test:studio-session-ownership`
- docs：architecture/overview、modules/library、modules/api

## 验证

- 自动：test:studio-session-ownership、test:studio-dag、lint、tsc 通过
- Checker：Pass
- 用户验收：通过

## 已知窗口

存量多 context 任务在再次 bind 前仍可能多 session 显示；不做只读自动猜 owner。
