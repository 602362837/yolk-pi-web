# Design: Git Status Panel

## Summary

在中央聊天区顶部栏新增 Git dropdown panel，复用现有 `activeTopPanel` 互斥机制。新建一个只读 API 获取 Git 状态数据，前端组件负责渲染。

## Data Flow

```
Browser (GitPanel)
  │
  ├─ fetch GET /api/git/status?cwd=xxx ──▶ Next.js API Route
  │                                          │
  │                                          ├─ git status --porcelain=v2 --branch
  │                                          ├─ git log --oneline -10
  │                                          ├─ git stash list
  │                                          └─ git rev-parse (worktree detection)
  │
  ◀── { status: GitStatusInfo | null } ─────┘
```

## Type Contract — `lib/types.ts`

```typescript
export interface GitFileChange {
  status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
  file: string;
  oldFile?: string;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  relativeDate: string;
}

export interface GitStatusInfo {
  branch: string | null;
  upstream: string | null;
  isDetached: boolean;
  isDirty: boolean;
  isWorktree: boolean;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  recentCommits: GitCommitInfo[];
  stashCount: number;
}
```

## API: `GET /api/git/status`

- Query: `cwd` (required, absolute path)
- Response: `{ status: GitStatusInfo }` or `{ status: null }` if not a git repo
- 通过 `git rev-parse --show-toplevel` 验证 cwd 是否 git 仓库
- 并行调用 `git status`, `git log`, `git stash list` 加速响应
- 不使用 allowed-root 校验（与现有 `git/info` 路由一致）

## Component: `components/GitPanel.tsx`

- Props: `{ cwd: string | null; refreshKey?: number }`
- 内部管理 fetch 和状态
- `refreshKey` 变化时重新获取数据（用于 agent 结束后刷新）
- 分区渲染：Branch Status → Recent Commits → Staged → Unstaged → Untracked → Stash

## AppShell Integration

1. `activeTopPanel` type 增加 `"git"` 选项
2. 新增 `gitDirty` state 用于按钮上的状态指示
3. 新增 `gitRefreshKey` state，在 `onAgentEnd` 和 cwd 变化时递增
4. 顶部栏 Git 按钮放在 Subagents 按钮后面
5. dropdown 区域新增 `activeTopPanel === "git"` 渲染分支

## Refresh Strategy

| Trigger | Action |
|---------|--------|
| Panel opened | Fetch once |
| `onAgentEnd` fires | Increment `gitRefreshKey` |
| CWD changes | Reset state, fetch on next open |
| Manual refresh button | Re-fetch within panel |

不做轮询。
