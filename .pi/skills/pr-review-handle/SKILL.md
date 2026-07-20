---
name: pr-review-handle
description: >
  Claim, label, review, and merge (or request changes on) a GitHub Pull Request
  for this repo using gh. Use whenever the user provides a PR URL, PR number/id,
  or asks to 认领/审核/审查/处理/合并 PR, review a pull request, approve merge,
  request changes, or add labels on a PR — even if they only paste a link like
  https://github.com/org/repo/pull/123 or say "处理一下 #42". If the user does
  not identify a specific PR, first list the repository's open PRs and ask them
  to choose one. Prefer this skill over ad-hoc gh commands for the full
  claim→label→review→merge/reject flow.
---

# PR Review Handle (project)

Handle an inbound GitHub PR end-to-end for **yolk-pi-web / pi-agnet-web**: claim → label → review with an explicit merge decision → approve+merge **or** request changes with written reasons.

## When this skill applies

- User pastes a PR URL or number (`#12`, `12`, full `https://github.com/.../pull/12`).
- User asks to 认领、打标签、审核、review、approve、合并、拒绝合并、request changes.
- Default product context is this workspace; resolve the concrete `owner/repo` from the PR URL when present.

## Preconditions

1. Confirm `gh` auth before mutating the PR:
   ```bash
   gh auth status
   ```
   If not logged in, stop and ask the user to run `gh auth login` (need `repo` scope; merge may need write access on the target repo).
2. Never force-push, never push to `upstream` unless the user explicitly asks.
3. Never merge when checks are failing, the PR is draft, or merge is blocked — report the blocker and stop.
4. Do not invent review findings. Base comments on actual diff / CI / project invariants (`AGENTS.md`, `docs/`).

## Resolve the PR

### If the user did not specify a PR

Before asking which PR to handle, proactively query the current repository's open PR list. Do not claim, label, review, comment on, or merge anything until the user selects a PR. Resolve the repository from the primary remote (prefer `upstream`, otherwise `origin`) and run:

```bash
REMOTE_URL="$(git remote get-url upstream 2>/dev/null || git remote get-url origin)"
REPO="$(printf '%s' "$REMOTE_URL" | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\\.git$##')"
gh pr list --repo "$REPO" --state open --limit 100 \
  --json number,title,headRefName,baseRefName,url \
  --jq '(["| id | 标题 | source merge to target | pr链接 |","|---:|---|---|---|"] + [.[] | "| \(.number) | \(.title | gsub("\\|"; "\\\\|")) | \(.headRefName) merge to \(.baseRefName) | \(.url) |"] | .[])'
```

Present the result as this Markdown table, preserving these columns:

```markdown
| id | 标题 | source merge to target | pr链接 |
|---:|---|---|---|
| 123 | 示例标题 | feature/example merge to main | https://github.com/OWNER/REPO/pull/123 |
```

Then ask the user to provide the PR `id` (or URL) to handle. If no open PRs are found, say so explicitly and ask whether they want to provide a closed PR or another repository. If listing fails because `gh` is unauthenticated or the remote cannot be resolved, report that blocker instead of guessing.

### If the user specified a PR

Accept any of:

| Input | How to resolve |
| --- | --- |
| Full URL | Parse `owner`, `repo`, `number` from `https://github.com/{owner}/{repo}/pull/{n}` |
| Bare number / `#n` | Use this project's primary remote repo (prefer the remote that hosts the PR; usually `upstream` = `twofive1203/pi-agnet-web`, else `origin`) |
| `owner/repo#n` | Use as given |

Normalize once and reuse:

```bash
# From URL
PR_URL='https://github.com/OWNER/REPO/pull/N'
# Or:
gh pr view N --repo OWNER/REPO --json number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,author,assignees,labels,baseRefName,headRefName,commits,statusCheckRollup,body
```

Always pin `--repo OWNER/REPO` (or work from a checkout of that repo) so fork vs upstream is never ambiguous.

