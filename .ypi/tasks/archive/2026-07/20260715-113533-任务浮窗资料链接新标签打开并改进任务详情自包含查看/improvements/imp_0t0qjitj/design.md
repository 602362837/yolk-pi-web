# Design — IMP-002（修订 r4）

## 蛋黄𝝅 配置形状

```ts
yolk: {
  defaultToolPreset: ...
  // legacy optional read-compat:
  // defaultThinkingLevel?: ...
  defaultModel:
    | { mode: "piDefault" }
    | {
        mode: "specific";
        provider: string;
        modelId: string;
        thinking?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
      }
}
```

### Thinking 跟随模型

- Settings 与 Chat：可选 thinking 列表来自该模型的 thinkingLevels / capability map（已有 `/api/models` thinkingLevels）。
- 切换模型时：若当前 thinking 不在新模型支持集，夹紧到最近合法默认（如 medium → auto/medium/first）。
- 新建 session：使用 `defaultModel.thinking`（specific）或 Pi default thinking（piDefault）；并再按模型夹紧一次。

### 兼容

- 读取旧 `yolk.defaultThinkingLevel`：当 `defaultModel` 缺 thinking 时作为回退。
- 保存新配置时优先写 `defaultModel.thinking`；可停止写独立顶层 thinking（或双写一版兼容，实现时选最小破坏）。

## 其余层

Send pin / reload restore / session-scoped set_model 同前；pin 路径在需要时同时 ensure thinking。
