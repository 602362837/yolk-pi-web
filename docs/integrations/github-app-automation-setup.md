# 自建 GitHub App：议题自动处理配置指南

本文面向 **蛋黄派客户与自托管运维**。  
每位部署方需要 **自己创建并安装 GitHub App**；产品不会替你托管云端 App，也不会在网页里收集私钥。

完成后可以做到：

1. 仓库有新议题时，自动认领并写中文分析结论  
2. 议题上出现你的本机 GitHub 用户作为 Assignee，并打上处理标签  
3. 你（仓库所有者）明确说「采纳」后，可选择自动改文档/小 bugfix，并向 `main` 开 PR  
4. PR 会关联议题，**不会自动合并**

在蛋黄派里配置入口：**设置 → GitHub 自动化**。

---

## 整体流程（先看这张图）

```text
1. 在 GitHub 创建你自己的 App
2. 下载私钥，配置到运行蛋黄派的服务器环境变量
3. 把 App 安装到目标仓库
4. 准备公网 HTTPS，让 GitHub 能通知蛋黄派
5. 在「设置 → GitHub 自动化」关联仓库并验证配置
6. 先开「仅 Triage」试跑，确认无误后再考虑自动实现
```

---

## 1. 你需要准备什么

| 准备项 | 为什么需要 |
| --- | --- |
| 一台能长期运行蛋黄派的机器 | 用来接收 GitHub 通知并处理议题 |
| 公网 HTTPS 地址 | GitHub 云端必须能访问你的服务；仅本机 `127.0.0.1` 不够 |
| 可创建 GitHub App 的账号或组织 | 每位客户创建 **自己的** App |
| 对本机 GitHub 登录（推荐 `gh auth login`） | 认领时把你的用户写到议题 Assignee |

你的 Webhook 地址会是：

```text
https://你的域名/api/github-automation/webhook
```

把「你的域名」换成真实公网域名即可。本地开发端口（如 30141 / 30142）需要通过反代或隧道暴露成 HTTPS。

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
| --- | --- | --- |
| Issues | 必需 | 新议题触发处理 |
| Issue comment | 必需 | 你回复「采纳」时触发后续流程 |
| Installation / Installation repositories | 推荐 | 感知安装与仓库变更 |
| Pull request | 建议（完整闭环） | PR 合并或关闭后回写状态 |

### 2.5 创建后立刻保存这三样

1. **App ID**（一串数字）  
2. **Private key**（点 Generate a private key 下载的 `.pem` 文件）  
3. **Webhook secret**（你自己填的那串）

私钥保存示例：

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

## 4. 在服务器配置环境变量

在 **实际运行蛋黄派的机器/进程** 上设置，然后重启服务：

```bash
export YPI_GITHUB_APP_ID="123456"
export YPI_GITHUB_APP_PRIVATE_KEY_FILE="$HOME/.pi/agent/secrets/ypi-github-app.pem"
export YPI_GITHUB_APP_WEBHOOK_SECRET="与 GitHub 里填的 webhook secret 完全一致"
```

| 环境变量 | 必填 | 含义 |
| --- | --- | --- |
| `YPI_GITHUB_APP_ID` | 是 | App ID 数字 |
| `YPI_GITHUB_APP_PRIVATE_KEY_FILE` | 是 | 私钥文件路径（不是把私钥内容贴到网页） |
| `YPI_GITHUB_APP_WEBHOOK_SECRET` | 是 | Webhook 签名密钥 |
| `YPI_GITHUB_APP_SLUG` | 否 | App 名称 slug，仅展示用 |

### 安全要求

- 私钥和 secret **只放服务器环境变量或密钥管理系统**  
- **不要**贴进蛋黄派网页、聊天、PR、截图或 git 仓库  
- 设置页故意不提供密钥输入框，这是正常设计  

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

---

## 6. 打通公网 Webhook

