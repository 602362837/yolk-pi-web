---
name: submit-pr
description: >
  创建并规范化 GitHub Pull Request：将当前分支提交到本仓库的 main 分支，使用固定、完整、条理清晰的中文 Markdown 描述，并在 PR 合并后删除源分支。只要用户说“提 PR”“创建 PR”“发起合并请求”“向 main 提交”“开一个 GitHub PR”等，就使用本 skill，不要临时编写随意的 PR 文案或绕过检查流程。
---

# 项目级提 PR

## 目标

把当前工作分支安全地提交为本仓库 `main` 分支的 Pull Request。PR 标题和正文必须使用中文；正文必须遵循本文固定模板，不能用空泛的一句话替代。创建 PR 前先核对分支、远程仓库、变更范围和验证结果，避免把错误分支或无关改动提交到 `main`。

## 安全边界

- 先执行 `git status --short --branch`、`git branch --show-current` 和 `git remote -v`，确认当前不是 `main`/`master`，且目标远程确实是本仓库。
- 不要提交未被用户要求的未跟踪文件、密钥、环境文件、个人路径或无关改动。
- 不要改写历史，不要 force-push，不要直接推送 `main`。
- 创建 PR 属于外部写操作：在执行 `git push` 和 `gh pr create` 前，向用户简要说明将推送的分支与目标，并请求确认；若用户已经明确要求“提 PR”，可视为对本次 PR 操作的确认，但仍要在发现高风险（错误仓库、敏感文件、巨大无关 diff）时暂停。
- 合并不是创建 PR 的默认动作。除非用户明确要求合并，不要执行 `gh pr merge`。
- PR 被合并时必须使用 `gh pr merge ... --delete-branch`，或在合并已由他人完成后删除对应远程和本地源分支；删除前确认 PR 的 `state` 为 `MERGED`，绝不删除未合并分支。

## 与 GitHub 自动化 publisher 的边界（必读）

| 模式 | 谁 push/开 PR | 身份 | Closing 契约 |
| --- | --- | --- | --- |
| **Manual（本 Skill）** | 当前用户 `gh` / git | 操作者本人 | 关联 Issue 可写“暂无”；有议题时**推荐**同仓库 `Fixes #N` |
| **Automation runner publisher** | server-owned GitHub App（`github-git-publisher`） | App installation；**不是**本机 personal token | **必须**且仅有一条同仓库 `Fixes #N`；创建前按 head/base 复用已有 PR；**不** merge、**不**关 Issue |

- 本 Skill **保持 manual 流程不变**；不要在 manual 路径改用 App installation token。
- 当分支名匹配 `ypi/gha/...` 或任务上下文标明 GitHub unattended automation 时：**不要**由 agent/本 Skill 自行 `git push` / `gh pr create`；发布由 server publisher 在 final diff + validation 通过后执行。
- Automation PR 正文禁止跨仓库 closing（如 `Fixes other/repo#1`），禁止用“关联 Issue：暂无”代替 `Fixes #N`。
- full agent 残留风险：即使随后由 server 发布，执行期副作用也不由本 Skill 撤销。

## 固定流程

### 1. 检查仓库和变更

```bash
git status --short --branch
git branch --show-current
git remote -v
git diff --stat main...HEAD
git diff --name-status main...HEAD
```

若当前分支是 `main`、没有提交差异、存在疑似敏感文件，或远程仓库无法确认，停止并向用户报告。检查提交记录：

```bash
git log --oneline --decorate -n 20 main..HEAD
```

### 2. 运行项目验证

优先读取项目 `AGENTS.md` 和相关文档，按项目规定运行验证。对于本项目，至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

失败时不要创建“看起来已通过”的 PR；在正文中如实记录失败项，并先询问用户是否仍要提交。

### 3. 推送当前分支

确认当前分支名为 `<source-branch>`，目标为 `<remote>/main` 后：

```bash
git push -u <remote> <source-branch>
```

通常选择承载本仓库的 `origin`；若 remote 有歧义，先询问用户，不要猜测。

