# Checks：浮窗决策 CTA → Chat Send 续推 + 工作中禁用

## 1. 需求覆盖

| ID | 检查项 | 方法 | 期望 |
| --- | --- | --- | --- |
| R-01 | `approve_plan`：PATCH + Chat Send | 手工 + 代码审 | 落库 implementing + transcript 引导词 |
| R-02 | `request_plan_changes`：PATCH + Chat Send | 手工 + 代码审 | planning/revision+1 + 引导词；**无** server 双发用户消息 |
| R-03 | `approve_improvement_plan`：PATCH + Chat Send | 手工 | 实例 implementing + 引导词含 improvementId |
| R-04 | `start_user_acceptance`：仅 PATCH | 手工 | user_acceptance；transcript **无**自动引导词 |
| R-05 | 改进结果验收：仅 PATCH | 手工 | accepted；无 Send |
| R-06 | 主验收/归档：仅 PATCH | 手工 | completed/archive；无 Send |
| R-07 | agentRunning 禁用决策+双验收 | 手工 | disabled + title 说明 |
| R-08 | 写 busy 串行 | 手工 | 双击不双 PATCH |
| R-09 | Send 失败不回滚 | 手工/mock | 状态保持；partial toast |
| R-10 | 禁止「只 Send 不 PATCH」批准 | 代码审 | 无新路径跳过 action body |
| R-11 | 引导词无 HTML/endpoint | 单测 | builder assert |
| R-12 | 模型与 Chat 一致 | 手工 | 顶栏模型=续推调用路径（ensureSessionModel） |
| R-13 | **不改现有浮窗视觉** | diff 审 + 对照生产 | 无新增/改写决策区·rail·验收区布局与样式体系；HTML 示意不得驱动 CSS/DOM 重画；仅 disabled/aria/title/toast/Chat 消息 |

## 2. 动作矩阵验收

| 动作 | PATCH | Chat Send | 工作中禁用 | 检查 |
| --- | --- | --- | --- | --- |
| approve_plan | 是 | 是 | 是 | ☐ |
| request_plan_changes | 是 | 是 | 是 | ☐ |
| approve_improvement_plan | 是 | 是 | 是 | ☐ |
| start_user_acceptance | 是 | 否 | 是 | ☐ |
| 改进结果验收 | 是 | 否 | 是 | ☐ |
| 主任务验收/归档 | 是 | 否 | 是 | ☐ |

## 3. 质量检查（自动）

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-widget-actions
npm run test:studio-main-accept
npm run test:studio-widget-continue   # 若已添加
npm run test:studio-dag
```

| 检查 | 期望 |
| --- | --- |
| ESLint | 0 error |
| tsc | 0 error |
| widget-actions | 投影/写路径不回归 |
| main-accept | canAcceptMain 不回归 |
| continue helper | kind 矩阵 + prompt 字段 |
| dag | server helper 若保留则形状测试仍绿；route 不再依赖 wake |

## 4. 保全清单 A–F

| ID | 项 | 检查 |
| --- | --- | --- |
| A | 8 站 `WorkflowRail` / `is-eight-station` / Detail | ☐ 结构在；无删站 |
| B | quickPreviews 只读、不写 grant | ☐ busy 时仍可预览（推荐） |
| C | 改进摘要 + 结果验收 | ☐ 仅增 disabled |
| D | 主验收 + 归档 | ☐ body 不变 |
| E | runtime / overlays / 写锁 | ☐ 写锁覆盖决策+验收 |
| F | 聊天 `user-input` 批准路径 | ☐ 未删除 |

## 5. UI / a11y

| 项 | 期望 |
| --- | --- |
| HTML 原型对照 | 禁用态、toast、续推消息信息层级一致 |
| aria-label | 决策仍区分「不是结果验收」；工作中有不可用说明 |
| 触控 | 决策按钮 ≥44px 保持 |
| reduced-motion | 无新增必选动画 |
| 误导 toast | 无「将继续编排」却无 Send 的默认成功文案 |

## 6. 回归风险

| 风险 | 如何抓 |
| --- | --- |
| 双发 request_changes | 网络面板仅 1 次 prompt；无 studio_user_action 主路径 |
| stale onComposeSend | 切换 session 后续推打到错误会话 |
| confirm 期间 agent 启动 | 二次 lock；无 PATCH |
| handleSend early return | 续推前 agentRunning 检查 |
| 拆掉 studio_autocontinue | 代码审：child/ready 续推仍在 rpc-manager |
| partial 用户不知所措 | toast 文案含「已落库」+ 下一步 |

## 7. 手工验收脚本（检查员）

1. 准备绑定会话任务于 `awaiting_approval`，Chat 选已知模型。  
2. 点「批准并开始实现」→ 确认 → 见 grant/implementing → Chat 用户消息引导词 → 流式。  
3. 另任务点「需要修改」→ 填 feedback → planning → Chat 引导词（无双消息）。  
4. 改进 `waiting_plan_approval` → 批准 → 实例引导词。  
5. `review` →「开始用户验收」→ 无 Chat 引导词 → 主验收可用。  
6. 主验收 / 改进验收 → 无 Chat 引导词。  
7. 在 agent 流式时展开浮窗：决策/验收 disabled；预览可开。  
8. （可选）临时弄断 onComposeSend：批准后状态变、partial toast、无回滚。  

## 8. 文档门禁

- [ ] `docs/modules/frontend.md` 描述 Chat Send 主路径  
- [ ] `docs/modules/api.md` request_changes server wake 已更正  
- [ ] `docs/modules/library.md` helper 已登记  
- [ ] `docs/architecture/overview.md` 一句不矛盾  

## 9. 完成定义（DoD）

- 矩阵全勾、A–F 全过、自动验证绿、无 scope 漂移、plan-review 已批后实现。  
