# Review — IMP-002 模型 pin / 不反写 / 蛋黄𝝅 默认

## Verdict

**Pass（主会话检查）** — 建议进入 `waiting_user_acceptance`。

## Scope checked

- MODEL-PIN-1：`lib/session-model-pin.ts` + `hooks/useAgentSession.ts` ensureSessionModel / modelChangeChain
- MODEL-PIN-2：loadSession / agent_end 选择器恢复（不盲清 override；live/显式优先）
- MODEL-PIN-3：`lib/rpc-manager.ts` 会话级 set_model，不写 settings 全局 default
- MODEL-PIN-4：`lib/pi-web-config.ts` `yolk.defaultModel(+thinking)`；Settings 蛋黄𝝅 UI；新 session 初始化；thinking 随模型夹紧
- docs 与 `npm run lint` / `tsc --noEmit`

## Acceptance mapping

| 项 | 结论 |
| --- | --- |
| 发送前 UI 模型 pin | Pass（代码 + session-model-pin 测试） |
| 结束后不因 assistant 反写 | Pass（代码路径） |
| Chat 切换不写 settings default | Pass（rpc-manager 会话级） |
| 蛋黄𝝅 默认模型+思考 | Pass（config + Settings） |
| lint / tsc | Pass |

## Remaining / 用户验收

1. 选 Grok 发送 → 执行 Grok；结束后选择器仍为 Grok  
2. Chat 切换后 `settings.json` default 不变  
3. Settings 蛋黄𝝅 配置新建 session 默认模型/思考并验证新建会话  
4. 换模型时思考选项/值夹紧  

## Recommendation

`checking` → `waiting_user_acceptance`
