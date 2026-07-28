# Brief — WorkTree Check 依赖准备统一修复

## 问题

Git WorkTree 只包含 Git 跟踪内容，不会继承主工作树中被忽略的 `node_modules/`。当前两个检查入口都默认依赖已经存在：

1. GitHub unattended 在 `lib/github-automation-runner.ts` 的 `checking` checkpoint 直接调用 `runGithubValidationBroker()`；默认命令是 `npm run lint` 与 `node_modules/.bin/tsc --noEmit`。
2. 普通 YPI Studio 在 `ypi_studio_subagent(member=checker)` 后直接启动 SDK/CLI checker；检查员只能自行发现并安装依赖，没有平台级前置条件。

因此新建或复用 WorkTree 即使源码完整，也可能因缺少依赖而把环境问题误报为代码验证失败。

## 已核对证据

- `lib/git-worktree.ts#createGitWorktree()` 只执行 `git worktree add`，没有依赖准备。
- `app/api/git/worktrees/route.ts` 与 `lib/github-automation-worktree.ts` 共用上述创建语义。
- `lib/github-validation-broker.ts` 直接以 WorkTree cwd、固定 argv、`shell:false` 执行 validation；没有 install/preflight。
- `lib/ypi-studio-extension.ts` 的 SDK/CLI checker 启动路径没有统一 workspace prepare hook。
- 仓库同时跟踪 `npm-shrinkwrap.json`、`package-lock.json`、`bun.lock`，且 `package.json` 没有 `packageManager`；简单“看到任意 lockfile 就选 manager”会产生歧义。npm 自身以 shrinkwrap 为高优先级锁，因此本仓库应稳定选择 npm。
- `package.json#postinstall` 会应用 AnyRouter 补丁，说明默认 `--ignore-scripts` 会让本项目得到不完整依赖树。

## 修订结论

按用户反馈，不在平台层新增 Node/package-manager adapter。Check 阶段改用通用的、LLM驱动的协议：

```text
fixed linked WorkTree
  → trusted server Check policy
  → LLM reads repository docs / CI / manifests / locks / wrappers as data
  → guarded probe
  → optional project-local dependency prepare (bounded)
  → guarded checks
  → structured report reconciled with platform-observed command evidence
```

平台不判断语言或包管理器，只负责固定WorkTree、受限argv执行、超时/取消、attempt budget、lease、进度、失败归类和evidence reconciliation。GitHub unattended与普通Studio checker使用同一协议；Issue/task文本不能改变权限、cwd、env、timeout、attempt或operator validation commands。

## v1 范围假设

- 对语言/工具链保持通用；是否需要准备、如何准备由checker根据项目已有文档/配置判断。
- 只允许项目级、WorkTree内的准备；缺宿主工具且需要sudo/system/global安装时fail closed。
- unrestricted bash不属于checker profile；SDK/CLI都必须走等价受限工具，不能由fallback绕开。
- 单run最多2次prepare并有累计wall timeout；已启动安装失败不自动重复执行scripts。
- 不更改WorkTree创建API，不复制/链接主工作树依赖，不写平台生态cache/stamp。
- 应用级command guard不是OS sandbox；GitHub unattended仍需低权限账号/容器承载full-agent residual risk。

## UI 门禁

本方案不新增页面、组件、交互或信息结构；复用 GitHub Jobs 既有 reason/block layer 与 Studio run progress/error 投影显示安全状态，因此本轮不触发 HTML UI 原型门禁。若主会话要求新增专门的“依赖安装进度卡/重试按钮”，需另派 UI 设计员并先审批 HTML 原型。
