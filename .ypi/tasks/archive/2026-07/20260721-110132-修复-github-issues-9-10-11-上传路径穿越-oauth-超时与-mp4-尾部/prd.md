# PRD：修复上传路径穿越、Links OAuth deadline 与 MP4 tail-`moov`

## 目标与用户价值

- 阻断通用文件上传的越权写入风险，保护源码、配置和同机数据。
- 保证 GitHub Device Flow 的每次上游请求都有确定时间上限，避免授权长期卡住并占用容量。
- 允许常见的合法 tail-`moov` MP4 作为 Appearance 视频上传，不再错误提示媒体无效。

## 范围内 / 范围外

### 范围内

1. `POST /api/files/upload` 的服务端存储名、目录边界、原子/独占写入和回归测试。
2. GitHub Links 三类上游调用（device code、token polling、identity）统一组合 caller abort + 15 秒 deadline，覆盖 body read。
3. Appearance MP4 顶层 box 链遍历和尾部 metadata 解析。
4. focused tests、相关文档、全量 lint/type-check。

### 范围外

- 前端页面、布局、文案和交互改版。
- 上传 API shape、上传大小、保留期或文件预览功能调整。
- OAuth 状态机/SSE schema、连接存储、重试策略调整。
- 新媒体格式、视频重编码、`ffprobe` 依赖、duration/resolution 政策变更。

## 需求与验收标准

### R1 — 客户端文件名不得决定存储路径

- `file.name` 不得作为写入 basename、目录名或路径片段。
- 服务端为每次上传生成不可预测的 opaque 目录与 basename。
- 可选扩展名只能来自严格归一化的短 ASCII alphanumeric allowlist；非法/超长扩展直接省略，不拼接原始字符。
- API 仍返回 `{ name, path, size }`，`name` 保留原始显示名，`path` 指向服务端生成的实际文件。

**验收：** `../x`、`..\\x`、POSIX/Windows 绝对路径、NUL、URL/百分号编码分隔符、重复名均不能影响目标目录外任何文件。

### R2 — 写入边界必须有纵深防御

- 最终 target 使用 `resolve` 计算，并用 `relative` 验证严格位于本次 upload directory。
- 上传目录以 0700 新建；文件以 0600、`wx` 独占创建；随机碰撞只允许受限重试，不覆盖既有文件。
- cleanup 不得跟随目录 symlink 去删除上传根之外的内容；遇到 symlink/异常条目跳过。
- 失败返回稳定、无绝对路径的错误，不把底层 write error 原文投影给浏览器。

**验收：** 同名并发/模拟随机碰撞不覆盖；symlink 和 containment 测试不触达临时根外 sentinel。

### R3 — 上传兼容性保持

- 200 MiB 单文件限制、1 GiB cleanup quota、7 天 retention 和返回字段保持。
- `ChatInput` 无需改动，附件显示仍使用原始 `name`，发送给 agent 的 `path` 是真实安全存储路径。
- 不迁移或重命名历史 `uploads/` 文件。

### R4 — 每个 GitHub 请求始终有独立 deadline

- 无论调用方是否传入 signal，都创建独立 15 秒 timeout/deadline。
- 组合信号实现必须兼容没有 `AbortSignal.any` 的运行时，不因平台能力降级为无 timeout。
- timer/listener 在成功、失败、主动取消和超时后均清理。

**验收：** 传入一个永不 abort 的 caller signal 时，永不 resolve 的 mocked fetch 在测试 deadline 后以 `github_timeout` 结束。

### R5 — 主动取消与超时可区分

- 内部 deadline 先触发：安全错误 code 为 `github_timeout`。
- caller signal 先触发：保留 AbortError/取消语义，不映射成 timeout/network；authorization manager 检测 aborted 后不写失败终态。
- timeout 与取消均不得把 URL、token、device code、response body 或 abort reason 原文投影到 wire/log。

### R6 — deadline 覆盖响应体读取

- 同一个组合 signal 覆盖 `fetch()` 和 bounded body-reader 循环。
- body stream 不结束时也必须按 deadline 退出。
- oversize、parse error、timeout、cancel 时 reader 都 best-effort cancel/release lock。
- 64 KiB cap、manual redirect rejection、JSON parse 和现有稳定错误 code 保持。

### R7 — 合法 tail-`moov` MP4 可解析

- 顶层 parser 从 offset 0 按合法 box size/extended size 跳跃，允许 `moov` 位于大 `mdat` 或 `free` 之后。
- 不扫描 `mdat` 内容，不把 payload 内的伪造 `moov` 字符串当成 box。
- 头部和尾部 `moov` 都返回相同的数字 metadata shape：`durationMs`, `width`, `height`。

**验收：** `moov` 起点在 8 MiB 前、边界附近和 8 MiB 后的合法 fixture 都成功；缺失 `moov` 仍为 `invalid_media`。

### R8 — MP4 解析资源边界保持

- hard upload/storage 约束沿用当前源码；本任务不修改 duration/resolution 产品政策。
- metadata container 最大 8 MiB、最大深度 6、全局 box 数预算 2048；所有 size/offset 做 finite、安全整数和越界检查。
- malformed size、截断 header、非法 extended size、box-count bomb、size=0 吞掉尾部、encrypted sample 继续 fail closed。
- 不引入 raw tail substring search，不新增 child process/probe。

### R9 — 公共错误与 UI 兼容

- 三个 route 的成功响应字段、SSE event types 和现有通用 UI 状态不变。
- tail-`moov` 修复复用现有上传成功路径；真正 malformed/预算超限仍使用现有安全错误体系。
- 不新增用户可见 copy 或前端状态。

### R10 — 回归测试与文档

- 新增 `test:file-upload` focused suite。
- 扩充 `test:links`：fetch hang、body hang、deadline、caller cancel、timer cleanup。
- 扩充 `test:appearance-video`：head/tail/boundary `moov`、payload false positive、malformed box/budget。
- 更新 `docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md`、`docs/integrations/README.md`、`docs/standards/code-style.md`；不扩写 `AGENTS.md`，因没有顶层导航变化。

## UI 原型门禁

不触发。无前端文件和用户可见信息结构改动；`ui.md` 记录不适用。若实现扩大到新错误展示/确认/页面变化，必须停止并补 UI 设计员 HTML 原型和用户审批。

## 未决问题

无阻塞产品问题。默认建议批准上述边界，尤其确认：

1. 保持 15 秒 GitHub deadline；
2. 不借此任务改变当前 Appearance 大小、duration、resolution 策略；
3. 不增加新 UI/error copy。