### 4. 生成固定 PR 标题和正文

标题格式固定为：

```text
<类型>：<一句话概括核心变更>
```

类型只能从 `新增`、`修复`、`优化`、`重构`、`文档`、`测试`、`其他` 中选择。标题简洁、中文、不要带句号和 PR 编号。

正文必须严格使用以下 Markdown 结构；未知内容写“暂无”并说明原因，不得删除章节：

```markdown
## 一、变更概述
<!-- 用 1～3 句话说明为什么改、改了什么、解决了什么问题。 -->

## 二、主要变更
- <变更点 1>
- <变更点 2>

## 三、影响范围
- **涉及模块：** <模块、目录或 API>
- **用户影响：** <用户可见变化；无则写“无直接用户可见变化”>
- **兼容性：** <兼容性、迁移或配置说明；无则写“无”>

## 四、实现说明
1. <关键实现或设计决策>
2. <数据流、接口、交互或边界处理>

## 五、验证结果
- [x] `npm run lint`：通过
- [x] `node_modules/.bin/tsc --noEmit`：通过
- [ ] <其他验证>：<通过 / 失败 / 未执行及原因>

## 六、风险与注意事项
- **风险：** <风险；无则写“暂无已知风险”>
- **发布/部署注意：** <需要关注的事项；无则写“无”>
- **回滚方式：** <回滚方式；无则写“按 GitHub PR 回滚合并提交”>

## 七、关联信息
- **关联 Issue：** <#编号或“暂无”>；若本 PR 用于关闭同仓库议题，正文中另需独立一行 `Fixes #N`（推荐，便于 GitHub Development）
- **测试说明：** <测试数据、手工步骤或“见验证结果”>
- **源分支：** `<source-branch>`
- **目标分支：** `main`

> Automation 发布路径（非本 Skill）强制：正文有且仅有一条同仓库 `Fixes #N`，且含 `<!-- ypi-github-automation:pr-contract v1 -->` marker。

## 八、提交确认
- [ ] 已确认变更范围与 PR 描述一致
- [ ] 已确认不存在密钥、Token、个人隐私或无关文件
- [ ] PR 合并后删除源分支
```

注释可以保留，也可以在提交前移除；章节、顺序和字段必须保留。根据实际 diff 填充，不要捏造测试、Issue、风险或兼容性结论。

### 5. 创建 PR

先检查是否已有同源分支 PR：

```bash
gh pr list --head <source-branch> --state open --json number,url,title,baseRefName,headRefName
```

若不存在，使用文件避免 shell 转义问题：

```bash
cat > /tmp/pr-body.md <<'EOF'
<按固定模板填写的正文>
EOF
gh pr create --base main --head <source-branch> --title '<中文标题>' --body-file /tmp/pr-body.md
```

如果已有开放 PR，不要重复创建；检查其 base 是否为 `main`，必要时向用户报告并提供 URL。

### 6. 合并后的分支清理

只有用户明确要求合并，且所有保护条件满足时才执行：

```bash
gh pr merge <number> --squash --delete-branch
```

若 PR 已经由他人合并，先确认：

```bash
gh pr view <number> --json state,mergedAt,headRefName,baseRefName
```

仅当 `state` 为 `MERGED` 且 `baseRefName` 为 `main` 时删除源分支：

```bash
git push <remote> --delete <source-branch>
git branch -d <source-branch>
```

如果远程分支已被 GitHub 自动删除，跳过远程删除并继续清理本地分支；如果本地当前正位于源分支，先切换到 `main` 再删除。

## 最终报告格式

完成后始终使用中文报告：

```markdown
## PR 创建结果
- **标题：** <标题>
- **地址：** <PR URL>
- **源分支：** `<source-branch>`
- **目标分支：** `main`
- **验证：** <通过项 / 失败项>
- **分支清理：** <待合并后执行 / 已删除 / 未执行及原因>
- **阻塞事项：** <暂无或具体事项>
```

报告必须如实区分“已创建 PR”和“已合并 PR”；不能把审批、创建和合并混为一谈。
