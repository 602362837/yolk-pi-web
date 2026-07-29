/**
 * Next.js instrumentation — Node server lifecycle hooks.
 *
 * HNR-03: when a Node server process starts, fire-and-forget ensure the GitHub
 * Issue Analysis durable scheduler so overdue queued / retry_due / stale-running
 * schema-v2 jobs resume without a second webhook or manual Retry.
 *
 * Constraints:
 * - Node runtime only (`NEXT_RUNTIME === "nodejs"`). Edge/build must not start.
 * - Fire-and-forget: never block Next ready on durable-queue I/O.
 * - Multi-process safe: each process may ensure; filesystem job lease + fencing
 *   de-duplicates handler side effects.
 * - status/verify GET remain read-only and do not call this path.
 * - Never reads or logs secrets, paths, Issue bodies, tokens, or stacks.
 */

export async function register(): Promise<void> {
  // Next sets NEXT_RUNTIME for server instrumentation. Guard both edge and any
  // unexpected non-node context (including some build-time evaluations).
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Dynamic import keeps the edge/build graph free of the scheduler module tree.
  // Fire-and-forget: do not await ensure work beyond module load; ensure itself
  // schedules background rescans and must not delay request readiness.
  try {
    const { ensureGithubAutomationScheduler } = await import(
      "./lib/github-automation-scheduler"
    );
    ensureGithubAutomationScheduler();
  } catch {
    // Startup reconcile is best-effort. A failure here must not crash the server;
    // webhook enqueue / manual Retry remain alternate recovery paths.
  }
}
