/**
 * GET /api/links/[provider]/authorizations/[authorizationId]/events — SSE stream
 *
 * Server-Sent Events stream for authorization state changes. Sends the
 * current snapshot on connect, then updates on each state transition.
 *
 * State transitions are driven by the background polling task in the
 * authorization manager. Persistence (connected / duplicate / failed)
 * is handled independently by the persist handler — the SSE stream
 * projects the latest sanitized state.
 *
 * Supports reconnect: a new EventSource with the same authorization id
 * receives the current snapshot (including terminal states retained for
 * a short TTL).
 *
 * Security:
 * - device_code and access token NEVER appear in SSE frames.
 * - userCode is included only for active (non-terminal) states.
 * - Cache-Control: no-cache, no-store
 */

import type { LinkAuthorizationSnapshot } from "@/lib/links-types";
import { subscribeToAuthorization } from "@/lib/links-authorization-manager";
import {
  ensureGitHubLinksAdapter,
  ensureLinksPersistHandler,
  validateProviderParam,
  validateOpaqueIdParam,
  LINKS_SSE_HEADERS,
} from "@/lib/links-api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string; authorizationId: string }> },
): Promise<Response> {
  ensureGitHubLinksAdapter();
  ensureLinksPersistHandler();

  const { provider: rawProvider, authorizationId: rawAuthorizationId } =
    await params;

  const validatedProvider = validateProviderParam(rawProvider);
  if (validatedProvider.errorResponse) return validatedProvider.errorResponse;

  const validatedId = validateOpaqueIdParam(
    rawAuthorizationId,
    "authorization_not_found",
  );
  if (validatedId.errorResponse) return validatedId.errorResponse;
  const { id: authorizationId } = validatedId;

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController,
    data: unknown,
  ): void => {
    try {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
      );
    } catch {
      // Stream already closed.
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      let unsubscribe: (() => void) | null = null;

      try {
        // Subscribe to authorization state changes.
        // The callback fires immediately with the current snapshot,
        // then on each state transition.
        unsubscribe = subscribeToAuthorization(
          authorizationId,
          (snapshot: LinkAuthorizationSnapshot) => {
            send(controller, snapshot);
          },
        );
      } catch {
        // Subscription failed — emit error and close.
        send(controller, {
          authorizationId,
          status: "failed",
          errorCode: "internal_error",
          errorMessage: "Failed to subscribe to authorization events",
        });
        controller.close();
        return;
      }

      // Keep-alive heartbeat every 30s.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Stream already closed.
        }
      }, 30_000);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
      };

      req.signal?.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: LINKS_SSE_HEADERS,
  });
}
