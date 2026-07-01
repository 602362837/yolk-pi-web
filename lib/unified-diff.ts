import { createTwoFilesPatch } from "diff";

const MAX_DIFF_BYTES = 1024 * 1024;

export interface UnifiedDiffResult {
  diff: string;
  additions: number;
  deletions: number;
  truncated: boolean;
}

function countChangedLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (Buffer.byteLength(diff, "utf8") <= MAX_DIFF_BYTES) return { diff, truncated: false };
  let bytes = 0;
  const lines: string[] = [];
  for (const line of diff.split("\n")) {
    const lineBytes = Buffer.byteLength(line + "\n", "utf8");
    if (bytes + lineBytes > MAX_DIFF_BYTES) break;
    lines.push(line);
    bytes += lineBytes;
  }
  lines.push("", `... diff truncated at ${MAX_DIFF_BYTES} bytes ...`);
  return { diff: lines.join("\n"), truncated: true };
}

export function createUnifiedDiff(path: string, before: string, after: string): UnifiedDiffResult {
  if (before === after) {
    return { diff: "", additions: 0, deletions: 0, truncated: false };
  }

  const patch = createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    before,
    after,
    undefined,
    undefined,
    { context: 3 },
  );
  const fullDiff = patch.trimEnd();
  const counts = countChangedLines(fullDiff);
  const { diff, truncated } = truncateDiff(fullDiff);
  return { diff, additions: counts.additions, deletions: counts.deletions, truncated };
}
