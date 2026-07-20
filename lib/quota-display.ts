export interface QuotaDisplayTier {
  name: string;
  utilization: number;
  resetsAt: string | null;
}

export interface CodexResetCreditDisplay {
  id: string;
  status: string;
  grantedAt: string;
  expiresAt: string;
}

export const QUOTA_TIER_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
};

/** Chinese compact labels for the GPT top-bar usage pill (5h / week). */
export const GPT_QUOTA_TIER_COMPACT_LABELS: Record<string, string> = {
  five_hour: "5 小时",
  seven_day: "7d",
};

/** Chinese expanded labels for GPT quota window cards. */
export const GPT_QUOTA_TIER_PANEL_LABELS: Record<string, string> = {
  five_hour: "5 小时额度",
  seven_day: "7 天额度",
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
  // Theme-aware usage status colors (light/dark tokens with safe fallbacks).
  if (utilization >= 90) return "var(--usage-status-danger-fg, #b91c1c)";
  if (utilization >= 70) return "var(--usage-status-warning-fg, #b45309)";
  return "var(--usage-status-success-fg, #15803d)";
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
  if (!timestamp) return "从未";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "刚刚";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  return `${Math.floor(diffSeconds / 86400)} 天前`;
}

/**
 * Chinese relative age for GPT usage panel cache timestamps.
 * Shared relative age formatter for Models / warmup UI.
 */
export function formatGptQuotaRelativeAge(timestamp: number | null | undefined): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 5_000) return "刚刚";
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1000))} 秒`;
  if (ageMs < 3_600_000) return `${Math.max(1, Math.round(ageMs / 60_000))} 分钟`;
  if (ageMs < 86_400_000) return `${Math.max(1, Math.round(ageMs / 3_600_000))} 小时`;
  return `${Math.max(1, Math.round(ageMs / 86_400_000))} 天`;
}

/** Chinese countdown for GPT reset windows / credits (e.g. "2 小时 15 分"). */
export function formatGptResetCountdown(resetsAt: string | null | undefined): string | null {
  if (!resetsAt) return null;
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

export function earliestResetCreditExpiration(credits: CodexResetCreditDisplay[]): string | null {
  let earliest: { time: number; value: string } | null = null;
  for (const credit of credits) {
    const time = new Date(credit.expiresAt).getTime();
    if (!Number.isFinite(time)) continue;
    if (!earliest || time < earliest.time) earliest = { time, value: credit.expiresAt };
  }
  return earliest?.value ?? null;
}
