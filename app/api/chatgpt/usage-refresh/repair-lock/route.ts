import { repairChatGptUsageRefreshLock } from "@/lib/chatgpt-usage-refresh-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { confirm?: unknown };
  try {
    return Response.json(await repairChatGptUsageRefreshLock(body.confirm === true));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
