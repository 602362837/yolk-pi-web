# Dynamic browser tab title by workspace

## Goal

Update the browser document title to follow the currently selected project workspace name.

## Requirements

- The browser tab title should include the basename of the current workspace/cwd and the current Git branch when available.
- The current workspace should be resolved from the active saved session cwd, new-session cwd, or sidebar-selected cwd.
- When no workspace can be resolved, the title should fall back to the product title.
- Git branch lookup may use a lightweight API because browser code cannot run Git directly.
- Use `{project-name}({branch})` for regular repositories and `{project-name}.worktree({branch})` for Git worktrees when branch information is known.
- Show a compact project-name-only title in the sidebar header above the action buttons, with a grey second line describing branch/worktree source information.
- Sidebar title and subtitle should reveal their full details on hover or keyboard focus.

## Acceptance Criteria

- [x] Selecting/opening a session under a workspace updates `document.title` to `<project-name>(${branch})` when branch information is known.
- [x] Switching the selected project workspace updates the browser title and sidebar header.
- [x] Missing/unknown workspace falls back to `pi-web`.
- [x] Lint/type-check pass for modified code, or any environment blockers are reported.
