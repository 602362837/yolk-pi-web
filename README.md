# yolk pi web

`yolk pi web` 是面向 `pi` 编程智能体的本地 WebChat 工作台。它把本地会话、实时对话、分支切换、模型配置、文件浏览、Git/WorkTree 辅助和可选 Web 终端集中到浏览器里，适合在桌面或服务器环境中长期运行。

npm 包名：`@alan-zhao/yolk-pi-web`

命令行入口：`ypi`（Web 工作台）、`ypic`（终端 chat）

## 运行环境

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 建议 Node.js 22+ | Next.js 16 / React 19 运行环境；低版本 Node 可能无法启动。 |
| npm | 建议 npm 10+ | 用于 `npx`、全局安装和源码安装依赖。 |
| pi agent 数据目录 | 默认 `~/.pi/agent/` | Web UI 会读取本机 pi 会话、模型和设置文件。 |
| Git | 可选但建议安装 | Git 状态、分支、WorkTree 功能需要。 |
| 本地 shell | 可选 | 开启 Web Terminal 时需要系统 shell。 |
| Chrome 浏览器 | 可选 | 安装 YPI Browser Share 扩展后，可把当前 Chrome 标签页分享给指定 YPI 会话。 |

> `@lydell/node-pty` 是 Web Terminal 的原生 PTY 依赖。通常随 npm 安装自动处理；如果目标机器缺少原生依赖构建环境，可先关闭 Web Terminal 功能。

## 快速开始

无需安装，直接运行最新版本：

```bash
npx @alan-zhao/yolk-pi-web@latest
```

或全局安装后使用 `ypi`：

```bash
npm install -g @alan-zhao/yolk-pi-web
ypi
```

默认监听 `http://localhost:30141`。服务就绪后，CLI 会尝试自动打开浏览器。

## 终端聊天入口 `ypic`

`ypic` 是面向当前目录的轻量终端 chat 入口：在任意项目目录运行 `ypic`，即以该目录为 workspace 与 agent 对话，复用同一个 ypi Web server 的会话、Studio 与模型能力。

```bash
npm install -g @alan-zhao/yolk-pi-web
ypi          # 先启动 Web server（ypic 不会自启 server）
cd your-project
ypic         # 在当前目录进入终端聊天
ypic "解释这个仓库"   # 也可直接带上第一条消息
ypic -c                # 续接当前目录最近的会话
ypic --resume <sid>    # 直接恢复指定 session
ypic --port 8080       # 指定 ypi server 端口
```

启动提示：

启动后在 TTY 模式下显示 YPI CLI 身份 banner、当前工作目录（cwd）、ypi server 地址与版本号、session id、当前模型与 thinking 等级、以及 `/help` `/model` `/config` `/oweb` `/quit` 等核心命令提示。若模型未配置，会提示使用 `/config` 打开 Web 设置页。

`/model` 命令：

| 命令 | 用途 |
| --- | --- |
| `/model` | 显示帮助和当前模型/thinking。 |
| `/model current` | 显示当前 provider/model/thinking 等级和支持的 thinking 范围。 |
| `/model list [provider]` | 列出所有可用模型（可按 provider 过滤）；当前生效模型标注 `*`。 |
| `/model <provider>/<modelId>` | 直接切换到指定模型（agent idle 时）。 |
| `/model <provider>/<modelId> <thinking>` | 切换模型并同时设置 thinking 等级。 |
| `/model thinking <level>` | 仅切换 thinking 等级（`off`/`auto`/`low`/`medium`/`high`/`xhigh`）。 |

切换后会通过 `set_model` / `set_thinking_level` 写入服务端 session 状态，Web 端打开同一 session 可看到相同变化。agent 正在运行时禁止切换模型，会提示先 `/abort`。

TTY 底部固定输入区与状态栏：

在支持 ANSI 的终端（`stdout.isTTY && !NO_COLOR && !YPIC_PLAIN`）中，`ypic` 使用 alternate screen buffer 渲染：

