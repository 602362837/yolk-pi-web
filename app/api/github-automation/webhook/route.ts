/**
 * POST /api/github-automation/webhook
 *
 * GitHub App webhook ingestion (GHA-02):
 * - Cap raw body bytes
 * - Verify X-Hub-Signature-256 with timingSafeEqual before JSON parse
 * - Exclusive delivery create + durable enqueue
 * - Respond 202 quickly; never run LLM/Git on the request thread
 *
 * Cache-Control: no-store
 * Never logs raw body, signature, or secrets.
 */

import { NextResponse } from "next/server";

import { acceptGithubAutomationWebhook } from "@/lib/github-automation-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function POST(request: Request): Promise<NextResponse> {
  const result = await acceptGithubAutomationWebhook({ request });

  const body = {
    ok: result.httpStatus >= 200 && result.httpStatus < 300,
    code: result.code,
    message: result.message,
    deliveryId: result.deliveryId,
    jobId: result.jobId,
    disposition: result.disposition,
    ignoreReason: result.ignoreReason,
  };

  return NextResponse.json(body, {
    status: result.httpStatus,
    headers: NO_STORE_HEADERS,
  });
}

/** GitHub may send a GET for health in some proxies; reject non-POST clearly. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: false,
      code: "method_not_allowed",
      message: "Use POST for GitHub webhooks",
    },
    { status: 405, headers: NO_STORE_HEADERS },
  );
}
