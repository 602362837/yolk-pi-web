# 自建 GitHub App：新议题分析（客户 / 运维指南）

本指南面向**自托管**蛋黄派（`ypi`）部署方：自行创建 GitHub App，在本机保存凭据，只对人类新建 Issue 做分类与只读仓库证据分析，并发布一条可幂等更新的规范评论；仅在严格门禁下才自动关闭已证伪的 bug。

产品**不提供**托管 App、云中继或共享 installation。

## 整体流程（先看这张图）

```text
1. 在 GitHub 创建 App（Metadata + Issues；只订阅 Issues）
2. 安装到目标仓库
3. 设置 → GitHub 自动化 → 保存本机凭据
4. 关联允许仓库 + Project Registry 本地项目（只读证据）
5. 验证配置（零副作用）
6. 公网 HTTPS 只暴露 webhook
7. 启用分析（默认关闭；升级后也强制关闭）
8. 用测试 Issue 验收评论 / 可选关闭
```

## 1. 你需要准备什么

| 准备项 | 用途 |
| --- | --- |
| 可公网访问的 HTTPS 入口 | 只转发到 `POST /api/github-automation/webhook` |
| 本机或受控网络上的 `ypi` 进程 | 跑分析调度与 Settings 管理面 |
| 目标仓库的安装权限 | 安装你自己的 GitHub App |
| 已在蛋黄派 Project Registry 登记的本地项目 | 作为只读证据根；**不是**实现目录 |

不需要：

- 本机 `gh` 登录作为 Assignee
- Contents / Pull requests 写权限
- Links OAuth / 个人 PAT 作为 App mutation 身份
- Issue 评论指令或 Owner「采纳」协议

### 公网暴露边界（必读）

| 可公网 | 必须本机 / VPN / 受控访问 |
| --- | --- |
| 仅 `POST /api/github-automation/webhook` | Settings UI、`/credentials`、`/config`、`/status`、`/verify`、`/jobs` |

把管理面暴露到未认证公网会放大凭据写入风险。产品不提供云中继；本地开发端口（如 30141）需自行反代或隧道成 HTTPS。

## 2. 在 GitHub 创建 App

### 2.1 打开创建页

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
（组织仓库则在组织 Settings 下创建。）

### 2.2 基本信息怎么填

- **GitHub App name**：部署方可识别名称（全局唯一）
- **Homepage URL**：你的 `ypi` 文档或主页
- **Webhook**：勾选 Active；URL 填 `https://你的域名/api/github-automation/webhook`
- **Webhook secret**：生成高强度随机串并妥善保存（稍后写入本机凭据）
- **Callback / setup URL**：本产品路径不依赖用户 OAuth 回调；可按 GitHub 表单要求填占位

### 2.3 权限怎么选

**最小权限（推荐也是唯一产品要求）：**

| Permission | Access |
| --- | --- |
| Repository permissions → Metadata | Read-only |
| Repository permissions → Issues | Read & write |

**不要**为当前产品申请 Contents、Pull requests、Actions、Secrets、Administration。旧文档若仍写 P1 发布权限，已过时。

### 2.4 事件怎么勾

- 勾选 **Issues**
- 安装生命周期事件可选（用于后续绑定观察）
- **不要**依赖 Issue comment / Pull request 事件做业务；即使误订阅，服务端也会 audit-only（0 job / 0 wake）

### 2.5 创建后立刻保存这三样

1. **App ID**
2. **Webhook secret**
3. **Private key**（生成并下载 PEM；只在创建时完整可见）

可选：App slug（高级 env 用）。

## 3. 把 App 安装到仓库

Install App → 选择账号/组织 → 仅选择需要分析的仓库（或按策略选全部）→ 确认 Issues 权限生效。

记下每个仓库的：

- `owner/repo` full name
- 不可变 **repository id**（API / 仓库设置可查）
- **installation id**

## 4. 在设置页配置本机 GitHub App 凭据（默认路径）

打开蛋黄派 → **设置 → GitHub 自动化 → 本机 GitHub App 凭据**。

### 4.1 填写并「保存到本机」

1. App ID
2. Webhook secret
3. 私钥 PEM（粘贴或选择文件；二者互斥）
4. 点击保存

首次保存必须三项齐全。之后轮换时，留空字段表示保留本机已有值（不会从 env 回填磁盘）。

### 4.2 页面不会回显什么

保存成功后，页面**永不回显** App ID 明文以外的 secret / PEM / 路径 / 指纹 / JWT / installation token。只能看到 configured / readiness / 字段来源（`env` | `local` | `missing`）等安全投影。

### 4.3 本机存储位置与权限（了解即可）

```text
~/.pi/agent/github-automation/     # 或 PI_CODING_AGENT_DIR 覆盖；目录 0700
  credentials.v1.json              # 0600
  private-key.<generation>.pem     # 0600
  config.json                      # 非密钥 CAS 配置
  deliveries/ jobs/ events/ ...
```

备份该目录等于备份 App 身份材料，按主机密钥处理。不要提交到 git。

### 4.4 移除本机凭据

设置页提供显式确认删除；只删本机 fallback，不修改进程 env。若某字段由非空 env 覆盖，删除本机后仍可能显示 env 来源已配置。

## 5. 打通公网 Webhook

1. 反代/隧道终止 TLS
2. 只把 `POST /api/github-automation/webhook` 转到 `ypi`
3. 保留 `X-Hub-Signature-256`、`X-GitHub-Delivery`、`X-GitHub-Event` 等头
4. 不要把 `/credentials` 等管理 API 挂到同一未认证公网入口

签名校验失败 → 401；超大 body → 413；验签通过但非业务事件 → 202 ignored（健康）。

## 6. 在蛋黄派里完成其余配置

### 6.1 Setup checklist +「验证配置」

