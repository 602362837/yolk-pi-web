# Checks：Issues #9、#10、#11

## 需求覆盖检查

| Issue | 必须证明 | Blocker |
| --- | --- | --- |
| #9 | 任意客户端 `file.name` 都不能决定写入路径；final target 是本次 opaque directory 的 strict child；不覆盖、不跟随 symlink | 任一 traversal/absolute/Windows 名称可在目标目录外创建或覆盖文件 |
| #10 | caller signal 存在时 fetch 和 body read 仍受 15 秒 deadline；timeout 与主动 cancel 区分；reader/timer/listener 释放 | hang、timeout 被映射 network、cancel 被映射 timeout、授权槽位不释放 |
| #11 | head/tail/boundary `moov` 可解析；不扫描 mdat payload；malformed/count/depth/metadata budget fail closed | tail 合法文件仍 invalid，或 payload 字符串可伪造 moov，或 parser 无界 |

## #9 文件上传安全矩阵

使用临时 uploads root 和 root 外 sentinel：

- [ ] 普通名 `notes.txt` 保存为 opaque UUID 路径，response `name` 仍为 `notes.txt`。
- [ ] `../outside.txt`。
- [ ] `..\\outside.txt`。
- [ ] `/tmp/outside.txt`。
- [ ] `C:\\Windows\\outside.txt`、UNC 路径。
- [ ] `.`、`..`、空名、NUL/control chars。
- [ ] `%2e%2e%2foutside`、Unicode slash/lookalike（不得被解码成路径）。
- [ ] 极长 extension、双扩展、非 ASCII extension：只保留严格 allowlist 或省略。
- [ ] 两个同名上传得到不同路径，不覆盖。
- [ ] 模拟 UUID/EEXIST 碰撞走受限重试，最终 `wx`。
- [ ] target directory/file 权限在 Unix 上 best-effort 0700/0600。
- [ ] cleanup 遇到 symlink directory/file 不跟随、不删除 root 外 sentinel。
- [ ] error JSON 不含临时绝对路径、原始 syscall message 或 stack。
- [ ] size/quota/retention 和 `{ name, path, size }` shape 保持。

建议自动脚本：`npm run test:file-upload`。

## #10 OAuth deadline 矩阵

在 `scripts/test-links.mjs` 使用小型 test-only timeout override：

1. 无 caller signal + fetch 永不 resolve → `github_timeout`。
2. caller signal 永不 abort + fetch 永不 resolve → 仍 `github_timeout`。
3. fetch 返回、body stream 永不 done → 仍 `github_timeout`。
4. caller 在 deadline 前 abort → AbortError/cancel，不是 `github_timeout`/`github_network_error`。
5. deadline 先到、caller 后 abort → 只报告 timeout，settle 一次。
6. 正常 fetch/body 在 deadline 前结束 → 成功，timer 不晚到污染后续测试。
7. body >64 KiB → existing `github_bad_response`，reader cancel。
8. redirect、malformed JSON、network error → 原有 stable code。
9. Device code、token poll、identity 三条 public function 均走同一 helper。
10. authorization manager cancel 后不进入 failed；timeout 后 active count 释放并进入现有 terminal error。
11. access token/device code/URL/raw body/abort reason sentinel 不进入 error/wire/log。

建议自动脚本：`npm run test:links`。

## #11 MP4 parser 矩阵

- [ ] 小型 head-`moov` 真实 MP4成功。
- [ ] tail-`moov` 起点约 9 MiB 成功。
- [ ] `moov` 起点在 8 MiB 边界前后成功。
- [ ] 大 `mdat` 后 tail-`moov` 通过 header jump，不逐字节扫描 mdat。
- [ ] mdat payload 内字面 `moov`、无顶层 moov → `invalid_media`。
- [ ] top-level 32-bit/extended size 合法样本正确；unsafe/overflow/truncated size拒绝。
- [ ] size=0 mdat 吞到 EOF，后续伪造 moov不被接受。
- [ ] `moov` metadata >8 MiB、depth >6、box count >2048 fail closed且在有界时间完成。
- [ ] encrypted `encv`/`enca` 继续 `unsupported_media`。
- [ ] metadata仍只有有限数字字段，不泄露路径/probe text。
- [ ] `normalizeAppearanceVideo` 与 poster/store 现有 tests继续通过。

建议自动脚本：`npm run test:appearance-video` 和 `npm run test:appearance`。

## API 与兼容性检查

- [ ] `ChatInput.tsx`、`LinksConfig.tsx`、`AppearanceConfig.tsx` 无生产改动。
- [ ] `/api/files/upload` success shape 不变。
- [ ] Links error code/SSE type 集合不变，`github_timeout` 仍映射 504。
- [ ] Appearance upload error code集合/catalog schema不变。
- [ ] 无 config、JSONL、credential、catalog migration。
- [ ] `docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md`、`docs/integrations/README.md` 与实现一致。
- [ ] Appearance docs不再把当前源码的 confirmation threshold 误写成 hard cap，也不虚构 duration/resolution拒绝。

## 自动验证

依赖安装后执行：

```bash
npm install
npm run test:file-upload
npm run test:links
npm run test:appearance-video
npm run test:appearance
npm run lint
node_modules/.bin/tsc --noEmit
```

可选回归：

```bash
npm run test:web-credential-store
npm run test:studio-task-preview
```

禁止日常直接运行 `next build`；release validation 才使用 `npm run build`。

## 人工验收

本任务无 UI 原型验收。仅做现有流程 smoke：

1. Chat 上传一个普通文本/压缩文件，附件名正确，发送后的实际 path 可读。
2. Settings → Links 启动后断网/上游挂起，约 15 秒进入现有安全失败状态；取消不闪现 timeout。
3. Settings → 外观上传 >8 MiB 且 tail-`moov` 的合法 MP4，使用现有成功流程激活并能播放/显示 poster。
4. 真实非法 MP4 仍显示现有通用处理失败状态。

## 当前环境阻塞记录

规划阶段尝试运行验证，但工作树缺少完整依赖：

- `test:links`：缺 `jiti`；
- `test:appearance-video`：缺 `sharp`；
- lint：缺 `eslint`；
- tsc：`node_modules/.bin/tsc` 不存在。

实施员必须先 `npm install`，不得把这些环境错误报告成代码回归或伪造通过。

## Checker Blockers

- traversal、absolute path、symlink cleanup 或 overwrite 任一逃逸；
- caller signal 仍关闭 deadline，或 body read 可永久挂起；
- 主动 cancel 被显示为 timeout；
- raw `moov` 搜索接受 mdat 内伪造字符串；
- 为修 tail-`moov` 移除 box count/depth/metadata budget；
- 顺带改变上传/OAuth/Appearance UI、schema、limit政策却未重新审批；
- focused tests 或 lint/tsc 未运行且无明确环境阻塞。