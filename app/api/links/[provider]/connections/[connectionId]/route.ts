/**
 * DELETE /api/links/[provider]/connections/[connectionId] — disconnect
 *
 * Soft-deletes the connection metadata, quarantines and removes the
 * OAuth secret file. Does NOT revoke the GitHub remote OAuth grant.
 *
 * Cache-Control: no-store
 */

import { NextResponse } from "next/server";
import type {
  LinkDisconnectResponse,
  LinkErrorResponse,
} from "@/lib/links-types";
import { disconnectLinkConnection } from "@/lib/links-store";
import {
  ensureGitHubLinksAdapter,
  validateProviderParam,
  validateOpaqueIdParam,
  LINKS_REST_HEADERS,
  toLinkErrorResponse,
} from "@/lib/links-api-helpers";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string; connectionId: string }> },
): Promise<NextResponse<LinkDisconnectResponse | LinkErrorResponse>> {
  ensureGitHubLinksAdapter();

  const { provider: rawProvider, connectionId: rawConnectionId } = await params;

  const validatedProvider = validateProviderParam(rawProvider);
  if (validatedProvider.errorResponse) return validatedProvider.errorResponse;
  const { provider } = validatedProvider;

  const validatedId = validateOpaqueIdParam(rawConnectionId, "connection_not_found");
  if (validatedId.errorResponse) return validatedId.errorResponse;
  const { id: connectionId } = validatedId;

  try {
    const result = await disconnectLinkConnection(provider, connectionId);

    return NextResponse.json(
      { disconnectedId: result.disconnected ? connectionId : "" },
      { headers: LINKS_REST_HEADERS },
    );
  } catch (err: unknown) {
    return toLinkErrorResponse(err);
  }
}
