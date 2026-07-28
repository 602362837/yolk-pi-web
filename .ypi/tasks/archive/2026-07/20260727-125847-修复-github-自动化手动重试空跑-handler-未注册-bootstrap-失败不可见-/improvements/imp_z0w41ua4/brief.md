# Brief — IMP-001 空壳 Session 与 implementer_error

## 来源

主任务 GHR-06 在 30142 上证明 handler 可加载、parent Session 可绑定，但用户打开 `019fa25b-1d0b-731e-88af-1b2e86911602` 看到空壳。

事件：`unattended_session_created` → +11ms `unattended_implementer_error`（Internal GitHub automation error）。

## 已确认事实

| 事实 | 证据 |
| --- | --- |
| Parent session 仅 header/model | JSONL 5 行 / 866B，无 user/assistant/tool |
| 无 child session 文件 | 同 worktree sessions 目录仅 parent |
| implementer 在 child launch 前 throw | catch → implementer_error |
| 安全文案自触发 sentinel | “installation tokens” 命中 `/installation[_\s-]?token/i` |

## 用户诉求

1. 空壳 Session ≠ Agent 可用
2. 失败原因可见
3. 可修复/可验收
4. 保护 30141；优先 30142
5. 不要求完成本改进即完成 #22 业务

## 非目标

- 不自动完成 Issue #22 业务 diff
- 不放宽对真实 token 的拦截
