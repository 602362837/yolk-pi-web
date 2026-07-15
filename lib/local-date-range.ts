/**
 * local-date-range — Pure local-calendar date helpers for usage APIs.
 *
 * Server-local day boundaries are the product date semantics for ledger and
 * session rollup queries. UTC partitions in the usage store are only a scan
 * index; callers must still filter events by full `occurredAt` instants.
 */

/**
 * Format a Date as `YYYY-MM-DD` in the process-local timezone.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse `YYYY-MM-DD` into an inclusive local-day boundary instant.
 *
 * @param value Query param date string.
 * @param endOfDay When true, return 23:59:59.999 local; otherwise 00:00:00.000.
 * @returns Local Date, or null when the string is not a real calendar day.
 */
export function parseLocalDateParam(
  value: string | null | undefined,
  endOfDay: boolean,
): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Resolve the process-local IANA timezone when available.
 * Falls back to a fixed offset label (e.g. `UTC+08:00`) when the runtime
 * does not expose a zone name.
 */
export function localTimeZone(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "longOffset",
    }).formatToParts(date);
    const iana = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (iana && iana.length > 0) return iana;
    const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value;
    if (offsetPart) return offsetPart.replace("GMT", "UTC");
  } catch {
    // fall through
  }
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}
