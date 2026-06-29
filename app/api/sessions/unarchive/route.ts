import { NextResponse } from "next/server";
import {
  invalidateSessionPathCache,
  resolveSessionPath,
  unarchiveSessionFile,
} from "@/lib/session-reader";

export async function POST(req: Request) {
  try {
    const { sessionIds } = (await req.json()) as { sessionIds: string[] };
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return NextResponse.json({ error: "sessionIds must be a non-empty array" }, { status: 400 });
    }

    const unarchived: Array<{ id: string; path: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of sessionIds) {
      try {
        const filePath = await resolveSessionPath(id);
        if (!filePath) {
          errors.push({ id, error: "Session not found" });
          continue;
        }
        if (!filePath.includes("/sessions-archive/")) {
          errors.push({ id, error: "Session is not archived" });
          continue;
        }
        const newPath = unarchiveSessionFile(filePath);
        invalidateSessionPathCache(id);
        unarchived.push({ id, path: newPath });
      } catch (error) {
        errors.push({ id, error: String(error) });
      }
    }

    return NextResponse.json({ unarchived, errors });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
