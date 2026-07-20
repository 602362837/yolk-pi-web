/**
 * GET /api/links/[provider]/connections — list active connections
 *
 * Returns metadata-only connection summaries for the provider.
 * Does NOT open secret files, call GitHub, or expose credentials.
 *
 * Cache-Control: no-store
 */

import { NextResponse } from "next/server";
import type {
  LinksConnectionsResponse,
  LinkErrorResponse,
} from "@/lib/links-types";
import { listLinkConnections } from "@/lib/links-store";
import {
  ensureGitHubLinksAdapter,
  validateProviderParam,
  LINKS_REST_HEADERS,
  toLinkErrorResponse,
} from "@/lib/links-api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse<LinksConnectionsResponse | LinkErrorResponse>> {
  ensureGitHubLinksAdapter();

  const { provider: raw } = await params;
  const validated = validateProviderParam(raw);
  if (validated.errorResponse) return validated.errorResponse;
  const { provider } = validated;

  try {
    const connections = await listLinkConnections(provider);

    return NextResponse.json(
      { provider, connections },
      { headers: LINKS_REST_HEADERS },
    );
  } catch (err: unknown) {
    return toLinkErrorResponse(err);
  }
}
