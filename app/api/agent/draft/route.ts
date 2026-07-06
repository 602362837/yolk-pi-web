import { NextResponse } from "next/server";
import { AgentSessionBootstrapError, createConfiguredEmptyAgentSession } from "@/lib/agent-session-bootstrap";

// POST /api/agent/draft  body: { cwd: string; toolNames?: string[]; provider?: string; modelId?: string; thinkingLevel?: string }
// Creates a real pi session without sending a prompt so features such as
// Browser Share can bind before the first user message.
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: string;
      provider?: string;
      modelId?: string;
      toolNames?: string[];
      thinkingLevel?: string;
    };

    const { sessionId } = await createConfiguredEmptyAgentSession({
      cwd: body.cwd,
      provider: body.provider,
      modelId: body.modelId,
      toolNames: body.toolNames,
      thinkingLevel: body.thinkingLevel,
      applyAutoThinkingLevel: false,
    });

    return NextResponse.json({ success: true, sessionId });
  } catch (error) {
    if (error instanceof AgentSessionBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
