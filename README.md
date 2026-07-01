# yolk pi web

`yolk pi web` 是面向 `pi` 编程智能体的 WebChat 工作台。它把本地会话、实时对话、分支切换、模型配置、文件浏览和 WorkTree 管理集中到浏览器中，适合在桌面或服务器环境中长期运行。

本仓库最初源自上游项目，但当前已按自身需求持续演进；使用方式也以源码构建和本地部署为主，不再把 npm 发布包作为默认安装入口。

## 核心能力

- **会话浏览器** — 按工作目录分组展示本地 `pi` 会话，快速回到历史上下文。
- **实时智能体对话** — 通过 SSE 流式展示智能体输出，支持运行中引导、完成后追加消息。
- **会话分叉与分支导航** — 从任意用户消息创建新会话，或在同一会话内回退节点继续探索。
- **模型与工具配置** — 在对话中切换模型、调整思考等级、配置工具预设和可用模型。
- **文件、Git 与终端辅助** — 在侧边栏浏览当前工作目录文件，支持创建 Git worktree，并可按设置开启当前工作区 Web 终端。
- **长会话管理** — 支持压缩会话摘要，降低长上下文继续工作的成本。

## 快速开始

本项目建议从源码安装依赖并运行开发服务器：

```bash
git clone <repo-url>
cd yolk-pi-web
npm install
npm run dev
```

启动后打开 [http://localhost:30141](http://localhost:30141)。

## 生产运行

构建并启动生产服务：

```bash
npm run build
npm run start
```

默认端口是 `30141`。如需调整监听地址或端口：

```bash
npm run start -- --port 8080
npm run start -- --hostname 127.0.0.1
PORT=8080 npm run start

# npm 包安装后也可使用
npx yolk-pi-web@latest --port 8080
ypi --port 8080
```

> 请使用 `npm run build` 进行生产构建；不要直接运行 `next build`，构建脚本包含项目需要的环境处理。

## 数据与配置

`yolk pi web` 默认读取 `~/.pi/agent/` 下的智能体数据。可通过 `PI_CODING_AGENT_DIR` 指向其他数据目录。

| 路径 | 用途 |
| --- | --- |
| `sessions/` | 会话 JSONL 文件，按工作目录归档。 |
| `models.json` | 模型提供商和模型列表配置。 |
| `settings.json` | `pi` 智能体设置，包括默认模型。 |
| `pi-web.json` | Web UI 设置，例如 New WorkTree 默认行为、Web 终端开关/shell/env 配置。 |

会话文件路径格式：

```text
~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl
```

## 开发

常用命令：

```bash
npm install
npm run dev
npm run lint
node_modules/.bin/tsc --noEmit
```

项目结构概览：

```text
app/
  api/              # 会话、智能体、文件、Git、模型、配置等 API 路由
components/         # 浏览器端 UI 组件
hooks/              # 会话状态、主题、拖拽、音频等 React hooks
lib/                # 会话解析、RPC 生命周期、工具调用规范化等共享逻辑
scripts/            # 构建和运维辅助脚本
bin/                # ypi 命令入口，保留用于本地/发布场景
public/             # 静态资源
docs/               # 架构、模块、部署和运维文档
```

更多运行与部署细节见 [`docs/deployment/README.md`](docs/deployment/README.md)。