- **历史输出区**：上方可滚动区域显示 assistant 输出、tool call、Studio 摘要等。
- **分隔线**：灰色横线将输出区与底部三行 UI 分开。
- **状态栏**：左侧显示 idle/RUNNING/ERROR 状态圆点和文本；右侧显示当前模型和 thinking 等级。
- **输入行**：固定在底部，绿色 `> ` 提示符；运行时显示灰色 placeholder 提示“Enter to steer, Ctrl-C to abort”。
- 窗口 resize 时自动重绘。

降级与兼容：

- 设置 `YPIC_PLAIN=1` 或 `NO_COLOR`，或 stdout/stdin 非 TTY（管道、CI、脚本）时，自动降级为 plain readline 模式：输出直接写入 stdout，状态信息通过 `[YPIC:info]` 写入 stderr，不产生任何 ANSI escape 序列。
- 非 TTY 下 `ypic "message"` 发送首条消息后，在 `agent_end` 后自动退出，适合脚本/管道使用。

定位与限制：

- `ypic` 不替代 `ypi`，也不在终端重做 Web 工作台。模型、账号、Studio 成员策略、Web Terminal 等复杂配置请用 `/config` 打开 Web 页面完成。
- CLI 内支持 `/oweb` 直接打开当前 session 的固定 Web 链接；退出时也会打印 `--resume <sessionId>` 提示与对应 Web 链接。
- `ypic` 不会自启 server。启动时先 `GET /api/cli/health` 探测；未检测到 ypi server 或端口被其他服务占用时，会提示先手动运行 `ypi`。
- 当前目录尚未注册为项目时，`ypic` 会通过现有 Project Registry API 自动建立/注册对应 project/space 上下文（按 canonical pathKey 去重）。
- YPI Studio 在终端只做轻控制：`/studio-feature`、`/studio-continue`、`/studio-check` 等 slash command 透传给同一会话；CLI 展示 task id/status 和 `plan-review.md` 路径提示，完整任务详情、artifact 预览、成员配置仍在 Web Studio 面板查看。审批仍由用户在聊天中明确确认触发，CLI 不会自动批准。
- 会话仍以 pi JSONL 存于 `~/.pi/agent/`，未新增独立会话格式；Web 打开同一会话内容一致。

## Chrome 标签页分享（Browser Share）

`ypi` 支持通过独立的 Chrome 扩展 **YPI Browser Share**，把当前浏览器标签页安全地绑定到指定聊天/会话。绑定后，agent 可以读取经过脱敏的页面快照、当前选中文本和交互元素摘要；在用户授权下，还可以执行受控的 `click`、`type`、`scroll`、`navigate` 操作。

