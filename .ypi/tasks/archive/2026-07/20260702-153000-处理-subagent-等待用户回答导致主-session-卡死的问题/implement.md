# implement

## 已执行改动

- `lib/ypi-studio-types.ts`
  - `YpiStudioSubagentTranscriptStatus` 增加 `waiting_for_user`。
- `lib/ypi-studio-extension.ts`
  - 新增阻塞型 extension UI request 识别与可读文本格式化。
  - 子进程遇到 `select` / `confirm` / `input` / `editor` 请求时，标记 `waiting_for_user`、写入 transcript、推送进度、终止子进程并返回父工具结果。
- `components/YpiStudioSubagentTranscript.tsx`
  - 支持解析和显示 `waiting_for_user` 状态。
- `docs/architecture/overview.md`
- `docs/modules/library.md`
- `docs/modules/frontend.md`
  - 记录该状态与展示行为。

## 验证计划

1. `npm run lint`
2. `node_modules/.bin/tsc --noEmit`
3. 手工触发一个会发出 extension UI request 的 Studio member/子进程，确认父会话不再无限等待，并能看到 Waiting for user 状态与问题详情。
