import { NextRequest, NextResponse } from "next/server";
import { existsSync, realpathSync } from "fs";
import { resolve, sep } from "path";
import { getAgentDir } from "@/lib/session-reader";
import { parseSubagentChildren } from "@/lib/parse-subagent-children";

/**
 * GET /api/agent/subagent-children?sessionFile=<path>
 *
 * Reads a subagent's session JSONL file and returns its nested subagent tool calls.
 * Used by the SubagentPanel for recursive "expand → see children" display.
 */
export async function GET(request: NextRequest) {
  const sessionFile = request.nextUrl.searchParams.get("sessionFile");
  if (!sessionFile) {
    return NextResponse.json({ error: "sessionFile query parameter is required" }, { status: 400 });
  }

  // Validate: sessionFile must be within the agent sessions directory
  const sessionsDir = getAgentDir() + "/sessions";
  let resolvedPath: string;
  try {
    resolvedPath = resolve(sessionFile);
    if (!existsSync(resolvedPath)) {
      return NextResponse.json({ error: "Session file not found" }, { status: 404 });
    }
    resolvedPath = realpathSync(resolvedPath);
  } catch {
    return NextResponse.json({ error: "Invalid session file path" }, { status: 400 });
  }

  // Security: ensure the resolved path is within the sessions directory
  const resolvedSessionsDir = resolve(sessionsDir);
  if (!resolvedPath.startsWith(resolvedSessionsDir + sep) && !resolvedPath.startsWith(resolvedSessionsDir + "/")) {
    return NextResponse.json({ error: "Session file must be within the agent sessions directory" }, { status: 403 });
  }

  const children = parseSubagentChildren(resolvedPath);

  return NextResponse.json({ children });
}
