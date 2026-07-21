# Design：三项后端安全与兼容性修复

## 方案摘要

三个 Issue 共享一个原则：**把不可信输入和无界等待收敛在 server-only 边界，保持现有 API/UI 契约。**

- 上传：原始名字与存储身份解耦，服务端 opaque path + containment + exclusive write。
- OAuth：caller cancellation 与内部 deadline 组合，deadline 同时覆盖 fetch 和 body stream。
- MP4：按 ISO BMFF 顶层 box size 跳过 payload，在固定 metadata budget 下解析任意位置的 `moov`。

三条实现链互不共享运行时模块，可并行开发，最后统一文档和验证。

## 影响模块与边界

| 领域 | 主要文件 | 不应改动 |
| --- | --- | --- |
| 文件上传 | `app/api/files/upload/route.ts`、新增 `lib/file-upload-storage.ts`、新增 `scripts/test-file-upload.mjs`、`package.json` | `components/ChatInput.tsx`、文件 viewer API |
| GitHub Links | `lib/github-link-oauth.ts`、`scripts/test-links.mjs` | Links store、authorization wire schema、`components/LinksConfig.tsx` |
| Appearance MP4 | `lib/appearance-video.ts`、`scripts/test-appearance-video.mjs`（必要时补 `scripts/test-appearance.mjs`） | Appearance store/schema/UI、ffmpeg poster、asset route |
| 文档 | architecture/API/library/integrations/standards | `AGENTS.md` 顶层导航（无变化） |

## #9：上传安全存储设计

### AS-IS

```text
multipart file.name
  → targetDir = uploads/<8-char-id>
  → path.join(targetDir, originalName)
  → collision suffix based on originalName
  → writeFileSync(targetPath)
```

路径分隔符、绝对路径和 `..` 直接进入目标计算；没有最终 containment。

### TO-BE

```text
multipart file
  ├─ displayName = file.name                 # 仅 response metadata
  ├─ uploadDirId = full random UUID          # server-generated
  ├─ storageId = full random UUID            # server-generated
  ├─ ext = normalized ASCII [a-z0-9]{1,16}?  # 可选；非法即省略
  ├─ target = resolve(uploadDir, storageId + ext)
  ├─ assert relative(uploadDir, target) is strict child
  └─ open/write with mode 0600 + flag wx
```

### `lib/file-upload-storage.ts` 建议契约

```ts
interface PersistFileUploadInput {
  uploadsRoot: string;
  originalName: string;
  bytes: Buffer;
}

interface PersistedFileUpload {
  path: string;
  uploadDirectory: string;
}

export function safeUploadExtension(originalName: string): string;
export function isStrictPathChild(parent: string, candidate: string): boolean;
export function persistFileUpload(input: PersistFileUploadInput): PersistedFileUpload;
```

约束：

- `uploadsRoot` 的生产值保持现有 uploads 目录；测试传临时目录。
- root 先以 0700 创建；新 upload directory 使用非递归 mkdir，`EEXIST` 受限重试。
- storage basename 不含原始 basename；extension 先把 `/`、`\\`、NUL 和非 ASCII 全部视为不可信，仅在末尾 token 完全匹配 allowlist 时保留并 lower-case。
- final `resolve + relative` 是强制门禁，即使未来 storage-name 规则回归也不能越界。
- `openSync(..., "wx", 0o600)`/等价异步调用禁止覆盖。
- cleanup 使用 `lstat`，跳过 symlink directory/file；不跟随 symlink 删除 root 外内容。
- route catch 返回固定 `{ error: "File upload failed", code: "upload_failed" }` 或保持兼容的固定 error 字段，不序列化原始异常。客户端只读取 `error`，无需 UI 改动。

### 兼容性与迁移

- response shape 不变；`name` 仍是显示名，`path` 的 basename 变为 opaque。
- 历史上传不迁移。lazy cleanup 同时兼容旧 8-char 目录和新 UUID 目录。
- 不改变 size/quota/retention。

## #10：GitHub OAuth 组合 deadline 设计

### AS-IS

```ts
signal: init.signal ?? AbortSignal.timeout(15_000)
```

caller signal 存在时 timeout 完全消失；body reader 没有显式 deadline race；所有 AbortError 大多被当作 timeout/network。

### TO-BE

新增 server-only helper（可留在 `github-link-oauth.ts`）：

```ts
interface RequestDeadline {
  signal: AbortSignal;
  didTimeout(): boolean;
  didCallerAbort(): boolean;
  dispose(): void;
}

function createRequestDeadline(caller: AbortSignal | undefined, timeoutMs: number): RequestDeadline;
```

实现策略：

1. 每次调用创建内部 `AbortController` 和 timer。
2. caller 已 aborted 时立即转发；否则注册 once listener。
3. timer 先触发时记录 `timedOut=true` 并 abort 内部 signal。
4. 将组合 signal 传入 `fetch`。
5. body 每次 `reader.read()` 与组合 signal race；abort 时 best-effort `reader.cancel()`，finally `releaseLock()`。
6. 整个 fetch + redirect check + read + parse 完成后才 `dispose()` timer/listener。
7. catch 分类顺序：
   - `didTimeout()` → `github_timeout`；
   - `didCallerAbort()` → 抛出/保留安全 `AbortError`，不改写为 timeout/network；
   - 已有 stable domain error → 原样；
   - 其他 → `github_network_error`。

