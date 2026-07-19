/**
 * GET /api/links — provider catalog
 *
 * Returns the list of allowlisted Links providers with configuration
 * status and active connection counts. Does NOT trigger GitHub network
 * requests, read secret files, or import LLM auth modules.
 *
 * Cache-Control: no-store
 */

import { NextResponse } from "next/server";
import type { LinkProviderId, LinksCatalogResponse, LinkErrorResponse } from "@/lib/links-types";
import { ALLOWLISTED_LINK_PROVIDERS, LINK_PROVIDER_DISPLAY_NAMES } from "@/lib/links-types";
import { isGithubOAuthConfigured } from "@/lib/github-link-oauth";
import { getConnectionCount } from "@/lib/links-store";
import {
  ensureGitHubLinksAdapter,
  LINKS_REST_HEADERS,
  toLinkErrorResponse,
} from "@/lib/links-api-helpers";

export const dynamic = "force-dynamic";

export async function GET(): Promise<
  NextResponse<LinksCatalogResponse | LinkErrorResponse>
> {
  ensureGitHubLinksAdapter();

  try {
    const providers = await Promise.all(
      ALLOWLISTED_LINK_PROVIDERS.map(async (id: LinkProviderId) => {
        let authorizationConfigured = false;
        let connectionCount = 0;

        if (id === "github") {
          authorizationConfigured = isGithubOAuthConfigured();
          try {
            connectionCount = await getConnectionCount(id);
          } catch {
            connectionCount = 0;
          }
        }

        return {
          id,
          displayName: LINK_PROVIDER_DISPLAY_NAMES[id],
          authorizationConfigured,
          connectionCount,
        };
      }),
    );

    return NextResponse.json({ providers }, { headers: LINKS_REST_HEADERS });
  } catch (err: unknown) {
    return toLinkErrorResponse(err);
  }
}
