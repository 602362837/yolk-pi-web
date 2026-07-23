/**
 * Managed API-key single-account update, enable, disable, and delete endpoints.
 *
 * PATCH  /api/auth/api-key/[provider]/accounts/[accountId]  — update display name, description,
 *         replace key, optional baseUrlOverride, or action-based enable/disable.
 * DELETE /api/auth/api-key/[provider]/accounts/[accountId]  — delete an account
 *
 * PATCH actions:
 *   { action: "enable" } — enable a disabled account so it can be activated again.
 *   { action: "disable", reason?, replacementAccountId?, clearActive? } — disable an account.
 *     If the account is currently active, a replacementAccountId or explicit clearActive
 *     must be provided; otherwise a 409 error is returned.
 *
 * DELETE body (optional JSON):
 *   { replacementAccountId?, clearActive? }
 *   Required for AnyRouter when deleting the Active account and others remain.
 *   xAI / OpenCode Go keep legacy recent-account fallback when body is empty.
 */

import {
  updateApiKeyAccount,
  deleteApiKeyAccount,
  enableApiKeyAccount,
  disableApiKeyAccount,
} from "@/lib/api-key-accounts";
import {
  assertBodyAllowlist,
  apiKeyRouteErrorResponse,
  jsonNoStore,
  readJsonObjectBody,
} from "@/lib/api-key-route-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string; accountId: string }> };

const UPDATE_ALLOWED_KEYS = new Set([
  "displayName",
  "description",
  "apiKey",
  "baseUrlOverride",
]);

const DISABLE_ALLOWED_KEYS = new Set([
  "action",
  "reason",
  "disabledBy",
  "autoDisabledReason",
  "replacementAccountId",
  "clearActive",
]);

const ENABLE_ALLOWED_KEYS = new Set(["action"]);

const DELETE_ALLOWED_KEYS = new Set(["replacementAccountId", "clearActive"]);

export async function PATCH(req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    const body = await readJsonObjectBody(req, { allowEmpty: true });

    // Action-based enable / disable
    if (body.action === "enable") {
      assertBodyAllowlist(body, ENABLE_ALLOWED_KEYS, "enable action body");
      return jsonNoStore(await enableApiKeyAccount(provider, accountId));
    }
    if (body.action === "disable") {
      assertBodyAllowlist(body, DISABLE_ALLOWED_KEYS, "disable action body");
      return jsonNoStore(
        await disableApiKeyAccount(provider, accountId, {
          reason: typeof body.reason === "string" ? body.reason.trim() : undefined,
          disabledBy: body.disabledBy === "system" ? "system" : "user",
          autoDisabledReason:
            body.autoDisabledReason === "account_unusable" ? "account_unusable" : undefined,
          replacementAccountId:
            typeof body.replacementAccountId === "string"
              ? body.replacementAccountId.trim()
              : undefined,
          clearActive: body.clearActive === true ? true : undefined,
        }),
      );
    }

    if (body.action !== undefined) {
      return jsonNoStore({ error: "Unsupported action" }, { status: 400 });
    }

    // Field-based update
    assertBodyAllowlist(body, UPDATE_ALLOWED_KEYS, "update account body");

    const input: {
      displayName?: string;
      description?: string;
      apiKey?: string;
      baseUrlOverride?: string | null;
    } = {};
    if (body.displayName !== undefined) input.displayName = String(body.displayName);
    if (body.description !== undefined) input.description = String(body.description);
    if (body.apiKey !== undefined) {
      if (typeof body.apiKey !== "string") {
        return jsonNoStore({ error: "apiKey must be a string" }, { status: 400 });
      }
      input.apiKey = body.apiKey;
    }
    if (Object.prototype.hasOwnProperty.call(body, "baseUrlOverride")) {
      if (body.baseUrlOverride === null || typeof body.baseUrlOverride === "string") {
        input.baseUrlOverride = body.baseUrlOverride as string | null;
      } else {
        return jsonNoStore(
          { error: "baseUrlOverride must be a string or null" },
          { status: 400 },
        );
      }
    }

    return jsonNoStore(await updateApiKeyAccount(provider, accountId, input));
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to update account");
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    // Optional JSON body for explicit replacement / disconnect (AnyRouter).
    // Empty body remains valid for legacy xAI / OpenCode Go fallback delete.
    let body: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await readJsonObjectBody(req, { allowEmpty: true });
    } else {
      // Some clients send a body without content-type; best-effort parse.
      try {
        const text = await req.text();
        if (text.trim()) {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        }
      } catch {
        // Treat unreadable / non-JSON body as empty for wire compatibility.
        body = {};
      }
    }

    assertBodyAllowlist(body, DELETE_ALLOWED_KEYS, "delete account body");

    const replacementAccountId =
      typeof body.replacementAccountId === "string"
        ? body.replacementAccountId.trim()
        : undefined;
    const clearActive = body.clearActive === true ? true : undefined;

    return jsonNoStore(
      await deleteApiKeyAccount(provider, accountId, {
        ...(replacementAccountId ? { replacementAccountId } : {}),
        ...(clearActive ? { clearActive } : {}),
      }),
    );
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to delete account");
  }
}
