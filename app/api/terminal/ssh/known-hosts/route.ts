import { NextResponse } from "next/server";
import {
  listTerminalKnownHosts,
  parseTerminalKnownHostTrustBody,
  removeTerminalKnownHost,
  TerminalKnownHostsError,
  trustTerminalKnownHost,
} from "@/lib/terminal-known-hosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TerminalKnownHostsError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const result = await listTerminalKnownHosts();
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as unknown;
    const input = parseTerminalKnownHostTrustBody(body);
    const result = await trustTerminalKnownHost(input);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { host?: unknown; port?: unknown; fingerprint?: unknown; index?: unknown };
    const result = await removeTerminalKnownHost(body);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
