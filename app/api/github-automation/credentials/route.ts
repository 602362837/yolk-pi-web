/**
 * GET/PUT/DELETE /api/github-automation/credentials
 *
 * Local GitHub App credential control plane (GHCRED-03).
 * - Independent from non-secret /config CAS.
 * - Cache-Control: no-store on every response.
 * - Never returns App ID value, webhook secret, PEM, key path/basename, fingerprint,
 *   JWT, or installation token.
 * - PUT is strict bounded multipart; blank rotation fields preserve local values only
 *   (never imports process env into disk).
 * - Successful PUT/DELETE clear installation token cache before responding.
 * - No network, no scheduler / job side effects.
 */

import { NextResponse } from "next/server";

import {
  deleteGithubAppLocalCredentials,
  upsertGithubAppLocalCredentials,
} from "@/lib/github-app-credential-store";
import { clearGithubAppInstallationTokenCache } from "@/lib/github-app-client";
import { getGithubAppCredentialSafeProjection } from "@/lib/github-app-credentials";
import {
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "@/lib/github-automation-errors";
import { assertGithubAutomationProjectionSafe } from "@/lib/github-automation-projection";
import type { GithubAppCredentialSafeProjection } from "@/lib/github-automation-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

/** Total multipart envelope ceiling (design: ~96 KiB). */
const MAX_REQUEST_BYTES = 96 * 1024;

/** Per-field string size caps (bytes, UTF-8) before store validation. */
const MAX_APP_ID_BYTES = 64;
const MAX_WEBHOOK_SECRET_BYTES = 4096;
const MAX_APP_SLUG_BYTES = 200;
const MAX_PRIVATE_KEY_PEM_BYTES = 64 * 1024;
const MAX_PRIVATE_KEY_FILE_BYTES = 64 * 1024;

/** Exact DELETE confirm token. */
const DELETE_CONFIRM = "remove_local_credentials";

const ALLOWED_PUT_FIELDS = new Set([
  "appId",
  "webhookSecret",
  "appSlug",
  "clearAppSlug",
  "privateKeyPem",
  "privateKeyFile",
]);

// ─── Response helpers ────────────────────────────────────────────────────────

function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: Record<string, string | number | boolean | null> | null,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code,
      message,
      ...(details ? { details } : {}),
    },
    { status, headers: NO_STORE_HEADERS },
  );
}

function mapError(err: unknown): NextResponse {
  if (isGithubAutomationError(err)) {
    // Never leak free-form details that might include paths; only allow fixed store codes.
    const details = sanitizeErrorDetails(err.details);
    return errorResponse(err.code, err.message, err.status, details);
  }
  return errorResponse(
    "internal_error",
    safeGithubAutomationErrorMessage(err),
    500,
  );
}

function sanitizeErrorDetails(
  details: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!details) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") {
      // Drop path-like or secret-like detail strings entirely.
      if (
        value.includes("/") ||
        value.includes("\\") ||
        /-----BEGIN/i.test(value) ||
        value.length > 120
      ) {
        continue;
      }
      out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function buildSafeStatus(): Promise<GithubAppCredentialSafeProjection> {
  const status = await getGithubAppCredentialSafeProjection();
  assertGithubAutomationProjectionSafe(status);
  return status;
}

function successStatusResponse(
  status: GithubAppCredentialSafeProjection,
): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      status,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

// ─── Request guards ──────────────────────────────────────────────────────────

function hasDisallowedQuerySecrets(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("token") ||
      lower.includes("password") ||
      lower.includes("private") ||
      lower.includes("pem") ||
      lower.includes("key") ||
      lower === "appid" ||
      lower === "app_id" ||
      lower === "webhooksecret" ||
      lower === "webhook_secret" ||
      lower === "appslug" ||
      lower === "app_slug"
    ) {
      return true;
    }
  }
  return false;
}

function contentTypeOf(request: Request): string {
  return (request.headers.get("content-type") || "").toLowerCase();
}

function rejectOversizedRequest(request: Request): NextResponse | null {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse(
      "invalid_credentials_request",
      "GitHub App credentials request exceeds size limit",
      413,
    );
  }
  return null;
}

function isFileEntry(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function looksLikeServerPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.includes("\\") && /\\/.test(trimmed) && !trimmed.includes("BEGIN")) {
    // Windows-ish path without PEM markers.
    return true;
  }
  // Explicit path-import fields are rejected elsewhere; also reject values that
  // clearly look like "import this file path" without PEM markers.
  if (
    !/-----BEGIN/.test(trimmed) &&
    (trimmed.endsWith(".pem") || trimmed.endsWith(".key")) &&
    (trimmed.includes("/") || trimmed.includes("\\"))
  ) {
    return true;
  }
  return false;
}