不单独依赖 `AbortSignal.any`；即使运行时没有该 API也保持 deadline。不得把 `signal.reason` 原文放进错误。

### Body reader

`readBoundedBody(response, maxSize, deadline)`：

- 累计长度 >64 KiB 时 cancel 并抛现有 `github_bad_response`；
- timeout/cancel race 即使 mock/custom stream 不观察 fetch signal 也能退出；
- 用数组收集 chunk，保持现有 cap；可以在最终一次 `Buffer.concat`/Uint8Array concat，避免每个 chunk O(n²) reduce，但这不是 wire 变化。

### 测试时间

生产固定 15 秒。测试沿用现有 `_testOverride...` 风格增加 test-only timeout override，默认/reset 后必须回到 15 秒；测试使用 20–50ms deadline，避免真实等待 15 秒。

### 状态机兼容

- timeout 仍为 `github_timeout`，REST 已映射 504，polling 进入现有 failed/error projection。
- DELETE cancel 触发 caller signal；manager 在 await 后检查 `signal.aborted` 并退出，不制造 timeout failed 状态。
- 不新增 error code、SSE type 或 UI copy。

## #11：MP4 tail-`moov` 设计

### AS-IS

解析范围的 `end` 被截断到前 8 MiB，且 iterator 以绝对 `offset < 8MiB` 停止。大 `mdat/free` 后的合法顶层 `moov` 永远不可达。

### 选择方案：顶层 box-chain 跳跃，不做 raw tail search

ISO BMFF 顶层 box 自带 size；解析器只需读每个 header，然后 `offset += size` 跳过 payload。即使 `mdat` 为数百 MiB，CPU工作仍与 top-level box 数量相关，而不是媒体字节数相关。

```text
0
├─ ftyp (validate signature)
├─ free?  ───────────────┐
├─ mdat  (skip by size)  │ no payload scan
└─ moov  ◀───────────────┘ parse bounded metadata subtree
```

### Parser 约束

- 顶层边界使用完整 `bytes.length`，但只读取 box headers。
- 支持 32-bit size、extended 64-bit size；所有值必须 finite、safe integer、`size >= headerSize`、`offset + size <= end` 且无 overflow。
- size=0 只允许 box 延伸到当前 container end；若 `mdat size=0`，其后的字节属于 mdat，不能再识别伪造 moov。
- 全局（不是每层重置）box budget 2048，depth budget 6。
- 只在顶层确认合法 `moov` 后递归；`moov.size`/累计 metadata walk 不超过 8 MiB。
- `stsd` encrypted marker 检查保持；metadata budget 防止对超大伪造 payload 做无界 includes。
- 不使用 `bytes.indexOf("moov")`、尾部固定字符串定位或 ffprobe。

### 为什么不采用固定 tail window

固定读取最后 N MiB 仍可能漏掉较大的 `moov`，raw 搜索还可能误中 `mdat` payload。完整顶层 header chain + metadata budget 同时提供规范正确性和资源上限。

### 测试 fixture

在 ffmpeg 生成的短小真实 MP4 中定位顶层 `moov`，在其前插入合法 `free` box：

- padding 让 `moov.start < 8MiB`；
- `moov.start` 紧邻 8MiB 边界两侧；
- `moov.start > 8MiB`（建议 9MiB）。

因为 `free` 插在媒体数据之后、`moov` 之前，不改变 mdat chunk offsets。另造 payload 内含字面 `moov` 但无顶层 moov 的 fixture，必须拒绝。

### 限额与文档漂移

当前源码实际为：视频 50 MiB 以上确认、1 GiB hard ceiling/总预算、duration/resolution 不作为政策限制；部分 docs 仍写 50 MiB hard cap、30秒、1920。实现只修 parser，并把直接相关 docs 对齐当前源码，不能借文档漂移恢复旧限制。

## API/文件契约

- `/api/files/upload`：shape 不变；只改变实际路径 basename 和固定安全错误。
- Links：无 route/schema 变化；`github_timeout` 继续存在。
- `/api/appearance/skins`：shape/code 集合不变；更多合法 MP4 成功。
- 不新增持久化 schema、session JSONL、config field 或 migration。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| opaque upload path 无扩展影响工具识别 | 仅保留严格短 ASCII extension；显示名独立保留 |
| random collision/race 覆盖 | full UUID + non-recursive mkdir + `wx` + bounded retry |
| timeout 后 reader/task 泄漏 | read race、cancel、releaseLock、dispose listener/timer |
| caller cancel 被误报失败 | 显式 `didTimeout`/`didCallerAbort`，manager abort check |
| MP4 raw search误中 mdat | 只按顶层 box chain 定位 |
| 恶意 box 导致 CPU/offset overflow | safe integer、global count/depth、metadata 8MiB budget |
| docs限额与源码冲突 | 实现时以当前源码行为为准并同步 docs，不更改产品政策 |

## 回滚

- 上传：回滚 helper/route/tests 即可，无数据迁移；已生成 opaque 文件仍由 cleanup 正常处理。
- OAuth：回滚组合 deadline helper；无持久化变化。
- MP4：回滚 parser；已上传视频和 catalog 不受影响。
- 可分别回滚三条链；不删除 uploads、Links credential 或 Appearance assets。