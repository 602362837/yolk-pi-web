# yolk pi web

`yolk pi web` 是面向 `pi` 编程智能体的本地 WebChat 工作台。它把本地会话、实时对话、分支切换、模型配置、文件浏览、Git/WorkTree 辅助和可选 Web 终端集中到浏览器里，适合在桌面或服务器环境中长期运行。

npm 包名：`@alan-zhao/yolk-pi-web`

命令行入口：`ypi`

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
bin/          # ypi CLI 入口
public/       # 静态资源
docs/         # 架构、模块、部署和运维文档
```

更多部署、发布和运行细节见 [`docs/deployment/README.md`](docs/deployment/README.md)。
