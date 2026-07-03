# checks

## 需求覆盖检查

- [x] 成功 run + transcript/item/API 截断：显示 succeeded，截断为 info，不显示失败/异常提示。
- [x] hard limit/abort/non-zero exit：显示 failed/cancelled/waiting，保留原因和恢复建议。
- [x] 工具标题无需展开即可看到 `xx.x t/s`。
- [x] 默认展开态只显示固定数量最近进展（5），新进展替换旧进展。
- [x] 默认不展示 prompt、raw JSON、tool args/results；Debug/Raw 可显式打开。
- [x] 历史无 transcript 或旧 `transcript.truncated=true` 的 run 能降级显示。
- [x] Studio 任务列表/详情可绑定/继续 active task 到当前聊天；绑定不绕过 approval gate。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
```

结果：三项均通过。

## Checker Review

Checker verdict: Pass. No blocking findings.

## 手工验收

未执行完整浏览器手工回放。建议发布前可选 smoke：

1. 正常 Studio member run：标题显示 member、phase、`t/s`；展开 recent activity 不超过 5 条。
2. 长输出/截断 run：展示/结果裁剪为中性 info，不出现“成员运行异常”误导。
3. 真实失败 run：abort 或 hard failure 后仍使用失败样式。
4. Studio task list/detail：绑定 awaiting_approval task 后，当前聊天可识别任务；后续 explicit approval 仍由 approval gate 校验。

## 回归风险

- `hooks/useAgentSession.ts` 的 generic `subagent` partialOutput 拼接逻辑未作为本任务目标修改。
- `components/ChatWindow.tsx` studio overlay signature 已包含 recent preview 与 display flags，避免 widget 漏刷新。
- `lib/ypi-studio-transcripts.ts` 保留 `transcript.truncated` legacy 兼容；UI 不再把它单独视为失败。
