import { NextResponse } from "next/server";

import { AppearanceStoreError, projectAppearanceCatalog, readAppearanceCatalog, updateAppearanceIndex } from "@/lib/appearance-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(error: unknown) {
  if (error instanceof AppearanceStoreError) {
    const status = error.code === "revision_conflict" ? 409 : error.code === "skin_not_found" ? 404 : 500;
    return NextResponse.json({ error: "Appearance settings could not be updated", code: error.code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ error: "Appearance settings could not be updated", code: "storage_error" }, { status: 500, headers: NO_STORE });
}

function parseRevision(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(?:W\/)?"?([a-f0-9]{24})"?$/i);
  return match?.[1] ?? null;
}

function isExactActiveBody(value: unknown): value is { activeSkinId: string | null } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 && "activeSkinId" in value &&
    (((value as { activeSkinId?: unknown }).activeSkinId === null) || typeof (value as { activeSkinId?: unknown }).activeSkinId === "string");
}

export async function GET() {
  try {
    return NextResponse.json(projectAppearanceCatalog(await readAppearanceCatalog()), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const expectedRevision = parseRevision(request.headers.get("if-match"));
    const body = await request.json().catch(() => null) as unknown;
    if (!expectedRevision || !isExactActiveBody(body)) {
      return NextResponse.json({ error: "A revision and active skin id are required", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const result = await updateAppearanceIndex(expectedRevision, (index) => {
      if (body.activeSkinId !== null && !index.skins.some((skin) => skin.id === body.activeSkinId)) {
        throw new AppearanceStoreError("skin_not_found");
      }
      return { ...index, activeSkinId: body.activeSkinId };
    });
    return NextResponse.json(projectAppearanceCatalog(result), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
