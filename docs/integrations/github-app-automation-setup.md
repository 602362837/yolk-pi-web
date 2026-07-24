# 自建 GitHub App：议题自动处理配置指南

本文面向 **蛋黄派客户与自托管运维**。  
每位部署方需要 **自己创建并安装 GitHub App**；产品不会替你托管云端共享 App。

完成后可以做到：

1. 仓库有新议题时，自动认领并写中文分析结论  
2. 议题上出现你的本机 GitHub 用户作为 Assignee，并打上处理标签  
3. 你（仓库所有者）明确说「采纳」后，可选择自动改文档/小 bugfix，并向 `main` 开 PR  
4. PR 会关联议题，**不会自动合并**

在蛋黄派里配置入口：**设置 → GitHub 自动化**。

**默认凭据路径是设置页「本机 GitHub App 凭据」**：填写 App ID、Webhook secret，粘贴或选择私钥 PEM，保存到本机 agent data dir 后，正常启动 / 重启 `ypi` 即可复用。  
环境变量 `YPI_GITHUB_APP_*` 仅作为 CI / 容器 / 专业部署的**高级覆盖**（见文末），不是普通本机用户的必选步骤。

---

## 整体流程（先看这张图）

```text
1. 在 GitHub 创建你自己的 App
2. 下载私钥与 Webhook secret（先妥善保存在本机，不要提交 git）
3. 把 App 安装到目标仓库
4. 准备公网 HTTPS，只把 webhook 路由暴露给 GitHub
5. 在「设置 → GitHub 自动化」：
   a. 本机凭据卡保存 App ID / Webhook secret / 私钥 PEM
   b. 关联允许仓库
   c. 验证配置
6. 先开「仅 Triage」试跑，确认无误后再考虑自动实现
```

---

## 1. 你需要准备什么

| 准备项 | 为什么需要 |
| --- | --- |
| 一台能长期运行蛋黄派的机器 | 用来接收 GitHub 通知并处理议题 |
| 公网 HTTPS 地址（仅 webhook） | GitHub 云端必须能访问 webhook 路由；仅本机 `127.0.0.1` 不够 |
| 可创建 GitHub App 的账号或组织 | 每位客户创建 **自己的** App |
| 对本机 GitHub 登录（推荐 `gh auth login`） | 认领时把你的用户写到议题 Assignee |

你的 **Webhook** 地址会是：

```text
https://你的域名/api/github-automation/webhook
```

把「你的域名」换成真实公网域名即可。本地开发端口（如 30141 / 30142）需要通过反代或隧道暴露成 HTTPS。

### 公网暴露边界（必读）

- **应公网可达**：`POST /api/github-automation/webhook`
- **不应无认证公网暴露**：Settings UI、`/api/github-automation/credentials`、`/config`、`/status`、`/verify`、`/jobs/*` 等管理面  
  本机凭据 API 允许写入 App 身份材料；请仅在本机 loopback、VPN 或受控访问后使用。  
  反代时建议只把 webhook 路径放到公网入口，管理面走本机或额外访问控制。

---

## 2. 在 GitHub 创建 App

### 2.1 打开创建页

