# Checks：GitHub 自动化自循环与指令闭环

## 需求覆盖

- [x] App 自己的 `issue_comment.created/edited` delivery 被持久化为 ignored，零 job、零 generation、零 wake、零 GitHub mutation。
- [x] App 自己的 `issues.assigned/labeled/unlabeled/closed` 不进入 claim/triage。
- [x] human `issues.opened` 仅创建一个首代 job；delivery replay 不重复。
- [x] generation 只在 approved lifecycle/retry 条件增长。
- [x] human exact comment created/edited 能绑定 comment id/version；无关事件不会命中过去评论。
- [x] deleted/superseded comment 不产生授权。
- [x] same semantic canonical body 不 PATCH；动态 trace 不再进入 marker/body identity。
- [x] Owner command 有 receipt；状态推进有单一 status comment；公共内容不回显正文/hash/路径/凭据。
- [x] non-owner、Bot、claim incomplete、recommendation != yes、Issue closed、global paused 均 fail closed。
- [x] comment 永不修改 validation/branch/remote/publisher/global paused，永不直接注入 agent。

## Focused 自动测试

### Webhook/action matrix

1. [x] `issues.opened` human → exactly one job g1。
2. [x] 随后模拟 Bot `assigned`、4 次 `labeled`、comment `created`、100 次 `edited` → deliveries 全记录，job 仍 g1，handler/wake/mutation 计数不变。
3. [x] sender login 改名但 `performedViaAppId` 相同 → self ignored。
4. [x] 缺 performed app id、`sender.type=Bot` → conservative ignored。
5. [x] human `issue_comment.created/edited` → actionable；deleted → audit-only。
6. [x] Issue closed → lifecycle reconcile一次，不创建 g2；reopened 按批准规则创建/恢复新代。
7. [x] global paused → disposition paused，command parser/runner 不执行。

### Exact comment / command

- [x] 同一 comment id + body hash delivery 重放：一次 side effect、一次 receipt。
- [x] edited 后旧 delivery worker 回读新版本：旧版 `superseded`，只处理新版。
- [x] delivery sender 与 exact comment author 不同：拒绝。
- [x] 列表中存在历史“采纳”评论，但当前 delivery 是“状态”：只执行状态，不复用历史采纳。
- [x] quote/code/HTML comment 中的命令不生效；否定/疑问优先。
- [x] user-owned owner id、org ownerActorIds、non-owner、Bot actor matrix。
- [x] recommendation needs_info/no 不产生 ownerAuthorization；`重新评估` 仅使用最新 Issue title/body。
- [x] `重试/暂停/继续` 调用结构化函数，不把 comment body 传入 prompt/task/session/validation。

### Canonical remote effect

- [x] v2 marker repo/issue/kind 精确匹配；伪造其他 repo/issue marker 不复用。
- [x] v1 marker 可读取；无语义变化不执行纯迁移 PATCH。
- [x] body 完全相同：`writePerformed=false`，GitHub PATCH mock 计数 0。
- [x] body 语义变化：PATCH 恰好 1 次；其 self edited delivery 被入口忽略。
- [x] POST/PATCH timeout 后 re-list 已存在 marker：reconcile success，不重复 POST/PATCH。
- [x] 并发 worker under issue lease 只产生一个 receipt/status authority。

### Durable/state regression

- [x] 历史 schema v1 delivery/job/issue state 缺新字段可读且 fail closed。
- [x] terminal `not_adopted/completed` 遇到 label/comment self event不 generation++。
- [x] effect `intended → remote_confirmed/reconcile_needed` crash recovery。
- [x] 既有 PR merged / closed-unmerged lifecycle tests 通过。
- [x] g1–g80 历史文件不被测试/迁移重写。

## 自动验证命令（CHECK-06 re-run）

```bash
npm run test:github-automation   # pass 93/93
npm run test:github-unattended   # pass 18/18
npm run test:github-unattended-runner  # pass 14/14
npm run test:github-publish-policy     # pass 23/23
npm run lint                     # pass (0 errors; 11 pre-existing warnings)
node_modules/.bin/tsc --noEmit   # pass
```

不得直接运行 `next build`。本任务不是 release validation。

## Source/privacy scans

```bash
rg -n "issue_comment|performed_via_github_app|commentId|senderType|generation" \
  lib/github-* scripts/test-github-*.mjs
rg -n "commentBody|ownerComment|validationCommands|global.*paused|paused" \
  lib/github-* scripts/test-github-*.mjs
```

人工检查结果：

- [x] store/projection 不包含 raw Issue/comment body、signature、token、PEM、绝对路径、prompt/transcript（仅 opaque hash / denylist）。
- [x] command path 不写 `config.paused` / validation / branch / remote / publisher。

## 人工验收

### 当前 paused 期间（允许执行）

- [x] 不解除全局 paused（re-read `paused:true`）。
- [x] 用 fixture/mock 完成完整 self-loop 与 owner command 流程（focused suites）。
- [ ] 确认新的真实 self delivery 只显示 paused/ignored audit，不产生 job（需生产流量观察；非本轮自动化范围）。
- [ ] Settings recent jobs 不再因 self edited 增长（需部署后观察）。

### 用户批准维护窗口后（当前不可执行）

1. 用户明确决定是否解除 global paused；agent 不代替操作。
2. 在隔离测试 Issue 创建一次 human issue。
3. 观察一次 claim/triage 后至少 2 分钟：无新 generation、无重复 PATCH。
4. Owner 发 `状态`，确认 exact receipt；编辑同一评论，确认 receipt 更新而非新增。
5. 发一条批准范围内的 adoption/retry 命令，确认一次状态推进。
6. 关闭测试 Issue，确认无再 triage，active job按批准策略 fail closed。
7. 重新开启 global paused（若维护策略要求）并记录 delivery/job/comment ids；不记录正文/secret。

## UI / 内容验收

- [x] ui-designer 的 HTML 原型已生成并由用户批准。
- [x] triage comment 明示 command target 与支持命令。
- [x] receipt 的 accepted/rejected/paused/superseded/closed 文案没有“已执行”误报。
- [x] per-job 暂停与 global paused 明确区分。
- [x] App Bot 与 machine assignee 身份说明正确，Bot 不被描述为 assignee。
- [x] reason code 是次级信息，中文下一步清楚。

## 重点回归风险

- [x] 初始 claim 的 assignee + `ypi:claimed` + canonical triage comment 完整性不回归。
- [x] ownerAuthorization 仍要求 recommendation=yes、Issue open、complete claim。
- [x] unattended publisher、PR contract、validation broker 无 comment override。
- [x] manual triage 继续识别 automation claim，避免 dual write。
- [x] webhook 仍先验签后 parse，request thread 不运行 LLM/Git/GitHub mutation。
- [x] 管理面 API、Settings UI、global paused 没有被 Issue comment 间接修改。

## 停止条件

- 无法可靠取得 sender type/comment id/version；
- self event 仍能创建或唤醒 job；
- exact comment 回读无法区分 superseded；
- canonical body 相同仍 PATCH；
- 任一命令可改变 global paused/policy/validation/branch/remote；
- HTML 原型或用户审批缺失；
- focused tests、lint、tsc 出现与本改动相关失败。

**本轮停止条件均未触发。**

## Checker 结论

- **Verdict: Pass**
- Evidence: `review.md`
- Global paused remains **true**
- Live unpaused smoke: **not executed** (operator decision required)
