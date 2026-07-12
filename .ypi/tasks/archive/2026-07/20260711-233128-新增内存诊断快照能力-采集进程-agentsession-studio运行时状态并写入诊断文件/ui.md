# UI

## 原型门禁判断

**已触发 UI 原型门禁。**

原因：用户要求新增前端「诊断内存」按钮，属于前端功能新增与用户可见信息结构变化（Settings 新 section）。

## 推荐入口

- **推荐**：Settings 弹窗左侧新增 section `diagnostics`（诊断 / Diagnostics）。
- **主操作**：按钮「生成内存诊断快照」。
- **备选 A**：Yolk section 底部动作区。
- **备选 B**：Usage 弹窗底部次要动作。

不在聊天顶栏/输入区增加常驻按钮，避免主路径噪声。

## HTML 原型

- 路径：[ui-prototype.html](ui-prototype.html)
- 覆盖状态：idle / loading / success / error / 409 busy
- success 展示：路径、大小、耗时、schema/partial badge、复制路径
- 固定隐私 callout：本机路径保留、不自动上传、分享前审阅
- 明确不做：文件列表、下载中心、完整 JSON 预览、自动清理

## 交互与状态

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 默认 | 说明 + 主按钮 | 点击生成 | 进入 loading |
| 采集中 | 按钮 disabled「正在采集…」 | 无 | 等待 API |
| 成功 | 元数据卡片 | 复制路径 / 再次采集 | toast 或 inline 复制成功 |
| 409 | busy 提示 | 稍后重试 | 不重复提交 |
| 失败 | error message | 重试 | 保持 Settings 可用 |

## 实现复用

- `components/SettingsConfig.tsx`：扩展 `SettingsSection`，仿现有 section 列表 + 内容区。
- `fetch('/api/diagnostics/memory-snapshot', { method: 'POST' })`。
- 样式复用 Settings 现有 CSS 变量与按钮密度。

## 审批请求

请用户审阅 [ui-prototype.html](ui-prototype.html) 的入口位置、按钮文案与五态反馈；批准前不得实现。
