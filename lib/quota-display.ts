export interface QuotaDisplayTier {
  name: string;
  utilization: number;
  resetsAt: string | null;
}

export const QUOTA_TIER_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
};

export function isKnownQuotaTier(tier: QuotaDisplayTier): boolean {
  return tier.name in QUOTA_TIER_LABELS;
}

export function knownQuotaTiers<T extends QuotaDisplayTier>(tiers: T[]): T[] {
  return tiers.filter((tier) => isKnownQuotaTier(tier));
}

/**
 * 根据额度使用百分比返回展示颜色。
 *
 * @param utilization 使用百分比，范围通常为 0-100。
 * @returns CSS 颜色值。
 */
export function quotaColor(utilization: number): string {
  if (utilization >= 90) return "#f87171";
  if (utilization >= 70) return "#fb923c";
  return "#4ade80";
}

/**
 * 格式化额度窗口重置倒计时。
 *
 * @param resetsAt ISO 格式的重置时间。
 * @returns 简短倒计时文本，无法计算时返回 null。
 */
export function formatResetCountdown(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * 格式化额度查询的相对更新时间。
 *
 * @param timestamp 查询完成的毫秒时间戳。
 * @returns 简短相对时间文本。
 */
export function formatQuotaQueriedAt(timestamp: number | null): string {
  if (!timestamp) return "never";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}
