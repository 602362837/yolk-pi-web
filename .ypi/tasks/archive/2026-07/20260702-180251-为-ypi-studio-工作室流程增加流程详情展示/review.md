# review

## Check Complete

### Findings Fixed

- 修复 `lib/ypi-studio-workflow-flow.ts`：当当前任务落在 `changes_requested / blocked / cancelled` 等非主路径状态时，原排序会把该状态直接拼到末尾，导致详情流里出现不存在的相邻边（如 `ready → changes_requested`）和误导性 warning。现在改为优先插入到真实来源节点之后，并截断后续 happy path，任务流程区块与流程详情能正确反映当前路线。

### Remaining Findings

- None.

### Verification

- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed

### Verdict

- Pass — 实现已覆盖 workflow flow helper、Workflows 详情切换、Task detail 当前流程区块、类型与文档更新；静态验证通过。
