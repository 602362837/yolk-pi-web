#!/usr/bin/env node
/**
 * Provider top-bar usage compact / N-ring / aggregate-shell contract checks.
 *
 * Covers (USAGE-FIX-04 + USAGE-AGG-02 compact/aggregate contracts):
 * - Shared ProviderUsageTrigger full/compact presentation primitive
 * - Shared dynamic-window projector: permutation, only-one, unknown/tie, center outer
 * - Duration resolver positive/negative evidence (no Limits/remaining/reset guesses)
 * - Aggregate hover/focus columns shell (no accordion / no fetch / no total ring)
 * - Theme tokens + panel large ring (≥ trigger 30px) + responsive column breakpoints
 * - GPT/Grok/Kiro actual-window adapters via shared projector
 * - Single app-top-usage-panel host, GPT→Grok→Kiro order, one right padding
 * - KiroUsagePanel accountId/generation guards and safe short fallbacks (no 0% invent)
 * - No secret/raw payload projection in Kiro panel source
 *
 * Run:
 *   npm run test:provider-usage-compact
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-provider-usage-compact.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function pass(name) {
  console.log(`  ok  - ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  FAIL- ${name}`);
  console.error(error);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

const {
  DEFAULT_PI_WEB_CONFIG,
} = await import("../lib/pi-web-config.ts");

const contract = await import("../components/ProviderUsagePanelContract.ts");

await test("usage.providerPanelsCompact defaults to false (full triggers)", () => {
  assert.equal(DEFAULT_PI_WEB_CONFIG.usage.providerPanelsCompact, false);
  assert.equal(DEFAULT_PI_WEB_CONFIG.kiro.usagePanelEnabled, false);
});

await test("ProviderUsageTrigger is pure presentational full/compact primitive", () => {
  const trigger = read("components/ProviderUsageTrigger.tsx");
  assert.match(trigger, /export type ProviderUsageDisplayMode = "full" \| "compact"/);
  assert.match(trigger, /export function ProviderUsageTrigger/);
  assert.match(trigger, /displayMode === "compact"/);
  assert.match(trigger, /compactSummaries\.slice\(0, 2\)/);
  assert.match(trigger, /compactFallback/);
  assert.match(trigger, /providerLabel/);
  assert.match(trigger, /ringUnit/);
  assert.match(trigger, /ProviderUsageRingUnitView/);
  // Must not own network / accounts / quota state machines.
  assert.doesNotMatch(trigger, /fetch\(|useState|useEffect|\/api\/auth/);
  assert.doesNotMatch(trigger, /openai-codex|grok-cli|kiro_subscription_quota/);
});

await test("shared N-ring contract: center outermost + independent tone + clamp", () => {
  const {
    clampUsagePercent,
    toneForUsagePercent,
    formatRingCenterValue,
    isValidRingUnitCenter,
    assertRingUnitCenterInvariant,
    createProviderUsageRingUnit,
    layerIdentityForIndex,
    buildRingUnitAriaLabel,
    PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS,
    PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS,
  } = contract;

  assert.equal(clampUsagePercent(null), null);
  assert.equal(clampUsagePercent(undefined), null);
  assert.equal(clampUsagePercent(-5), 0);
  assert.equal(clampUsagePercent(142), 100);
  assert.equal(clampUsagePercent(42.6), 42.6);

  assert.equal(toneForUsagePercent(null), "muted");
  assert.equal(toneForUsagePercent(0), "normal");
  assert.equal(toneForUsagePercent(79.9), "normal");
  assert.equal(toneForUsagePercent(80), "warning");
  assert.equal(toneForUsagePercent(94.9), "warning");
  assert.equal(toneForUsagePercent(95), "danger");
  assert.equal(toneForUsagePercent(100), "danger");

  assert.equal(formatRingCenterValue(null), "—");
  assert.equal(formatRingCenterValue(null, "余 125"), "余 125");
  assert.equal(formatRingCenterValue(42.2), "42%");
  // Unknown never becomes 0%.
  assert.notEqual(formatRingCenterValue(null), "0%");

  assert.equal(layerIdentityForIndex(0), "layer-0");
  assert.equal(layerIdentityForIndex(1), "layer-1");
  assert.equal(layerIdentityForIndex(2), "layer-2");
  assert.equal(layerIdentityForIndex(5), "layer-2");

  assert.equal(PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS, 220);
  assert.ok(PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("accountId"));
  assert.ok(PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("profileArn"));

  // 1 layer
  const single = createProviderUsageRingUnit({
    layers: [{
      id: "gpt-week",
      shortLabel: "周",
      fullLabel: "周额度",
      percent: 37,
      title: "周额度已使用 37%",
    }],
    providerLabel: "GPT",
  });
  assert.equal(single.layers.length, 1);
  assert.equal(single.centerLayerId, "gpt-week");
  assert.equal(isValidRingUnitCenter(single), true);

  // 2 layers outer→inner (5h, week) — center 5h
  const dual = createProviderUsageRingUnit({
    layers: [
      {
        id: "gpt-5h",
        shortLabel: "5h",
        fullLabel: "5 小时额度",
        percent: 42,
        title: "5 小时已使用 42%",
      },
      {
        id: "gpt-week",
        shortLabel: "周",
        fullLabel: "周额度",
        percent: 37,
        title: "周额度已使用 37%",
      },
    ],
    providerLabel: "GPT",
  });
  assert.equal(dual.layers.length, 2);
  assert.equal(dual.layers[0].id, "gpt-5h");
  assert.equal(dual.layers[1].id, "gpt-week");
  assert.equal(dual.centerLayerId, "gpt-5h");
  assert.match(dual.ariaLabel, /5 小时额度 42%/);
  assert.match(dual.ariaLabel, /中心为外圈优先层 5h 42%/);

  // Outer unknown percent keeps outer layer/center and shows — (never borrows inner)
  const innerUnknown = createProviderUsageRingUnit({
    layers: [
      {
        id: "gpt-5h",
        shortLabel: "5h",
        fullLabel: "5 小时额度",
        percent: null,
        title: "5 小时额度未知",
      },
      {
        id: "gpt-week",
        shortLabel: "周",
        fullLabel: "周额度",
        percent: 37,
        title: "周额度已使用 37%",
      },
    ],
  });
  assert.equal(innerUnknown.centerLayerId, "gpt-5h");
  assert.equal(formatRingCenterValue(innerUnknown.layers[0].percent), "—");
  // Must not borrow other percent for center.
  assert.notEqual(formatRingCenterValue(innerUnknown.layers[0].percent), "37%");

  // Grok outer week / inner month — center week
  const grok = createProviderUsageRingUnit({
    layers: [
      {
        id: "grok-week",
        shortLabel: "周",
        fullLabel: "周额度",
        percent: 51,
        title: "周额度已使用 51%",
      },
      {
        id: "grok-month",
        shortLabel: "月",
        fullLabel: "月度额度",
        percent: 73,
        title: "月度已使用 73%",
      },
    ],
    providerLabel: "Grok",
  });
  assert.equal(grok.centerLayerId, "grok-week");
  assert.match(grok.ariaLabel, /中心为外圈优先层 周 51%/);

  // 3 layers all rendered, no +N
  const triple = createProviderUsageRingUnit({
    layers: [
      {
        id: "kiro-hourly",
        shortLabel: "Hourly",
        fullLabel: "Hourly",
        percent: 10,
        title: "Hourly 10%",
      },
      {
        id: "kiro-daily",
        shortLabel: "Daily",
        fullLabel: "Daily",
        percent: 20,
        title: "Daily 20%",
      },
      {
        id: "kiro-limits",
        shortLabel: "Limits",
        fullLabel: "Limits",
        percent: 75,
        title: "Limits 75%",
      },
    ],
  });
  assert.equal(triple.layers.length, 3);
  assert.equal(triple.centerLayerId, "kiro-hourly");
  assert.equal(triple.layers.map((layer) => layer.id).join(","), "kiro-hourly,kiro-daily,kiro-limits");

  // Invalid center must throw (no silent fallback)
  assert.throws(
    () =>
      assertRingUnitCenterInvariant({
        layers: dual.layers,
        centerLayerId: "gpt-week",
        ariaLabel: "bad",
      }),
    /centerLayerId must equal outermost/,
  );

  const aria = buildRingUnitAriaLabel(dual.layers, { providerLabel: "GPT" });
  assert.match(aria, /GPT/);
  assert.match(aria, /周额度 37%/);
  assert.match(aria, /5 小时额度 42%/);
  assert.match(aria, /中心为外圈优先层/);
});

await test("shared duration resolver accepts trusted periods and rejects guess signals", () => {
  const { resolveUsageWindowDuration } = contract;

  assert.equal(resolveUsageWindowDuration({ durationMs: 90 * 60_000 })?.durationMs, 90 * 60_000);
  assert.equal(resolveUsageWindowDuration({ durationEvidence: "90m" })?.durationMs, 90 * 60_000);
  assert.equal(resolveUsageWindowDuration({ durationEvidence: "2h" })?.durationMs, 2 * 3_600_000);
  assert.equal(resolveUsageWindowDuration({ durationEvidence: "7d" })?.durationMs, 7 * 86_400_000);
  assert.equal(resolveUsageWindowDuration({ durationEvidence: "five_hour" })?.durationMs, 5 * 3_600_000);
  assert.equal(resolveUsageWindowDuration({ durationEvidence: "seven_day" })?.durationMs, 7 * 86_400_000);
  assert.equal(resolveUsageWindowDuration({ token: "weekly" })?.durationMs, 7 * 86_400_000);
  assert.equal(resolveUsageWindowDuration({ token: "monthly" })?.durationMs, 30 * 86_400_000);
  assert.equal(resolveUsageWindowDuration({ label: "Hourly credits" })?.evidence, "label:hour");
  assert.equal(resolveUsageWindowDuration({ label: "周额度" })?.durationMs, 7 * 86_400_000);

  // Explicit non-positive / non-finite durations are rejected.
  assert.equal(resolveUsageWindowDuration({ durationMs: 0 }), null);
  assert.equal(resolveUsageWindowDuration({ durationMs: -5 }), null);
  assert.equal(resolveUsageWindowDuration({ durationMs: Number.NaN }), null);

  // Forbidden guess signals — never become duration.
  for (const bad of [
    "Limits",
    "quota",
    "quota envelope",
    "subscription limit",
    "remaining",
    "remaining 10",
    "reset",
    "reset tomorrow",
    "resourceType",
    "resource type",
    "gpt",
    "grok",
    "kiro",
  ]) {
    assert.equal(
      resolveUsageWindowDuration({ durationEvidence: bad, token: bad, label: bad }),
      null,
      `must reject duration guess from ${bad}`,
    );
  }
});

await test("shared projector: permutation, only-one, unknown/tie, outer unknown center", () => {
  const {
    projectProviderUsageWindows,
    resolveRingUnitCenterLayer,
    formatRingCenterValue,
    isValidRingUnitCenter,
    PROVIDER_USAGE_DETAIL_ONLY_NOTE,
  } = contract;

  const cand = (partial) => ({
    present: true,
    trusted: true,
    percent: 10,
    title: `${partial.shortLabel} usage`,
    fullLabel: partial.fullLabel ?? partial.shortLabel,
    durationMs: null,
    ...partial,
  });

  // Input permutation [7d, 2h, 1d] and all orders → outer short→long [2h,1d,7d].
  const mixedBase = [
    cand({ id: "w7", shortLabel: "7d", durationEvidence: "7d", percent: 70 }),
    cand({ id: "h2", shortLabel: "2h", durationEvidence: "2h", percent: 20 }),
    cand({ id: "d1", shortLabel: "1d", durationEvidence: "1d", percent: 40 }),
  ];
  const permutations = [
    mixedBase,
    [mixedBase[1], mixedBase[2], mixedBase[0]],
    [mixedBase[2], mixedBase[0], mixedBase[1]],
    [mixedBase[0], mixedBase[2], mixedBase[1]],
  ];
  for (const input of permutations) {
    const result = projectProviderUsageWindows(input);
    assert.equal(result.mode, "ordered-multi");
    assert.deepEqual(result.ringUnit.layers.map((layer) => layer.id), ["h2", "d1", "w7"]);
    assert.equal(result.ringUnit.centerLayerId, "h2");
    assert.equal(result.ringUnit.centerLayerId, result.ringUnit.layers[0].id);
    assert.ok(isValidRingUnitCenter(result.ringUnit));
    assert.equal(resolveRingUnitCenterLayer(result.ringUnit).id, "h2");
    assert.equal(result.detailOnlyCandidateIds.length, 0);
    assert.equal(result.detailNote, null);
  }

  // Provider key must not exist on projector signature / not affect output.
  const contractSource = read("components/ProviderUsagePanelContract.ts");
  assert.match(contractSource, /export function projectProviderUsageWindows/);
  assert.doesNotMatch(
    contractSource,
    /projectProviderUsageWindows\([^)]*providerKey|function projectProviderUsageWindows\([\s\S]*provider:\s*ProviderUsageKey/,
  );
  // Same candidate set under different provider labels must keep identical layer order.
  const crossA = projectProviderUsageWindows(mixedBase, { providerLabel: "GPT" });
  const crossB = projectProviderUsageWindows(mixedBase, { providerLabel: "Grok" });
  const crossC = projectProviderUsageWindows(mixedBase, { providerLabel: "Kiro" });
  assert.deepEqual(
    crossA.ringUnit.layers.map((layer) => layer.id),
    crossB.ringUnit.layers.map((layer) => layer.id),
  );
  assert.deepEqual(
    crossA.ringUnit.layers.map((layer) => layer.id),
    crossC.ringUnit.layers.map((layer) => layer.id),
  );
  assert.equal(crossA.ringUnit.centerLayerId, crossB.ringUnit.centerLayerId);
  assert.equal(crossA.ringUnit.centerLayerId, crossC.ringUnit.centerLayerId);

  // only-one known
  const onlyKnown = projectProviderUsageWindows([
    cand({ id: "only-7d", shortLabel: "7d", durationEvidence: "seven_day", percent: 37 }),
  ]);
  assert.equal(onlyKnown.mode, "single");
  assert.equal(onlyKnown.ringUnit.layers.length, 1);
  assert.equal(onlyKnown.ringUnit.centerLayerId, "only-7d");

  // only-one unknown duration still single ring (no ordering ambiguity)
  const onlyUnknown = projectProviderUsageWindows([
    cand({ id: "mystery", shortLabel: "Quota", fullLabel: "Mystery quota", percent: 12 }),
  ]);
  assert.equal(onlyUnknown.mode, "single");
  assert.equal(onlyUnknown.ringUnit.layers.length, 1);
  assert.equal(onlyUnknown.ringUnit.centerLayerId, "mystery");

  // known + unknown → known ring(s), unknown detail-only
  const knownPlusUnknown = projectProviderUsageWindows([
    cand({ id: "unk", shortLabel: "Other", fullLabel: "Other bucket" }),
    cand({ id: "week", shortLabel: "周", durationEvidence: "weekly", percent: 51 }),
    cand({ id: "hour", shortLabel: "h", durationEvidence: "hourly", percent: 10 }),
  ]);
  assert.equal(knownPlusUnknown.mode, "ordered-multi");
  assert.deepEqual(knownPlusUnknown.ringUnit.layers.map((layer) => layer.id), ["hour", "week"]);
  assert.deepEqual(knownPlusUnknown.detailOnlyCandidateIds, ["unk"]);
  assert.equal(knownPlusUnknown.detailNote, PROVIDER_USAGE_DETAIL_ONLY_NOTE);

  // one known + unknown multi → degraded-single
  const degraded = projectProviderUsageWindows([
    cand({ id: "u1", shortLabel: "A", fullLabel: "Alpha limits" }),
    cand({ id: "week-only", shortLabel: "周", durationEvidence: "week", percent: 22 }),
    cand({ id: "u2", shortLabel: "B", fullLabel: "Beta remaining" }),
  ]);
  assert.equal(degraded.mode, "degraded-single");
  assert.equal(degraded.ringUnit.layers.length, 1);
  assert.equal(degraded.ringUnit.centerLayerId, "week-only");
  assert.ok(degraded.detailOnlyCandidateIds.includes("u1"));
  assert.ok(degraded.detailOnlyCandidateIds.includes("u2"));
  assert.equal(degraded.detailNote, PROVIDER_USAGE_DETAIL_ONLY_NOTE);

  // all unknown multi → detail-only, no fabricated ring/center
  const allUnknown = projectProviderUsageWindows([
    cand({ id: "x", shortLabel: "X", fullLabel: "Limits" }),
    cand({ id: "y", shortLabel: "Y", fullLabel: "quota" }),
  ]);
  assert.equal(allUnknown.mode, "detail-only");
  assert.equal(allUnknown.ringUnit, null);
  assert.deepEqual(allUnknown.detailOnlyCandidateIds.sort(), ["x", "y"]);
  assert.equal(allUnknown.detailNote, PROVIDER_USAGE_DETAIL_ONLY_NOTE);

  // duplicate duration tie → neither wins by id/array order
  const tied = projectProviderUsageWindows([
    cand({ id: "z-week", shortLabel: "Z", durationEvidence: "weekly", percent: 1 }),
    cand({ id: "a-week", shortLabel: "A", durationEvidence: "weekly", percent: 2 }),
    cand({ id: "hour", shortLabel: "h", durationEvidence: "hourly", percent: 3 }),
  ]);
  assert.equal(tied.mode, "degraded-single");
  assert.equal(tied.ringUnit.layers.length, 1);
  assert.equal(tied.ringUnit.centerLayerId, "hour");
  assert.ok(tied.detailOnlyCandidateIds.includes("z-week"));
  assert.ok(tied.detailOnlyCandidateIds.includes("a-week"));
  // Reversed input must not pick a different tied winner into the ring.
  const tiedReversed = projectProviderUsageWindows([
    cand({ id: "a-week", shortLabel: "A", durationEvidence: "weekly", percent: 2 }),
    cand({ id: "z-week", shortLabel: "Z", durationEvidence: "weekly", percent: 1 }),
    cand({ id: "hour", shortLabel: "h", durationEvidence: "hourly", percent: 3 }),
  ]);
  assert.deepEqual(
    tiedReversed.ringUnit.layers.map((layer) => layer.id),
    tied.ringUnit.layers.map((layer) => layer.id),
  );

  // all-tied multi → detail-only
  const allTied = projectProviderUsageWindows([
    cand({ id: "b", shortLabel: "B", durationEvidence: "day", percent: 1 }),
    cand({ id: "a", shortLabel: "A", durationEvidence: "daily", percent: 2 }),
  ]);
  assert.equal(allTied.mode, "detail-only");
  assert.equal(allTied.ringUnit, null);

  // outer percent unknown keeps outer label + same-bucket fallback; never inner percent
  const outerUnknown = projectProviderUsageWindows([
    cand({
      id: "outer",
      shortLabel: "5h",
      durationEvidence: "5h",
      percent: null,
      unknownCenterValue: "余 80",
    }),
    cand({ id: "inner", shortLabel: "周", durationEvidence: "7d", percent: 37 }),
  ]);
  assert.equal(outerUnknown.mode, "ordered-multi");
  assert.equal(outerUnknown.ringUnit.centerLayerId, "outer");
  assert.equal(outerUnknown.ringUnit.layers[0].percent, null);
  assert.equal(outerUnknown.ringUnit.layers[1].percent, 37);
  assert.equal(
    formatRingCenterValue(outerUnknown.ringUnit.layers[0].percent, outerUnknown.ringUnit.unknownCenterValue),
    "余 80",
  );
  assert.notEqual(
    formatRingCenterValue(outerUnknown.ringUnit.layers[0].percent, outerUnknown.ringUnit.unknownCenterValue),
    "37%",
  );
  assert.equal(resolveRingUnitCenterLayer(outerUnknown.ringUnit).id, "outer");

  // Invalid / absent candidates filtered out
  const filtered = projectProviderUsageWindows([
    cand({ id: "ok", shortLabel: "周", durationEvidence: "week", present: true, trusted: true }),
    cand({ id: "ghost", shortLabel: "5h", durationEvidence: "5h", present: false, trusted: true }),
    cand({ id: "unsafe", shortLabel: "月", durationEvidence: "month", present: true, trusted: false }),
    { id: "", shortLabel: "x", fullLabel: "x", title: "x", present: true, trusted: true, percent: 1, durationMs: null },
  ]);
  assert.equal(filtered.mode, "single");
  assert.equal(filtered.ringUnit.centerLayerId, "ok");

  // empty
  const empty = projectProviderUsageWindows([]);
  assert.equal(empty.mode, "empty");
  assert.equal(empty.ringUnit, null);

  // resolveRingUnitCenterLayer fails loud on illegal center
  assert.throws(
    () =>
      resolveRingUnitCenterLayer({
        layers: outerUnknown.ringUnit.layers,
        centerLayerId: "inner",
        ariaLabel: "bad",
      }),
    /centerLayerId must equal outermost/,
  );
});

await test("ProviderUsageRingUnitView encodes layer identity, tone, sheen hooks", () => {
  const trigger = read("components/ProviderUsageTrigger.tsx");
  assert.match(trigger, /export function ProviderUsageRingUnitView/);
  assert.match(trigger, /data-layer-identity/);
  assert.match(trigger, /data-tone/);
  assert.match(trigger, /provider-usage-ring-unit__sheen|sheen-flow/);
  assert.match(trigger, /<mask|mask=\{`url/);
  assert.match(trigger, /layer-0|layerIdentityForIndex/);
  assert.match(trigger, /centerLayerId/);
  assert.match(trigger, /assertRingUnitCenterInvariant/);
  assert.match(trigger, /resolveRingUnitCenterLayer/);
  // Center must be resolved by id, not by reading the last layer.
  assert.doesNotMatch(trigger, /layers\[layers\.length - 1\]|layers\.at\(-1\)/);
  // Unknown percent must not set aria-valuenow=0 on the unit.
  assert.doesNotMatch(trigger, /aria-valuenow=\{0\}|aria-valuenow=\{percent === null \? 0/);
  // All safe layers render — no runtime truncation of layers array.
  assert.doesNotMatch(trigger, /layers\.slice\(0,\s*2\)|maxLayers\s*=/);
  assert.doesNotMatch(trigger, /unit\.layers\.slice|layers\.filter\(/);
  // Geometry adapts for 1/2/3+ layers.
  assert.match(trigger, /layerCount <= 1|layerCount === 2/);
});

await test("ProviderUsageAggregatePanel is hover/focus columns shell without fetch", () => {
  const panel = read("components/ProviderUsageAggregatePanel.tsx");
  assert.match(panel, /export function ProviderUsageAggregatePanel/);
  assert.match(panel, /PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS/);
  assert.match(panel, /220/);
  assert.match(panel, /aria-haspopup="dialog"/);
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /aria-controls=/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /escapeSuppressedRef/);
  assert.match(panel, /scheduleClose/);
  assert.match(panel, /onPointerEnter/);
  assert.match(panel, /onPointerLeave/);
  assert.match(panel, /onFocusCapture|handlePanelFocusIn/);
  assert.match(panel, /onBlurCapture|handlePanelFocusOut/);
  assert.match(panel, /document\.activeElement/);
  assert.match(panel, /provider-usage-aggregate__columns/);
  assert.match(panel, /gridTemplateColumns/);
  assert.match(panel, /ProviderUsageRingUnitView/);
  // Non-accordion: all columns always rendered when open (map over sortedColumns).
  assert.match(panel, /sortedColumns\.map/);
  assert.doesNotMatch(panel, /expandedKey|setExpandedProvider|activeProviderKey|expandedProvider/);
  assert.match(panel, /non-accordion|provider columns/i);
  // No total ring / composite percent.
  assert.doesNotMatch(panel, /totalPercent|overallRing|averagePercent|总环|总百分比/);
  // Shell must not fetch or call provider APIs.
  assert.doesNotMatch(panel, /fetch\(|\/api\/auth|GetUsageLimits|kiro_subscription_quota/);
  // Forbidden secret fields must not appear as projection consumers.
  assert.doesNotMatch(panel, /accountId|profileArn|clientSecret|access_token|refresh_token/);
  // Escape closes; pointer leave does not force focus back.
  assert.match(panel, /Escape/);
  assert.match(panel, /triggerRef\.current\.focus/);
});

await test("AppShell mounts GPT→Grok→Kiro with one host and global displayMode", () => {
  const appShell = read("components/AppShell.tsx");
  assert.match(appShell, /import \{ KiroUsagePanel \} from "\.\/KiroUsagePanel"/);
  assert.match(appShell, /showKiroUsage = webConfig\?\.kiro\.usagePanelEnabled === true/);
  assert.match(appShell, /showAnyProviderUsage = showChatGptUsage \|\| showGrokUsage \|\| showKiroUsage/);
  assert.match(appShell, /providerUsageDisplayMode/);
  // Compact applies only when not aggregated (aggregate presentation priority).
  assert.match(appShell, /!providerUsageAggregated && webConfig\?\.usage\.providerPanelsCompact === true \? "compact" : "full"/);
  assert.match(appShell, /app-top-usage-panel/);
  assert.match(appShell, /showAnyProviderUsage \? 12 : rightPanelTogglePadding/);

  // Standalone order: GPT then Grok then Kiro in the single host (JSX-mutex with aggregate).
  const gptIdx = appShell.indexOf("<ChatGptUsagePanel");
  const grokIdx = appShell.indexOf("<GrokUsagePanel");
  const kiroIdx = appShell.indexOf("<KiroUsagePanel");
  assert.ok(gptIdx > 0 && grokIdx > gptIdx && kiroIdx > grokIdx, "expected GPT → Grok → Kiro mount order");

  assert.match(appShell, /displayMode=\{providerUsageDisplayMode\}/);
  // Only one paddingRight assignment on the usage host.
  const hostBlock = appShell.slice(
    appShell.indexOf("app-top-usage-panel"),
    appShell.indexOf("app-top-usage-panel") + 1400,
  );
  assert.equal((hostBlock.match(/paddingRight/g) || []).length, 1);
});

await test("ChatGptUsagePanel keeps 5h/week schema and accepts displayMode", () => {
  const panel = read("components/ChatGptUsagePanel.tsx");
  assert.match(panel, /displayMode\?: ProviderUsageDisplayMode/);
  assert.match(panel, /displayMode = "full"/);
  assert.match(panel, /ProviderUsageTrigger/);
  // Actual tiers → shared projector (no fixed 5h/7d push).
  assert.match(panel, /ringUnit=\{ringUnit\}/);
  assert.match(panel, /buildChatGptUsageRingUnit/);
  assert.match(panel, /buildChatGptUsageWindowCandidates/);
  assert.match(panel, /projectProviderUsageWindows/);
  assert.match(panel, /gpt-week/);
  assert.match(panel, /gpt-5h/);
  assert.match(panel, /["']周["']/);
  assert.match(panel, /["']5h["']/);
  assert.doesNotMatch(panel, /hasFiveHour[\s\S]{0,120}layers\.push/);
  assert.doesNotMatch(panel, /compactSummaries|summaries\.push|ProviderUsageCompactSummary/);
  assert.doesNotMatch(panel, /月度额度|monthly\.utilization|GrokQuotaResultV1|kiro_subscription_quota/);
  assert.match(panel, /compactFallback/);
  assert.match(panel, /需登录|额度未知|登录/);
  // Aggregate presentation reuses detail without own trigger/dialog.
  assert.match(panel, /presentation\?: ChatGptUsagePresentation/);
  assert.match(panel, /presentation = "standalone"/);
  assert.match(panel, /data-presentation="aggregate"/);
  assert.match(panel, /onAggregateProjectionChange/);
});

await test("GrokUsagePanel keeps month/week schema and accepts displayMode", () => {
  const panel = read("components/GrokUsagePanel.tsx");
  const projection = read("components/GrokUsageProjection.ts");
  assert.match(panel, /displayMode\?: ProviderUsageDisplayMode/);
  assert.match(panel, /displayMode = "full"/);
  assert.match(panel, /ProviderUsageTrigger/);
  assert.match(projection, /shortLabel: "月"/);
  assert.match(projection, /shortLabel: "周"/);
  assert.match(projection, /buildGrokUsageRingUnit|projectProviderUsageWindows/);
  assert.match(projection, /buildGrokUsageWindowCandidates/);
  assert.match(projection, /id: "grok-month"/);
  assert.match(projection, /id: "grok-week"/);
  assert.match(projection, /durationEvidence: "weekly"/);
  assert.match(projection, /durationEvidence: "monthly"/);
  assert.match(panel, /ringUnit=\{aggregateProjection\.ringUnit\}/);
  assert.match(panel, /presentationMode = "standalone"/);
  assert.match(panel, /quota\?\.monthly|monthlyPercent|weeklyPercent/);
  assert.match(read("components/GrokUsageProjection.ts"), /weekly|monthly/);
  assert.doesNotMatch(panel, /five_hour|seven_day|kiro_subscription_quota|Reset credits/);
  assert.match(panel, /compactFallback/);
  // Normal quota no longer uses text summary chips.
  assert.doesNotMatch(panel, /compactSummaries/);
});

await test("KiroUsagePanel N-ring adapter + aggregate presentation + race guards", () => {
  const panel = read("components/KiroUsagePanel.tsx");
  assert.match(panel, /export function KiroUsagePanel/);
  assert.match(panel, /displayMode\?: ProviderUsageDisplayMode/);
  assert.match(panel, /presentation\?: KiroUsagePresentation/);
  assert.match(panel, /presentation = "standalone"/);
  assert.match(panel, /presentation === "aggregate"/);
  assert.match(panel, /onAggregateProjectionChange/);
  assert.match(panel, /projectKiroRingUnit/);
  assert.match(panel, /from "@\/lib\/kiro-usage-ring"/);
  assert.match(panel, /ringUnit=\{ringProjection\.ringUnit\}/);
  assert.match(panel, /ProviderUsageTrigger/);
  assert.match(panel, /KIRO_PROVIDER_ID = "kiro"/);
  assert.match(panel, /kind === "kiro_subscription_quota"/);
  assert.match(panel, /formatKiroRemaining/);
  assert.match(panel, /KIRO_EXTRA_WINDOWS_DETAIL_NOTE/);
  assert.match(panel, /ringProjection\.detailNote/);
  // No compact text-chip summary for normal quota; remaining is shortValue/unknown only.
  assert.doesNotMatch(panel, /compactSummaries|label: "剩余"/);
  // Must not invent percent from remaining.
  assert.doesNotMatch(panel, /percentFromRemaining|sortByRemaining/);
  // primary is detail highlight only — not multi-ring product default.
  assert.match(panel, /never decides multi-ring product shape|Detail highlight only|detail highlight only/i);

  const ringHelper = read("lib/kiro-usage-ring.ts");
  assert.match(ringHelper, /export function projectKiroRingUnit/);
  assert.match(ringHelper, /export function extractKiroBucketOrderEvidence/);
  assert.match(ringHelper, /projectProviderUsageWindows/);
  assert.match(ringHelper, /resolveUsageWindowDuration/);
  assert.match(ringHelper, /KIRO_EXTRA_WINDOWS_DETAIL_NOTE/);
  assert.match(ringHelper, /Never uses remaining, resetsAt|remaining never becomes percent/i);
  // Limits/quota envelope must not be guessed as 90d.
  assert.doesNotMatch(ringHelper, /90 \* 86_400_000|label:limits|Limits=90/);
  assert.doesNotMatch(ringHelper, /percentFromRemaining|sortByRemaining/);
  assert.doesNotMatch(ringHelper, /Date\.parse\([^)]*resetsAt/);
  assert.doesNotMatch(ringHelper, /resetsAt\s*\.\s*getTime|resetsAt\s*-\s*Date/);
  // primaryBucketId must not invent radial center.
  assert.doesNotMatch(ringHelper, /primaryBucketId/);
  assert.match(panel, /quotaRequestGen|accountsRequestGen/);
  assert.match(panel, /accountId && data\.accountId && data\.accountId !== accountId/);
  assert.match(panel, /setQuota\(null\)/);
  assert.match(panel, /quotaMatchesAccount|safeQuota/);
  assert.match(panel, /Math\.min\(392,/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /Escape/);
  assert.match(panel, /triggerRef\.current\?\.focus\(\)/);
  assert.match(panel, /role="progressbar"/);
  // Aggregate does not create its own trigger/dialog/outside handlers.
  assert.match(panel, /isAggregate \|\| !open/);
  assert.match(panel, /data-presentation="aggregate"/);
  assert.match(panel, /data-presentation="standalone"/);
  // Short compact fallbacks — never invent 0%.
  assert.match(panel, /fallback = "登录"/);
  assert.match(panel, /fallback = "加载中"/);
  assert.match(panel, /fallback = "需登录"/);
  assert.match(panel, /fallback = "不可用"/);
  assert.match(panel, /fallback = "额度未知"/);
  assert.doesNotMatch(panel, /invent(?:ed)?\s*0%|伪造\s*0%|fallback\s*=\s*["']0%/);
  // No secret / raw payload leakage patterns in UI source.
  assert.doesNotMatch(panel, /clientSecret|profileArn|refresh_token|access_token|userInfo/);
  assert.doesNotMatch(panel, /Reset credits|credential import|JSON import/i);
  assert.doesNotMatch(panel, /\{\s*[A-Za-z0-9_$.?]*\.error\.message\s*\}/);
});

await test("projectKiroRingUnit: shared projector, only-one, mixed, Limits unknown, remaining-only", async () => {
  const kiroMod = await import("../lib/kiro-usage-ring.ts");
  const {
    projectKiroRingUnit,
    extractKiroBucketOrderEvidence,
  } = kiroMod;
  const {
    isValidRingUnitCenter,
    formatRingCenterValue,
    toneForUsagePercent,
  } = contract;

  const bucket = (partial) => ({
    id: partial.id,
    label: partial.label,
    resourceType: partial.resourceType,
    used: partial.used ?? 0,
    limit: partial.limit ?? 100,
    remaining: partial.remaining ?? Math.max(0, (partial.limit ?? 100) - (partial.used ?? 0)),
    utilization: partial.utilization ?? ((partial.used ?? 0) / (partial.limit ?? 100)) * 100,
    unit: partial.unit,
    resetsAt: partial.resetsAt,
  });

  // 1 window → single ring even with unknown duration, center = that window.
  const single = projectKiroRingUnit([
    bucket({ id: "credit-0", label: "Credits", resourceType: "CREDIT", used: 25, limit: 100, utilization: 25 }),
  ]);
  assert.equal(single.mode, "single");
  assert.equal(single.ringUnit?.layers.length, 1);
  assert.equal(single.ringUnit?.centerLayerId, "credit-0");
  assert.ok(isValidRingUnitCenter(single.ringUnit));
  assert.equal(formatRingCenterValue(single.ringUnit.layers[0].percent), "25%");
  assert.equal(single.ringUnit.shortValue, "75");
  assert.equal(single.detailNote, null);

  // remaining-only / unknown utilization → percent null, center remaining fallback, shortValue remaining.
  const remainingOnly = projectKiroRingUnit([
    bucket({
      id: "limits-0",
      label: "Limits",
      used: 10,
      limit: 100,
      remaining: 90,
      utilization: Number.NaN,
    }),
  ]);
  assert.equal(remainingOnly.mode, "single");
  assert.equal(remainingOnly.ringUnit?.layers[0].percent, null);
  assert.equal(formatRingCenterValue(remainingOnly.ringUnit.layers[0].percent, remainingOnly.ringUnit.unknownCenterValue), "90");
  assert.notEqual(formatRingCenterValue(remainingOnly.ringUnit.layers[0].percent), "0%");
  assert.equal(toneForUsagePercent(remainingOnly.ringUnit.layers[0].percent), "muted");

  // Limits alone is not a duration; Daily alone becomes degraded-single, Limits stays detail-only.
  const dualWithLimits = projectKiroRingUnit([
    bucket({ id: "daily-1", label: "Daily", used: 20, limit: 100, utilization: 20 }),
    bucket({ id: "limits-0", label: "Limits", used: 40, limit: 100, utilization: 40 }),
  ]);
  assert.equal(dualWithLimits.mode, "degraded-single");
  assert.equal(dualWithLimits.ringUnit?.layers.length, 1);
  assert.equal(dualWithLimits.ringUnit.layers[0].id, "daily-1");
  assert.equal(dualWithLimits.ringUnit.centerLayerId, "daily-1");
  assert.ok(dualWithLimits.detailOnlyBucketIds.includes("limits-0"));
  assert.equal(dualWithLimits.detailNote, "另有窗口仅在详情展示");
  assert.ok(isValidRingUnitCenter(dualWithLimits.ringUnit));

  // Outer percent unknown keeps Daily remaining; never borrows another bucket.
  const dualOuterUnknown = projectKiroRingUnit([
    bucket({ id: "daily-1", label: "Daily", used: 20, limit: 100, utilization: Number.NaN, remaining: 80 }),
    bucket({ id: "weekly-0", label: "Weekly", used: 40, limit: 100, utilization: 40 }),
  ]);
  assert.equal(dualOuterUnknown.mode, "ordered-multi");
  assert.equal(dualOuterUnknown.ringUnit.layers[0].id, "daily-1");
  assert.equal(dualOuterUnknown.ringUnit.layers[1].id, "weekly-0");
  assert.equal(dualOuterUnknown.ringUnit.centerLayerId, "daily-1");
  assert.equal(dualOuterUnknown.ringUnit.layers[0].percent, null);
  assert.equal(formatRingCenterValue(dualOuterUnknown.ringUnit.layers[0].percent, dualOuterUnknown.ringUnit.unknownCenterValue), "80");
  assert.notEqual(formatRingCenterValue(dualOuterUnknown.ringUnit.layers[0].percent, dualOuterUnknown.ringUnit.unknownCenterValue), "40%");

  // 3 ordered windows outer→inner: Hourly, Daily, Weekly (Limits is not duration).
  const triple = projectKiroRingUnit([
    bucket({ id: "hourly-2", label: "Hourly", used: 10, limit: 100, utilization: 10 }),
    bucket({ id: "weekly-0", label: "Weekly", used: 50, limit: 100, utilization: 50 }),
    bucket({ id: "daily-1", label: "Daily", used: 20, limit: 100, utilization: 20 }),
  ]);
  assert.equal(triple.mode, "ordered-multi");
  assert.equal(triple.ringUnit.layers.map((layer) => layer.id).join(","), "hourly-2,daily-1,weekly-0");
  assert.equal(triple.ringUnit.centerLayerId, "hourly-2");
  assert.equal(triple.ringUnit.layers[0].orderEvidence, "label:hour");
  assert.equal(triple.ringUnit.layers[1].orderEvidence, "label:day");
  assert.equal(triple.ringUnit.layers[2].orderEvidence, "label:week");

  // Explicit numeric periods also project short→long regardless of input order.
  const numericMixed = projectKiroRingUnit([
    bucket({ id: "w7", label: "7d Credits", used: 30, limit: 100, utilization: 30 }),
    bucket({ id: "m90", label: "90m Credits", used: 10, limit: 100, utilization: 10 }),
    bucket({ id: "h2", label: "2h Credits", used: 20, limit: 100, utilization: 20 }),
  ]);
  assert.equal(numericMixed.mode, "ordered-multi");
  assert.equal(numericMixed.ringUnit.layers.map((layer) => layer.id).join(","), "m90,h2,w7");
  assert.equal(numericMixed.ringUnit.centerLayerId, "m90");

  // All-unknown multi → no fabricated ring; fixed detail note.
  const unordered = projectKiroRingUnit([
    bucket({ id: "a", label: "Alpha Credits", resourceType: "CREDIT", used: 1, limit: 10, utilization: 10 }),
    bucket({ id: "b", label: "Beta Vibe", resourceType: "VIBE", used: 2, limit: 10, utilization: 20 }),
  ]);
  assert.equal(unordered.mode, "detail-only");
  assert.equal(unordered.ringUnit, null);
  assert.ok(unordered.detailOnlyBucketIds.includes("a"));
  assert.ok(unordered.detailOnlyBucketIds.includes("b"));
  assert.equal(unordered.detailNote, "另有窗口仅在详情展示");

  // primaryBucketId is no longer accepted — must not invent a center from multi-unknown.
  const noPrimaryGuess = projectKiroRingUnit([
    bucket({ id: "a", label: "Alpha Credits", resourceType: "CREDIT", used: 1, limit: 10, utilization: 10 }),
    bucket({ id: "b", label: "Beta Vibe", resourceType: "VIBE", used: 2, limit: 10, utilization: 20 }),
  ]);
  assert.equal(noPrimaryGuess.ringUnit, null);
  assert.equal(noPrimaryGuess.mode, "detail-only");

  // Partial order: only ordered windows enter multi-ring; others stay detail-only.
  const partial = projectKiroRingUnit([
    bucket({ id: "daily-1", label: "Daily", used: 20, limit: 100, utilization: 20 }),
    bucket({ id: "mystery", label: "Mystery Pool", used: 5, limit: 50, utilization: 10 }),
    bucket({ id: "weekly-0", label: "Weekly", used: 40, limit: 100, utilization: 40 }),
  ]);
  assert.equal(partial.mode, "ordered-multi");
  assert.equal(partial.ringUnit.layers.map((layer) => layer.id).join(","), "daily-1,weekly-0");
  assert.ok(partial.detailOnlyBucketIds.includes("mystery"));
  assert.equal(partial.detailNote, "另有窗口仅在详情展示");

  // Order evidence must not use remaining/reset/array index/Limits alone.
  assert.equal(extractKiroBucketOrderEvidence({ id: "x", label: "Credits", resourceType: "CREDIT" }), null);
  assert.equal(extractKiroBucketOrderEvidence({ id: "lim", label: "Limits", resourceType: "CREDIT" }), null);
  assert.ok(extractKiroBucketOrderEvidence({ id: "y", label: "Weekly Credits", resourceType: "CREDIT" }));
  assert.equal(
    extractKiroBucketOrderEvidence({ id: "y", label: "Weekly Credits", resourceType: "CREDIT" }).evidence,
    "label:week",
  );

  // Layer percent comes only from utilization; remaining is auxiliary.
  const utilSource = projectKiroRingUnit([
    bucket({ id: "daily-1", label: "Daily", used: 80, limit: 100, remaining: 9999, utilization: 80 }),
  ]);
  assert.equal(utilSource.ringUnit.layers[0].percent, 80);
  assert.equal(toneForUsagePercent(utilSource.ringUnit.layers[0].percent), "warning");
  assert.equal(utilSource.ringUnit.shortValue, "10k"); // formatTokensCompact for large remaining
});

await test("globals.css shared N-ring, sheen, aggregate columns + reduced-motion", () => {
  const globals = read("app/globals.css");
  assert.match(globals, /\.provider-usage-trigger/);
  assert.match(globals, /\.provider-usage-trigger__spinner/);
  assert.match(globals, /\.provider-usage-ring-unit/);
  assert.match(globals, /\.provider-usage-ring-unit__sheen|\.sheen-flow/);
  assert.match(globals, /provider-usage-sheen-move|sheen-move/);
  assert.match(globals, /--provider-usage-ring-layer-0/);
  assert.match(globals, /--provider-usage-ring-layer-1/);
  assert.match(globals, /--provider-usage-ring-layer-2/);
  assert.match(globals, /\.provider-usage-aggregate/);
  assert.match(globals, /\.provider-usage-aggregate__columns/);
  assert.match(globals, /\.kiro-usage-panel/);
  assert.match(globals, /\.kiro-usage-panel__skeleton-shimmer/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.provider-usage-trigger__spinner/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.provider-usage-ring-unit__sheen|\.sheen-flow/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.kiro-usage-panel/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  assert.match(globals, /GPT→Grok→Kiro|GPT\/Grok\/Kiro/);
});

await test("theme tokens, panel ring >= trigger, detail-only copy, responsive breakpoints", () => {
  const {
    PROVIDER_USAGE_DETAIL_ONLY_NOTE,
    PROVIDER_USAGE_DETAIL_ONLY_FALLBACK,
  } = contract;
  const globals = read("app/globals.css");
  const trigger = read("components/ProviderUsageTrigger.tsx");
  const panel = read("components/ProviderUsageAggregatePanel.tsx");

  // light/dark usage semantic tokens exist under :root / html.dark.
  for (const token of [
    "--usage-panel-surface",
    "--usage-panel-border",
    "--usage-panel-shadow",
    "--usage-panel-close-bg",
    "--usage-center-label",
    "--usage-center-value",
    "--usage-status-warning-fg",
    "--usage-status-danger-fg",
    "--usage-status-success-fg",
  ]) {
    assert.match(globals, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // Both theme blocks define the surface token (light + dark).
  assert.equal((globals.match(/--usage-panel-surface:/g) || []).length >= 2, true);

  // Aggregate shell must not hardcode the old fixed-night colors; surface comes from CSS tokens.
  assert.doesNotMatch(panel, /rgba\(\s*11\s*,\s*15\s*,\s*25/);
  assert.doesNotMatch(panel, /#1e293b/i);
  assert.doesNotMatch(panel, /background:\s*["']#0b0f19/i);
  assert.match(panel, /provider-usage-aggregate__panel/);
  assert.match(globals, /\.provider-usage-aggregate__panel[\s\S]{0,240}var\(--usage-panel-surface/);
  assert.match(globals, /\.provider-usage-aggregate__close[\s\S]{0,160}var\(--usage-panel-close-bg/);

  // Trigger 30px small; panel column header large 40px (geometry ≥38).
  assert.match(trigger, /small = aggregate\/compact trigger 30px/);
  assert.match(trigger, /large = panel header \/ full mode target 40px/);
  assert.match(trigger, /return size === "small" \? 30 : 40/);
  assert.match(panel, /size="small"/);
  assert.match(panel, /size="large"/);
  assert.match(panel, /Panel column header uses large 40px rings/);
  assert.match(panel, /Trigger segments stay 30px small rings/);
  // Panel large ring must not shrink under flex.
  assert.match(globals, /provider-usage-aggregate__column-header[\s\S]{0,180}flex-shrink:\s*0/);

  // detail-only / fallback use fixed safe copy constants, never raw evidence.
  assert.equal(PROVIDER_USAGE_DETAIL_ONLY_NOTE, "另有窗口仅在详情展示");
  assert.equal(PROVIDER_USAGE_DETAIL_ONLY_FALLBACK, "详情");
  assert.match(panel, /provider-usage-aggregate__column-fallback/);
  // Column no-ring path uses safe fallback text (projection.fallback or em dash), not raw errors.
  assert.match(panel, /projection\.fallback \?\? ["']—["']/);
  assert.doesNotMatch(panel, /durationEvidence|rawBody|error\.message/);
  // Safe detail-only note constant is shared and used by provider detail banners.
  assert.match(read("lib/kiro-usage-ring.ts"), /PROVIDER_USAGE_DETAIL_ONLY_NOTE|KIRO_EXTRA_WINDOWS_DETAIL_NOTE/);
  assert.match(read("components/KiroUsagePanel.tsx"), /detailNote|另有窗口仅在详情展示|KIRO_EXTRA_WINDOWS_DETAIL_NOTE/);

  // Responsive: ≤640 two columns; ≤420 single column; panel viewport clamp.
  assert.match(globals, /@media \(max-width: 640px\)[\s\S]{0,400}provider-usage-aggregate__columns[\s\S]{0,220}grid-template-columns:\s*repeat\(2/);
  assert.match(globals, /@media \(max-width: 420px\)[\s\S]{0,400}provider-usage-aggregate__columns[\s\S]{0,220}grid-template-columns:\s*1fr/);
  assert.match(globals, /\.provider-usage-aggregate__panel\s*\{[\s\S]{0,400}max-width:\s*calc\(100vw - 16px\)/);
  assert.match(panel, /calc\(100vw - 16px\)/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll provider usage compact checks passed.");
