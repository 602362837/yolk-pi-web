# Git panel branch preview

## Goal

Let the Git panel commit graph preview the locally selected branch without switching the workspace checkout. The existing explicit Switch button remains the only mutating branch-switch action.

## User Value

- Users can inspect another local branch's commit tree before deciding whether to switch.
- Dirty worktrees can still be inspected safely because previewing is read-only.
- The UI distinction between selecting a branch and switching to it is clearer.

## Requirements

- Selecting a local branch in the Git panel should refresh the commit graph to show that branch's history/perspective.
- Selecting a branch must not run `git switch` or mutate the workspace.
- The current explicit Switch button should continue to perform the actual guarded checkout.
- Default selection should be the current branch when available, avoiding misleading initial preview of a different branch.
- Dirty worktrees should still block actual switching, but should not block read-only graph preview.
- The graph API should validate preview branch names as local branches when a branch filter is provided.
- Existing Git status, dirty indicator, branch switch safety, and non-Git behavior should remain intact.

## Acceptance Criteria

- [ ] Git panel branch selector defaults to the current local branch when available.
- [ ] Changing the selected local branch reloads the commit graph for that branch without changing `status.branch`.
- [ ] Commit graph highlights/labels using the selected preview branch while the Branch status section still shows the real current branch.
- [ ] Switch button remains disabled for dirty worktrees and current-branch selection.
- [ ] Successful Switch still refreshes status and graph and resets preview to the new current branch.
- [ ] Non-Git directories still show the existing "Not a Git repository" state.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass or any pre-existing blockers are reported.

## Out of Scope

- Branch creation, deletion, rename, merge, rebase, pull, or push workflows.
- Previewing remote-only branches.
- Force checkout, stash, discard, or conflict resolution flows.