Fetch a working snapshot before acting:

```bash
gh pr view "$N" --repo "$OWNER/$REPO" \
  --json number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,author,assignees,labels,baseRefName,headRefName,commits,files,statusCheckRollup,body,additions,deletions,changedFiles
gh pr diff "$N" --repo "$OWNER/$REPO"
gh pr checks "$N" --repo "$OWNER/$REPO" || true
```

If `state` is not `OPEN`, stop and report (already merged/closed).

## Workflow (strict order)

### 1) Claim the PR

Goal: make the current GitHub user the assignee (认领), so ownership is visible.

```bash
ME="$(gh api user --jq .login)"
gh pr edit "$N" --repo "$OWNER/$REPO" --add-assignee "$ME"
```

Notes:

- If the API rejects assignee (user not a collaborator), report it; do not fake claim. Optionally still continue review if the user wants, but say claim failed.
- If already assigned to `$ME`, skip edit and note "already claimed".
- Do **not** remove other assignees unless the user asks.

### 2) Apply labels

Infer labels from title/body/diff, then apply. Prefer existing repo labels only.

List labels first:

```bash
gh label list --repo "$OWNER/$REPO" --limit 100
```

Common defaults on this project (create only if missing **and** user agrees):

| Situation | Label |
| --- | --- |
| Bug fix | `bug` |
| Feature / enhancement | `enhancement` |
| Docs only | `documentation` |
| Duplicate of another PR | `duplicate` |
| Invalid / wrong target | `invalid` |
| Explicitly will not take | `wontfix` |

Apply:

```bash
gh pr edit "$N" --repo "$OWNER/$REPO" --add-label "enhancement"
# multiple:
gh pr edit "$N" --repo "$OWNER/$REPO" --add-label "bug" --add-label "documentation"
```

Rules:

- Do not invent label names that do not exist on the repo.
- If inference is ambiguous, pick the best single label and state the choice in the final summary (or ask when risk of mislabel is high).
- Do not strip existing labels unless the user asks.

### 3) Review the PR (always write a review comment + merge verdict)

Read enough of the change to judge merge readiness against this repo's contracts:

- `AGENTS.md` invariants (session wrappers, normalize path, no `next build` in dev advice, exact-pinned pi deps, CredentialStore/ModelRuntime boundary, cacheWrite deprecation, etc.)
- Relevant `docs/modules/*`, `docs/architecture/*` for the touched area
- CI / `gh pr checks`
- Scope: unrelated drive-by changes, secrets, lockfile noise, missing docs when public surface changes

Produce a **structured review body** (Chinese or English matching the user; default Chinese if user wrote Chinese):

```markdown
## 审查结论
- 合并建议: **允许合并** | **不允许合并**
- 认领: @<me>
- Labels: …

## 变更摘要
- …

## 检查项
- [ ] 范围与 PR 描述一致
- [ ] 无密钥 / 本地路径 / token 泄漏
- [ ] 触及公共 API / UI / 配置时文档或说明是否跟上
- [ ] 与 AGENTS.md 不变量无冲突
- [ ] CI / checks 状态

## 具体意见
1. …
2. …

## 合并门槛
- 允许: 无阻塞问题；checks 可通过；非 draft
- 不允许: 列出必须修改项（阻塞）与可选建议（非阻塞）
```

Submit the review **with an explicit GitHub event**:

| Verdict | `gh` event | Meaning |
| --- | --- | --- |
| 允许合并 | `--approve` | Approve |
| 不允许合并 | `--request-changes` | Request changes (preferred over plain comment) |
| 仅评论、暂不裁决 | `--comment` | Only if user asked for comment-only |

