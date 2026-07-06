import { NextResponse } from "next/server";
import { AgentSessionBootstrapError, createConfiguredEmptyAgentSession } from "@/lib/agent-session-bootstrap";

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };
    const { session, sessionId } = await createConfiguredEmptyAgentSession({
      cwd,
      provider,
      modelId,
      toolNames,
      thinkingLevel,
    });

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId, data: result });
  } catch (error) {
    if (error instanceof AgentSessionBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
