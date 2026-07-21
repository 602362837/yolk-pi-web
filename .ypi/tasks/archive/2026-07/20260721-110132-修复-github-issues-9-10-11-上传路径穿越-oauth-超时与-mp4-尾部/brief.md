# Brief：GitHub Issues #9、#10、#11 安全与兼容性修复

## 目标

在不改变现有前端结构和公共响应 shape 的前提下，修复三项已认领、已采纳的后端缺陷：

| Issue | 影响 | 目标结果 |
| --- | --- | --- |
| [#9 文件上传路径穿越](https://github.com/602362837/yolk-pi-web/issues/9) | 构造的 multipart `file.name` 可参与 `path.join`，存在越出随机上传目录并覆盖文件的风险 | 客户端文件名只保留为展示元数据；落盘目录和 basename 由服务端生成，并做最终 containment + exclusive write 校验 |
| [#10 Links OAuth 超时失效](https://github.com/602362837/yolk-pi-web/issues/10) | 外部 `AbortSignal` 覆盖默认 15 秒 timeout；fetch 或 body reader 可永久挂起，占用授权槽位 | 每次 GitHub 请求同时受调用方取消和独立 15 秒 deadline 约束，超时稳定映射 `github_timeout`，主动取消不伪装成超时 |
| [#11 MP4 尾部 `moov` 误拒](https://github.com/602362837/yolk-pi-web/issues/11) | `walkForMetadata()` 仅遍历绝对文件前 8 MiB；常见 tail-`moov` 合法 MP4 被判 `invalid_media` | 按 ISO BMFF 顶层 box size 跳跃遍历到文件尾，在固定 box 数/深度/metadata 大小预算内解析尾部 `moov`，不做未约束字节搜索 |

## 证据与当前实现

### #9

- `app/api/files/upload/route.ts` 直接执行 `path.join(targetDir, originalName)` 后 `writeFileSync`。
- 碰撞逻辑同样继续使用客户端 basename/ext。
- `components/ChatInput.tsx` 已把上传返回的 `name` 与 `path` 分开使用，因此可以保持显示原名，同时把存储路径改成 opaque 服务端名称，不需改 UI。

### #10

- `lib/github-link-oauth.ts:safeFetch()` 当前使用 `init.signal ?? AbortSignal.timeout(...)`，两种信号互斥。
- body 通过 `reader.read()` 循环读取；当前 timeout 不保证覆盖外部 signal 存在时的 body 阶段，reader 异常也统一降级为 network error。
- `lib/links-authorization-manager.ts` 已有每个授权会话自己的 `AbortController`，取消后会检查 `signal.aborted` 并静默退出；适合保留“调用方取消”语义。
- `lib/links-api-helpers.ts` 已把 `github_timeout` 映射为 HTTP 504，无需新增 wire code。

### #11

- `lib/appearance-video.ts` 的 `visitContainer(0, Math.min(bytes.length, 8MiB), 0)` 和 `offset < 8MiB` 共同阻断尾部 `moov`。
- 上传已整体缓冲为 `Buffer`，当前 hard ceiling 为 1 GiB、50 MiB 以上需显式确认；解析器仍应只读 box header 并按声明 size 跳过大 `mdat`，而不是逐字节扫描整个 payload。
- 现有测试 `scripts/test-appearance-video.mjs` 仅覆盖小型真实 MP4、spoof、缺 `moov` 等，尚无大于 8 MiB 的 tail-`moov` 回归。

## 范围内

- 新增通用文件上传安全存储边界与 focused 测试。
- 修正 GitHub Links 上游 deadline/cancellation/body-reader 清理及测试。
- 修正 MP4 顶层 box 遍历与尾部 `moov` 测试。
- 更新 API/library/architecture/integration/test 文档中直接相关的契约和已发现的超时/Appearance 限额描述漂移。
- 运行 lint、TypeScript 与 focused tests。

## 范围外

- 不改上传大小/保留期/响应字段，不新增上传 UI。
- 不改 GitHub Device Flow 页面、SSE 事件种类、错误文案或 OAuth 存储。
- 不引入 `ffprobe` 新依赖，不重编码视频，不改 poster 生成流程。
- 不新增 MP4 codec 支持、duration/resolution 产品限制或远程媒体 URL。
- 不修复与三个 Issue 无关的上传流式化、全局 quota、旧上传文件迁移。

## 已选技术边界

1. 上传路径采用“服务端 opaque UUID basename + 严格可选 ASCII extension”；原名只用于响应中的 `name`。
2. 最终写入执行 `resolve/relative` containment、0700 新目录、0600 文件和 `wx` exclusive create；不依赖 basename 清洗作为唯一防线。
3. GitHub deadline 默认保持代码现有 15 秒；文档中“10 秒”统一更正为 15 秒。
4. 调用方先取消时保留 AbortError/cancel 语义；只有内部 deadline 触发才映射 `github_timeout`。
5. MP4 解析按 top-level box chain 跳过 payload；`moov` metadata 仍受 8 MiB、depth 6、全局 box count 2048 预算约束。禁止对任意 payload 做 `indexOf("moov")` 式搜索。
6. 保持现有 Appearance 源码策略：50 MiB 是确认阈值、1 GiB 是 hard ceiling、duration/resolution 当前不是拒绝条件；本修复不顺带改变产品限制。

## UI Gate

**不适用。** 三项均为后端安全/网络/解析修复：没有页面、组件、CSS、信息结构、按钮、确认或审批体验变化；公共响应 shape 和现有成功/错误状态均保持。合法 tail-`moov` 从错误转为走现有上传成功路径，不产生新 UI 状态。故不派发 UI 设计员、不要求 HTML prototype。

若实现阶段新增错误 code/copy、改变上传附件展示、增加确认流程或调整 Appearance 页面状态，则必须重新打开 UI gate 并在实现前取得 HTML 原型审批。

## 当前验证基线

已尝试：

- `npm run test:links`
- `npm run test:appearance-video`
- `npm run lint`
- `node_modules/.bin/tsc --noEmit`

当前工作树没有安装完整 `node_modules`：分别因缺 `jiti`、`sharp`、`eslint`、`tsc` 而无法运行。这是环境阻塞，不是已发现的代码失败。实施/检查前必须先 `npm install`，再执行全部验证。