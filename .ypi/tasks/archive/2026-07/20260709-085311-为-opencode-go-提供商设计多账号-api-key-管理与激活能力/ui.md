# OpenCode Zen Go 多账号 API Key 管理与激活 - UI 设计要点

为了提高对多 API Key 管理及按需激活特性的表现层一致性，我们为 `opencode-go` 提供商设计了多账号列表界面。

## Provider 范围说明

- **本原型仅展示 `opencode-go` 的多账号管理 UI。**
- **其它 API-key provider**（`deepseek`、`openrouter`、`opencode`、`groq` 等）在 v1 **保持不变**，仍使用现有单输入框 + Save / Disconnect 模式（即当前 `components/ModelsConfig.tsx` 中 `ApiKeyDetail` 组件的交互）。
- `opencode-go` 与 `opencode` 账号池完全独立，互不影响。

## 交互设计原型

已交付高保真自包含 HTML 交互原型：
👉 [ui-prototype.html](ui-prototype.html) (支持切换状态、展示增删改查、以及安全查看/复制/回退演示)

---

## 核心设计要点

### 1. 列表式信息架构与指示器
*   **状态概览 (Provider Status)**: 顶部保留状态灯。当前只要有至少一条 API Key 且存在 Active Key，即显示 `configured` (绿灯)，点击“断开”或清空所有 Key 后恢复至 `not configured` (灰灯)。
*   **Active Badge**: 列表当前仅允许且必须维持最多一个账号为 `ACTIVE`。活跃的账号会有显著的高亮蓝框和绿色 `ACTIVE` 标签指示。
*   **已导入标识 (Legacy Import Badge)**: 首次从旧单 Key (`auth.json`) 迁移导入的 Key，会有专属的 `已导入` (黄色) 标签，并自动成为当前 Active，直至用户做主动切换或修改，避免破坏旧配置兼容体验。

### 2. 严格的 API Key 回显与复制约束 (Security Boundaries)
*   **默认脱敏**: 页面首屏以及后端返回的所有账号摘要中，API Key 始终保持 `op_zen_****_9f2d` 脱敏预览形态。
*   **单账号主动 Reveal/Hide**: 用户必须点击特定的 👀 按钮，前端才单独从后端 `reveal` 接口异步拉取并显示该行的真实 Key。支持再次点击隐藏。
*   **显式 Copy**: 仅在账号处于已 Reveal 状态下，才提供复制按钮。点击后复制到剪贴板，提供 Toast 成功反馈，在内存中瞬时完成，不保留至任何全局上下文或调试日志。

### 3. 操作行为与自动回退机制 (Fallback Logic)
*   **添加账号 (Add Key)**: 新增时，支持设置“显示名”(如团队名称、备用 key)、“描述备注”、输入“API Key”明文。提供 `保存后立即激活并设为生效 Key` 的默认勾选框。如果是首条账号，则强制自动激活。
*   **编辑账号 (Edit)**: 允许用户随时修改已有账号的显示名称与描述。对于 API Key 字段，提示输入新 Key 以替换旧凭证，不修改则留空，实现平滑轮换。
*   **删除 Active 的自动回退 (Fallback)**: 当用户点击删除当前处于 `ACTIVE` 的账号时：
    1. 若列表仍有剩余账号，系统会弹出确认框，提醒用户：“系统将自动激活并切回备用账号 `<Name>` 作为运行时凭证”；
    2. 若已是最后一条账号，提醒用户：“删除后提供商将退回到未配置状态，模型无法再调用”。
*   **断开提供商 (Disconnect All)**: 点击底部的“断开此提供商”按钮时，弹出高亮警告框确认，通过清空所有账号和凭证实现一键注销。

### 4. 异常与错误状态提示 (Error & Feedback)
*   当 reveal 明文、保存、激活或删除发生服务端 API 异常时，UI 需在列表顶部渲染醒目的红色错误提示条 (Error Banner)，详细反馈报错信息并不影响列表现有操作。
