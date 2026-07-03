# handoff

## 产物

已完成设计产物：

- `brief.md`
- `prd.md`
- `ui.md`
- `design.md`
- `implement.md`
- `checks.md`

本轮未修改生产代码。

## 关键设计结论

- `ERR_STRING_TOO_LONG` 与 `runChildPi()` 无界 stdout/stderr Buffer 累积、`stdoutBuffer` 超长字符串、结束时 `Buffer.concat(...).toString()` 高度相关。
- MVP 应优先重构为流式 JSONL 解析 + 有界 accumulator，最终文本从已解析 assistant `message_end` 提取，禁止全量 stdout/stderr 转字符串。
- stop 需要从 `AgentSessionWrapper.abort/destroy` 级联到 Studio child process；建议新增无依赖 runtime registry，并使用进程组 kill + grace 后强杀。
- 卡死检测采用 first-event warning、idle timeout、max runtime timeout；主动 stop 记为 cancelled，timeout/output-limit 记为 failed + warning，不新增破坏性 status。

## 建议下一步

主 session 在记录本次 architect run 完成后，应将任务推进到 `awaiting_approval` 并请求用户确认；不要直接进入实现。

需要主会话确认的默认阈值：stdout 16MiB、stderr 1MiB、单行 1MiB、final output 256KiB、idle 10min、max runtime 60min、kill grace 2s/5s。

## 验证

本轮为设计产物，未运行 lint/tsc。
