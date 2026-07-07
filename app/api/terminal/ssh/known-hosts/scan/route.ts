import { NextResponse } from "next/server";
import { scanTerminalKnownHost, TerminalKnownHostsError } from "@/lib/terminal-known-hosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { host?: unknown; port?: unknown; timeoutMs?: unknown };
    const result = await scanTerminalKnownHost(body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TerminalKnownHostsError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
