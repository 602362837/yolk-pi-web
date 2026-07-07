import { NextResponse, type NextRequest } from "next/server";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { formatLocalDate, getUsageStats, getUsageStatsForSessionRollup, parseLocalDateParam } from "@/lib/usage-stats";

export const dynamic = "force-dynamic";

/**
 * 计算默认的本地日期范围。
 *
 * @returns 默认近 7 天的开始和结束日期。
 */
function getDefaultRange(): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * 查询指定日期范围内的 Pi assistant usage 费用统计。
 *
 * @param request 包含 from、to、cwd 查询参数的 Next.js 请求对象。
 * @returns 聚合后的费用统计 JSON。
 */
export async function GET(request: NextRequest) {
  try {
    const defaults = getDefaultRange();
    const searchParams = request.nextUrl.searchParams;
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const sessionId = searchParams.get("sessionId") || undefined;
    const cwd = searchParams.get("cwd") || undefined;
    const from = fromParam ? parseLocalDateParam(fromParam, false) : sessionId ? undefined : defaults.from;
    const to = toParam ? parseLocalDateParam(toParam, true) : sessionId ? undefined : defaults.to;

    if ((fromParam && !from) || (toParam && !to) || (!sessionId && (!from || !to))) {
      return NextResponse.json({ error: "from and to must use YYYY-MM-DD" }, { status: 400 });
    }
    if (from && to && from.getTime() > to.getTime()) {
      return NextResponse.json({ error: "from must be earlier than or equal to to" }, { status: 400 });
    }

    const config = readPiWebConfig();
    if (sessionId) {
      const rollup = await getUsageStatsForSessionRollup({
        sessionId,
        from: from ?? undefined,
        to: to ?? undefined,
        includeArchived: config.usage.includeArchived,
      });
      if (!rollup) {
        return NextResponse.json({ error: "session not found" }, { status: 404 });
      }
      return NextResponse.json(rollup);
    }

    const stats = await getUsageStats({ from: from!, to: to!, cwd, includeArchived: config.usage.includeArchived });
    return NextResponse.json({
      ...stats,
      from: fromParam ?? formatLocalDate(from!),
      to: toParam ?? formatLocalDate(to!),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
