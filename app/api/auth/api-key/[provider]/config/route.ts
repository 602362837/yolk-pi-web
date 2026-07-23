/**
 * AnyRouter provider-wide source config (safe projection only).
 *
 * GET   /api/auth/api-key/[provider]/config
 * PATCH /api/auth/api-key/[provider]/config
 *
 * Only `provider=anyrouter` is supported. Responses never include apiKey,
 * model bodies, absolute paths, or unknown raw fields. PATCH uses revision
 * CAS, rebuilds the Active runtime bridge, and reloads live auth state.
 */

import {
  getAnyRouterSafeConfig,
  patchAnyRouterConfig,
  type AnyRouterConfigPatchInput,
  type AnyRouterRetryPolicy,
  ANYROUTER_PROVIDER_ID,
  AnyRouterConfigError,
} from "@/lib/anyrouter-config";
import { rebuildAnyRouterRuntimeBridgeAfterConfigChange } from "@/lib/anyrouter-runtime-bridge";
import {
  assertBodyAllowlist,
  apiKeyRouteErrorResponse,
  isRecord,
  jsonNoStore,
  readJsonObjectBody,
} from "@/lib/api-key-route-helpers";
import { reloadRpcAuthState } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

const PATCH_ALLOWED_KEYS = new Set(["revision", "baseUrl", "retry"]);
const RETRY_ALLOWED_KEYS = new Set([
  "maxRetries",
  "baseDelayMs",
  "maxDelayMs",
  "jitterMs",
  "retryAfterCapMs",
]);

function assertAnyRouterProvider(provider: string): void {
  if (provider !== ANYROUTER_PROVIDER_ID) {
    throw new AnyRouterConfigError(
      `Provider config is only supported for ${ANYROUTER_PROVIDER_ID}`,
      400,
      "validation_error",
    );
  }
}

function parseRetryPatch(value: unknown): Partial<AnyRouterRetryPolicy> {
  if (!isRecord(value)) {
    throw new AnyRouterConfigError("retry must be an object", 400, "validation_error");
  }
  assertBodyAllowlist(value, RETRY_ALLOWED_KEYS, "retry");
  const out: Partial<AnyRouterRetryPolicy> = {};
  for (const key of RETRY_ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new AnyRouterConfigError(
        `retry.${key} must be a finite number`,
        400,
        "validation_error",
      );
    }
    out[key as keyof AnyRouterRetryPolicy] = raw;
  }
  return out;
}

function parsePatchBody(body: Record<string, unknown>): AnyRouterConfigPatchInput {
  assertBodyAllowlist(body, PATCH_ALLOWED_KEYS, "config patch body");

  const revision = typeof body.revision === "string" ? body.revision.trim() : "";
  if (!revision) {
    throw new AnyRouterConfigError("revision is required", 400, "validation_error");
  }

  const input: AnyRouterConfigPatchInput = { revision };

  if (Object.prototype.hasOwnProperty.call(body, "baseUrl")) {
    const baseUrl = body.baseUrl;
    if (baseUrl === null) {
      input.baseUrl = null;
    } else if (typeof baseUrl === "string") {
      input.baseUrl = baseUrl;
    } else {
      throw new AnyRouterConfigError("baseUrl must be a string or null", 400, "validation_error");
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "retry")) {
    input.retry = parseRetryPatch(body.retry);
  }

  return input;
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { provider } = await params;
    assertAnyRouterProvider(provider);
    return jsonNoStore(getAnyRouterSafeConfig());
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to load provider config");
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { provider } = await params;
    assertAnyRouterProvider(provider);

    const body = await readJsonObjectBody(req);
    const input = parsePatchBody(body);
    const projection = await patchAnyRouterConfig(input);

    // Config mutation must rebuild the Active bridge (effective baseUrl/retry)
    // and only then reload live wrappers. Never report success before both finish.
    await rebuildAnyRouterRuntimeBridgeAfterConfigChange();
    await Promise.resolve(reloadRpcAuthState());

    return jsonNoStore(projection);
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to update provider config");
  }
}
