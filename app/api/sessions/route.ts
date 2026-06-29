import { NextResponse } from "next/server";
import { listAllSessions, scanArchivedCwds } from "@/lib/session-reader";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    const { cwds: archivedCwds, counts: archivedCounts } = scanArchivedCwds();
    return NextResponse.json({ sessions, archivedCwds, archivedCounts });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
