import { NextResponse } from "next/server";
import {
  getStudioChildSessionListForParent,
  StudioChildSessionListError,
} from "@/lib/studio-child-session-list";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

// GET /api/sessions/:id/studio-children
// Read-only, bounded projection of high-confidence YPI Studio child audit sessions
// for one parent Chat. Never returns path/cwd/sessionFile/transcript/content.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await getStudioChildSessionListForParent(id);
    return NextResponse.json(body, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof StudioChildSessionListError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "Failed to load studio child sessions" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
