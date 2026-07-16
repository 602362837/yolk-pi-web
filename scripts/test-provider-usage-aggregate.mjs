#!/usr/bin/env node
/**
 * Provider usage aggregate integration contracts (USAGE-AGG-06).
 *
 * Covers:
 * - usage.providerPanelsAggregated default false
 * - AppShell JSX mutual exclusion (aggregate vs standalone, no CSS hide)
 * - GPT → Grok → Kiro order, single host / right padding
 * - Shared N-ring centers (GPT 5h, Grok week, Kiro 1/N)
 * - Aggregate hover/focus shell: 220ms grace, Escape suppression, columns
 * - No total ring, no dual owner remount path, projection safety
 * - Compact is ring-first (no normal text summary chips); standalone keeps click detail
 *
 * Run:
 *   npm run test:provider-usage-aggregate
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
const grokProjectionMod = await import("../components/GrokUsageProjection.ts");
const kiroRingMod = await import("../lib/kiro-usage-ring.ts");

await test("config default: providerPanelsAggregated is false", () => {
  assert.equal(DEFAULT_PI_WEB_CONFIG.usage.providerPanelsAggregated, false);
  assert.equal(DEFAULT_PI_WEB_CONFIG.usage.providerPanelsCompact, false);
});

await test("AppShell reads providerPanelsAggregated and JSX-mutex mounts aggregate vs standalone", () => {
  const appShell = read("components/AppShell.tsx");

  assert.match(appShell, /providerUsageAggregated = webConfig\?\.usage\.providerPanelsAggregated === true/);
  assert.match(appShell, /import \{\s*ProviderUsageAggregatePanel/);
  assert.match(appShell, /data-usage-mode=\{providerUsageAggregated \? "aggregate" : "standalone"\}/);

  // Mutual exclusive branch — aggregate path OR standalone path, not both.
  assert.match(appShell, /providerUsageAggregated \? \(/);
  assert.match(appShell, /<ProviderUsageAggregatePanel/);
  assert.match(appShell, /presentation="aggregate"/);
  assert.match(appShell, /presentationMode="aggregate"/);

  // Must not CSS-hide standalone while aggregate is on.
  assert.doesNotMatch(appShell, /display:\s*["']none["'][\s\S]{0,80}ChatGptUsagePanel|visibility:\s*hidden[\s\S]{0,80}GrokUsagePanel/);
  assert.doesNotMatch(appShell, /className=\{[^}]*hidden[^}]*\}[\s\S]{0,40}ChatGptUsagePanel/);

  // Single host + SessionStatsChips padding contract preserved.
  assert.match(appShell, /app-top-usage-panel/);
  assert.match(appShell, /showAnyProviderUsage \? 12 : rightPanelTogglePadding/);
  const hostBlock = appShell.slice(
    appShell.indexOf("app-top-usage-panel"),
    appShell.indexOf("app-top-usage-panel") + 1600,
  );
  assert.equal((hostBlock.match(/paddingRight/g) || []).length, 1);

  // Zero providers: host gated by showAnyProviderUsage (no empty aggregate mount outside host).
  assert.match(appShell, /showAnyProviderUsage && \(/);

  // Compact only applies when not aggregated (value retained in config).
  assert.match(
    appShell,
    /!providerUsageAggregated && webConfig\?\.usage\.providerPanelsCompact === true \? "compact" : "full"/,
  );

  // Models open closes aggregate first via generation token.
  assert.match(appShell, /providerUsageAggregateCloseGeneration|setProviderUsageAggregateCloseGeneration/);
  assert.match(appShell, /openModelsFromProviderUsage/);
  assert.match(appShell, /closeGeneration=\{providerUsageAggregateCloseGeneration\}/);

  // Standalone still wires displayMode + click-capable panels (no presentation=aggregate in that branch).
  assert.match(appShell, /displayMode=\{providerUsageDisplayMode\}/);
});

await test("AppShell aggregate columns ordered GPT → Grok → Kiro with one owner each", () => {
  const appShell = read("components/AppShell.tsx");

  // Projection state owners (single instance per enabled key).
  assert.match(appShell, /gptAggregateProjection/);
  assert.match(appShell, /grokAggregateProjection/);
  assert.match(appShell, /kiroAggregateProjection/);
  assert.match(appShell, /setGptAggregateProjection/);
  assert.match(appShell, /setGrokAggregateProjection/);
  assert.match(appShell, /setKiroAggregateProjection/);

  // Stable detail owners memoized so projection updates do not remount panels.
  assert.match(appShell, /gptAggregateDetail = useMemo/);
  assert.match(appShell, /grokAggregateDetail = useMemo/);
  assert.match(appShell, /kiroAggregateDetail = useMemo/);

  // Column push order GPT → Grok → Kiro.
  const gptPush = appShell.indexOf('key: "gpt"');
  const grokPush = appShell.indexOf('key: "grok"');
  const kiroPush = appShell.indexOf('key: "kiro"');
  assert.ok(gptPush > 0 && grokPush > gptPush && kiroPush > grokPush, "expected GPT → Grok → Kiro column construction");

  // Standalone branch still wires displayMode for Full/Compact click detail.
  const standaloneBlockStart = appShell.indexOf("providerUsageAggregated ? (");
  const standaloneBlock = appShell.slice(standaloneBlockStart, standaloneBlockStart + 2500);
  assert.match(standaloneBlock, /displayMode=\{providerUsageDisplayMode\}/);
  assert.match(standaloneBlock, /<ChatGptUsagePanel/);
  assert.match(standaloneBlock, /<GrokUsagePanel/);
  assert.match(standaloneBlock, /<KiroUsagePanel/);

  // Aggregate shell does not fetch.
  assert.doesNotMatch(appShell, /ProviderUsageAggregatePanel[\s\S]{0,200}fetch\(/);
});

await test("ProviderUsageAggregatePanel hover/focus lifecycle + non-accordion columns", () => {
  const panel = read("components/ProviderUsageAggregatePanel.tsx");
  const {
    PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS,
    PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS,
  } = contract;

  assert.equal(PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS, 220);
  assert.match(panel, /PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS/);
  assert.match(panel, /escapeSuppressedRef/);
  assert.match(panel, /scheduleClose/);
  assert.match(panel, /clearCloseTimer/);
  assert.match(panel, /pointerInsideTriggerRef|pointerInsidePanelRef/);
  assert.match(panel, /focusInsideTriggerRef|focusInsidePanelRef/);
  assert.match(panel, /document\.activeElement/);
  assert.match(panel, /onPointerEnter/);
  assert.match(panel, /onPointerLeave/);
  assert.match(panel, /onFocusCapture|handlePanelFocusIn/);
  assert.match(panel, /onBlurCapture|handlePanelFocusOut/);
  assert.match(panel, /handleEscape/);
  assert.match(panel, /Escape/);
  // Escape restores focus to trigger under suppression; ordinary leave does not force focus.
  assert.match(panel, /triggerRef\.current\.focus/);
  assert.match(panel, /focusWasInPanel/);
  // Grace delay uses the shared 220ms constant.
  assert.match(panel, /setTimeout\([\s\S]*PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS/);
  // closeGeneration external close without remount.
  assert.match(panel, /closeGeneration/);
  // Panel stays mounted when closed (state single-instance / no remount on reopen).
  assert.match(panel, /display: open \? "flex" : "none"|hidden=\{!open\}/);
  assert.match(panel, /aria-haspopup="dialog"/);
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /aria-controls=/);
  assert.match(panel, /role="dialog"/);
  assert.doesNotMatch(panel, /aria-modal=\{?true\}?/);
  // Non-accordion columns: ban accordion state machines (comments may say "non-accordion").
  assert.match(panel, /provider-usage-aggregate__columns/);
  assert.match(panel, /sortedColumns\.map/);
  assert.match(panel, /non-accordion|provider columns/i);
  assert.doesNotMatch(panel, /expandedKey|setExpandedProvider|activeProviderKey|expandedProvider/);
  // No total / composite ring.
  assert.doesNotMatch(panel, /totalPercent|overallRing|averagePercent|总环|总百分比/);
  // Shell does not fetch provider APIs.
  assert.doesNotMatch(panel, /fetch\(|\/api\/auth|GetUsageLimits|kiro_subscription_quota/);
  // Forbidden fields not consumed as projection data.
  for (const field of PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS) {
    assert.doesNotMatch(panel, new RegExp(`projection\\.${field}|\\b${field}\\b\\s*[,:]`), `shell must not use ${field}`);
  }
  // accountId etc. should not appear at all in shell source.
  assert.doesNotMatch(panel, /accountId|profileArn|clientSecret|access_token|refresh_token/);
});

await test("GPT adapter: actual tiers → outer shortest 5h / center outer; unknown keeps 5h/—", () => {
  const {
    projectProviderUsageWindows,
    isValidRingUnitCenter,
    formatRingCenterValue,
  } = contract;

  const candidates = (tiers) => tiers.map((tier) => ({
    id: tier.name === "five_hour" ? "gpt-5h" : "gpt-week",
    shortLabel: tier.name === "five_hour" ? "5h" : "周",
    fullLabel: tier.name === "five_hour" ? "5 小时额度" : "7 天额度",
    percent: Number.isFinite(tier.utilization) ? tier.utilization : null,
    title: tier.name === "five_hour" ? "5 小时" : "周额度",
    present: true,
    trusted: true,
    durationMs: null,
    durationEvidence: tier.name,
  }));

  // Input order 7d→5h still projects outer 5h (short) → inner 7d.
  const dual = projectProviderUsageWindows(candidates([
    { name: "seven_day", utilization: 37 },
    { name: "five_hour", utilization: 42 },
  ]), { providerLabel: "GPT" }).ringUnit;
  assert.ok(dual);
  assert.equal(dual.layers.length, 2);
  assert.equal(dual.layers[0].id, "gpt-5h");
  assert.equal(dual.layers[1].id, "gpt-week");
  assert.equal(dual.centerLayerId, "gpt-5h");
  assert.ok(isValidRingUnitCenter(dual));
  assert.equal(formatRingCenterValue(dual.layers[0].percent), "42%");

  const fiveHourUnknown = projectProviderUsageWindows(candidates([
    { name: "five_hour", utilization: Number.NaN },
    { name: "seven_day", utilization: 37 },
  ]), { providerLabel: "GPT" }).ringUnit;
  assert.ok(fiveHourUnknown);
  assert.equal(fiveHourUnknown.centerLayerId, "gpt-5h");
  assert.equal(fiveHourUnknown.layers[0].percent, null);
  assert.equal(formatRingCenterValue(fiveHourUnknown.layers[0].percent), "—");
  // Must not borrow week percent for center.
  assert.notEqual(formatRingCenterValue(fiveHourUnknown.layers[0].percent), "37%");

  const onlyWeek = projectProviderUsageWindows(candidates([
    { name: "seven_day", utilization: 37 },
  ]), { providerLabel: "GPT" }).ringUnit;
  assert.ok(onlyWeek);
  assert.equal(onlyWeek.centerLayerId, "gpt-week");
  assert.equal(onlyWeek.layers.length, 1);
  assert.ok(isValidRingUnitCenter(onlyWeek));

  const panel = read("components/ChatGptUsagePanel.tsx");
  assert.match(panel, /export function buildChatGptUsageRingUnit/);
  assert.match(panel, /export function buildChatGptUsageWindowCandidates/);
  assert.match(panel, /projectProviderUsageWindows/);
  assert.match(panel, /gpt-week/);
  assert.match(panel, /gpt-5h/);
  assert.doesNotMatch(panel, /hasFiveHour[\s\S]{0,120}layers\.push/);
  assert.match(panel, /presentation = "standalone"/);
  assert.match(panel, /data-presentation="aggregate"/);
  // Standalone opens from keyboard focus or pointer hover.
  assert.match(panel, /onFocus=\{\(\) =>/);
  assert.match(panel, /onMouseEnter=\{\(\) =>/);
  assert.match(panel, /ProviderUsageTrigger/);
});

await test("Grok adapter: outer week / inner month via shared projector, center week (not month)", () => {
  const { buildGrokUsageRingUnit } = grokProjectionMod;
  const { isValidRingUnitCenter, formatRingCenterValue } = contract;

  const dual = buildGrokUsageRingUnit({
    hasAccount: true,
    monthly: { utilization: 70, usedPercent: 70 },
    weekly: { utilization: 51, usedPercent: 51 },
  });
  assert.ok(dual);
  assert.equal(dual.layers.length, 2);
  assert.equal(dual.layers[0].id, "grok-week");
  assert.equal(dual.layers[1].id, "grok-month");
  assert.equal(dual.centerLayerId, "grok-week");
  assert.ok(isValidRingUnitCenter(dual));
  assert.equal(formatRingCenterValue(dual.layers[0].percent), "51%");
  // Center must not be month.
  assert.notEqual(dual.centerLayerId, "grok-month");

  const weekUnknown = buildGrokUsageRingUnit({
    hasAccount: true,
    monthly: { utilization: 70, usedPercent: 70 },
    weekly: { utilization: Number.NaN, usedPercent: Number.NaN },
  });
  assert.ok(weekUnknown);
  assert.equal(weekUnknown.centerLayerId, "grok-week");
  assert.equal(weekUnknown.layers[0].percent, null);
  assert.equal(formatRingCenterValue(weekUnknown.layers[0].percent), "—");
  assert.notEqual(formatRingCenterValue(weekUnknown.layers[0].percent), "70%");

  const onlyWeek = buildGrokUsageRingUnit({
    hasAccount: true,
    monthly: null,
    weekly: { usedPercent: 40 },
  });
  assert.ok(onlyWeek);
  assert.equal(onlyWeek.layers.length, 1);
  assert.equal(onlyWeek.centerLayerId, "grok-week");

  const panel = read("components/GrokUsagePanel.tsx");
  assert.match(panel, /presentationMode = "standalone"/);
  assert.match(panel, /presentationMode === "aggregate"/);
  assert.match(panel, /onFocus=\{\(\) =>/);
  assert.match(panel, /onMouseEnter=\{\(\) =>/);
  // Adapter uses shared projector; no fixed center assignment.
  const projection = read("components/GrokUsageProjection.ts");
  assert.match(projection, /projectProviderUsageWindows/);
  assert.match(projection, /buildGrokUsageWindowCandidates/);
  assert.doesNotMatch(projection, /centerLayerId\s*=\s*["']grok-month["']|center.*month.*fixed/i);
});

await test("Kiro adapter: shared projector, Limits not 90d, remaining not percent", () => {
  const { projectKiroRingUnit } = kiroRingMod;
  const { isValidRingUnitCenter, formatRingCenterValue, toneForUsagePercent } = contract;

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

  const single = projectKiroRingUnit([
    bucket({ id: "credit-0", label: "Credits", resourceType: "CREDIT", used: 25, limit: 100, utilization: 25 }),
  ]);
  assert.equal(single.ringUnit?.layers.length, 1);
  assert.equal(single.ringUnit?.centerLayerId, "credit-0");
  assert.ok(isValidRingUnitCenter(single.ringUnit));

  // Limits is not a trusted duration; Daily alone becomes degraded-single.
  const dual = projectKiroRingUnit([
    bucket({ id: "daily-1", label: "Daily", used: 20, limit: 100, utilization: 20 }),
    bucket({ id: "limits-0", label: "Limits", used: 40, limit: 100, utilization: 40 }),
  ]);
  assert.equal(dual.mode, "degraded-single");
  assert.equal(dual.ringUnit?.layers.length, 1);
  assert.equal(dual.ringUnit.layers[0].id, "daily-1");
  assert.equal(dual.ringUnit.centerLayerId, "daily-1");
  assert.ok(dual.detailOnlyBucketIds.includes("limits-0"));
  assert.ok(isValidRingUnitCenter(dual.ringUnit));

  const ordered = projectKiroRingUnit([
    bucket({ id: "weekly-0", label: "Weekly", used: 40, limit: 100, utilization: 40 }),
    bucket({ id: "daily-1", label: "Daily", used: 20, limit: 100, utilization: 20 }),
  ]);
  assert.equal(ordered.mode, "ordered-multi");
  assert.equal(ordered.ringUnit.layers.map((layer) => layer.id).join(","), "daily-1,weekly-0");
  assert.equal(ordered.ringUnit.centerLayerId, "daily-1");

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
  assert.equal(remainingOnly.ringUnit?.layers[0].percent, null);
  assert.equal(toneForUsagePercent(remainingOnly.ringUnit.layers[0].percent), "muted");
  assert.notEqual(formatRingCenterValue(remainingOnly.ringUnit.layers[0].percent), "0%");

  const panel = read("components/KiroUsagePanel.tsx");
  assert.match(panel, /presentation = "standalone"/);
  assert.match(panel, /data-presentation="aggregate"/);
  assert.match(panel, /projectKiroRingUnit/);
  // No product rule forcing primary-only single ring.
  assert.doesNotMatch(panel, /default primary single|always single ring|primaryOnlyRing/i);
  assert.match(panel, /onFocus=\{\(\) =>/);
  assert.match(panel, /onMouseEnter=\{\(\) =>/);
  const ringHelper = read("lib/kiro-usage-ring.ts");
  assert.doesNotMatch(ringHelper, /90 \* 86_400_000|label:limits/);
  assert.match(ringHelper, /projectProviderUsageWindows/);
});

await test("shared N-ring layer identity / tone / flow / reduced-motion present", () => {
  const trigger = read("components/ProviderUsageTrigger.tsx");
  const globals = read("app/globals.css");
  const panel = read("components/ProviderUsageAggregatePanel.tsx");

  assert.match(trigger, /data-layer-identity/);
  assert.match(trigger, /data-tone/);
  assert.match(trigger, /provider-usage-ring-unit__sheen|sheen-flow/);
  assert.match(trigger, /<mask|mask=\{`url/);
  assert.match(trigger, /assertRingUnitCenterInvariant/);

  assert.match(globals, /--provider-usage-ring-layer-0/);
  assert.match(globals, /--provider-usage-ring-layer-1/);
  assert.match(globals, /--provider-usage-ring-layer-2/);
  assert.match(globals, /provider-usage-sheen-move|sheen-move/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  assert.match(globals, /\.provider-usage-aggregate__columns/);

  // Theme + size contracts for aggregate shell (USAGE-FIX-04).
  assert.match(globals, /--usage-panel-surface/);
  assert.match(globals, /--usage-center-label/);
  assert.match(globals, /--usage-status-danger-fg/);
  assert.equal((globals.match(/--usage-panel-surface:/g) || []).length >= 2, true);
  assert.doesNotMatch(panel, /rgba\(\s*11\s*,\s*15\s*,\s*25/);
  assert.doesNotMatch(panel, /#1e293b/i);
  assert.match(panel, /size="small"/);
  assert.match(panel, /size="large"/);
  assert.match(trigger, /return size === "small" \? 30 : 40/);
  assert.match(globals, /@media \(max-width: 640px\)[\s\S]{0,220}grid-template-columns:\s*repeat\(2/);
  assert.match(globals, /@media \(max-width: 420px\)[\s\S]{0,220}grid-template-columns:\s*1fr/);
  assert.match(panel, /PROVIDER_USAGE_DETAIL_ONLY_FALLBACK|column-fallback/);
});

await test("Compact is ring-first; no normal text summary chips in provider panels", () => {
  const chatgpt = read("components/ChatGptUsagePanel.tsx");
  const grok = read("components/GrokUsagePanel.tsx");
  const kiro = read("components/KiroUsagePanel.tsx");
  const trigger = read("components/ProviderUsageTrigger.tsx");

  assert.doesNotMatch(chatgpt, /compactSummaries/);
  assert.doesNotMatch(grok, /compactSummaries/);
  // Trigger may still accept compactSummaries for fallback compatibility, but providers must not build them.
  assert.match(trigger, /ringUnit/);
  assert.match(chatgpt, /ringUnit=\{ringUnit\}/);
  assert.match(grok, /ringUnit=\{aggregateProjection\.ringUnit\}/);
  assert.match(kiro, /ringUnit=\{ringProjection\.ringUnit\}/);
});

await test("projection allowlist safety in contract + provider aggregate projections", () => {
  const {
    PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS,
  } = contract;
  assert.ok(PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("accountId"));
  assert.ok(PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("profileArn"));
  assert.ok(PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("rawBody"));

  for (const file of [
    "components/ChatGptUsagePanel.tsx",
    "components/GrokUsagePanel.tsx",
    "components/KiroUsagePanel.tsx",
    "components/GrokUsageProjection.ts",
  ]) {
    const src = read(file);
    // Aggregate projection objects must not spread raw quota / account payloads.
    assert.doesNotMatch(src, /onAggregateProjectionChange\?\.\(\{[\s\S]{0,200}accountId/);
    assert.doesNotMatch(src, /onProjectionChange\?\.\(\{[\s\S]{0,200}accountId/);
    assert.doesNotMatch(src, /ringUnit:[\s\S]{0,80}raw/);
  }

  const kiro = read("components/KiroUsagePanel.tsx");
  assert.doesNotMatch(kiro, /profileArn|clientSecret|access_token|refresh_token/);

  // Top-bar detail may show only safe display fields, never arbitrary account metadata.
  for (const file of [
    "components/ChatGptUsagePanel.tsx",
    "components/GrokUsagePanel.tsx",
    "components/KiroUsagePanel.tsx",
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /maskedAccountId\}\{(?:account|item)\.label/);
  }
  const chatgpt = read("components/ChatGptUsagePanel.tsx");
  assert.doesNotMatch(chatgpt, /title=\{account\.extraInfo\}|\{account\.extraInfo\}/);
  assert.doesNotMatch(chatgpt, /\{item\.label\}/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll provider usage aggregate checks passed.");
