#!/usr/bin/env node
/**
 * Antigravity top-bar usage panel contracts (AG-07 + IMP-001 AG-G02).
 *
 * Covers:
 * - group-aware dual-independent rings (Flash | Opus side-by-side)
 * - ban concentric Flash outer + Opus inner packing
 * - single priority group → one independent ring (no fake 0% sibling)
 * - non-priority only → detail-only + 多模型
 * - resetTime never becomes duration/order evidence
 * - no total/average composite percent
 * - aggregate projection allowlist (no accountId/projectId/credentials)
 * - panel source: standalone+aggregate presentation, 5min poll floor, refresh=1 force
 * - AppShell fourth provider order + JSX mutual exclusion + single host
 *
 * Run:
 *   npm run test:antigravity-usage-panel
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
const antigravityRing = await import("../lib/antigravity-usage-ring.ts");

function model(partial) {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    publicModelIds: partial.publicModelIds ?? [],
    remainingFraction: partial.remainingFraction,
    usedPercent: partial.usedPercent ?? (1 - partial.remainingFraction) * 100,
    resetsAt: partial.resetsAt,
  };
}

await test("config default: antigravity.usagePanelEnabled is false", () => {
  assert.equal(DEFAULT_PI_WEB_CONFIG.antigravity.usagePanelEnabled, false);
});

await test("contract allowlists antigravity as fourth ProviderUsageKey", () => {
  const src = read("components/ProviderUsagePanelContract.ts");
  assert.match(src, /"gpt" \| "grok" \| "kiro" \| "antigravity"/);
  assert.match(src, /"GPT" \| "Grok" \| "Kiro" \| "Antigravity"/);
  assert.ok(contract.PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("projectId"));
  assert.ok(contract.PROVIDER_USAGE_FORBIDDEN_PROJECTION_FIELDS.includes("accountId"));
  // Multi independent ringUnits field is allowlisted on aggregate projection.
  assert.match(src, /ringUnits\?:/);
  assert.equal(typeof contract.resolveAggregateRingUnits, "function");
});

await test("single safe priority model window → one independent ring; resetTime is not duration", () => {
  const {
    projectAntigravityRingUnit,
    buildAntigravityUsageWindowCandidate,
    isSafeAntigravityModelWindow,
  } = antigravityRing;
  const { isValidRingUnitCenter, formatRingCenterValue } = contract;

  assert.equal(
    isSafeAntigravityModelWindow(model({ id: "gemini-3-flash", remainingFraction: 0.15, usedPercent: 85 })),
    true,
  );
  assert.equal(
    isSafeAntigravityModelWindow(model({ id: "bad", remainingFraction: 1.5, usedPercent: -10 })),
    false,
  );

  const single = projectAntigravityRingUnit([
    model({
      id: "gemini-3-flash",
      label: "Gemini 3 Flash",
      remainingFraction: 0.15,
      usedPercent: 85,
      resetsAt: "2026-07-17T00:00:00Z",
    }),
  ]);
  assert.equal(single.mode, "single");
  assert.equal(single.safeModelCount, 1);
  assert.equal(single.ringSlots.length, 1);
  assert.equal(single.ringSlots[0].groupId, "gemini-3-flash");
  assert.ok(single.ringUnit);
  assert.equal(single.ringUnit.layers.length, 1);
  assert.equal(single.ringUnit.centerLayerId, "antigravity-group-gemini-3-flash");
  assert.ok(isValidRingUnitCenter(single.ringUnit));
  assert.equal(formatRingCenterValue(single.ringUnit.layers[0].percent), "85%");
  // Single-layer only — not a dual concentric unit.
  assert.equal(single.ringUnit.layers.length, 1);

  const candidate = buildAntigravityUsageWindowCandidate(model({
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    remainingFraction: 0.15,
    usedPercent: 85,
    resetsAt: "2026-07-17T00:00:00Z",
  }));
  assert.equal(candidate.durationMs, null);
  assert.equal(candidate.durationEvidence, undefined);
  assert.match(candidate.title, /重置/);
});

await test("Flash + Opus → dual-independent rings (never concentric outer/inner)", () => {
  const {
    projectAntigravityRingUnit,
    buildAntigravityUsageAggregateProjection,
    ringUnitsFromAntigravityProjection,
    ANTIGRAVITY_USAGE_ORDER,
  } = antigravityRing;
  const { isValidRingUnitCenter, resolveAggregateRingUnits, createProviderUsageRingUnit } = contract;

  const dual = projectAntigravityRingUnit([
    model({
      id: "gemini-3-flash",
      remainingFraction: 0.15,
      usedPercent: 85,
      resetsAt: "2026-07-17T01:00:00Z",
    }),
    model({
      id: "gemini-3.5-flash-low",
      remainingFraction: 0.4,
      usedPercent: 60,
    }),
    model({
      id: "claude-opus-4-6",
      remainingFraction: 0.88,
      usedPercent: 12,
      resetsAt: "2026-07-18T01:00:00Z",
    }),
    model({
      id: "claude-opus-4-6-thinking",
      remainingFraction: 0.5,
      usedPercent: 50,
    }),
    // Non-priority should not become a third ring slot.
    model({ id: "claude-sonnet-4-5", remainingFraction: 0.2, usedPercent: 80 }),
  ]);

  assert.equal(dual.mode, "dual-independent");
  assert.equal(dual.ringSlots.length, 2);
  assert.equal(dual.ringSlots[0].groupId, "gemini-3-flash");
  assert.equal(dual.ringSlots[1].groupId, "claude-opus");
  assert.equal(dual.ringSlots[0].shortLabel, "G");
  assert.equal(dual.ringSlots[1].shortLabel, "A");
  // Legacy single unit is null so callers cannot treat both groups as one N-ring.
  assert.equal(dual.ringUnit, null);
  // Conservative max(used): Flash max(85,60)=85; Opus max(12,50)=50.
  assert.equal(dual.ringSlots[0].ringUnit.layers[0].percent, 85);
  assert.equal(dual.ringSlots[1].ringUnit.layers[0].percent, 50);
  // Each slot is single-layer.
  for (const slot of dual.ringSlots) {
    assert.equal(slot.ringUnit.layers.length, 1);
    assert.ok(isValidRingUnitCenter(slot.ringUnit));
    // No duration forge from resetTime.
    assert.equal("durationMs" in slot.ringUnit.layers[0], false);
  }

  const units = ringUnitsFromAntigravityProjection(dual);
  assert.equal(units.length, 2);
  assert.equal(units[0].centerLayerId, "antigravity-group-gemini-3-flash");
  assert.equal(units[1].centerLayerId, "antigravity-group-claude-opus");

  // Explicit ban: packing Flash+Opus as concentric layers of ONE unit is forbidden
  // by projection (we never emit that shape). Guardrail for future regressions:
  const forbiddenConcentric = createProviderUsageRingUnit({
    layers: [
      {
        id: "antigravity-group-gemini-3-flash",
        shortLabel: "G",
        fullLabel: "Gemini 3 Flash 组",
        percent: 85,
        title: "G",
      },
      {
        id: "antigravity-group-claude-opus",
        shortLabel: "A",
        fullLabel: "Claude Opus 组",
        percent: 12,
        title: "A",
      },
    ],
  });
  // Projection must not equal this concentric packing.
  assert.notEqual(dual.ringUnit, forbiddenConcentric);
  assert.notEqual(dual.ringSlots.length, 1);
  assert.ok(
    !(dual.ringUnit && dual.ringUnit.layers.length === 2
      && dual.ringUnit.layers[0].id.includes("flash")
      && dual.ringUnit.layers[1].id.includes("opus")),
    "must never pack Flash outer + Opus inner into one ringUnit",
  );

  const projection = buildAntigravityUsageAggregateProjection({
    hasAccount: true,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "opaque-should-not-leak",
      success: true,
      models: [
        model({ id: "gemini-3-flash", remainingFraction: 0.15, usedPercent: 85 }),
        model({ id: "claude-opus-4-6", remainingFraction: 0.88, usedPercent: 12 }),
      ],
      cache: { state: "live", queriedAt: "2026-07-16T10:00:00Z", ageMs: 1000 },
      reauthRequired: false,
    },
  });

  assert.equal(projection.key, "antigravity");
  assert.equal(projection.label, "Antigravity");
  assert.equal(projection.order, ANTIGRAVITY_USAGE_ORDER);
  assert.equal(ANTIGRAVITY_USAGE_ORDER, 3);
  // Dual: ringUnit null, ringUnits has two independent single-layer units.
  assert.equal(projection.ringUnit, null);
  assert.ok(projection.ringUnits);
  assert.equal(projection.ringUnits.length, 2);
  assert.equal(projection.ringUnits[0].layers.length, 1);
  assert.equal(projection.ringUnits[1].layers.length, 1);
  assert.equal(projection.fallback, null);
  assert.match(projection.title, /Flash|Opus|Gemini|Claude|保守|G |A /);
  assert.equal(JSON.stringify(projection).includes("opaque-should-not-leak"), false);
  assert.equal(JSON.stringify(projection).includes("projectId"), false);

  const resolved = resolveAggregateRingUnits(projection);
  assert.equal(resolved.length, 2);
  // No total percent field.
  assert.equal("totalPercent" in projection, false);
  assert.equal("averagePercent" in projection, false);
});

await test("non-priority multi-model only → detail-only, no total percent", () => {
  const {
    projectAntigravityRingUnit,
    buildAntigravityUsageAggregateProjection,
    ANTIGRAVITY_MULTI_MODEL_FALLBACK,
  } = antigravityRing;

  const multi = projectAntigravityRingUnit([
    model({ id: "claude-sonnet-4-5", label: "Sonnet", remainingFraction: 0.4, usedPercent: 60, resetsAt: "2026-07-17T01:00:00Z" }),
    model({ id: "gemini-3-pro", label: "Pro", remainingFraction: 0.8, usedPercent: 20, resetsAt: "2026-07-18T01:00:00Z" }),
    model({ id: "gpt-oss-120b", label: "GPT-OSS", remainingFraction: 0.1, usedPercent: 90 }),
  ]);
  assert.equal(multi.mode, "detail-only");
  assert.equal(multi.ringUnit, null);
  assert.equal(multi.ringSlots.length, 0);
  assert.equal(multi.safeModelCount, 3);
  assert.equal(multi.detailOnlyModelIds.length, 3);

  const projection = buildAntigravityUsageAggregateProjection({
    hasAccount: true,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "opaque-should-not-leak",
      success: true,
      models: [
        model({ id: "claude-sonnet-4-5", remainingFraction: 0.4, usedPercent: 60 }),
        model({ id: "gemini-3-pro", remainingFraction: 0.05, usedPercent: 95 }),
      ],
      cache: { state: "live", queriedAt: "2026-07-16T10:00:00Z", ageMs: 1000 },
      reauthRequired: false,
    },
  });

  assert.equal(projection.ringUnit, null);
  assert.equal(projection.ringUnits, null);
  assert.equal(projection.fallback, ANTIGRAVITY_MULTI_MODEL_FALLBACK);
  assert.match(projection.title, /模型额度详情|多模型/);
  assert.equal(projection.risk, "danger"); // highest model risk channel, not a total %
  assert.equal(JSON.stringify(projection).includes("opaque-should-not-leak"), false);
  assert.equal(JSON.stringify(projection).includes("projectId"), false);
});

await test("only Opus present → single independent ring (no fake Flash 0%)", () => {
  const { projectAntigravityRingUnit, buildAntigravityUsageAggregateProjection } = antigravityRing;

  const onlyOpus = projectAntigravityRingUnit([
    model({ id: "claude-opus-4-6", remainingFraction: 0.9, usedPercent: 10 }),
  ]);
  assert.equal(onlyOpus.mode, "single");
  assert.equal(onlyOpus.ringSlots.length, 1);
  assert.equal(onlyOpus.ringSlots[0].groupId, "claude-opus");
  assert.ok(onlyOpus.ringUnit);
  assert.equal(onlyOpus.ringUnit.layers.length, 1);
  assert.equal(onlyOpus.ringUnit.layers[0].percent, 10);
  // Must not invent missing Flash as 0%.
  assert.ok(!onlyOpus.ringSlots.some((s) => s.groupId === "gemini-3-flash"));

  const projection = buildAntigravityUsageAggregateProjection({
    hasAccount: true,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "x",
      success: true,
      models: [model({ id: "claude-opus-4-6", remainingFraction: 0.9, usedPercent: 10 })],
      cache: { state: "live", queriedAt: "2026-07-16T10:00:00Z", ageMs: 1000 },
      reauthRequired: false,
    },
  });
  assert.ok(projection.ringUnit);
  assert.ok(projection.ringUnits);
  assert.equal(projection.ringUnits.length, 1);
  assert.equal(projection.fallback, null);
});

await test("aggregate projection states: no account / reauth / invalid project / stale dual", () => {
  const { buildAntigravityUsageAggregateProjection } = antigravityRing;

  const noAccount = buildAntigravityUsageAggregateProjection({
    hasAccount: false,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: null,
  });
  assert.equal(noAccount.fallback, "登录");
  assert.equal(noAccount.ringUnit, null);
  assert.equal(noAccount.ringUnits, null);

  const reauth = buildAntigravityUsageAggregateProjection({
    hasAccount: true,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "x",
      success: false,
      models: [],
      cache: { state: "none", queriedAt: null, ageMs: null },
      reauthRequired: true,
      error: { code: "unauthorized", message: "reauth", retryable: false },
    },
  });
  assert.equal(reauth.fallback, "需登录");
  assert.equal(reauth.risk, "danger");

  const invalid = buildAntigravityUsageAggregateProjection({
    hasAccount: true,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "x",
      success: false,
      models: [],
      cache: { state: "none", queriedAt: null, ageMs: null },
      reauthRequired: false,
      error: { code: "invalid_project", message: "invalid", retryable: false },
    },
  });
  assert.equal(invalid.fallback, "不可用");
  assert.equal(invalid.risk, "danger");

  const dualStale = buildAntigravityUsageAggregateProjection({
    hasAccount: true,
    accountsLoading: false,
    accountsError: null,
    refreshing: false,
    quotaLoading: false,
    quota: {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "x",
      success: true,
      models: [
        model({ id: "gemini-3-flash", remainingFraction: 0.5, usedPercent: 50 }),
        model({ id: "claude-opus-4-6", remainingFraction: 0.2, usedPercent: 80 }),
      ],
      cache: { state: "stale", queriedAt: "2026-07-15T10:00:00Z", ageMs: 90_000_000 },
      reauthRequired: false,
    },
  });
  // Stale can still show independent rings with warning.
  assert.equal(dualStale.ringUnit, null);
  assert.ok(dualStale.ringUnits);
  assert.equal(dualStale.ringUnits.length, 2);
  assert.equal(dualStale.risk, "warning");
  assert.match(dualStale.title, /缓存已过期/);
});

await test("source bans Flash/Opus concentric packing and resetTime duration forge", () => {
  const ring = read("lib/antigravity-usage-ring.ts");
  const trigger = read("components/ProviderUsageTrigger.tsx");
  const aggregate = read("components/ProviderUsageAggregatePanel.tsx");

  // Dual-independent projection helpers exist.
  assert.match(ring, /dual-independent/);
  assert.match(ring, /ringSlots/);
  assert.match(ring, /buildAntigravityGroupRingUnit/);
  assert.match(ring, /groupByAntigravityQuotaWindows/);
  // Must not call shared period projector for priority dual case.
  assert.doesNotMatch(ring, /projectProviderUsageWindows/);
  // No duration forge.
  assert.match(ring, /durationEvidence: undefined/);
  assert.doesNotMatch(ring, /durationMs:\s*Date\.parse|durationMs:\s*[^n].*reset/i);
  // No composite total/average fields.
  assert.doesNotMatch(ring, /totalPercent|averagePercent|overallPercent/);
  // Explicit single-layer construction for groups (not Flash+Opus layers array).
  assert.match(ring, /antigravity-group-\$\{group\.groupId\}/);

  // Trigger / Aggregate support multi independent units.
  assert.match(trigger, /ringUnits/);
  assert.match(trigger, /data-multi-independent/);
  assert.match(aggregate, /resolveAggregateRingUnits/);
  assert.match(aggregate, /data-multi-independent/);
});

await test("AntigravityUsagePanel source contracts: presentation, poll, privacy", () => {
  const panel = read("components/AntigravityUsagePanel.tsx");
  const ring = read("lib/antigravity-usage-ring.ts");

  assert.match(panel, /export function AntigravityUsagePanel/);
  assert.match(panel, /presentation = "standalone"/);
  assert.match(panel, /data-presentation="aggregate"/);
  assert.match(panel, /presentation === "aggregate"/);
  assert.match(panel, /onAggregateProjectionChange/);
  assert.match(panel, /displayMode/);
  assert.match(panel, /ProviderUsageTrigger/);
  assert.match(panel, /ringUnits=\{aggregateProjection\.ringUnits/);
  assert.match(panel, /ACCOUNT_CACHE_POLL_INTERVAL_MS = 5 \* 60_000/);
  assert.match(panel, /forceQuota: false/);
  assert.match(panel, /reason !== "interval"/);
  assert.match(panel, /params\.set\("refresh", "1"\)/);
  assert.match(panel, /google-antigravity|ANTIGRAVITY_PROVIDER_ID/);
  assert.match(panel, /setQuota\(null\)/);
  assert.match(panel, /quotaRequestGen/);
  assert.match(panel, /accountsRequestGen/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /onFocus=\{\(\) =>/);
  assert.match(panel, /onMouseEnter=\{\(\) =>/);
  assert.match(panel, /Escape/);
  assert.match(panel, /triggerRef\.current\?\.focus/);
  assert.match(panel, /antigravity-usage-quota-grid/);
  assert.match(panel, /多模型额度仅在详情展示|ANTIGRAVITY_MULTI_MODEL_FALLBACK/);

  // Privacy: no raw token/secret field access in panel runtime code.
  assert.doesNotMatch(panel, /\baccess_token\b|\brefresh_token\b|\bclient_secret\b/);
  assert.doesNotMatch(panel, /projection\.projectId|params\.set\(["']projectId|JSON\.stringify\([^)]*projectId/);
  // Aggregate projection builder must not spread accountId into projection.
  assert.doesNotMatch(panel, /onAggregateProjectionChange\?\.\(\{[\s\S]{0,200}accountId/);

  assert.match(ring, /durationEvidence: undefined/);
  assert.doesNotMatch(ring, /totalPercent|averagePercent|overallPercent/);
});

await test("AntigravityUsagePanel group accordion + dual independent ring wiring (AG-G03)", () => {
  const panel = read("components/AntigravityUsagePanel.tsx");
  const globals = read("app/globals.css");

  // Top-bar: multi independent ringUnits (never Flash/Opus concentric layers).
  assert.match(panel, /ringUnits=\{aggregateProjection\.ringUnits/);
  assert.match(panel, /ringUnit=\{aggregateProjection\.ringUnit/);
  assert.match(panel, /aggregateProjection\.ringUnits && aggregateProjection\.ringUnits\.length > 1/);
  assert.doesNotMatch(
    panel,
    /layers:\s*\[[^\]]*(flash|opus|gemini-3-flash|claude-opus)[^\]]*(flash|opus|gemini-3-flash|claude-opus)/i,
  );

  // Detail is group-first accordion, not a flat 16+ model card map.
  assert.match(panel, /function AntigravityUsageGroupAccordion/);
  assert.match(panel, /AntigravityUsageGroupAccordion groups=\{quotaGroups\}/);
  assert.match(panel, /ringProjection\.groups/);
  assert.match(panel, /className="antigravity-usage-quota-group"/);
  assert.match(panel, /className="antigravity-usage-quota-group-summary"/);
  assert.match(panel, /className="antigravity-usage-quota-group-variants"/);
  assert.match(panel, /className="antigravity-usage-quota-group-variant"/);
  assert.match(panel, /data-group-id=\{group\.groupId\}/);
  assert.match(panel, /data-priority-ring/);
  assert.match(panel, /组（保守）/);
  assert.match(panel, /组内取最紧额度/);
  // Default collapsed: <details> without defaultOpen / open={
  assert.match(panel, /<details/);
  assert.doesNotMatch(panel, /defaultOpen|open=\{true\}/);
  // No variant-level refresh control in the accordion body.
  assert.doesNotMatch(panel, /refreshVariant|onRefreshVariant|variantRefresh/);
  assert.doesNotMatch(panel, /forceRefresh.*variant|refresh.*variant\.id/i);
  // Do not flat-map raw models into a card grid anymore.
  assert.doesNotMatch(panel, /safeModels\.map\(\s*\(model\)/);

  // CSS hooks + reduced-motion already covers antigravity panel.
  assert.match(globals, /\.antigravity-usage-quota-groups/);
  assert.match(globals, /\.antigravity-usage-quota-group-summary/);
  assert.match(globals, /\.antigravity-usage-quota-group-variants/);
  assert.match(
    globals,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*antigravity-usage-panel/,
  );
});

await test("AppShell mounts Antigravity as fourth provider with aggregate mutex", () => {
  const appShell = read("components/AppShell.tsx");

  assert.match(appShell, /import \{ AntigravityUsagePanel \} from "\.\/AntigravityUsagePanel"/);
  assert.match(appShell, /showAntigravityUsage = webConfig\?\.antigravity\.usagePanelEnabled === true/);
  assert.match(
    appShell,
    /showAnyProviderUsage = showChatGptUsage \|\| showGrokUsage \|\| showKiroUsage \|\| showAntigravityUsage/,
  );
  assert.match(appShell, /antigravityAggregateProjection/);
  assert.match(appShell, /setAntigravityAggregateProjection/);
  assert.match(appShell, /antigravityAggregateDetail = useMemo/);
  assert.match(appShell, /key: "antigravity"/);
  assert.match(appShell, /label: "Antigravity"/);
  assert.match(appShell, /order: 3/);

  const gptPush = appShell.indexOf('key: "gpt"');
  const grokPush = appShell.indexOf('key: "grok"');
  const kiroPush = appShell.indexOf('key: "kiro"');
  const antiPush = appShell.indexOf('key: "antigravity"');
  assert.ok(
    gptPush > 0 && grokPush > gptPush && kiroPush > grokPush && antiPush > kiroPush,
    "expected GPT → Grok → Kiro → Antigravity column construction",
  );

  // Standalone order also includes Antigravity after Kiro.
  const standaloneBlockStart = appShell.indexOf("providerUsageAggregated ? (");
  const standaloneBlock = appShell.slice(standaloneBlockStart, standaloneBlockStart + 3200);
  assert.match(standaloneBlock, /<AntigravityUsagePanel/);
  assert.match(standaloneBlock, /displayMode=\{providerUsageDisplayMode\}/);

  // Mutual exclusion preserved.
  assert.match(appShell, /providerUsageAggregated \? \(/);
  assert.match(appShell, /<ProviderUsageAggregatePanel/);
  assert.doesNotMatch(appShell, /display:\s*["']none["'][\s\S]{0,80}AntigravityUsagePanel/);

  // Single host + padding.
  assert.match(appShell, /app-top-usage-panel/);
  const hostBlock = appShell.slice(
    appShell.indexOf("app-top-usage-panel"),
    appShell.indexOf("app-top-usage-panel") + 1800,
  );
  assert.equal((hostBlock.match(/paddingRight/g) || []).length, 1);
});

await test("globals.css covers 4-column aggregate + antigravity panel a11y/reduced-motion", () => {
  const globals = read("app/globals.css");
  assert.match(globals, /data-columns="4"/);
  assert.match(globals, /\.antigravity-usage-panel/);
  assert.match(globals, /\.antigravity-usage-quota-grid/);
  assert.match(globals, /\.antigravity-usage-quota-groups/);
  assert.match(globals, /\.antigravity-usage-quota-group\b/);
  assert.match(globals, /\.antigravity-usage-quota-group-summary/);
  assert.match(
    globals,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*antigravity-usage-panel/,
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll antigravity usage panel checks passed.");
