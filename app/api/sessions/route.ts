import { NextResponse } from "next/server";
import { listAllSessions, scanArchivedCwds } from "@/lib/session-reader";

export async function GET(req: Request) {
  try {
    const includeGit = new URL(req.url).searchParams.get("includeGit") === "1";
    const sessions = await listAllSessions({ includeGit });
    const { cwds: archivedCwds, counts: archivedCounts } = scanArchivedCwds();
    return NextResponse.json({ sessions, archivedCwds, archivedCounts });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
