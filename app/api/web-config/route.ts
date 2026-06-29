import { NextResponse } from "next/server";
import {
  PiWebConfigValidationError,
  readPiWebConfigForApi,
  writePiWebConfigPatch,
} from "@/lib/pi-web-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readPiWebConfigForApi());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { worktree?: unknown; trellis?: unknown; usage?: unknown; chatgpt?: unknown };
    const result = writePiWebConfigPatch(body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PiWebConfigValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
