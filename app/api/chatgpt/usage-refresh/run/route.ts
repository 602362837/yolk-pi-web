import { runChatGptUsageRefreshNow } from "@/lib/chatgpt-usage-refresh-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return Response.json(await runChatGptUsageRefreshNow());
}
