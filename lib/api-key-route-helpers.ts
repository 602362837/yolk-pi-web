/**
 * Shared helpers for managed API-key account routes and AnyRouter config routes.
 *
 * Keep wire-level body allowlists and opaque error projection in one place so
 * xAI / OpenCode Go / AnyRouter routes stay consistent without leaking secrets.
 */

import { NextResponse } from "next/server";
import { ApiKeyAccountStoreError } from "@/lib/api-key-accounts";
import { AnyRouterConfigError } from "@/lib/anyrouter-config";
import { AnyRouterRuntimeBridgeError } from "@/lib/anyrouter-runtime-bridge";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

const FORBIDDEN_SECRET_BODY_KEYS = new Set([
  "key",
  "token",
  "secret",
  "authorization",
  "headers",
  "path",
  "configPath",
  "models",
  "fingerprint",
  "keyFingerprint",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasDisallowedBodyKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key) || FORBIDDEN_SECRET_BODY_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a JSON request body as a plain object. Non-object / empty body becomes
 * `{}` when `allowEmpty` is true; otherwise throws a store error.
 */
export async function readJsonObjectBody(
  req: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    if (options.allowEmpty) return {};
    throw new ApiKeyAccountStoreError("Request body must be a JSON object", 400);
  }
  if (raw === undefined || raw === null) {
    if (options.allowEmpty) return {};
    throw new ApiKeyAccountStoreError("Request body must be a JSON object", 400);
  }
  if (!isRecord(raw)) {
    throw new ApiKeyAccountStoreError("Request body must be a JSON object", 400);
  }
  return raw;
}

export function assertBodyAllowlist(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label = "request body",
): void {
  if (hasDisallowedBodyKeys(body, allowed)) {
    throw new ApiKeyAccountStoreError(
      `${label} contains unsupported or forbidden fields`,
      400,
    );
  }
}

/**
 * Opaque route-level error projection. Never re-serializes unexpected
 * exception messages (they may contain paths/keys from lower layers).
 */
export function apiKeyRouteErrorResponse(
  error: unknown,
  fallbackMessage = "Request failed",
): NextResponse {
  if (error instanceof ApiKeyAccountStoreError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  if (error instanceof AnyRouterConfigError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  if (error instanceof AnyRouterRuntimeBridgeError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.retryable ? { retryable: true } : {}),
      },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: fallbackMessage },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export function jsonNoStore(data: unknown, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(data, {
    status: init.status,
    headers: NO_STORE_HEADERS,
  });
}
