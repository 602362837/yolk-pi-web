import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { getSessionFileDiff } from "@/lib/session-file-changes";

function isSafeRelativePath(filePath: string): boolean {
  if (!filePath || filePath.startsWith("/") || filePath.startsWith("\\")) return false;
  return !filePath.split(/[\\/]+/).some((part) => part === "..");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const sessionPath = await resolveSessionPath(id);
    if (!sessionPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const filePath = url.searchParams.get("path") ?? "";
    if (!isSafeRelativePath(filePath)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    const diff = getSessionFileDiff(id, filePath);
    if (!diff) {
      return NextResponse.json({ error: "File change not found" }, { status: 404 });
    }
    return NextResponse.json(diff);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