验证项包括：

1. App ID / 私钥 / Webhook secret 是否就绪
2. Installation 是否可见
3. 是否具备 **Metadata + Issues** 能力
4. 允许仓库是否非空且 id/installation 匹配
5. 绑定的本地项目是否可读
6. 分析模型 readiness（跟随 pi 主默认模型；不展示 secret）
7. Webhook health（若可观测）

`POST /api/github-automation/verify` **永不**入队 job、不 wake scheduler、不写 GitHub、不改凭据。

### 6.2 关联允许仓库

每行需要：

| 字段 | 说明 |
| --- | --- |
| `owner/repo` | 展示名 |
| `repositoryId` | 不可变 id（allowlist 主键） |
| `installationId` | 必须与 webhook 一致 |
| `projectId` | Project Registry 项目；服务端解析 canonical root |

本地项目**仅作只读证据**，不会被自动化改代码或提 PR。
**已删除**的闭环字段：base ref、owner actor ids、Assignee 身份源等。

### 6.3 运行控制

- **启用**：单一开关（无 triage/unattended 分段）
- **全局暂停**：止血；不改变 enabled；Issue 文本不能清除
- **分析并发**：`analysis.maxConcurrency`（默认 2，范围 1–8）

首次启用前请阅读自动关闭条件：仅 `bug + not_exists + high + 完整反证 + 评论已确认 + Issue 内容未变 + fence 有效 + 仍启用未暂停`。
「未搜索到」永远不等于「问题不存在」。Feature/Docs/Question 为 `not_applicable`，保持打开。

v1 配置升级后会**强制** `enabled=false`，需运维重验后再开。

### 6.4 最近分析与重试

列表展示：Issue、分类、真实性、置信度、评论/关闭效果、安全 reason、时间。
**重试**只补未确认 checkpoint，不重复已确认的分析/评论/关闭。
不展示 Session / Agent / WorkTree / PR 双层 Jobs。

## 7. 怎么验收已经配好

在**专用测试仓库 / 测试 App**上执行（不要用生产议题）：

1. 人类新建 confirmed 向 bug → 一条 v3 分析评论，Issue **保持 open**
2. 新建 feature/docs/question → `not_applicable`，保持 open
3. 证据不足 bug → `inconclusive`，保持 open
4. 仅在已批准自动关闭口径后：高置信反证 fixture → 评论确认后 close（`not_planned`）
5. 编辑 / 评论 / reopen / label / Bot 自评论 → **不**新增 job；观察 ≥2 分钟无循环
6. 暂停时新 Issue 仅 audit；恢复后只处理之后的新 Issue
7. 若从旧版本升级：旧非终态 job 只读 retired，不创建 WorkTree/Session/PR

真实 GitHub UAT 是 release blocker；`npm run test:github-automation` 的 mock 绿不能替代。

## 8. 高级：环境变量覆盖（CI / 容器）

非空 env **按字段**覆盖本机凭据；空 env 不覆盖。Env **不会**写回磁盘。

| 变量 | 含义 |
| --- | --- |
| `YPI_GITHUB_APP_ID` | App ID |
| `YPI_GITHUB_APP_PRIVATE_KEY_FILE` | 运维管理的 PEM 路径（建议 0600） |
| `YPI_GITHUB_APP_WEBHOOK_SECRET` | Webhook secret |
| `YPI_GITHUB_APP_SLUG` | 可选 slug |

日常桌面部署优先本机凭据；容器/CI 可用 env。

## 9. 常见问题

| 现象 | 处理 |
| --- | --- |
| 重启后凭据丢失 | 确认本机保存成功，或容器是否只靠未持久化 env |
| Webhook 401 | secret 与 GitHub App 不一致；或反代改写了 raw body |
| 202 但无 job | 检查 enabled/paused/allowlist/installation；self/Bot/非 opened 为预期 0 job |
| 模型不可用 | 先保证 pi 主默认模型可用；分析不单独存 provider secret |
| 本地项目不可读 | Project Registry 路径、权限、绑定是否正确 |
| 误关 Issue | `paused=true` 止血；复核 close 门禁与本地 checkout 是否过旧；人工 reopen 属运维决定 |
| 仍看到历史 `ypi:claimed` / 旧 PR | 历史副作用不自动清理；人工处理。产品不再创建 claim/PR |
| 旧文档写 Assignee / Owner 指令 / 30142 | 已退役；以本文与 `docs/architecture/overview.md` 为准 |

## 10. 推荐落地清单

1. 创建最小权限 App 并只订 Issues
2. 本机保存凭据
3. 安装到测试仓
4. 关联 Project Registry 只读项目
5. 验证配置全绿
6. 公网只暴露 webhook
7. 启用前阅读自动关闭说明
8. 测试仓 UAT 通过后再对生产仓 allowlist

## 11. 产品边界（给客户的预期）

| 会做 | 不会做 |
| --- | --- |
| 分析人类新建 Issue | 认领、Assignee、`ypi:claimed` |
| 分类 + 四态真实性 | Owner 评论指令 / 采纳等待 |
| 一条规范 Markdown 评论 | 改代码、跑实现 Agent |
| 高置信证伪后严格关闭 | 建 WorkTree / Studio Task / Session |
| 只读本地仓库证据 | branch / push / 开 PR / merge |
| App installation 身份写 Issues | Links / PAT / 本机 `gh` 作为 Bot |

**残余风险（必须知情）：**

- 证据来自**当前绑定本地仓库静态快照**；Issues 权限下无法证明与远端默认分支同步。
- 关闭前最终 GET 缩小竞态，但 GitHub REST 无已验证的原子 content-CAS，仍有极小 TOCTOU。
- 分析是应用层只读 containment，不是 OS sandbox；但它不再启动仓库 shell / full agent。
