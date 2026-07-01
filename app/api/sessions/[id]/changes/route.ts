import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { listSessionChangedFiles } from "@/lib/session-file-changes";
import type { SessionChangesSummaryResponse } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const changes = listSessionChangedFiles(id);
    const response: SessionChangesSummaryResponse = {
      sessionId: id,
      updatedAt: changes.updatedAt,
      files: changes.files,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
