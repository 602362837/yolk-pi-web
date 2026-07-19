# Checks：Completed 退回与 /studio-archive 归档

## 1. 需求覆盖

| ID | 需求 | 验证方式 |
| --- | --- | --- |
| R1 | completed 投影退回 + 归档 CTA | 单测 `buildWidgetUserActions` + 手工浮窗 |
| R2 | 退回 `completed → user_acceptance` 原子写 | helper 单测 + PATCH 手工 |
| R3 | 归档主路径 Chat `/studio-archive` | 代码审查 + 手工 transcript |
| R4 | 禁止浮窗 silent fallback archive 主路径 | 代码审查：无 PATCH archive from new CTA |
| R5 | contextId / confirm / agentRunning busy | 手工 + 与 Hybrid B 对照 |
| R6 | archived 只读 | 单测 userActions=[] |
| R7 | 保全 approve/start_accept/main accept/improvement | 既有 test scripts |
| R8 | workflow 边 + review-only 无退回 | JSON/默认 workflow 断言 |
| R9 | docs 更新 | 文档 diff 审查 |

## 2. 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-widget-actions
npm run test:studio-widget-continue
npm run test:studio-main-accept
```

### 2.1 单测断言要点

**投影**

- `status=completed, archived=false` → kinds `{studio_archive, return_to_user_acceptance}`（或仅 archive 当 supportsReturn=false）
- roles primary/secondary；labels 非空；max ≤2
- `archived=true` → []
- `awaiting_approval` 仍 2 approve kinds（回归）
- 无 endpoint/url/body/path/feedback 字段

**domain**

- return helper：completed→user_acceptance；`completedAt == null`
- 错误：wrong status / unbound / bad revision / missing edge
- body guard 形状

**continue helper**

- `return_to_user_acceptance` / `studio_archive` → `needsChatContinue === false`

**canAcceptMain**

- completed → false；user_acceptance + unresolved0 → true

## 3. 手工验收

按 [ui.md](ui.md) §6 checklist 全跑一遍，额外：

1. 退回后主验收「确认主任务已完成」可再次 completed。  
2. `/studio-archive` 后任务进入 archive，浮窗只读或解绑行为符合现网。  
3. agent 流式输出时 CTA 禁用，结束后可点。  
4. Panel 归档仍可用（回归）。  
5. 主验收「确认并归档」仍按旧路径（本任务不改）。

## 4. 回归风险清单

| 风险 | 检查 |
| --- | --- |
| decision filter 漏 kind | 按钮不出现 |
| continue helper 误纳 archive | 错误 post-PATCH 引导 |
| 未清 completedAt | 统计/展示异常 |
| workflow 缺边 | 422；用户困惑 |
| 双发 archive | 禁止 widget PATCH archive |
| CSS 回归 | git diff globals.css 应为空（或仅无关） |
| userActions >2 | 单测失败 |

## 5. 安全 / 权限

- 写路径必须 bound `contextId` session-class
- 无 override 后门
- archive 仍仅 completed + 无 unresolved + 无 running subagents（既有 archive 门禁，由 slash 后模型调用）

## 6. 检查员重点

1. 是否出现 silent archive 捷径。  
2. slash 是否真走 `handleSend` → `prompt` → extension command。  
3. return 是否单锁零部分写。  
4. 视觉是否零改版。  
5. 文档 kinds 列表是否写全六个 kind。
