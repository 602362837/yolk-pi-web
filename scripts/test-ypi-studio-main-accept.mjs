/**
 * Pure-function truth table for main-task session-widget acceptance (IMP-003 MAIN-ACCEPT-1).
 * Covers canAcceptMainTask only — no widget UI, no server transition changes.
 */
import assert from "node:assert/strict";
import { canAcceptMainTask } from "../lib/ypi-studio-session-link.ts";

/** @type {Array<{ name: string; input: { status: string; archived?: boolean; unresolvedImprovementCount: number }; expected: boolean }>} */
const cases = [
  {
    name: "user_acceptance, no improvements unresolved",
    input: { status: "user_acceptance", archived: false, unresolvedImprovementCount: 0 },
    expected: true,
  },
  {
    name: "user_acceptance, archived omitted, unresolved 0",
    input: { status: "user_acceptance", unresolvedImprovementCount: 0 },
    expected: true,
  },
  {
    name: "user_acceptance with accepted improvements (unresolved 0)",
    input: { status: "user_acceptance", archived: false, unresolvedImprovementCount: 0 },
    expected: true,
  },
  {
    name: "user_acceptance with unresolved improvements",
    input: { status: "user_acceptance", archived: false, unresolvedImprovementCount: 1 },
    expected: false,
  },
  {
    name: "user_acceptance archived",
    input: { status: "user_acceptance", archived: true, unresolvedImprovementCount: 0 },
    expected: false,
  },
  {
    name: "waiting_for_improvements",
    input: { status: "waiting_for_improvements", archived: false, unresolvedImprovementCount: 1 },
    expected: false,
  },
  {
    name: "review (post-improvements review_ready path still review status)",
    input: { status: "review", archived: false, unresolvedImprovementCount: 0 },
    expected: false,
  },
  {
    name: "ready",
    input: { status: "ready", archived: false, unresolvedImprovementCount: 0 },
    expected: false,
  },
  {
    name: "completed",
    input: { status: "completed", archived: false, unresolvedImprovementCount: 0 },
    expected: false,
  },
  {
    name: "implementing",
    input: { status: "implementing", archived: false, unresolvedImprovementCount: 0 },
    expected: false,
  },
  {
    name: "awaiting_approval",
    input: { status: "awaiting_approval", archived: false, unresolvedImprovementCount: 0 },
    expected: false,
  },
  {
    name: "checking",
    input: { status: "checking", archived: false, unresolvedImprovementCount: 0 },
    expected: false,
  },
];

for (const testCase of cases) {
  const actual = canAcceptMainTask(testCase.input);
  assert.equal(
    actual,
    testCase.expected,
    `${testCase.name}: expected ${testCase.expected}, got ${actual}`,
  );
}

// review_ready is parentStatus, not main task status — must never be treated as completable status alone.
assert.equal(
  canAcceptMainTask({ status: "review_ready", archived: false, unresolvedImprovementCount: 0 }),
  false,
  "review_ready must not enable canAcceptMain",
);

console.log(`ypi-studio main-accept tests passed (${cases.length + 1} cases)`);