GitHub 需要主动通知你的蛋黄派。任选一种方式即可：

- 云服务器 + Nginx / Caddy 反代  
- Cloudflare Tunnel 等 HTTPS 隧道  
- 公司统一网关  

检查清单：

1. 公网地址可访问：`https://你的域名/api/github-automation/webhook`  
2. GitHub App 的 Webhook URL 与上面一致  
3. Webhook secret 与环境变量一致  
4. 在 GitHub App 的 **Recent Deliveries** 里能看到成功投递（通常是 200/202）  

---

## 7. 在蛋黄派里完成配置

打开：**设置 → GitHub 自动化**

### 7.1 先看 Setup checklist，再点「验证配置」

页面会按顺序检查：

1. App ID 是否配置  
2. 私钥文件是否可读  
3. Webhook secret 是否配置  
4. App 是否安装并绑定  
5. 权限是否足够  
6. 本机 Assignee 是否可用  
7. 是否已关联允许仓库  
8. 是否绑定本地项目  
9. Webhook 是否健康  

某一项未通过时，会直接给出「下一步做什么」，而不是只丢错误码。

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

---

## 8. 怎么验收已经配好

### 8.1 最小验收：只开 Triage

1. 环境变量已配置并重启蛋黄派  
2. App 已安装到测试仓库  
3. 设置页已关联该仓库  
4. 「验证配置」无关键阻塞项  
5. 模式设为 **仅 Triage** 并启用  
6. 在测试仓库新建一个 Issue  

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

## 9. 常见问题

| 现象 | 怎么处理 |
| --- | --- |
| 提示 App 凭据缺失 | 检查三个环境变量是否配置到 **当前运行中的进程**，改完后重启 |
| 私钥无效或不可读 | 检查路径、文件是否为 PEM、权限是否为 600 |
| Webhook 一直不健康 | 检查公网 HTTPS、Webhook URL、secret 是否一致，并看 GitHub Recent Deliveries |
| 安装缺失 | App 是否安装到该仓库；设置里 Installation ID 是否填对 |
| 权限不足 | 回 App 权限页补齐后，到安装页接受新权限 |
| Assignee 失败 | 执行 `gh auth status`；确认该用户可被指派到仓库 |
| 允许仓库是空的 | 正常，需要你手动关联，不会默认塞任何仓库 |
| 无人值守按钮不可用 | 先完成 checklist；若要自动 PR，还需 Contents / Pull requests 权限 |
| 想立刻停掉 | 在设置里关闭自动化，或改回「仅 Triage」 |

---

## 10. 推荐落地清单

- [ ] 创建自己的 GitHub App  
- [ ] 先授予 Metadata + Issues；需要自动 PR 时再加 Pull requests + Contents  
- [ ] 勾选 Issues、Issue comment 事件  
- [ ] 保存 App ID、私钥文件、Webhook secret  
- [ ] 配置三个环境变量并重启蛋黄派  
- [ ] 安装 App 到目标仓库，记录 Installation ID  
- [ ] 配置公网 HTTPS Webhook  
- [ ] 本机 `gh` 登录完成  
- [ ] 在「设置 → GitHub 自动化」关联仓库并验证配置  
- [ ] 先用「仅 Triage」跑通一个测试议题  
- [ ] 确认无误后，再决定是否开启无人值守  

---

## 11. 产品边界（给客户的预期）

| 会做 | 不会做 |
| --- | --- |
| 帮你认领、分析、打标签、写结论 | 替客户托管一个共用 GitHub App |
| 在设置页引导缺什么、下一步做什么 | 在网页里收集或展示私钥 / Webhook secret |
| 按你关联的仓库工作 | 默认锁死只能处理某一个固定仓库 |
| 所有者采纳后可选自动开 PR | 自动合并 PR、自动发布版本 |

如果某一步卡在 GitHub 页面或环境变量注入方式上，优先看设置页「验证配置」给出的下一步提示。