扩展项目与安装说明见：[`ypi-browser-share-extension`](https://github.com/602362837/ypi-browser-share-extension/blob/main/README.md)。当前扩展未上架 Chrome Web Store，需要以“加载已解压的扩展程序”的方式安装：

1. 启动 ypi web，默认地址为 `http://localhost:30141`。
2. 克隆或下载扩展项目，并在 Chrome 打开 `chrome://extensions/`。
3. 开启 **开发者模式**，点击 **加载已解压的扩展程序**，选择包含 `manifest.json` 的扩展目录。
4. 建议把 **YPI Browser Share** 固定到 Chrome 工具栏。
5. 如 ypi web 使用了自定义端口、局域网地址、HTTPS 反向代理或路径前缀，请在扩展弹窗中修改 **蛋黄派服务地址** 并点击 **保存并测试**。

使用流程：在要分享的页面点击扩展的 **分享当前页** 生成一次性分享码，然后回到目标 YPI 聊天/会话，点击输入区工具栏的 **绑定浏览器分享** 并粘贴分享码。分享只绑定到当前会话；默认只读，风险操作会通过 ypi 侧确认流程保护。分享期间 Chrome 会显示 debugger 提示条，扩展弹窗和 ypi 面板会显示当前绑定、权限和 debugger 状态。

## 常用启动参数

```bash
ypi --port 8080              # 自定义端口
ypi --hostname 127.0.0.1     # 仅本机访问
ypi -p 8080 -H 127.0.0.1     # 短参数组合
PORT=8080 ypi                # 也支持 PORT 环境变量
ypi --proxy http://127.0.0.1:7897                 # HTTP/HTTPS 代理
ypi --socks-proxy socks5://127.0.0.1:7897         # ALL_PROXY/SOCKS 代理
```

`npx` 同样支持这些参数：

```bash
npx @alan-zhao/yolk-pi-web@latest --port 8080
```

如果 shell 中已有 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`，`ypi` 会继承并自动为 Node 追加 `--use-env-proxy`。也可以用 `PROXY_URL` 和 `SOCKS_PROXY_URL`：

```bash
PROXY_URL=http://127.0.0.1:7897 SOCKS_PROXY_URL=socks5://127.0.0.1:7897 ypi
```

### 环境变量与 Node 内存限制

通过 `npm install -g` 全局安装的 `ypi` 在部分终端/系统中可能不会自动继承当前 shell 的环境变量。如果遇到代理不生效或 Node 内存不足导致 OOM，建议在启动命令前显式设置环境变量：

```bash
# 同时设置代理和增大 Node 堆内存
NODE_OPTIONS="--max-old-space-size=4096" PROXY_URL=http://127.0.0.1:7897 SOCKS_PROXY_URL=socks5://127.0.0.1:7897 ypi
```

- `NODE_OPTIONS="--max-old-space-size=4096"`：将 Node.js V8 堆内存上限提高到 4096 MB（默认约 1.5 GB）。如果长会话或大项目导致内存不足，可适当调大。
- `PROXY_URL` / `SOCKS_PROXY_URL`：设置 HTTP 和 SOCKS5 代理地址，确保 ypi 及其子进程能访问外部网络。

如果已在 `~/.bashrc` 或 `~/.zshrc` 中 export 了这些变量，通常无需每次手动指定；但若使用 `npx` 启动或遇到环境变量丢失，显式写在命令前更可靠。

## 数据与配置

默认读取 `~/.pi/agent/`。如需使用其他数据目录：

```bash
PI_CODING_AGENT_DIR=/path/to/pi-agent-data ypi
```

| 路径 | 用途 |
| --- | --- |
| `sessions/` | 会话 JSONL 文件，按工作目录归档。 |
| `models.json` | 模型提供商和模型列表配置。 |
| `settings.json` | pi agent 设置，包括默认模型。 |
| `pi-web.json` | Web UI 设置，例如蛋黄𝝅聊天默认值、WorkTree、Usage、Web Terminal、ChatGPT 面板和 Trellis 设置。 |

会话文件路径格式：

```text
~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl
```

## 核心能力

- **会话浏览器**：按工作目录分组展示本地 `pi` 会话，快速回到历史上下文。
- **实时智能体对话**：通过 SSE 流式展示智能体输出，支持运行中引导和完成后追加消息。
- **会话分叉与分支导航**：从任意用户消息创建新会话，或在同一会话内回退节点继续探索。
- **模型与工具配置**：在对话中切换模型、调整 thinking level、配置工具预设和可用模型。
- **文件、Git 与终端辅助**：浏览当前工作区文件，查看 Git 状态，创建 WorkTree，并可按设置开启 Web Terminal。
- **Chrome 标签页分享**：通过 YPI Browser Share 扩展把当前标签页绑定到指定会话，支持脱敏快照读取和经授权的受控浏览器操作。
- **长会话管理**：支持压缩会话摘要，降低长上下文继续工作的成本。

## 从源码运行

```bash
git clone https://github.com/602362837/pi-agnet-web.git
cd pi-agnet-web
npm install
npm run dev
```

开发服务器默认端口：`http://localhost:30141`。

生产构建和启动：

```bash
npm run build
npm run start
```

> 请使用 `npm run build`，不要直接运行 `next build`。构建脚本 `scripts/build-next.js` 包含项目需要的环境处理。

## 开发检查

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 项目结构

```text
app/          # Next.js 页面和 API 路由
components/   # 浏览器端 UI 组件
hooks/        # 会话状态、主题、拖拽、音频等 React hooks
lib/          # 会话解析、RPC 生命周期、路径/配置/提供商等共享逻辑
scripts/      # 构建和运维脚本
bin/          # ypi / ypic CLI 入口（ypic 为终端 chat，复用 ypi Web server）
public/       # 静态资源
docs/         # 架构、模块、部署和运维文档
```

更多部署、发布和运行细节见 [`docs/deployment/README.md`](docs/deployment/README.md)。
