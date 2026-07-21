# review：Issues #9、#10、#11

## Verdict

**Pass（附环境阻塞说明）**

三项后端修复覆盖 R1–R10 核心验收标准；未改前端生产文件、public schema、error code 或产品限额政策。检查员发现并修复一处 OAuth 主动取消被 `attemptPollAccessToken` 映射为 `github_network_error` 的低风险问题。`lint` / `tsc` 因当前工作树缺少 `eslint` / `typescript` 二进制未能执行，属环境阻塞，不是已证明的代码失败。

## Scope Review

| Issue | 结论 | 证据 |
| --- | --- | --- |
| #9 上传路径穿越 | Pass | `lib/file-upload-storage.ts` 使用服务端 UUID 目录/basename；`file.name` 只进响应 `name` 与可选 ASCII extension；`resolve + relative` containment；`wx`/0600；cleanup `lstat` 跳过 symlink |
| #10 OAuth deadline | Pass（已修 cancel 包装） | `createRequestDeadline` 始终组合 caller + 15s timer；`raceDeadline` 覆盖 fetch 与 body reader；timeout → `github_timeout`；caller cancel → `AbortError`；manager abort 后静默退出 |
| #11 tail-`moov` | Pass | 顶层 box-chain 走完整 buffer；只解析真正 top-level `moov`；metadata 8 MiB / depth 6 / global 2048；无 raw `moov` 搜索、无 ffprobe |

UI gate 保持不适用：无 `components/**` / `hooks/**` / `app/globals.css` 改动。

## Findings Fixed

1. **`attemptPollAccessToken` 吞掉 caller cancel**  
   - 现象：`pollAccessToken` 正确抛 `AbortError`，但 wrapper 把它收成 `{ error: github_network_error }`；manager 若在 `result.error` 分支先于 `signal.aborted` 处理，可能写失败终态。  
   - 修复：`AbortError` 原样 rethrow；补 focused test。  
   - 文件：`lib/github-link-oauth.ts`、`scripts/test-links.mjs`。

## Remaining Findings

### Blockers

None（代码路径）。

### Environment blockers（主会话处理）

- `npm run lint` → `eslint: command not found`（exit 127）
- `node_modules/.bin/tsc --noEmit` → `tsc` 不存在（exit 127）
- 当前 `node_modules` 有 `jiti`/`sharp`，缺 `eslint`/`typescript` 包本体；未执行 `npm install`，避免改依赖树。

### Non-blockers / residual risks

1. MP4 focused tests 覆盖 head/`>8MiB` tail/`mdat` 伪 `moov`；未单独加 8 MiB 边界两侧、size=0 mdat、extended-size overflow、depth/count bomb 的专用 fixture。实现仍 fail-closed，但覆盖矩阵未完全脚本化。
2. 上传测试直接打 storage helper，未做 route 层 multipart HTTP 集成；route 本身已极薄。
3. Unix 权限断言在 Windows 上跳过（脚本已处理）。
4. 真实 15 秒线上 smoke、真实 tail-`moov` Appearance 上传未在本检查员环境手工执行。

## Compatibility / Security Checklist

- [x] 客户端 `file.name` 不决定存储 basename/目录
- [x] 最终 target 是 upload directory 的 strict child；`wx` 防覆盖
- [x] cleanup 不跟随 symlink；root 外 sentinel 不变
- [x] 上传错误固定 `upload_failed`，无绝对路径/stack
- [x] 上传 `{ name, path, size }`、200 MiB / 1 GiB / 7 天保持
- [x] caller signal 存在时仍有独立 deadline
- [x] body hang 可 timeout；reader cancel
- [x] timeout vs cancel 可区分；cancel 不伪装 timeout/network
- [x] `github_timeout` 仍映射 504；无新 error code/SSE type
- [x] tail-`moov` 可解析；payload 内 `moov` 字符串拒绝
- [x] metadata/depth/count budget 保留
- [x] Appearance 50 MiB 确认 / 1 GiB ceiling / 非拒绝 duration-resolution 与源码一致
- [x] 文档已对齐 upload / Links deadline / tail-`moov` / Appearance 限额漂移
- [x] 无前端生产改动、无 schema/migration

## Verification

| Command | Result |
| --- | --- |
| `npm run test:file-upload` | Pass |
| `npm run test:links` | Pass（84） |
| `npm run test:appearance-video` | Pass（16） |
| `npm run test:appearance` | Pass（18 + 16） |
| `git diff --check` | Pass |
| `npm run lint` | Blocked：缺 `eslint` |
| `node_modules/.bin/tsc --noEmit` | Blocked：缺 `tsc` |

## Files Reviewed / Touched

实现（既有）：

- `app/api/files/upload/route.ts`
- `lib/file-upload-storage.ts`（新）
- `lib/github-link-oauth.ts`
- `lib/appearance-video.ts`
- `scripts/test-file-upload.mjs`（新）
- `scripts/test-links.mjs`
- `scripts/test-appearance-video.mjs`
- `package.json`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/integrations/README.md`
- `docs/standards/code-style.md`
- `docs/operations/troubleshooting.md`

检查员修复：

- `lib/github-link-oauth.ts` — cancel rethrow
- `scripts/test-links.mjs` — cancel wrapper regression

## Main Session Next

1. 在可改依赖树的环境执行 `npm install`，重跑 `npm run lint` 与 `node_modules/.bin/tsc --noEmit`。
2. 可选人工 smoke：普通附件上传、Links 断网/取消、Appearance tail-`moov` 上传。
3. 更新任务状态 / summary；需要时再 commit（本检查员未 commit/push/merge）。
