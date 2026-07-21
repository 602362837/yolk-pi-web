import { NextResponse } from "next/server";

import { AppearanceStoreError, deleteAppearanceSkin, projectAppearanceCatalog, updateAppearanceIndex } from "@/lib/appearance-store";
import { sanitizeAppearanceName, validateAppearancePresentation } from "@/lib/appearance-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
interface RouteContext { params: Promise<{ id: string }>; }

function errorResponse(error: unknown) {
  if (error instanceof AppearanceStoreError) {
    const status = error.code === "revision_conflict" || error.code === "skin_active" ? 409 : error.code === "skin_not_found" ? 404 : 500;
    return NextResponse.json({ error: "The appearance catalog could not be updated", code: error.code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ error: "The appearance catalog could not be updated", code: "storage_error" }, { status: 500, headers: NO_STORE });
}

function parseRevision(value: string | null): string | null {
  const match = value?.trim().match(/^(?:W\/)?"?([a-f0-9]{24})"?$/i);
  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPatch(body: unknown): body is { name?: string; presentation?: unknown } {
  if (!isRecord(body)) return false;
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((key) => key === "name" || key === "presentation") &&
    (body.name === undefined || typeof body.name === "string") &&
    (body.presentation === undefined || validateAppearancePresentation(body.presentation) !== null);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const expectedRevision = parseRevision(request.headers.get("if-match"));
    const body = await request.json().catch(() => null) as unknown;
    const { id } = await context.params;
    if (!expectedRevision || !validPatch(body)) {
      return NextResponse.json({ error: "A revision and valid skin update are required", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const name = body.name === undefined ? undefined : sanitizeAppearanceName(body.name);
    const presentation = body.presentation === undefined ? undefined : validateAppearancePresentation(body.presentation);
    if ((body.name !== undefined && !name) || (body.presentation !== undefined && !presentation)) {
      return NextResponse.json({ error: "The skin update is invalid", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const result = await updateAppearanceIndex(expectedRevision, (index) => {
      const skin = index.skins.find((item) => item.id === id);
      if (!skin) throw new AppearanceStoreError("skin_not_found");
      return {
        ...index,
        skins: index.skins.map((item) => item.id === id ? {
          ...item,
          ...(name ? { name } : {}),
          ...(presentation ? { presentation } : {}),
          updatedAt: new Date().toISOString(),
        } : item),
      };
    });
    return NextResponse.json(projectAppearanceCatalog(result), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const expectedRevision = parseRevision(request.headers.get("if-match"));
    const body = await request.json().catch(() => ({})) as unknown;
    const { id } = await context.params;
    if (!expectedRevision || !isRecord(body) || Object.keys(body).some((key) => key !== "deactivateActive") || (body.deactivateActive !== undefined && typeof body.deactivateActive !== "boolean")) {
      return NextResponse.json({ error: "A revision and valid delete request are required", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const result = await deleteAppearanceSkin({ expectedRevision, id, deactivateActive: body.deactivateActive === true });
    return NextResponse.json(projectAppearanceCatalog(result), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
