# Plan Review：GitHub 自动化凭据产品化

## 审批状态

**规划内容已完成，UI 原型门禁也已由 UI 设计员交付。现可将任务转入 `awaiting_approval` 并请求用户审批。**

## 规划摘要

### PRD

- 默认产品路径从 env-only 改为 **Settings → GitHub 自动化 → 本机凭据**。
- 用户填写 App ID、Webhook secret，并粘贴或选择 GitHub App RSA PEM；服务端安全落盘，一次配置后重启仍可用。
- env 保留为高级覆盖，按字段执行 `env > local > missing`，不写回本机。
- 所有浏览器响应只返回 `configured/readiness/has*/source/local summary`，永不回显 App ID 原值、secret、PEM、路径或指纹。
- 不改变 App 创建/安装、allowlist、Assignee、Triage、无人值守与发布策略。

详见 [brief.md](brief.md) 与 [prd.md](prd.md)。

### UI

- 新主卡“本机 GitHub App 凭据”位于 checklist/status/jobs 之前。
- 三项配置状态 + 来源；App ID、password secret、PEM paste/file；保存到本机、轮换、危险删除。
- env 指南降级为折叠“高级：环境变量覆盖”。
- 已保存 secret/key 不 reveal、不 masked、不下载；临时输入在成功、删除、切 view、unmount、输入方式切换时清理。

材料：

- [ui.md](ui.md)
- [github-app-local-credentials.html](github-app-local-credentials.html) — **最终 HTML 原型（UI 设计员已交付）**

### Design

- 新增 GitHub automation 专属 secret store，不复用/污染 Links、LLM auth 或非 secret config。
- 磁盘采用 `credentials.v1.json` 原子指针 + `private-key.<generation>.pem`；先写 generation key，再原子切 metadata，避免固定双文件轮换中间态。
- 0700/0600、同目录 tmp+fsync+rename、进程队列 + owner mkdir lock、普通文件/RSA/尺寸/containment/fingerprint 校验、未知 schema fail closed。
- 独立 `GET/PUT/DELETE /api/github-automation/credentials`；PUT 是严格 bounded multipart，DELETE 只清 local fallback。
- 保存/删除后清 installation token cache；Webhook 后续请求重读 effective secret。
- status/setup/verify 继续只读/no-store/无 scheduler side effect。

详见 [design.md](design.md)。

### Implement

8 个 DAG 子任务，`maxConcurrency=2`：

1. `GHCRED-01` secure generation store/types
2. `GHCRED-02` env-over-local runtime resolver + cache invalidation
3. `GHCRED-03` credentials API
4. `GHCRED-04` status/setup/verify integration（与 03 可并行）
5. `GHCRED-05` approved frontend UI
6. `GHCRED-06` focused persistence/security tests
7. `GHCRED-07` docs（与 06 可并行）
8. `GHCRED-08` integrated checker validation

材料：

- [implement.md](implement.md)
- [implementation-plan.json](implementation-plan.json)

### Checks

关键强验收：

- 设置页配置一次 → 完全停止/重启 ypi → shell 无 `YPI_GITHUB_APP_*` → status 仍 configured。
- 本机 Webhook secret 的合法 HMAC 通过，错误签名 401。
- env-only 与逐字段 env override 均保持；空 env 回落 local。
- 轮换 App/key 后不复用旧 installation token cache。
- API/status/verify/DOM/toast/log/config/jobs/task/session 无 secret/PEM/path/fingerprint/JWT/token sentinel。
- 存储权限、并发锁、generation 原子切换、future/malformed/symlink/oversize/non-RSA fail closed。
- 生产 UI 对照用户批准的最终 HTML 验收 desktop/≤640px/dark/light/keyboard/reduced motion。

详见 [checks.md](checks.md)。

## 关键决策请求

已确认的产品方向没有需要重新询问的范围歧义。请主会话/用户重点确认以下实现细化：

1. **接受 generation key 文件**：使用 `private-key.<generation>.pem` + metadata 指针，而非永久固定 `private-key.pem`；这是为获得轮换时原子可见性，仍满足同目录 0600 私钥文件目标。
2. **接受逐字段 env overlay**：可只用 env 覆盖 App ID/key/webhook 中某一项；UI 显示每项来源并提醒必须属于同一 App。
3. **接受 blank-preserve 轮换**：首次本机配置必须三项完整，之后空白字段保留 local；env 值永不被导入本机。
4. **接受无 reveal**：用户可写/轮换/删除，但已保存 App ID 原值、Webhook secret、PEM、文件名/路径、fingerprint 均不回显。

## 主会话必须执行的下一步

1. 将 [implementation-plan.json](implementation-plan.json) 保存到 Studio task state，并把任务转为 `awaiting_approval`；不要进入 implementing。
2. 将最终 HTML [github-app-local-credentials.html](github-app-local-credentials.html)、本 `plan-review.md` 和上面 4 项关键决策提交用户批准，停下来等待。
3. 用户明确批准后才能进入 `implementing`；批准前不得 claim `GHCRED-*`、不得派 implementer、不得修改生产代码。

## 当前剩余风险

- 管理 UI/API 若被无认证暴露公网，写 secret 的能力会放大现有管理面风险；文档必须要求只公网代理 webhook route，管理面走本机/受控访问。
- 没有用户批准的测试 GitHub App 与公网 HTTPS 时，只能完成 mock/offline 验证；真实 GitHub UAT 必须列为未完成。
- 两个新 untracked Studio task 目录属于用户/其他任务工作；实施与清理不得覆盖。
