# UI — Models 弹窗渐进加载与覆盖项过滤

## UI 原型门禁

**已触发。** 本任务改变已有 Models 弹窗的可见信息结构（隐藏未配置的纯覆盖 provider）并新增 provider catalog 加载/失败状态。

- HTML 原型：[models-popup-prototype.html](./models-popup-prototype.html)
- 原型是基于当前 860px、78vh、左树右详情、底部保存栏的现有布局制作。
- `ui.md` 仅说明交互；HTML 文件是审批原型，不以纯 Markdown 替代。
- 当前尚无用户审批记录；在用户审批前不得进入实现。

## 保持不变

- 左下角 Models 入口位置、按钮名称与图标。
- 弹窗 860px 双栏结构、models.json 路径标题、取消/保存按钮。
- 左侧 active OAuth / API Key provider、custom provider/model 层级。
- 右侧 provider/model/account 详情内容和已有二级弹窗。

## 变化点

### 1. 渐进加载

- modal shell 立即渲染。
- models.json tree 先到先显示。
- active provider 区域在 catalog 未完成时显示单行：`正在读取已配置提供商…`。
- 不用全屏 spinner，不禁用 custom model 编辑。

### 2. 纯覆盖节点过滤

下列 raw config 节点不进入左树：

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "some-model": { "cost": { "input": 0 } }
      }
    }
  }
}
```

条件：provider 对象除 `modelOverrides` 外没有任何字段。该规则与 override 内容是否为 cost 无关；未知字段存在时保守显示。

- 数据不删除。
- 如果 OpenRouter 已配置 API Key，它仍从 active provider 区显示。
- 如果 provider 有 `models[]` / `baseUrl` / `api` 等，仍从 custom config 区显示。

### 3. 失败状态

- 固定文案：`提供商状态加载失败`。
- 同行提供 `重试`。
- custom models tree 和保存能力不被清空。
- 错误详情不展示 raw exception。

## 状态矩阵

| models-config | provider catalog | 左栏 |
| --- | --- | --- |
| loading | loading | config 区“加载中”；active 区“正在读取…” |
| ready | loading | config 树可操作；active 区“正在读取…” |
| ready | ready | active + filtered config 树 |
| ready | error | config 树可操作；active 区失败+重试 |
| error | any | models.json 固定错误；不得回退成空配置后允许覆盖保存 |

> 当前 `reloadConfigFromServer()` catch 会设置空 providers；实现时应避免把 GET 失败伪装成合法空配置，并禁用保存，防止误覆盖。这是现有风险的伴随修复。

## 键盘与可访问性

- modal 继续使用 dialog 语义；本任务不另造第二套 overlay。
- loading 使用 `role=status` / `aria-live=polite`，避免反复播报。
- error 使用可聚焦 button 执行重试。
- 过滤后 selection 若指向不可见 raw config，应回退到首个可见 config；深链 provider 优先级不变。

## 响应式

- 沿用 `.pi-modal-panel-large` / `.pi-modal-split-body` 的现有窄屏规则。
- 状态文案单行省略或自然换行，不增加横向滚动。

## 审批请求

请主会话/用户在实现前确认：

1. 接受“仅 `modelOverrides`、未形成实际 provider 配置的 raw 节点从左树隐藏但数据保留”；
2. 接受 provider catalog 按本地状态渐进加载，不在首屏主动联网验证认证；
3. 原型中的黄色“覆盖项不会丢失”卡片仅用于解释审批口径，推荐**不进入生产 UI**。
