import { writeSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorktreeCheckExecutionController } from "./worktree-check-execution";
import { createWorktreeCheckPolicyExtension, registerWorktreeCheckCliTools, safeProjection, worktreeCheckPolicyHandshake } from "./worktree-check-extension";

const root = process.env.YPI_WORKTREE_CHECK_ROOT;
const resultFd = Number(process.env.YPI_WORKTREE_CHECK_RESULT_FD);
const expectedHandshake = process.env.YPI_WORKTREE_CHECK_POLICY;
const invocationFence = process.env.YPI_WORKTREE_CHECK_RESULT_FENCE;

/**
 * CLI-only server asset. It accepts only parent-created environment values and
 * never reads project extensions, skills, prompts, or context files.
 */
export default async function registerWorktreeCheckCliExtension(pi: ExtensionAPI): Promise<void> {
  if (!root || !Number.isInteger(resultFd) || resultFd < 3 || !invocationFence || expectedHandshake !== worktreeCheckPolicyHandshake()) {
    throw new Error("check_runner_policy_unavailable");
  }
  const controller = new WorktreeCheckExecutionController({
    worktreePath: root,
    env: process.env,
    allowMainWorktree: process.env.YPI_WORKTREE_CHECK_ALLOW_MAIN === "1",
  });
  const leased = await controller.acquireLease();
  if (!leased) throw new Error("check_execution_lease_timeout");
  let finalized = false;
  const finalize = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    try {
      // fd 3 is a parent-owned pipe and is not inherited by repository commands.
      const frame = JSON.stringify({ protocol: "ypi-worktree-check-result-v1", policy: worktreeCheckPolicyHandshake(), fence: invocationFence, result: safeProjection(controller.finalize()) });
      if (Buffer.byteLength(frame, "utf8") > 64 * 1024) throw new Error("check_runner_policy_unavailable");
      writeSync(resultFd, frame, null, "utf8");
    } finally {
      await controller.releaseLease();
    }
  };
  createWorktreeCheckPolicyExtension()(pi);
  registerWorktreeCheckCliTools(pi, controller);
  pi.on("agent_settled", async () => { await finalize(); });
  pi.on("session_shutdown", async () => { await finalize(); });
}
