import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";

export async function GET(req: Request) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const includeGit = searchParams.get("includeGit") === "1";
    const includeStudioChildren = searchParams.get("includeStudioChildren") === "1";
    const sessions = await listAllSessions({ includeGit, includeStudioChildren });
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
