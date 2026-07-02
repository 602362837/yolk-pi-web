# summary

实现了 YPI Studio 子成员等待用户输入的 MVP 处理：当子 Pi 进程发出阻塞型 `extension_ui_request`（`select` / `confirm` / `input` / `editor`）时，父会话不再无限等待，而是把 run/transcript 状态标记为 `waiting_for_user`，显示请求详情，并结束子进程。

## 主要改动

- `lib/ypi-studio-extension.ts`：检测阻塞型 extension UI request，生成可读提示，推送进度并保留 `waiting_for_user` 状态。
- `lib/ypi-studio-types.ts`：状态类型增加 `waiting_for_user`。
- `lib/ypi-studio-tasks.ts`：任务持久化/readback 接受并保留 `waiting_for_user`。
- `components/YpiStudioSubagentTranscript.tsx`：展示 Waiting for user，并使用 warning 样式。
- 文档更新：`docs/architecture/overview.md`、`docs/modules/library.md`、`docs/modules/frontend.md`。

## 验证

- `npm run lint`：通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- Checker 复查：无 blocker。

## 后续建议

如果需要真正“父 UI 回答后子进程继续执行”，需要后续设计可恢复的双向子进程/RPC 通道；本次先解决主 session 卡死和用户不可见的问题。
