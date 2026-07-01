# yolk pi web

`yolk pi web` 是面向 `pi` 编程智能体的本地 WebChat 工作台。它会读取本机 pi agent 数据目录，在浏览器中提供会话管理、实时对话、模型配置、技能管理、项目文件预览、Git/WorkTree 辅助和可选 Web 终端。

npm 包名：`@alan-zhao/yolk-pi-web`

命令行入口：`ypi`

## 环境依赖

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 建议 Node.js 22+ | Next.js 16 / React 19 运行环境；低版本 Node 可能无法启动。 |
| npm | 建议 npm 10+ | 用于 `npx`、全局安装和源码安装依赖。 |
| pi agent 数据目录 | 默认 `~/.pi/agent/` | Web UI 会读取本机会话、模型和设置文件。 |
| Git | 可选但建议安装 | Git 状态、分支、WorkTree 功能需要。 |
| 本地 shell | 可选 | 开启 Web Terminal 时需要系统 shell。 |

> Web Terminal 依赖 `@lydell/node-pty`。如果目标机器缺少原生依赖构建环境，可先关闭 Web Terminal 功能，不影响会话浏览和对话主流程。

## 快速开始

**无需安装，直接运行：**

```bash
npx @alan-zhao/yolk-pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @alan-zhao/yolk-pi-web
ypi
```

启动后打开 [http://localhost:30141](http://localhost:30141)。CLI 会在服务就绪后尝试自动打开浏览器。

## 启动参数

```bash
ypi --port 8080              # 自定义端口
ypi --hostname 127.0.0.1     # 仅本机访问
ypi -p 8080 -H 127.0.0.1     # 组合使用
PORT=8080 ypi                # 也支持环境变量
ypi --proxy http://127.0.0.1:7897                 # HTTP/HTTPS 代理
ypi --socks-proxy socks5://127.0.0.1:7897         # ALL_PROXY/SOCKS 代理
```

`npx` 运行时也可以传参：

```bash
npx @alan-zhao/yolk-pi-web@latest --port 8080
```

如果 shell 中已有 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`，`ypi` 会继承并自动为 Node 追加 `--use-env-proxy`。也可以用 `PROXY_URL` 和 `SOCKS_PROXY_URL`：

```bash
PROXY_URL=http://127.0.0.1:7897 SOCKS_PROXY_URL=socks5://127.0.0.1:7897 ypi
```

## 数据目录与配置

默认读取：

```text
~/.pi/agent/
```

如需指定其他 pi agent 数据目录：

```bash
PI_CODING_AGENT_DIR=/path/to/pi-agent-data ypi
```

| 文件/目录 | 用途 |
| --- | --- |
| `sessions/` | 会话 JSONL 文件，按工作目录归档。 |
| `models.json` | 模型提供商和模型列表配置。 |
| `settings.json` | pi agent 设置，包括默认模型。 |
| `pi-web.json` | Web UI 设置，例如 WorkTree、Usage、Web Terminal、ChatGPT 面板和 Trellis 设置。 |

会话文件路径形如：

```text
~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **边聊边看项目文件/终端**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；需要时可在当前工作区打开 Web Terminal。
- **随时掌握会话状态**：在顶部查看上下文占用、花费、压缩结果和系统提示。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理。

## 使用注意

- **文件访问范围**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **模型配置**：Models 面板读写 pi agent 数据目录下的 `models.json`，模型列表和默认模型由 pi 配置解析得到。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。
- **Web Terminal**：需要本机 shell 和 PTY 支持；可在 `pi-web.json` 或界面设置中关闭。

## 从源码运行

```bash
git clone https://github.com/602362837/pi-agnet-web.git
cd pi-agnet-web
npm install
npm run dev
```

本地开发端口为 [http://localhost:30141](http://localhost:30141)。

生产构建和启动：

```bash
npm run build
npm run start
```

> 开发时不要直接运行 `next build`。发布或生产验证时使用 `npm run build`。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

## 项目结构

```text
app/          # Next.js 页面和 API 路由
components/   # 浏览器端 UI 组件
hooks/        # 会话状态、主题、拖拽、音频等 React hooks
lib/          # 会话解析、RPC 生命周期、路径/配置/提供商等共享逻辑
scripts/      # 构建和运维脚本
bin/          # ypi CLI 入口
public/       # 静态资源
docs/         # 架构、模块、部署和运维文档
```
