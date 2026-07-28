import assert from "node:assert/strict";
import {
  mergeRevisionedOAuthVerification,
  ModelsRequestLifecycle,
} from "../lib/models-config-lifecycle.ts";

function deferredFetch(signal) {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  // Deliberately ignores AbortSignal: this is the provider/fetch behavior that
  // makes generation and lifecycle checks the actual commit boundary.
  return { promise, resolve, signal };
}

async function settleRequest(gate, token, deferred, commit) {
  const value = await deferred.promise;
  if (gate.isCurrent(token)) commit(value);
}

async function testSlowFirstFastSecond() {
  const gate = new ModelsRequestLifecycle();
  const first = gate.begin("catalog");
  const firstAbort = new AbortController();
  const slow = deferredFetch(firstAbort.signal);
  let rows = [];
  const firstCommit = settleRequest(gate, first, slow, (value) => { rows = value; });

  const second = gate.begin("catalog");
  firstAbort.abort();
  assert.equal(slow.signal.aborted, true, "test setup must settle S1 despite abort");
  const fast = deferredFetch();
  const secondCommit = settleRequest(gate, second, fast, (value) => { rows = value; });
  fast.resolve(["S2"]);
  await secondCommit;
  slow.resolve(["S1"]);
  await firstCommit;
  assert.deepEqual(rows, ["S2"], "S1 must not overwrite a newer catalog generation");
}

async function testCloseReopen() {
  const oldModal = new ModelsRequestLifecycle();
  const oldRequest = oldModal.begin("config");
  const closeAbort = new AbortController();
  const slow = deferredFetch(closeAbort.signal);
  let oldCommits = 0;
  const pending = settleRequest(oldModal, oldRequest, slow, () => { oldCommits += 1; });
  closeAbort.abort();
  oldModal.close();
  assert.equal(slow.signal.aborted, true, "closed request still settles despite abort");

  const reopenedModal = new ModelsRequestLifecycle();
  const fresh = reopenedModal.begin("config");
  let config = null;
  assert.ok(reopenedModal.isCurrent(fresh));
  slow.resolve({ providers: { stale: {} } });
  await pending;
  assert.equal(oldCommits, 0, "a settled request after close must not commit");
  config = { providers: { fresh: {} } };
  assert.deepEqual(config, { providers: { fresh: {} } });
}

async function testProviderAndAccountSwitch() {
  const gate = new ModelsRequestLifecycle();
  const grokA = gate.begin("quota", { providerId: "grok-cli", accountId: "A" });
  const grokAResult = deferredFetch();
  let quota = null;
  const oldQuota = settleRequest(gate, grokA, grokAResult, (value) => { quota = value; });

  const kiroB = gate.begin("quota", { providerId: "kiro", accountId: "B" });
  const kiroBResult = deferredFetch();
  const newQuota = settleRequest(gate, kiroB, kiroBResult, (value) => { quota = value; });
  kiroBResult.resolve("kiro-B");
  await newQuota;
  grokAResult.resolve("grok-A");
  await oldQuota;
  assert.equal(quota, "kiro-B", "provider/account A cannot commit after switching to B");
}

async function testMutationBeatsOldGet() {
  const gate = new ModelsRequestLifecycle();
  const oldGet = gate.begin("accounts", { providerId: "grok-cli" });
  const deferred = deferredFetch();
  let accounts = ["before"];
  const pending = settleRequest(gate, oldGet, deferred, (value) => { accounts = value; });

  // A mutation invalidates reads before the POST starts, then its safe response
  // is committed synchronously as the authoritative local projection.
  gate.invalidate("accounts");
  accounts = ["new-active"];
  deferred.resolve(["old-active"]);
  await pending;
  assert.deepEqual(accounts, ["new-active"], "old GET cannot overwrite mutation response");
}

function testVerificationRevisionOwnership() {
  const summary = [{
    id: "grok-cli",
    localStateRevision: "r2",
    localConfigured: true,
    accountCount: 2,
    activeAccountDisplayName: "new",
    loggedIn: true,
  }];
  const stale = mergeRevisionedOAuthVerification(summary, [{
    id: "grok-cli",
    verification: { basedOnRevision: "r1", state: "invalid" },
  }]);
  assert.strictEqual(stale[0], summary[0], "verification with another revision must not merge");

  const current = mergeRevisionedOAuthVerification(summary, [{
    id: "grok-cli",
    verification: { basedOnRevision: "r2", state: "invalid" },
  }]);
  assert.equal(current[0].loggedIn, false);
  assert.equal(current[0].accountCount, 2, "verification cannot own account count");
  assert.equal(current[0].activeAccountDisplayName, "new", "verification cannot own Active selection");
}

async function testRevealAndCopyLateResult() {
  const gate = new ModelsRequestLifecycle();
  const revealA = gate.begin("reveal", { providerId: "xai", accountId: "A" });
  const slowReveal = deferredFetch();
  let plaintext = null;
  let copied = false;
  const pending = settleRequest(gate, revealA, slowReveal, (key) => {
    plaintext = key;
    copied = true;
  });

  // Switching provider clears sensitive state and starts a fresh reveal lane.
  gate.begin("reveal", { providerId: "anyrouter", accountId: "B" });
  plaintext = null;
  copied = false;
  slowReveal.resolve("sk-old-secret");
  await pending;
  assert.equal(plaintext, null, "late plaintext must not enter the next provider state");
  assert.equal(copied, false, "late reveal must not trigger copy state");
}

await testSlowFirstFastSecond();
await testCloseReopen();
await testProviderAndAccountSwitch();
await testMutationBeatsOldGet();
testVerificationRevisionOwnership();
await testRevealAndCopyLateResult();
console.log("models config lifecycle race behavior tests passed (6 scenarios)");
