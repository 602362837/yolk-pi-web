# Design

## 方案摘要

新增 `lib/memory-diagnostics.ts` 作为唯一快照编排与持久化入口。各 runtime 所有者模块导出只读、有界的 projection helper；collector 依次调用这些 helper，组合进程指标、启发式 findings、错误和截断信息，然后原子写入 `<getAgentDir()>/diagnostics/`。`POST /api/diagnostics/memory-snapshot` 只负责互斥、调用和 HTTP 映射。

前端在 `SettingsConfig` 增加 `diagnostics` section：按钮触发同一 POST，仅展示元数据与状态，不回读完整 JSON 文件。

不使用 heap snapshot：它可能暂停进程并产生接近 heap 大小的文件/额外内存，违背“低扰动、有界”目标。

## 模块与边界

| 模块 | 责任 | 禁止行为 |
| --- | --- | --- |
| `lib/memory-diagnostics.ts` | schema/type、预算、section 编排、进程/V8 指标、findings、JSON 大小降级、原子落盘 | 不反射其他模块私有字段；不读取 env/正文；不改变 runtime |
| `lib/rpc-manager.ts` | AgentSession wrapper/registry 有界投影 | 不 destroy/abort/reset；不返回 message 内容 |
| `lib/ypi-studio-subagent-runtime.ts` | child/continuation 聚合与有界安全样本 | 不 deliver/delete continuation；不返回 result/promise/text |
| `lib/session-reader.ts` | path cache count/sample | 不触发 `SessionManager.listAll()` |
| `lib/browser-share-manager.ts` | 纯计数/状态聚合 | 不运行 `cleanupExpired()`；不返回 snapshot/payload |
| `lib/terminal-manager.ts` | session/subscriber/buffer size 摘要 | 不订阅、关闭或返回 buffer 内容 |
| `lib/session-file-changes.ts` | active session sidecar 顶层计数 | 不返回 diff/baseline/latest text |
| API route | POST、进程内互斥、错误映射、`Cache-Control: no-store` | 不接受路径/limit 等任意用户参数 |
| `components/SettingsConfig.tsx` | diagnostics section、按钮、状态反馈、元数据展示、隐私提示 | 不渲染完整 JSON；不新增文件浏览器 |

## 快照契约

顶层建议结构：

```ts
interface MemoryDiagnosticSnapshotV1 {
  kind: "yolk-pi-memory-diagnostic";
  schemaVersion: 1;
  snapshotId: string;
  capturedAt: string;
  completedAt: string;
  durationMs: number;
  partial: boolean;
  privacy: {
    includesLocalPaths: true;
    excludes: string[];
    sharingWarning: string;
  };
  limits: MemoryDiagnosticLimits;
  process: ProcessDiagnostic;
  runtime: {
    agentSessions?: RpcRuntimeDiagnostic;
    studio?: StudioRuntimeDiagnostic;
    sessionPathCache?: CacheDiagnostic;
    browserShare?: BrowserShareDiagnostic;
    terminals?: TerminalDiagnostic;
    sessionFileChanges?: SessionFileChangesDiagnostic;
  };
  findings: MemoryDiagnosticFinding[];
  errors: DiagnosticSectionError[];
  truncation: DiagnosticTruncation[];
}
```

API 成功响应（元数据 only）建议：

```ts
interface MemorySnapshotApiSuccess {
  ok: true;
  kind: "yolk-pi-memory-diagnostic";
  schemaVersion: 1;
  snapshotId: string;
  capturedAt: string;
  filePath: string;
  fileName: string;
  bytes: number;
  durationMs: number;
  partial: boolean;
  sectionSummary?: { name: string; ok: boolean; truncated?: boolean }[];
  errorCount?: number;
  truncationCount?: number;
}
```

错误：`{ ok: false, code: string, message: string }`；409 使用 `snapshot_in_progress`。

## 前端交互设计

### 放置

- **推荐**：Settings 左侧 section 列表新增 `diagnostics`（诊断）。
- **备选 A**：`yolk` section 底部动作区。
- **备选 B**：`UsageStatsModal` 底部次要动作。

原型见 [ui-prototype.html](ui-prototype.html)。

### 状态机

```
idle --click--> loading
loading --201--> success
loading --409--> busy
loading --other error/network--> error
success|busy|error --click--> loading
```

loading 时按钮 disabled，文案「正在采集…」。success 展示路径/大小/耗时/partial，提供复制路径。busy 提示已有快照进行中。error 展示服务端 message 或网络失败文案。

### 隐私

固定 callout：诊断文件可能包含本机 workspace/session 路径与 id；不会自动上传；分享前人工审阅。

### 数据流

```
Settings Diagnostics button
  -> fetch POST /api/diagnostics/memory-snapshot
  -> API mutex + memory-diagnostics collector
  -> owner projections (read-only)
  -> atomic write diagnostics JSON
  -> 201 metadata JSON
  -> Settings success panel (no full file read)
```

## AgentSession / Studio / 次级运行时

（保持原只读有界设计）

1. rpc-manager 读取现有 `globalThis.__piSessions` / `__piStartLocks`，index-based 有界遍历，不复制 content。
2. OpenAI Codex 仅对已知 active session 调用公开 getter，只保留数值/布尔。
3. Studio 聚合 child/continuation 容器，省略 result/promise/callback/text。
4. Browser Share 不调用 cleanupExpired；Terminal 累计 buffer bytes 不拼接文本；file-change 只 stat/parse 顶层计数。

## 超时与内存上限

- deadline 默认 5s，cooperative 检查。
- 最终 JSON 5 MiB；超限 compact fallback 去掉 samples；仍超限失败并清理 tmp。
- 进程内互斥：`globalThis.__piMemoryDiagnosticSnapshotPromise` 或等价锁；并发 409。

## 文件与 API

- 目录：`path.join(getAgentDir(), "diagnostics")`。
- 文件：`memory-YYYYMMDDTHHMMSSmmmZ-pid<PID>-<8hex>.json`。
- 写入：tmp + rename；权限 best-effort `0700`/`0600`。
- API 不接受自定义输出路径；不接受 include-content 开关。

## 启发式规则

- `rss >= 1 GiB` warning，`>= 2 GiB` critical；
- `heapUsed >= 768 MiB` warning；
- alive sessions `>= 10`；
- 单 session estimated content `>= 50 MiB`；
- listeners `>= 10`；
- active child age `>= 30 min`；
- pending continuations `>= 20` 或 attempts `>= 10`；
- path cache `>= max(500, aliveSessions * 20)`。

措辞使用 “may warrant inspection”，不确认泄漏。

## 兼容性与迁移

- 新增 schema v1 文件、additive API、Settings section。
- 不改 session JSONL、Studio task、sidecar 或 pi-web config schema。
- Settings section 为前端本地状态，无新持久化配置字段。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 诊断遍历大 session 造成内存峰值 | 有界遍历、不深拷贝、单次 stringify、5s deadline |
| 泄露正文/密钥 | allowlist projection、marker 测试、API/UI 不返回快照正文 |
| 诊断改变状态 | 纯读取；禁止 cleanup/abort/destroy/reset/GC |
| 用户重复点击放大成本 | loading disable + 服务端互斥 409 |
| 路径分享暴露本机结构 | privacy warning；审批确认保留路径 |
| Settings 导航噪声 | 独立 diagnostics section，远离聊天主路径 |

## 回滚

删除 API route、collector、owner projection exports、Settings diagnostics section 与相关文档/测试。已有诊断 JSON 独立于业务数据，用户可自行删除。
