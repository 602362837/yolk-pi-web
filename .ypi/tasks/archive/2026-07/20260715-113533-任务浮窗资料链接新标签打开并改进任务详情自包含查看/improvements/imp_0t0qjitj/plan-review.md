# 计划审批书：IMP-002 Chat 指定模型与执行一致（修订 r4）

## 审批请求

请审批本改进项的**修订后**修复计划与 **Settings 原型**。批准前不实现代码。

## 用户已确认的产品决策

1. **Chat 切换模型 = 会话级**（方案 **A**）：不写 `settings.json` 全局 default。
2. **新建 session 默认模型**放在 Settings → **蛋黄𝝅 默认配置**。
3. **默认思考等级收进同一组**：思考等级跟随所选模型能力（选项按模型裁剪/夹紧），不再作为与模型无关的孤立顶层项来理解。
4. Settings 可见结构变化 → HTML 原型已更新。

## 目标

- Chat 选中模型 = 实际执行模型；结束后不反写。
- Chat 切换仅会话级。
- 新建会话的 **模型 + 思考等级** 由蛋黄𝝅 默认配置决定，且 thinking 跟随模型。

## 必读材料

- [Brief](brief.md)
- [PRD](prd.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
- [UI](ui.md)
- [HTML 原型](yolk-default-model-settings-prototype.html)

## 推荐方案（锁定）

### R1 发送前 pin
模型（及必要的 thinking）在 prompt 前与 UI 对齐。

### R2 结束后不反写
选择器优先 live / 显式选择，不被 assistant 消息覆盖。

### R3 会话级 set_model（A）
不写全局 default。

### R4 蛋黄𝝅 · 新建会话默认模型与思考等级
Settings → **蛋黄𝝅 默认配置**：

1. 默认工具预设（保留）
2. **新建会话默认模型与思考等级**（一组）：
   - 模式：跟随 Pi 默认 / 指定模型
   - 指定模型：provider/model
   - 思考等级：仅展示该模型支持的等级；换模型时自动夹紧

配置建议：

```json
{
  "yolk": {
    "defaultToolPreset": "default",
    "defaultModel": {
      "mode": "specific",
      "provider": "grok-cli",
      "modelId": "grok-4.5",
      "thinking": "medium"
    }
  }
}
```

兼容：旧 `yolk.defaultThinkingLevel` 可在读配置时迁移/回退进 `defaultModel.thinking`；UI 不再单独强调与模型脱钩的顶层思考默认（实现时保留读兼容，避免破坏已有 pi-web.json）。

Chat 内改思考等级同样会话级，不写回 Settings / settings.json（除非产品另有明确“设为默认”入口——本改进不做）。

## 实施批次

1. MODEL-PIN-1 发送 pin  
2. MODEL-PIN-2 选择器恢复  
3. MODEL-PIN-3 会话级 set_model  
4. MODEL-PIN-4 `yolk.defaultModel(+thinking)` + 蛋黄𝝅 UI（thinking 跟随模型）  
5. MODEL-PIN-5 测试与文档  

## 需要用户确认

请批准本 r4 计划与更新后的原型（或提修改）。
