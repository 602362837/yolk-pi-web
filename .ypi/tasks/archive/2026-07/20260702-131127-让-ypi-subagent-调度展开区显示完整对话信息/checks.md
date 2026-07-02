# Checks

## 需求覆盖检查

- [ ] `ypi_studio_subagent` 运行中展开区不再只显示输入 JSON。
- [ ] 展开区显示 member、status、elapsed time、runId/taskId、model/thinking（如有）。
- [ ] 运行中至少显示 child process started / waiting / event count / last update 等可解释进展。
- [ ] 完成后显示 transcript timeline：prompt、assistant、tool call、tool result、stderr/error。
- [ ] 完成后 final output 仍可查看和复制。
- [ ] 旧 run 无 transcript 时显示明确降级，不报错。
- [ ] transcript 文件缺失/损坏/越权时显示可读错误，并回退到 summary/result。
- [ ] 失败、取消、stderr 非空、stdout 非 JSON 场景均有状态。
- [ ] 超长 transcript 不一次性写入 task.json，不造成 UI 卡顿。

## 自动质量检查

必须通过：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议补充（若项目已有合适测试框架再执行）：

- transcript helper 单元测试：路径安全、截断、旧 run normalize、读取缺失文件。
- route handler 测试：missing cwd、invalid task/run、access denied、not found、success projection。

## 手工验收脚本

1. 正常运行
   - 创建/绑定 YPI Studio task。
   - 触发 `ypi_studio_subagent(member=architect)`。
   - 在运行中展开工具块。
   - 预期：显示 Running、已耗时、最近进展；不是只有 prompt JSON。

2. 完成回放
   - 等 child 完成。
   - 展开工具块。
   - 预期：有 transcript timeline，assistant 输出用 Markdown 可读，tool call/result 摘要可展开。
   - 刷新页面后再次展开。
   - 预期：通过 transcript API 回放，不依赖内存状态。

3. 历史兼容
   - 打开已有无 transcript 的 `ypi_studio_subagent` 消息。
   - 预期：显示“该运行未捕获 transcript，仅显示最终输出/summary”，无 React error。

4. 错误路径
   - 使用无效 member 或中止运行。
   - 预期：状态为 Failed/Cancelled；stderr/error 可见；不长期停留 Running。

5. 超长输出
   - 让 child 输出较长文本或执行会产生多工具结果的任务。
   - 预期：UI 有截断/折叠提示，API response bounded，task.json 只保存 ref。

## 回归风险

- `useAgentSession.ts` tool progress state 若处理不当，可能影响普通工具 streaming；检查 bash/read/edit 的工具结果仍正常显示。
- `ToolResultMessage.details` 类型变更应只放宽读取，不应改变 session parsing。
- `onUpdate` partialResult 是累计值；前端如果追加显示会重复内容。
- transcript sidecar 路径必须限制在 workspace `.ypi/.runtime/studio-subagents`，避免任意文件读取。
- child Pi 事件格式可能随版本变化；未知事件必须忽略或作为 status，不应 crash。

## 文档检查

- [ ] `docs/modules/frontend.md` 更新 MessageView/useAgentSession 行为。
- [ ] `docs/modules/api.md` 更新 transcript route。
- [ ] `docs/modules/library.md` 更新 transcript helper 与 task run contract。
- [ ] 若数据契约最终与本设计不同，同步修正本任务 artifact 或后续 handoff。
