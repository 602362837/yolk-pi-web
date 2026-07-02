# design

## 方案摘要

采用最小闭环方案：在 `runChildPi()` 解析子 Pi JSON 输出时识别阻塞型 `extension_ui_request`。一旦出现 `select`、`confirm`、`input` 或 `editor`，将子运行标记为 `waiting_for_user`，把请求信息转为 assistant/transcript item 和最终工具结果，并终止子进程，避免父 session 无限等待。

## 状态模型

`YpiStudioSubagentTranscriptStatus` 扩展为：

- `running`
- `succeeded`
- `failed`
- `cancelled`
- `waiting_for_user`

`waiting_for_user` 表示子成员无法在当前单向子进程执行模型内继续，需要用户关注请求内容。它不是运行中，也不是失败；前端用警示色展示。

## 数据流

1. `ypi_studio_subagent` 启动 `pi --mode json -p --no-session` 子进程。
2. 子进程 stdout JSONL 被 `runChildPi.parseLine()` 解析。
3. 遇到阻塞型 `extension_ui_request`：
   - 提取 method/title/message/placeholder/options。
   - `status = "waiting_for_user"`。
   - 写入 transcript item。
   - 通过 `onUpdate` 推送状态。
   - kill 子进程并 resolve 工具结果。
4. React transcript renderer 识别 `waiting_for_user` 并显示 `Waiting for user`。

## 风险与取舍

- 当前方案不保留子进程等待后继续执行的能力；这是为了先消除“主 session 卡死”的 UX 问题。
- 后续可设计持久化子进程/RPC 双向响应通道，实现用户在父 UI 输入后 resume 子任务。
