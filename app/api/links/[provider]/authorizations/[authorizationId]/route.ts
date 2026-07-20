/**
 * DELETE /api/links/[provider]/authorizations/[authorizationId] — cancel authorization
 *
 * Cancels a pending Device Flow authorization. Aborts background polling
 * and transitions the session to cancelled. Idempotent — terminal or
 * unknown sessions return a clean result without error.
 *
 * Cache-Control: no-store
 */

import { NextResponse } from "next/server";
import type {
  LinkCancelResponse,
  LinkErrorResponse,
} from "@/lib/links-types";
import { cancelAuthorization } from "@/lib/links-authorization-manager";
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
  { params }: { params: Promise<{ provider: string; authorizationId: string }> },
): Promise<NextResponse<LinkCancelResponse | LinkErrorResponse>> {
  ensureGitHubLinksAdapter();

  const { provider: rawProvider, authorizationId: rawAuthorizationId } =
    await params;

  const validatedProvider = validateProviderParam(rawProvider);
  if (validatedProvider.errorResponse) return validatedProvider.errorResponse;
  // Provider is validated but cancelAuthorization is provider-agnostic;
  // we just validate the provider is allowlisted.

  const validatedId = validateOpaqueIdParam(
    rawAuthorizationId,
    "authorization_not_found",
  );
  if (validatedId.errorResponse) return validatedId.errorResponse;
  const { id: authorizationId } = validatedId;

  try {
    const result = cancelAuthorization(authorizationId);

    return NextResponse.json(
      { cancelledId: result.cancelled ? authorizationId : "" },
      { headers: LINKS_REST_HEADERS },
    );
  } catch (err: unknown) {
    return toLinkErrorResponse(err);
  }
}
