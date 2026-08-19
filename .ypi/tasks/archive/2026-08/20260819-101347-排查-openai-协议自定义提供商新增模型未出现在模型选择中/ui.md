# UI — 修订门禁判定

## 判定

| 项 | 结论 |
| --- | --- |
| 页面/组件/布局变化 | 否 |
| 前端生产逻辑变化 | 否 |
| 模型选择器wire/value变化 | 否 |
| 是否触发HTML原型门禁 | **否** |

## 保持不变的体验

1. 用户仍在Models中新增provider/model并点击现有保存按钮；
2. 合法保存继续显示现有“已保存”；
3. semantic invalid保存复用footer已有`saveError`区域，不新增组件；
4. 关闭Models后仍由现有`refreshModelCatalog({force:true})`刷新；
5. Chat/Settings仍按provider分组显示exact `provider/modelId`；
6. server catalog失败继续使用现有client last-good/error状态；
7. 不新增reload按钮、toast、banner、auth说明或disabled/stale状态。

## 为什么无需前端修复

- `ChatInput`直接映射server `modelList`；
- `ModelSelect`不排除custom provider/model；
- 新会话同样订阅module-shared `useModelCatalog`，问题在server admin snapshot；
- browser generation/abort/last-good正确，前提是server用非2xx表达runtime错误。

## 门禁重开条件

实现若需要以下任一内容，必须停止并安排ui-designer产出HTML原型后请求用户审批：

- 新的可用性/auth说明；
- reload/refresh按钮；
- 保存后reload进度或partial warning；
- toast/banner/新错误区；
- 选择器stale/disabled状态；
- provider分组、文案、弹窗或确认流程变化。
