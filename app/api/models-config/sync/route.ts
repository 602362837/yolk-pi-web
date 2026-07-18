/**
 * POST /api/models-config/sync — OpenAI-compatible /models discovery + merge.
 *
 * Actions:
 * - preview: discover remote model ids for one saved custom provider (zero disk write)
 * - apply: merge selected new ids under the shared models.json lock with revision,
 *   fresh ModelRuntime verification, backup rollback, and best-effort live reload
 *
 * Security:
 * - Body allowlist only (action + providerId [+ apply fields]).
 * - Rejects url/baseUrl/headers/apiKey/path and any other extra keys.
 * - Never projects secrets, endpoints, raw upstream bodies, or absolute paths.
 * - Cache-Control: no-store on every response.
 */

import { NextResponse } from "next/server";
import type { ModelsSyncErrorBody, ModelsSyncErrorCode } from "@/lib/models-config-sync-types";
import {
  handleModelsConfigSyncRequest,
  ModelsConfigSyncError,
  modelsSyncErrorHttpStatus,
  modelsSyncErrorMessage,
} from "@/lib/models-config-sync";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(code: ModelsSyncErrorCode, status?: number): NextResponse {
  const body: ModelsSyncErrorBody = {
    error: {
      code,
      message: modelsSyncErrorMessage(code),
    },
  };
  return NextResponse.json(body, {
    status: status ?? modelsSyncErrorHttpStatus(code),
    headers: NO_STORE,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }

  try {
    const result = await handleModelsConfigSyncRequest(body);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ModelsConfigSyncError) {
      return errorResponse(error.code);
    }
    // Preview path network failures surface as ModelsConfigSyncError; unknown
    // failures on apply map to write_failed without leaking details.
    return errorResponse("write_failed", 500);
  }
}
