import { NextResponse } from "next/server";
import { listArchivedSessionsForCwd } from "@/lib/session-reader";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd query parameter is required" }, { status: 400 });
    }

    const sessions = await listArchivedSessionsForCwd(cwd);
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
