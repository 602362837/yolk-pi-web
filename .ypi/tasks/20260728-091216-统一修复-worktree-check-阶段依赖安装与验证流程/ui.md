# UI — 通用 WorkTree Check 状态

## 门禁结论

**本轮不触发 UI HTML 原型门禁。**

原因：规划不新增/修改页面、组件、交互、审批体验或信息层级；仅通过已有投影承载固定安全状态：

- GitHub unattended：现有 Jobs 的`reasonCode`、`blockedAtLayer`、retryability、safe event/next-step文案。
- 普通 Studio：现有subagent run的`progress.lastTextPreview`、`warnings`、`summary/error`、`terminationReason`。

## 允许的用户可见文案范围

不展示原始命令、安装/check输出、绝对路径、URL或env：

- `正在识别项目工具链与检查方式…`
- `正在准备 WorkTree 项目依赖…`
- `正在执行项目检查…`
- `正在核对检查证据…`
- `依赖准备失败，请根据项目配置或缺失工具处理后重试`
- `依赖准备超时或已达到尝试上限`
- `检查报告与实际命令结果不一致`

文案不出现平台“支持的包管理器”列表，也不宣称sandbox或缓存命中。

## 触发重新设计的条件

若实现范围新增以下任一项，必须先派UI设计员产出HTML原型并请用户审批：

- 专用发现/安装/check进度条或卡片；
- 原始命令/日志查看器；
- “安装/重试/选择工具链/放开权限”按钮；
- GitHub Jobs新字段布局或Studio run新信息层级；
- Settings中新增Check/依赖/权限策略配置；
- 新的交互式命令审批体验。