function readOptionalTextField(
  form: FormData,
  name: string,
  maxBytes: number,
): { ok: true; value: string | undefined } | { ok: false; response: NextResponse } {
  const all = form.getAll(name);
  if (all.length === 0) return { ok: true, value: undefined };
  if (all.length > 1) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request has duplicate fields",
        400,
      ),
    };
  }
  const entry = all[0];
  if (isFileEntry(entry)) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials field must be text",
        400,
      ),
    };
  }
  if (typeof entry !== "string") {
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request is invalid",
        400,
      ),
    };
  }
  if (Buffer.byteLength(entry, "utf8") > maxBytes) {
    return {
      ok: false,
      response: errorResponse(
        name === "privateKeyPem" ? "private_key_too_large" : "invalid_credentials_request",
        name === "privateKeyPem"
          ? "GitHub App private key exceeds size limit"
          : "GitHub App credentials field exceeds size limit",
        400,
      ),
    };
  }
  if (looksLikeServerPath(entry) && name !== "privateKeyPem") {
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request must not include server paths",
        400,
      ),
    };
  }
  // For PEM paste, server paths without PEM markers are rejected; PEM text itself is allowed.
  if (name === "privateKeyPem" && looksLikeServerPath(entry) && !/-----BEGIN/.test(entry)) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request must not include server paths",
        400,
      ),
    };
  }
  return { ok: true, value: entry };
}

async function readOptionalPrivateKeyFile(
  form: FormData,
): Promise<
  | { ok: true; pem: string | undefined }
  | { ok: false; response: NextResponse }