- 个人账号：[创建 GitHub App](https://github.com/settings/apps/new)
- 组织：组织设置 → Developer settings → GitHub Apps → New GitHub App

### 2.2 基本信息怎么填

| 字段 | 怎么填 |
| --- | --- |
| GitHub App name | 例如 `my-company-ypi-bot`（全局唯一） |
| Homepage URL | 你的蛋黄派地址或公司主页 |
| Callback URL | 可不填（本功能不走用户网页 OAuth 登录） |
| Webhook | 勾选 Active |
| Webhook URL | `https://你的域名/api/github-automation/webhook` |
| Webhook secret | 自己生成一串足够长的随机字符串，妥善保存 |

### 2.3 权限怎么选

建议分两阶段：

**第一阶段：只做认领 / 分析 / 评论（推荐先做）**

| 权限 | 选择 |
| --- | --- |
| Metadata | Read |
| Issues | Read and write |

**第二阶段：还要自动改代码并提 PR 时再加**

| 权限 | 选择 |
| --- | --- |
| Pull requests | Read and write |
| Contents | Read and write |

不要申请 Actions、Secrets、Administration 等无关高危权限。

### 2.4 事件怎么勾

| 事件 | 是否需要 | 作用 |
| --- | --- |
| Issues | 必需 | 新议题触发处理 |
| Issue comment | 必需 | 你回复「采纳」时触发后续流程 |
| Installation / Installation repositories | 推荐 | 感知安装与仓库变更 |
| Pull request | 建议（完整闭环） | PR 合并或关闭后回写状态 |

### 2.5 创建后立刻保存这三样

1. **App ID**（一串数字）  
2. **Private key**（点 Generate a private key 下载的 `.pem` 文件）  
3. **Webhook secret**（你自己填的那串）

下载的 PEM 只作**临时**保管，下一步会在设置页粘贴或选择文件交给服务端安全落盘。  
不要把 PEM / secret 提交进 git、聊天、截图或 PR。

可选：若你只想先把下载文件挪出浏览器默认下载目录（仍是本地文件，不是产品主路径）：

```bash
mkdir -p ~/.pi/agent/secrets
mv ~/Downloads/你的应用.private-key.pem ~/.pi/agent/secrets/ypi-github-app.pem
chmod 700 ~/.pi/agent/secrets
chmod 600 ~/.pi/agent/secrets/ypi-github-app.pem
```

---

## 3. 把 App 安装到仓库

1. 打开刚创建的 App 页面  
2. 选择 **Install App**  
3. 选择账号/组织  
4. 建议选 **Only select repositories**，只勾选要自动化的仓库  
5. 安装后记下 **Installation ID**（安装详情页里的数字）

之后在蛋黄派「允许仓库」里，每个仓库都要填对应的 Installation ID。

---

## 4. 在设置页配置本机 GitHub App 凭据（默认路径）

打开：**设置 → GitHub 自动化**，页面上方主卡是 **本机 GitHub App 凭据**。

### 4.1 填写并「保存到本机」

| 字段 | 怎么填 |
| --- | --- |
| App ID | 创建 App 后显示的数字 ID |
| Webhook secret | 与 GitHub App webhook secret **完全一致**（`password` 输入，页面不回显已保存值） |
| 私钥 | **粘贴 PEM** 或 **选择本机 `.pem` 文件**（二选一；切换输入方式会清理另一种临时值） |

点击 **保存到本机**：

1. 浏览器通过 `PUT /api/github-automation/credentials` 提交本次输入（multipart）  
2. 服务端校验后写入 agent data dir（见下节），并清理 installation token 内存缓存  
3. 成功后页面清空 password / PEM / File 临时输入；状态只显示「已配置 · 本机」等安全投影  
4. **不需要**配置 shell 环境变量，也**不需要**每次 `export`

首次保存必须三项齐全；之后轮换可只填变更项，**留空表示保留已保存本机值**（不会从环境变量反写到本机）。

### 4.2 页面不会回显什么

| 永不回显 / 不下载 | 会显示 |
| --- | --- |
| App ID 原值 | 是否已配置 |
| Webhook secret / 任意 masked 片段 | 来源：`本机` / `env` / `未配置` |
| 私钥 PEM、文件名、绝对路径、指纹 | readiness / 本地 bundle 是否可用 |
| JWT、installation token | 校验失败时的固定安全文案 |

### 4.3 本机存储位置与权限（了解即可）

服务端在 agent data dir 的 `github-automation/` 下持久化（默认 `~/.pi/agent/`，可用 `PI_CODING_AGENT_DIR` 覆盖）：

```text
github-automation/                         # 0700
  credentials.v1.json                      # 0600，schema v1 元数据 + secret 字段
  private-key.<generation>.pem             # 0600，metadata 原子指针指向的当前私钥
  .locks/credentials.lock/                 # 跨进程写锁
  config.json                              # 非 secret 控制面（模式/allowlist 等，无密钥）
  deliveries/ jobs/ repositories/ ...
```

写入规则摘要：

- 先写新 generation 私钥文件，再原子切换 `credentials.v1.json` 指针  
- 同目录临时文件 + fsync + rename；进程队列 + mkdir 锁  
- 读取时校验 basename 范围、普通文件、RSA 私钥与指纹；损坏 / 未知 schema **fail closed**  
- 与 Links、`auth.json`、模型 CredentialStore、Session/Task **隔离**；不写 `pi-web.json`

保存或删除成功后：后续 webhook / JWT / GitHub API 立即使用新有效值；**重启 `ypi` 且无任何 `YPI_GITHUB_APP_*` 时仍应保持 configured**。

### 4.4 移除本机凭据

危险操作 **移除本机凭据** 会要求确认，且：

- **只删除**本机 fallback（`credentials.v1.json` 与当前 generation 私钥）  
- **不删除** GitHub App、installation、允许仓库、jobs、审计  
- **不修改**进程环境变量  
- 若某字段仍由 env 覆盖且三项仍完整，effective 状态可能继续显示「已配置 · env」

---

## 5. 准备本机 Assignee

认领成功时，议题右侧 Assignees 会出现 **本机当前 GitHub 用户**。

请在运行蛋黄派的机器上执行：

```bash
gh auth status
```

若未登录：

```bash
gh auth login
```

若有多账号，切到希望出现在 Assignee 里的账号：

```bash
gh auth switch
```

该用户需要对目标仓库有可被指派的权限（通常是可写协作者）。

> **身份隔离**：App Bot 负责 webhook 验签、标签、评论、指派 API 与后续 PR 发布；  
> 本机 `gh` / git 凭据用户 **只作为 Assignee 展示身份**，不会变成 Bot 或 publisher 回退。  
> Links 里的 GitHub OAuth 连接与本功能无关。

---

## 6. 打通公网 Webhook

GitHub 需要主动通知你的蛋黄派。任选一种方式即可：

- 云服务器 + Nginx / Caddy 反代  
- Cloudflare Tunnel 等 HTTPS 隧道  
- 公司统一网关  

检查清单：

1. 公网地址可访问：`https://你的域名/api/github-automation/webhook`  
2. GitHub App 的 Webhook URL 与上面一致  
3. Webhook secret 与 **设置页本机凭据**（或高级 env 覆盖）一致  
4. 管理面（设置页 / credentials / config API）**未**无认证挂到同一公网入口  
5. 在 GitHub App 的 **Recent Deliveries** 里能看到成功投递（通常是 200/202）  

---

## 7. 在蛋黄派里完成其余配置

打开：**设置 → GitHub 自动化**

### 7.1 先看 Setup checklist，再点「验证配置」

凭据卡下方的 checklist 会按顺序检查，例如：

1. App ID 是否已配置（默认引导：上方本机凭据卡）  
2. 私钥是否可用  
3. Webhook secret 是否已配置  
4. App 是否安装并绑定  
5. 权限是否足够  
6. 本机 Assignee 是否可用  
7. 是否已关联允许仓库  
8. 是否绑定本地项目  
9. Webhook 是否健康  

「验证配置」是只读探测：不写盘、不入队、不唤醒调度器、不做 GitHub 写操作，也不接收 secret body。  
某一项未通过时会给出「下一步做什么」，而不是只丢错误码或路径。

### 7.2 关联允许仓库

新安装默认 **没有** 预置任何仓库，需要你自己添加：

1. 点击 **关联仓库 / 添加**  
2. 填写 `owner/repo`（例如 `acme/website`）  
3. 填写 Installation ID  
4. 选择本地项目（来自项目列表，用于后续自动改代码时的工作目录）  
5. 默认分支一般填 `main`  
6. 保存  

可以添加多个仓库，也可以删除不再使用的仓库。

### 7.3 选择运行模式

| 模式 | 适合场景 |
| --- | --- |
| 关闭 | 暂不处理新议题 |
| 仅 Triage | 只认领、分析、打标签、写评论（推荐先开这个） |
| 低风险无人值守 | 所有者采纳后，可自动处理文档和小 bugfix 并开 PR |

建议：

1. 先用 **仅 Triage** 跑通  
2. 确认认领和评论正常  
3. 再考虑打开无人值守  

无人值守默认使用完整 agent 能力，可以执行命令和访问网络，因此只应在你明确接受风险后开启。  
只有 **仓库所有者** 明确表示采纳时才会开始自动实现。  
产品保证不会把 App 私钥 / JWT / installation token、Webhook secret、本机个人凭据**主动注入** agent 上下文；这不等于 OS 级沙箱。生产建议使用独立低权限系统用户或容器。

---

## 8. 怎么验收已经配好

### 8.1 最小验收：只开 Triage

1. 设置页本机凭据已保存（**可不设置**任何 `YPI_GITHUB_APP_*`）  
2. 完全停止并重新启动蛋黄派后，status / 验证仍显示 App 凭据已配置  
3. App 已安装到测试仓库  
4. 设置页已关联该仓库  
5. 「验证配置」无关键阻塞项  
6. 模式设为 **仅 Triage** 并启用  
7. 在测试仓库新建一个 Issue  

预期结果：

- 议题被认领到你的 GitHub 用户  
- 出现处理相关标签  
- Bot 发布一条中文结论评论  

### 8.2 所有者采纳

用仓库所有者账号在议题下明确回复，例如：

- 采纳  
- 可以做  
- 开始实现  

非所有者、疑问句、否定句不会触发自动实现。

### 8.3 可选：自动开 PR

在权限已包含 Pull requests / Contents，且无人值守校验通过后：

1. 所有者采纳  
2. 系统在隔离工作区处理文档或小 bugfix  
3. 向默认分支开 PR，并关联议题  
4. **不会自动合并**，仍由你审核  

---

## 9. 高级：环境变量覆盖（CI / 容器 / 专业部署）

普通本机安装 **不需要** 配置环境变量。  
若你使用 secret manager、systemd、容器编排等，可对进程注入以下变量；**非空 env 按字段覆盖本机值**：

```bash
export YPI_GITHUB_APP_ID="123456"
export YPI_GITHUB_APP_PRIVATE_KEY_FILE="/secure/path/app.pem"   # 服务器可读的 0600 PEM 路径
export YPI_GITHUB_APP_WEBHOOK_SECRET="与 GitHub 一致的 secret"
# 可选
export YPI_GITHUB_APP_SLUG="your-app-slug"
```

| 规则 | 说明 |
| --- | --- |
| 优先级 | 每个字段独立：`非空 env` → `本机持久值` → `未配置` |
| 空白 env | 视为未设置，回落本机 |
| 混合来源 | 可只覆盖某一字段；设置页会显示每项来源。**覆盖值必须属于同一 App**，否则 JWT/验签会失败 |
| 不写回 | 设置页保存 **永不** 把 env 值复制进本机文件；删除本机凭据也 **不修改** env |
| 无 reveal | UI / status / verify 只显示来源枚举，不显示 env 值或路径 |

适用场景：CI、不可写 agent dir 的容器、由运维统一注入的密钥。  
本机用户请优先使用第 4 节设置页路径。

---

## 10. 常见问题

| 现象 | 怎么处理 |
| --- | --- |
| 提示 App 凭据缺失 | 打开设置页本机凭据卡，三项完整保存后点「验证配置」；若使用高级 env，确认注入到 **当前运行中的进程** |
| 私钥无效或不可读 | 重新粘贴/选择 **GitHub App RSA 私钥** PEM 并保存；高级 env 路径需为 0600 普通文件（非 symlink） |
| 本机 bundle 损坏 / 不支持 | 使用「移除本机凭据」后完整重配；不要手改 `credentials.v1.json` |
| 轮换后仍像旧 App | 保存/删除会清 installation token 缓存；若仍异常，确认 env 是否仍覆盖旧值 |
| Webhook 一直不健康 / 401 | 检查公网 HTTPS、Webhook URL、secret 是否与本机或 env 一致；看 GitHub Recent Deliveries；勿在日志中打印 raw body / signature |
| 安装缺失 | App 是否安装到该仓库；设置里 Installation ID 是否填对 |
| 权限不足 | 回 App 权限页补齐后，到安装页接受新权限 |
| Assignee 失败 | 执行 `gh auth status`；确认该用户可被指派到仓库 |
| 允许仓库是空的 | 正常，需要你手动关联，不会默认塞任何仓库 |
| 无人值守按钮不可用 | 先完成 checklist；若要自动 PR，还需 Contents / Pull requests 权限 |
| 想立刻停掉 | 在设置里关闭自动化，或改回「仅 Triage」；不必删除本机凭据 |
| 删除本机后仍显示已配置 | 进程 env 仍提供完整字段时属预期；去掉 env 后会变为未配置 |

---

## 11. 推荐落地清单

- [ ] 创建自己的 GitHub App  
- [ ] 先授予 Metadata + Issues；需要自动 PR 时再加 Pull requests + Contents  
- [ ] 勾选 Issues、Issue comment 事件  
- [ ] 保存 App ID、私钥 PEM、Webhook secret（勿入库）  
- [ ] 在「设置 → GitHub 自动化」本机凭据卡保存三项  
- [ ] 安装 App 到目标仓库，记录 Installation ID  
- [ ] 配置公网 HTTPS **仅** Webhook 路由；管理面受控  
- [ ] 本机 `gh` 登录完成  
- [ ] 关联允许仓库并「验证配置」  
- [ ] 重启 `ypi`（无 `YPI_GITHUB_APP_*`）确认仍 configured  
- [ ] 先用「仅 Triage」跑通一个测试议题  
- [ ] 确认无误后，再决定是否开启无人值守  
- [ ] （可选）CI/容器再配置高级 env 覆盖  

---

## 12. 产品边界（给客户的预期）

| 会做 | 不会做 |
| --- | --- |
| 在设置页安全写入本机 App 凭据并重启复用 | 替客户托管一个共用 GitHub App |
| 显示配置状态与来源（本机 / env / 未配置） | 回显、复制或下载已保存 secret / PEM / 路径 / 指纹 |
| 按你关联的仓库工作 | 默认锁死只能处理某一个固定仓库 |
| 所有者采纳后可选自动开 PR | 自动合并 PR、自动发布版本 |
| 公网 webhook 验签与 durable job | 把管理 UI/凭据 API 设计为可安全裸奔公网 |

如果某一步卡在 GitHub 页面或本机凭据状态上，优先看设置页「验证配置」给出的下一步提示。
