/**
 * github-webhook-verify — raw-body HMAC verification for GitHub App webhooks (GHA-02).
 *
 * Security invariants:
 * - Signature is checked with timingSafeEqual over the raw bytes BEFORE JSON parse.
 * - Body size is capped; oversize fails closed without buffering the full stream when possible.
 * - Signature header / secret / raw body are never returned in safe projections or logs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { GithubAutomationError } from "./github-automation-errors";

/** Hard cap for inbound webhook raw bodies (1 MiB). */
export const GITHUB_WEBHOOK_MAX_BODY_BYTES = 1 * 1024 * 1024;

const SIGNATURE_PREFIX = "sha256=";

/**
 * Parse `X-Hub-Signature-256` header value (`sha256=<hex>`).
 * Returns null when the header is missing or malformed (never throws with secret material).
 */
export function parseGithubWebhookSignatureHeader(
  header: string | null | undefined,
): Buffer | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith(SIGNATURE_PREFIX)) return null;
  const hex = trimmed.slice(SIGNATURE_PREFIX.length).trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 64) return null;
  try {
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}

/**
 * Compute expected `sha256=<hex>` signature for a raw body and secret.
 * Intended for tests; production verifies without exposing the digest string in logs.
 */
export function computeGithubWebhookSignatureHex(
  rawBody: Buffer | Uint8Array | string,
  secret: string,
): string {
  const body =
    typeof rawBody === "string"
      ? Buffer.from(rawBody, "utf8")
      : Buffer.isBuffer(rawBody)
        ? rawBody
        : Buffer.from(rawBody);
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Timing-safe verification of GitHub webhook signature against raw body bytes.
 * Does not log secret, signature, or body.
 */
export function verifyGithubWebhookSignature(options: {
  rawBody: Buffer | Uint8Array;
  signatureHeader: string | null | undefined;
  secret: string;
}): boolean {
  const expectedHex = computeGithubWebhookSignatureHex(options.rawBody, options.secret);
  const provided = parseGithubWebhookSignatureHeader(options.signatureHeader);
  if (!provided) return false;
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/**
 * Read a Request body with a hard byte cap.
 * Throws GithubAutomationError(github_oversized_response / 413) when over limit.
 * Returns the raw Buffer for signature verification (caller must not persist it).
 */
export async function readCappedWebhookRawBody(
  request: Request,
  maxBytes: number = GITHUB_WEBHOOK_MAX_BODY_BYTES,
): Promise<Buffer> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new GithubAutomationError(
        "github_oversized_response",
        "Webhook body exceeded size limit",
        { status: 413, details: { maxBytes } },
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    // No body stream — treat as empty.
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore cancel errors
        }
        throw new GithubAutomationError(
          "github_oversized_response",
          "Webhook body exceeded size limit",
          { status: 413, details: { maxBytes } },
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total);
}

/**
 * Verify signature after capped read. Fail closed on missing secret.
 * Throws GithubAutomationError with status 401 on invalid signature.
 */
export function assertValidGithubWebhookSignature(options: {
  rawBody: Buffer | Uint8Array;
  signatureHeader: string | null | undefined;
  secret: string | null | undefined;
}): void {
  if (!options.secret || options.secret.length === 0) {
    throw new GithubAutomationError("not_configured", undefined, {
      status: 400,
      details: { readiness: "missing_webhook_secret" },
    });
  }
  const ok = verifyGithubWebhookSignature({
    rawBody: options.rawBody,
    signatureHeader: options.signatureHeader,
    secret: options.secret,
  });
  if (!ok) {
    throw new GithubAutomationError(
      "github_auth_failed",
      "Webhook signature verification failed",
      { status: 401, details: { reason: "invalid_signature" } },
    );
  }
}
