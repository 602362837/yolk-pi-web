/**
 * POST /api/links/[provider]/authorizations — start Device Flow authorization
 *
 * Initiates a GitHub OAuth Device Flow. The response contains only the
 * user-facing fields: authorization id, userCode, verificationUri, expiry,
 * interval, and requestedScopes.
 *
 * device_code is kept in server memory only and NEVER appears in the response.
 * Client-submitted token/scope/clientId/url fields are rejected.
 *
 * Status 201 on success.
 * Cache-Control: no-store
 */

import { NextResponse } from "next/server";
import type {
  LinkAuthorizationStartResponse,
  LinkErrorResponse,
  LinkProviderId,
} from "@/lib/links-types";
import { startAuthorization } from "@/lib/links-authorization-manager";
import {
  ensureGitHubLinksAdapter,
  ensureLinksPersistHandler,
  validateProviderParam,
  rejectForbiddenBodyKeys,
  LINKS_REST_HEADERS,
  toLinkErrorResponse,
} from "@/lib/links-api-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse<LinkAuthorizationStartResponse | LinkErrorResponse>> {
  // Persist must be registered before background polling can complete — do not
  // wait for an SSE subscriber, or approved tokens may never be saved.
  ensureGitHubLinksAdapter();
  ensureLinksPersistHandler();

  const { provider: rawProvider } = await params;

  const validatedProvider = validateProviderParam(rawProvider);
  if (validatedProvider.errorResponse) return validatedProvider.errorResponse;
  const { provider } = validatedProvider;

  // Parse and validate body — reject any forbidden keys
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Empty or invalid JSON is fine; treat as {}.
    body = {};
  }

  if (body !== undefined && body !== null) {
    const forbiddenError = rejectForbiddenBodyKeys(body);
    if (forbiddenError) return forbiddenError;
  }

  try {
    const snapshot = await startAuthorization(provider as LinkProviderId);

    const response: LinkAuthorizationStartResponse = {
      authorization: {
        id: snapshot.authorizationId,
        status: "awaiting_user",
        userCode: snapshot.userCode ?? "",
        verificationUri: snapshot.verificationUri ?? "",
        expiresAt: snapshot.expiresAt ?? "",
        intervalSeconds: snapshot.intervalSeconds ?? 5,
        requestedScopes: snapshot.requestedScopes ?? ["read:user"],
      },
    };

    return NextResponse.json(response, {
      status: 201,
      headers: LINKS_REST_HEADERS,
    });
  } catch (err: unknown) {
    return toLinkErrorResponse(err);
  }
}