```bash
# Approve path (step 5 continues to merge)
gh pr review "$N" --repo "$OWNER/$REPO" --approve --body "$(cat <<'EOF'
## 审查结论
- 合并建议: **允许合并**
...
EOF
)"

# Reject path (step 4)
gh pr review "$N" --repo "$OWNER/$REPO" --request-changes --body "$(cat <<'EOF'
## 审查结论
- 合并建议: **不允许合并**
...
EOF
)"
```

### 4) If merge is **not** allowed — reinforce with a follow-up comment

After `--request-changes`, post **one additional PR comment** that restates the blocking reasons in a short, actionable list (this is the "再写一条理由" step; use a comment, not a git commit, unless the user explicitly asked you to push fix commits).

```bash
gh pr comment "$N" --repo "$OWNER/$REPO" --body "$(cat <<'EOF'
### 暂不合并说明
本次审查 **不通过**，请先处理以下阻塞项后再 @ 我复审：

1. [阻塞] …
2. [阻塞] …

非阻塞建议：
- …

复审时请附上对应 commit / 回复线程。
EOF
)"
```

Then **stop**. Do not merge. Do not approve.

Only if the user explicitly asks to **push fix commits** on their behalf:

- Check out the PR branch with `gh pr checkout`
- Implement fixes, commit with a clear message, push to the **PR head remote/branch**
- Leave another comment listing what you fixed  
Do not do this on the reject path by default.

### 5) If merge **is** allowed — approve (if not already) and merge

Pre-merge gates (all must hold):

- PR is open and not draft (`isDraft == false`)
- Review event was approve
- `mergeable` is not `CONFLICTING`
- Checks: no failing required checks (if checks still pending, wait or ask the user; do not merge over red X)
- User did not forbid auto-merge

Merge strategy (default for this project):

```bash
# Prefer squash for feature branches unless user/repo policy says otherwise
gh pr merge "$N" --repo "$OWNER/$REPO" --squash --delete-branch
```

Fallbacks:

- If squash is disabled: try `--merge` (merge commit)
- If the user asked for rebase: `--rebase`
- If merge fails (policy, rights, branch protection), report the raw error and stop — do not force

Optional when branch protection requires it and the user asked for auto-merge:

```bash
gh pr merge "$N" --repo "$OWNER/$REPO" --squash --auto --delete-branch
```

## Output back to the user

After the flow, always summarize:

1. PR identity: title, `OWNER/REPO#N`, URL  
2. Claim: assignee result  
3. Labels added  
4. Verdict: 允许合并 / 不允许合并  
5. Actions taken: review type, extra comment (if any), merge result (sha / merged / blocked)  
6. Blockers remaining (if any)

## Decision cheat sheet

```
PR input
  → auth + resolve OWNER/REPO#N
  → claim (assign self)
  → label (existing labels only)
  → read diff + checks + AGENTS invariants
  → write review with explicit 允许/不允许
       ├─ 不允许 → request-changes + follow-up comment → STOP
       └─ 允许   → approve → gate checks → squash merge → report
```

## Safety / anti-patterns

- Do not approve+merge without reading the diff.
- Do not use `gh pr merge --admin` unless the user explicitly requests admin override.
- Do not dismiss others' reviews.
- Do not change base branch or close the PR unless asked.
- Do not paste secrets from local env into review comments.
- Treat "commit 写出理由" in user shorthand as **review/comment reasons**, not an empty git commit, unless they clearly want code commits.

## Quick command kit

```bash
# Identity
gh api user --jq .login

# Snapshot
gh pr view N --repo OWNER/REPO --json number,url,title,state,isDraft,mergeable,assignees,labels,statusCheckRollup

# Claim + label
gh pr edit N --repo OWNER/REPO --add-assignee @me --add-label enhancement

# Review
gh pr review N --repo OWNER/REPO --approve --body "…"
gh pr review N --repo OWNER/REPO --request-changes --body "…"
gh pr comment N --repo OWNER/REPO --body "…"

# Merge
gh pr merge N --repo OWNER/REPO --squash --delete-branch
```
