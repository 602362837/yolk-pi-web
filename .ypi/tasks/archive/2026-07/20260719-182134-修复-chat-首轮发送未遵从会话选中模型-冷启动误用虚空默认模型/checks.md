# Checks — Chat 冷启动模型 pin（计划 B）

## 1. 需求覆盖

| 需求 | 验证方式 | 通过标准 |
| --- | --- | --- |
| R1 历史会话首轮用 UI 模型 | 手工 H1 + 网络序 | set_model→prompt；实际模型=UI |
| R2 context 不冒充 pin | 代码审 + 单测 | loadSession 无 context→lastPinned |
| R3 live 已对齐可跳过 | 手工 H4 + 单测 | liveConfirmed 且 equal → 可无 set_model |
| R4 idle 后必 pin | 手工 H3 + 单测 liveConfirmed=false | 必 set_model |
| R5 MODEL-PIN-3 | test PIN-3 + 手工 settings.json | 默认不被 Chat/yolk 兜底改写 |
| R6 new/draft 不回归 | 手工 H6 | 首条正确 |
| R7 pin 失败不静默错模 | 手工 H7 / 代码 | ensure throw，不发 prompt |
| R8 steer/follow_up | 代码审 ensure 调用点 | 三处均走新语义 |
| R9 单测 | `npm run test:session-model-pin` | 全绿 |
| R10 服务端 yolk 兜底 | 手工 H8 + 代码审 startRpcSession | 无可恢复模型时不为 settings 虚空（yolk specific） |
| R11 session 恢复优先 | 手工 H9 + 单测优先级 | 不被 yolk 覆盖 |
| R12 客户端 pin 仍强制 | 手工 H1 + 代码 | unconfirmed 必 pin UI |
| R13 piDefault | 手工 H10 / 代码 | 允许 SDK/settings |
| R14 兜底隔离 | 代码审 withSessionScoped | 不写 settings |

## 2. 自动验证

```bash
npm run test:session-model-pin
node_modules/.bin/tsc --noEmit
npm run lint
```

检查员必须实际执行并记录退出码。

## 3. 代码审查清单

- [ ] `lastPinnedModelRef` **无** path `context.model` 赋值路径  
- [ ] 无 live 时 `liveAgentConfirmed`/等价为 false，或 lastPinned 已清空  
- [ ] `ensureSessionModel` 在 unconfirmed 时对有效 desired **总是** set_model  
- [ ] `enqueueModelChange` 串行仍在  
- [ ] `withSessionScopedSettingsDefaults` 仍包裹 Chat set_model **与** 服务端 yolk apply  
- [ ] 冷启动优先级：recoverable session model > yolk specific > settings/SDK  
- [ ] yolk **不**覆盖 recoverable session model  
- [ ] yolk **不**替代客户端对 UI desired 的 pin  
- [ ] Studio child（若走 startRpcSession）跳过用户 yolk 或有明确理由  
- [ ] 未改 `settings.json` 写入路径、未改 yolk 配置 schema（除可选文案）  
- [ ] 未引入无关重构  
- [ ] 文档与实现一致（两套默认源职责清晰）  

## 4. 手工验收

| # | 步骤 | 期望 | 结果 |
| --- | --- | --- | --- |
| H1 | settings 默认≠UI；冷开会话发送 | 首轮=UI 模型 | ☐ |
| H2 | 发送后选择器仍=UI | 不被错误 live/context 带跑 | ☐ |
| H3 | idle/重启清 registry 后再发 | 再 pin，模型正确 | ☐ |
| H4 | live 已对齐再发 | 行为正确（可跳过 pin） | ☐ |
| H5 | 切换模型立刻发 | 用新模型；settings 默认不变 | ☐ |
| H6 | 新建会话 | 首条用所选 | ☐ |
| H7 | 不可用模型 | 错误可见，不静默成功跑错模 | ☐ |
| H8 | settings≠yolk specific；**无可恢复 session 模型** 冷启动 | 初始/实际不静默落 settings 虚空；优先 yolk（随后可被 UI pin 覆盖）；settings 不变 | ☐ |
| H9 | 会话可恢复 S，yolk=Y≠S，UI=S | 用 S，不被 Y 覆盖 | ☐ |
| H10 | yolk mode=piDefault，无可恢复模型 | 允许 SDK/settings；客户端 pin 仍保证 UI | ☐ |

## 5. 回归风险

| 风险 | 信号 | 处理 |
| --- | --- | --- |
| 每次发送都 set_model | 网络面板刷屏 | 检查 liveConfirmed 是否永不 true |
| 选择器空白 | selected 被误清 | 只清 pin/confirmed |
| 新建会话回归 | 首条错模 | 对照 bootstrap |
| settings 污染 | 默认文件变更 | 阻断；查 PIN-3 与 yolk apply |
| 历史会话被 yolk 抢走 | 首轮变成 yolk 而非会话模型 | 查 recoverable 判定与客户端 pin |
| Studio 子会话模型异常 | child 跑 yolk | 查 skip 分支 |
| agent_end 闪错模 | 展示跳到虚空 | display 与 pin 分离 |

## 6. 阻断项（任一失败不得 ready）

1. 无 live 首轮仍可能跳过 set_model。  
2. context.model 仍写入 lastPinned。  
3. Chat set_model 或 yolk 兜底写回 settings 默认。  
4. `yolk.mode=specific` 且无可恢复模型时冷启动仍静默落到 settings 虚空默认（客户端 pin 被跳过或服务端未兜底）。  
5. yolk 兜底覆盖会话 UI 选中模型导致首轮不是用户所选。  
6. 自动测试失败。  

## 7. 非阻断 / 可跟进

- 服务端 prompt body 双保险 model 字段。  
- settings 与 yolk 默认源产品统一（另案）。  
- Settings 蛋黄𝝅说明文案微调。  

## 8. 检查员交付

- 更新 `review.md`：通过/不通过、命令输出摘要、H1–H10、阻断项。  
- 小修复可直改；设计问题退回架构师。
