import { getChatGptUsageRefreshStatus, ensureChatGptUsageRefreshScheduler } from "@/lib/chatgpt-usage-refresh-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await ensureChatGptUsageRefreshScheduler();
  return Response.json(await getChatGptUsageRefreshStatus());
}
