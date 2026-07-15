/**
 * Focused tests for llm-usage-query date semantics (DATE-01).
 *
 * Covers:
 * - local-day range → UTC partition candidate scan → occurredAt filter
 * - inclusive from/to boundaries and 1ms exclusion outside
 * - UTC+8 cross-partition single local day isolation
 * - byDay / range / timezone local calendar consistency
 * - cache key isolation on full instants + filters
 * - invalid / oversized ranges
 *
 * Uses an isolated PI_CODING_AGENT_DIR fixture. Never reads/writes the
 * user real usage-events directory.
 *
 * Run:
 *   npm run test:llm-usage-query
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

// Must set BEFORE importing modules that resolve getAgentDir().
const agentDir = mkdtempSync(join(tmpdir(), "pi-llm-usage-query-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const eventsRoot = join(agentDir, "usage-events", "v1");

const {
  formatLocalDate,
  parseLocalDateParam,
  localTimeZone,
} = await import("../lib/local-date-range.ts");

const { formatUtcDate } = await import("../lib/llm-usage-types.ts");

const {
  queryLlmUsage,
  QueryValidationError,
  clearLlmUsageQueryCacheForTest,
} = await import("../lib/llm-usage-query.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  clearLlmUsageQueryCacheForTest();
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    errors.push(`${name}: ${msg}`);
    process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
  }
}

function makeEvent({
  eventId,
  occurredAt,
  provider = "openai",
  model = "gpt-test",
  tokens = 100,
  cost = 0.01,
  status = "success",
  source = "chat",
}) {
  return {
    kind: "yolk-llm-usage-event",
    schemaVersion: 1,
    eventId,
    callId: `call_${eventId}`,
    occurredAt,
    completedAt: occurredAt,
    status,
    provider,
    requestedModel: model,
    usage: {
      input: tokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: tokens,
      cost: {
        input: cost,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: cost,
      },
    },
    source: { kind: source, invocation: "agent_turn" },
    provenance: {
      mode: "native",
      usageSource: "sdk",
      attemptVisibility: "finalized_completion_only",
    },
  };
}

/** Write event into the UTC partition of its occurredAt (mirrors store layout). */
function writeEvent(event) {
  const utcDay = formatUtcDate(new Date(event.occurredAt));
  const dir = join(eventsRoot, utcDay);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${event.eventId}.json`), JSON.stringify(event), "utf-8");
}

function wipeEvents() {
  rmSync(eventsRoot, { recursive: true, force: true });
  mkdirSync(eventsRoot, { recursive: true });
}

// ---------------------------------------------------------------------------
// local-date-range helpers
// ---------------------------------------------------------------------------

process.stdout.write("\nlocal-date-range\n");

await test("parseLocalDateParam start/end of day are inclusive local bounds", () => {
  const start = parseLocalDateParam("2026-07-14", false);
  const end = parseLocalDateParam("2026-07-14", true);
  assert.ok(start);
  assert.ok(end);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(start.getMilliseconds(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
  assert.equal(end.getSeconds(), 59);
  assert.equal(end.getMilliseconds(), 999);
  assert.equal(formatLocalDate(start), "2026-07-14");
  assert.equal(formatLocalDate(end), "2026-07-14");
});

await test("parseLocalDateParam rejects invalid calendar days", () => {
  assert.equal(parseLocalDateParam("2026-02-30", false), null);
  assert.equal(parseLocalDateParam("2026-13-01", false), null);
  assert.equal(parseLocalDateParam("not-a-date", false), null);
  assert.equal(parseLocalDateParam(null, false), null);
});

await test("localTimeZone returns a non-empty label", () => {
  const tz = localTimeZone();
  assert.equal(typeof tz, "string");
  assert.ok(tz.length > 0);
});

// ---------------------------------------------------------------------------
// queryLlmUsage date semantics
// ---------------------------------------------------------------------------

process.stdout.write("\nqueryLlmUsage date filter\n");

await test("includes boundary events and excludes 1ms outside", async () => {
  wipeEvents();
  const from = parseLocalDateParam("2026-07-14", false);
  const to = parseLocalDateParam("2026-07-14", true);
  assert.ok(from && to);

  const insideStart = makeEvent({
    eventId: "bound-start",
    occurredAt: new Date(from.getTime()).toISOString(),
    tokens: 11,
  });
  const insideEnd = makeEvent({
    eventId: "bound-end",
    occurredAt: new Date(to.getTime()).toISOString(),
    tokens: 22,
  });
  const before = makeEvent({
    eventId: "bound-before",
    occurredAt: new Date(from.getTime() - 1).toISOString(),
    tokens: 33,
  });
  const after = makeEvent({
    eventId: "bound-after",
    occurredAt: new Date(to.getTime() + 1).toISOString(),
    tokens: 44,
  });

  for (const e of [insideStart, insideEnd, before, after]) writeEvent(e);

  const result = await queryLlmUsage({
    from,
    to,
    fromLabel: "2026-07-14",
    toLabel: "2026-07-14",
  });

  assert.equal(result.totals.calls, 2);
  assert.equal(result.totals.totalTokens, 33);
  assert.deepEqual(
    result.byDay.map((d) => d.date),
    ["2026-07-14"],
  );
});

await test("UTC+8 single local day does not mix adjacent local-day events", async () => {
  // This machine is expected to run in Asia/Shanghai (UTC+8) in CI/local.
  // If the host is not UTC+8, still verify the local-day isolation property
  // using process-local boundaries for 2026-07-14.
  wipeEvents();
  const from = parseLocalDateParam("2026-07-14", false);
  const to = parseLocalDateParam("2026-07-14", true);
  assert.ok(from && to);

  // Explicit UTC+8-style timestamps that cross UTC partitions for local day 7/14:
  // local 00:30 on 7/14 → 2026-07-13T16:30:00Z (previous UTC partition)
  // local 12:00 on 7/14 → 2026-07-14T04:00:00Z
  // local 23:30 on 7/14 → 2026-07-14T15:30:00Z
  // local 23:30 on 7/13 → 2026-07-13T15:30:00Z (previous local day)
  // local 00:30 on 7/15 → 2026-07-14T16:30:00Z (next local day)
  const events = [
    makeEvent({
      eventId: "u8-prev-local",
      occurredAt: "2026-07-13T15:30:00.000Z",
      tokens: 1,
    }),
    makeEvent({
      eventId: "u8-early-local",
      occurredAt: "2026-07-13T16:30:00.000Z",
      tokens: 10,
    }),
    makeEvent({
      eventId: "u8-mid-local",
      occurredAt: "2026-07-14T04:00:00.000Z",
      tokens: 20,
    }),
    makeEvent({
      eventId: "u8-late-local",
      occurredAt: "2026-07-14T15:30:00.000Z",
      tokens: 40,
    }),
    makeEvent({
      eventId: "u8-next-local",
      occurredAt: "2026-07-14T16:30:00.000Z",
      tokens: 80,
    }),
  ];
  for (const e of events) writeEvent(e);

  const result = await queryLlmUsage({
    from,
    to,
    fromLabel: "2026-07-14",
    toLabel: "2026-07-14",
  });

  // On UTC+8 hosts, the three mid-range events fall inside local 7/14.
  // On other offsets, still assert only events whose local day is 7/14.
  const expected = events.filter((e) => {
    const d = new Date(e.occurredAt);
    return formatLocalDate(d) === "2026-07-14";
  });
  assert.ok(expected.length >= 1, "fixture must produce at least one in-range event");
  assert.equal(result.totals.calls, expected.length);
  assert.equal(
    result.totals.totalTokens,
    expected.reduce((sum, e) => sum + e.usage.totalTokens, 0),
  );
  assert.deepEqual(
    result.byDay.map((d) => d.date),
    ["2026-07-14"],
  );

  // When host is UTC+8, the classic three-event / 70-token assertion holds.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  if (offsetHours === 8) {
    assert.equal(result.totals.calls, 3);
    assert.equal(result.totals.totalTokens, 70);
    assert.equal(result.range.timezone.includes("Shanghai") || result.range.timezone.length > 0, true);
  }
});

await test("range labels and timezone use local calendar semantics", async () => {
  wipeEvents();
  const from = parseLocalDateParam("2026-03-01", false);
  const to = parseLocalDateParam("2026-03-02", true);
  assert.ok(from && to);

  writeEvent(
    makeEvent({
      eventId: "range-label",
      occurredAt: new Date(from.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      tokens: 5,
    }),
  );

  const result = await queryLlmUsage({
    from,
    to,
    fromLabel: "2026-03-01",
    toLabel: "2026-03-02",
  });

  assert.equal(result.range.from, "2026-03-01");
  assert.equal(result.range.to, "2026-03-02");
  assert.notEqual(result.range.timezone, "UTC");
  assert.equal(result.range.timezone, localTimeZone(from));
  // byDay must not use UTC-only slice of ISO when labels are local.
  for (const day of result.byDay) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(day.date >= "2026-03-01" && day.date <= "2026-03-02");
  }
});

await test("byDay groups by local calendar day across multi-day range", async () => {
  wipeEvents();
  const from = parseLocalDateParam("2026-07-14", false);
  const to = parseLocalDateParam("2026-07-15", true);
  assert.ok(from && to);

  // Place one event in the middle of each local day.
  const mid14 = new Date(from.getTime() + 12 * 60 * 60 * 1000);
  const mid15 = new Date(parseLocalDateParam("2026-07-15", false).getTime() + 12 * 60 * 60 * 1000);

  writeEvent(
    makeEvent({
      eventId: "day-14",
      occurredAt: mid14.toISOString(),
      tokens: 14,
    }),
  );
  writeEvent(
    makeEvent({
      eventId: "day-15",
      occurredAt: mid15.toISOString(),
      tokens: 15,
    }),
  );

  const result = await queryLlmUsage({
    from,
    to,
    fromLabel: "2026-07-14",
    toLabel: "2026-07-15",
  });

  assert.equal(result.totals.calls, 2);
  assert.deepEqual(
    result.byDay.map((d) => ({ date: d.date, tokens: d.totals.totalTokens })),
    [
      { date: "2026-07-14", tokens: 14 },
      { date: "2026-07-15", tokens: 15 },
    ],
  );
});

// ---------------------------------------------------------------------------
// cache isolation + validation
// ---------------------------------------------------------------------------

process.stdout.write("\ncache + validation\n");

await test("cache key isolates full instants and filters", async () => {
  wipeEvents();
  const day = "2026-07-20";
  const from = parseLocalDateParam(day, false);
  const to = parseLocalDateParam(day, true);
  assert.ok(from && to);

  writeEvent(
    makeEvent({
      eventId: "cache-a",
      occurredAt: new Date(from.getTime() + 1000).toISOString(),
      tokens: 9,
      provider: "openai",
      model: "m-a",
      source: "chat",
      status: "success",
    }),
  );
  writeEvent(
    makeEvent({
      eventId: "cache-b",
      occurredAt: new Date(from.getTime() + 2000).toISOString(),
      tokens: 7,
      provider: "anthropic",
      model: "m-b",
      source: "studio_sdk",
      status: "error",
    }),
  );

  const all = await queryLlmUsage({
    from,
    to,
    fromLabel: day,
    toLabel: day,
  });
  assert.equal(all.totals.calls, 2);

  const byProvider = await queryLlmUsage({
    from,
    to,
    fromLabel: day,
    toLabel: day,
    provider: "openai",
  });
  assert.equal(byProvider.totals.calls, 1);
  assert.equal(byProvider.totals.totalTokens, 9);

  const byStatus = await queryLlmUsage({
    from,
    to,
    fromLabel: day,
    toLabel: day,
    status: "error",
  });
  assert.equal(byStatus.totals.calls, 1);
  assert.equal(byStatus.totals.totalTokens, 7);

  // Same UTC date labels but different instants must not share cache.
  // Shift the end by 1ms while keeping labels; second query must re-filter.
  const tighterTo = new Date(to.getTime() - 1);
  writeEvent(
    makeEvent({
      eventId: "cache-boundary",
      occurredAt: to.toISOString(), // exactly at original end
      tokens: 100,
    }),
  );
  clearLlmUsageQueryCacheForTest();
  const fullEnd = await queryLlmUsage({
    from,
    to,
    fromLabel: day,
    toLabel: day,
  });
  const tightEnd = await queryLlmUsage({
    from,
    to: tighterTo,
    fromLabel: day,
    toLabel: day,
  });
  assert.equal(fullEnd.totals.calls, 3);
  assert.equal(tightEnd.totals.calls, 2, "1ms-shorter end must exclude boundary event");
});

await test("rejects from > to and ranges over 366 days", async () => {
  const from = parseLocalDateParam("2026-07-15", false);
  const to = parseLocalDateParam("2026-07-14", true);
  assert.ok(from && to);
  await assert.rejects(
    () => queryLlmUsage({ from, to, fromLabel: "2026-07-15", toLabel: "2026-07-14" }),
    (err) => err instanceof QueryValidationError,
  );

  const longFrom = parseLocalDateParam("2025-01-01", false);
  const longTo = parseLocalDateParam("2026-01-03", true); // > 366 days
  assert.ok(longFrom && longTo);
  await assert.rejects(
    () =>
      queryLlmUsage({
        from: longFrom,
        to: longTo,
        fromLabel: "2025-01-01",
        toLabel: "2026-01-03",
      }),
    (err) =>
      err instanceof QueryValidationError &&
      /maximum of 366 days/.test(err.message),
  );
});

await test("366-day inclusive range is accepted", async () => {
  wipeEvents();
  const from = parseLocalDateParam("2025-01-01", false);
  // 366 local days: 2025-01-01 through 2026-01-01 inclusive
  const to = parseLocalDateParam("2026-01-01", true);
  assert.ok(from && to);
  const result = await queryLlmUsage({
    from,
    to,
    fromLabel: "2025-01-01",
    toLabel: "2026-01-01",
  });
  assert.equal(result.kind, "llm_usage_stats");
  assert.equal(result.range.from, "2025-01-01");
  assert.equal(result.range.to, "2026-01-01");
});

// ---------------------------------------------------------------------------
// Summary / cleanup
// ---------------------------------------------------------------------------

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
rmSync(agentDir, { recursive: true, force: true });

if (failed > 0) {
  process.stdout.write("\nFailures:\n");
  for (const e of errors) process.stdout.write(`- ${e}\n`);
  process.exit(1);
}
