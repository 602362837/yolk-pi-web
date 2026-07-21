# UI：Gate 不适用

## 结论

本任务 **不触发 UI 原型门禁**，不派发 UI 设计员，不需要 HTML prototype。

## 依据

- Issue #9 只改变上传文件的服务端实际存储 basename；`POST /api/files/upload` 仍返回 `{ name, path, size }`，附件 UI 仍以原始 `name` 展示。
- Issue #10 只保证现有 GitHub 请求在 15 秒 deadline 内进入既有安全错误路径；不新增 SSE 状态、按钮或文案。
- Issue #11 让合法 tail-`moov` 文件进入已有 Appearance 上传成功路径；不新增页面状态、进度、提示或设置项。
- 计划不修改 `components/**`、`hooks/**` 或 `app/globals.css`。

## 保持不变的用户可见契约

- Chat 附件卡片、上传 busy/失败行为与发送格式不变。
- Settings → Links 的 Device Flow 页面、状态文字和重试入口不变。
- Settings → 外观的视频选择、超大文件确认、上传成功/失败状态不变。

## 重新打开 Gate 的条件

若实现阶段出现以下任一需求，必须停止实现并由 UI 设计员交付 HTML prototype，随后等待用户审批：

1. 新增或修改上传错误文案、附件 path/name 展示；
2. 新增 OAuth timeout/cancel 状态或操作；
3. 为 MP4 parser budget 增加新的用户可见错误 code/copy；
4. 改变 Appearance 上传确认或成功/失败交互。