> {
  const all = form.getAll("privateKeyFile");
  if (all.length === 0) return { ok: true, pem: undefined };
  if (all.length > 1) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request accepts only one private key file",
        400,
      ),
    };
  }
  const entry = all[0];
  if (!isFileEntry(entry)) {
    // Text path string is rejected (no server-side path import).
    return {
      ok: false,
      response: errorResponse(
        "invalid_credentials_request",
        "privateKeyFile must be an uploaded file",
        400,
      ),
    };
  }
  if (entry.size <= 0) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_private_key",
        "GitHub App private key is invalid",
        400,
      ),
    };
  }
  if (entry.size > MAX_PRIVATE_KEY_FILE_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        "private_key_too_large",
        "GitHub App private key exceeds size limit",
        400,
      ),
    };
  }
  let text: string;
  try {
    text = await entry.text();
  } catch {
    return {
      ok: false,
      response: errorResponse(
        "invalid_private_key",
        "GitHub App private key is invalid",
        400,
      ),
    };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_PRIVATE_KEY_PEM_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        "private_key_too_large",
        "GitHub App private key exceeds size limit",
        400,
      ),
    };
  }
  return { ok: true, pem: text };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    if (hasDisallowedQuerySecrets(url)) {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request must not include query secrets",
        400,
      );
    }
    const status = await buildSafeStatus();
    return successStatusResponse(status);
  } catch (err) {
    return mapError(err);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    if (hasDisallowedQuerySecrets(url)) {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request must not include query secrets",
        400,
      );
    }

    const oversized = rejectOversizedRequest(request);
    if (oversized) return oversized;

    const contentType = contentTypeOf(request);
    if (!contentType.includes("multipart/form-data")) {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials must be submitted as multipart/form-data",
        400,
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request is invalid",
        400,
      );
    }

    // Strict field allowlist + no duplicates (getAll length > 1).
    const keys = [...form.keys()];
    for (const key of keys) {
      if (!ALLOWED_PUT_FIELDS.has(key)) {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials request has unknown fields",
          400,
        );
      }
    }

    for (const field of ALLOWED_PUT_FIELDS) {
      if (form.getAll(field).length > 1) {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials request has duplicate fields",
          400,
        );
      }
    }

    // Reject any additional path-import field names that might sneak past if allowlist drifts.
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (
        lower.includes("path") ||
        lower.includes("filepath") ||
        lower === "privatekeypath" ||
        lower === "private_key_file" ||
        lower === "privatekeyfilepath"
      ) {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials request must not include server paths",
          400,
        );
      }
    }

    const appIdField = readOptionalTextField(form, "appId", MAX_APP_ID_BYTES);
    if (!appIdField.ok) return appIdField.response;
    const webhookField = readOptionalTextField(
      form,
      "webhookSecret",
      MAX_WEBHOOK_SECRET_BYTES,
    );
    if (!webhookField.ok) return webhookField.response;
    const slugField = readOptionalTextField(form, "appSlug", MAX_APP_SLUG_BYTES);
    if (!slugField.ok) return slugField.response;
    const pemField = readOptionalTextField(
      form,
      "privateKeyPem",
      MAX_PRIVATE_KEY_PEM_BYTES,
    );
    if (!pemField.ok) return pemField.response;
    const fileField = await readOptionalPrivateKeyFile(form);
    if (!fileField.ok) return fileField.response;

    const clearAppSlugRaw = form.get("clearAppSlug");
    let clearAppSlug = false;
    if (clearAppSlugRaw !== null) {
      if (isFileEntry(clearAppSlugRaw)) {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials request is invalid",
          400,
        );
      }
      const token =
        typeof clearAppSlugRaw === "string" ? clearAppSlugRaw.trim().toLowerCase() : "";
      if (token !== "true" && token !== "1" && token !== "yes") {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials request is invalid",
          400,
        );
      }
      clearAppSlug = true;
    }

    const pastedPem =
      typeof pemField.value === "string" && pemField.value.trim().length > 0
        ? pemField.value
        : undefined;
    const uploadedPem =
      typeof fileField.pem === "string" && fileField.pem.trim().length > 0
        ? fileField.pem
        : undefined;

    if (pastedPem && uploadedPem) {
      return errorResponse(
        "invalid_credentials_request",
        "Provide either privateKeyPem or privateKeyFile, not both",
        400,
      );
    }

    const privateKeyPem = pastedPem ?? uploadedPem;

    // Build store upsert input: blank/omitted → preserve (undefined).
    const upsertInput: {
      appId?: string | null;
      webhookSecret?: string | null;
      appSlug?: string | null;
      privateKeyPem?: string | null;
    } = {};

    if (typeof appIdField.value === "string" && appIdField.value.trim().length > 0) {
      upsertInput.appId = appIdField.value;
    }
    if (
      typeof webhookField.value === "string" &&
      webhookField.value.trim().length > 0
    ) {
      upsertInput.webhookSecret = webhookField.value;
    }
    if (privateKeyPem) {
      upsertInput.privateKeyPem = privateKeyPem;
    }

    if (clearAppSlug) {
      upsertInput.appSlug = null;
    } else if (
      typeof slugField.value === "string" &&
      slugField.value.trim().length > 0
    ) {
      upsertInput.appSlug = slugField.value;
    }
    // else: omit appSlug → preserve

    // Durable mutation first.
    await upsertGithubAppLocalCredentials(upsertInput);
    // Only after durable success: clear installation token cache, then project.
    clearGithubAppInstallationTokenCache();
    const status = await buildSafeStatus();
    return successStatusResponse(status);
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    if (hasDisallowedQuerySecrets(url)) {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials request must not include query secrets",
        400,
      );
    }

    const oversized = rejectOversizedRequest(request);
    if (oversized) return oversized;

    const contentType = contentTypeOf(request);
    // DELETE requires JSON with exact confirm token.
    if (contentType && !contentType.includes("application/json")) {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials delete requires application/json",
        400,
      );
    }

    let body: unknown;
    try {
      // Empty body is invalid.
      const text = await request.text();
      if (!text || !text.trim()) {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials delete requires confirmation",
          400,
        );
      }
      if (Buffer.byteLength(text, "utf8") > 4096) {
        return errorResponse(
          "invalid_credentials_request",
          "GitHub App credentials request exceeds size limit",
          413,
        );
      }
      body = JSON.parse(text) as unknown;
    } catch {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials delete requires confirmation",
        400,
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body as Record<string, unknown>).length !== 1 ||
      (body as { confirm?: unknown }).confirm !== DELETE_CONFIRM
    ) {
      return errorResponse(
        "invalid_credentials_request",
        "GitHub App credentials delete requires confirmation",
        400,
      );
    }

    await deleteGithubAppLocalCredentials();
    clearGithubAppInstallationTokenCache();
    const status = await buildSafeStatus();
    return successStatusResponse(status);
  } catch (err) {
    return mapError(err);
  }
}

export async function POST(): Promise<NextResponse> {
  return errorResponse(
    "invalid_credentials_request",
    "Use GET, PUT, or DELETE for GitHub App credentials",
    405,
  );
}

export async function PATCH(): Promise<NextResponse> {
  return errorResponse(
    "invalid_credentials_request",
    "Use GET, PUT, or DELETE for GitHub App credentials",
    405,
  );
}

// Re-export for tests that want the confirm constant without hardcoding drift.
export const _CREDENTIALS_DELETE_CONFIRM = DELETE_CONFIRM;
