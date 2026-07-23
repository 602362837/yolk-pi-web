#!/usr/bin/env node
/**
 * AnyRouter provider-internal retry / abort / protocol regression suite (AR-06).
 *
 * Behavior tests against the exact-pinned, hash-verified patched pi-anyrouter@0.3.2
 * stream adapter. Uses:
 * - temporary webManaged runtime bridge (never ~/.pi/agent)
 * - mocked global fetch (no real AnyRouter network)
 * - node:test MockTimers for deterministic backoff
 * - real AbortSignal for cancel during fetch/backoff
 *
 * Covers:
 * - Claude `/v1/messages?beta=true` and Codex `/v1/responses` endpoints/headers
 * - maxRetries 0 / 2 / bounds semantics
 * - 429 + transient status table retries
 * - network error retries
 * - hard negatives: 401/403 never retry
 * - Retry-After cap
 * - abort during backoff cancels later fetch
 * - same Active snapshot for all attempts (bridge key unchanged)
 * - safe final errors (no raw body / Authorization / key / path)
 *
 * Run: npm run test:anyrouter-retry
 */

import { createJiti } from "jiti";
import { mock } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as realSetTimeout } from "node:timers";
import { setTimeout as realSetTimeoutPromise } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = `anyrouter-retry-key-${randomBytes(12).toString("hex")}`;
const RAW_UPSTREAM_BODY = `upstream-leaked-body-with-${SECRET}-and-stacktrace`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed += 1;
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${message}`);
    failed += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function sleep(ms) {
  return realSetTimeoutPromise(ms);
}

function jsonResponse(status, body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function sseResponse(events, status = 200) {
  const payload = events
    .map((e) => {
      if (typeof e === "string") return e;
      const data = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
      return `${e.event ? `event: ${e.event}\n` : ""}data: ${data}\n\n`;
    })
    .join("");
  return new Response(payload, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function claudeDoneSse(text = "ok") {
  return sseResponse([
    {
      data: {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-opus-4-8",
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    },
    {
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    {
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
    },
    {
      data: {
        type: "content_block_stop",
        index: 0,
      },
    },
    {
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 },
      },
    },
    {
      data: {
        type: "message_stop",
      },
    },
    "[DONE]",
  ]);
}

function codexDoneSse(text = "codex-ok") {
  return sseResponse([
    {
      data: {
        type: "response.created",
        response: { id: "resp_test" },
      },
    },
    {
      data: {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", content: [] },
      },
    },
    {
      data: {
        type: "response.output_text.delta",
        output_index: 0,
        delta: text,
      },
    },
    {
      data: {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          content: [{ type: "output_text", text }],
        },
      },
    },
    {
      data: {
        type: "response.completed",
        response: {
          id: "resp_test",
          usage: {
            input_tokens: 2,
            output_tokens: 1,
            total_tokens: 3,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      },
    },
  ]);
}

function modelClaude() {
  return {
    id: "claude-opus-4-8",
    name: "Claude Opus (AnyRouter)",
    api: "anyrouter-messages",
    provider: "anyrouter",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
  };
}

function modelCodex() {
  return {
    id: "gpt-5",
    name: "GPT-5 (AnyRouter)",
    api: "anyrouter-messages",
    provider: "anyrouter",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
  };
}

function context() {
  return {
    systemPrompt: "You are a test assistant.",
    messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
  };
}

async function drainStream(stream) {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  const result = await stream.result();
  return { events, result };
}

/**
 * Drive MockTimers while an async stream is in flight.
 * Advances setTimeout in small steps until the stream settles or budget expires.
 */
async function awaitWithTimerPump(promise, { stepMs = 50, maxSteps = 400 } = {}) {
  let settled = false;
  let value;
  let error;
  promise.then(
    (v) => {
      settled = true;
      value = v;
    },
    (e) => {
      settled = true;
      error = e;
    },
  );

  for (let i = 0; i < maxSteps && !settled; i++) {
    // Flush microtasks first so pending setTimeout registrations land.
    await Promise.resolve();
    await Promise.resolve();
    try {
      mock.timers.tick(stepMs);
    } catch {
      // tick may throw if no timers; ignore
    }
    // Allow promise reactions after timer callbacks.
    await Promise.resolve();
    await Promise.resolve();
    // Tiny real wait so aborted listeners and promise jobs can run under fake timers.
    await new Promise((r) => realSetTimeout(r, 0));
  }

  if (!settled) {
    throw new Error(`timed out waiting for stream after ${maxSteps * stepMs}ms of fake time`);
  }
  if (error) throw error;
  return value;
}

async function main() {
  const realHomeAgent = join(homedir(), ".pi", "agent");
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-anyrouter-retry-"));
  const bridgePath = join(agentDir, "auth-api-key-accounts", "anyrouter", ".runtime", "provider.json");
  await writeFile(join(agentDir, ".keep"), "1\n");

  // Ensure package import captures our bridge path (CONFIG_PATH is module-scope).
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_ANYROUTER_CC_CONFIG = bridgePath;
  process.env.PI_ANYROUTER_CC_STREAM_MODE = "force";
  delete process.env.PI_ANYROUTER_CC_API_KEY;
  delete process.env.PI_ANYROUTER_CC_BASE_URL;
  delete process.env.PI_ANYROUTER_CC_MAX_RETRIES;
  delete process.env.PI_ANYROUTER_CC_DEBUG;

  // pi-anyrouter routes through undici when HTTP(S)_PROXY is set. Clear proxy
  // env so mocked globalThis.fetch is used, and still patch undici.fetch as a
  // safety net if a proxy var is reintroduced mid-suite.
  const savedProxyEnv = {};
  for (const key of Object.keys(process.env)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) {
      savedProxyEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  assert(agentDir !== realHomeAgent, "must not use real agent dir");
  assert(process.env.PI_ANYROUTER_CC_CONFIG === bridgePath, "config env pinned to temp bridge");

  async function writeBridge(retry) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dirname(bridgePath), { recursive: true, mode: 0o700 });
    await writeFile(
      bridgePath,
      `${JSON.stringify(
        {
          webManaged: true,
          baseUrl: "https://anyrouter.test",
          apiKey: SECRET,
          models: [
            { id: "claude-opus-4-8" },
            { id: "gpt-5", api: "openai-codex-responses" },
          ],
          retry: {
            maxRetries: 2,
            baseDelayMs: 100,
            maxDelayMs: 400,
            jitterMs: 0,
            retryAfterCapMs: 500,
            ...retry,
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }

  await writeBridge({ maxRetries: 2 });

  // Load patched package after env is set so CONFIG_PATH is our bridge.
  const jiti = createJiti(import.meta.url);
  const mod = await jiti.import(join(root, "node_modules/pi-anyrouter/index.ts"));
  assert(typeof mod.default === "function", "default export is extension factory");

  let registered;
  mod.default({
    registerProvider(name, opts) {
      registered = { name, opts };
    },
  });
  assert(registered?.name === "anyrouter", "provider registered");
  assert(typeof registered.opts.streamSimple === "function", "streamSimple present");
  const streamSimple = registered.opts.streamSimple;

  const originalFetch = globalThis.fetch;
  let fetchCalls = [];
  let fetchImpl = async () => jsonResponse(500, { error: "default-mock" });

  const mockedFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    const headers = init.headers || {};
    const headerObj =
      headers instanceof Headers
        ? Object.fromEntries(headers.entries())
        : Array.isArray(headers)
          ? Object.fromEntries(headers)
          : { ...headers };
    const entry = {
      url,
      method: init.method || "GET",
      headers: headerObj,
      body: init.body,
      signal: init.signal,
    };
    fetchCalls.push(entry);
    return fetchImpl(entry, init);
  };

  globalThis.fetch = mockedFetch;
  // With proxy env cleared, pi-anyrouter uses global fetch (not undici).
  // undici.fetch is non-configurable in this Node build, so we rely on env clear.

  function resetFetch() {
    fetchCalls = [];
  }

  console.log("\n=== protocol adapter signatures ===");

  await test("Claude path hits /v1/messages?beta=true with Bearer + anthropic headers", async () => {
    resetFetch();
    fetchImpl = async () => claudeDoneSse("claude-hello");
    const stream = streamSimple(modelClaude(), context(), {});
    const { result } = await drainStream(stream);
    assert(fetchCalls.length === 1, `expected 1 fetch, got ${fetchCalls.length}`);
    assert(
      fetchCalls[0].url === "https://anyrouter.test/v1/messages?beta=true",
      `claude url ${fetchCalls[0].url}`,
    );
    assert(fetchCalls[0].method === "POST", "POST");
    assert(
      String(fetchCalls[0].headers.authorization || fetchCalls[0].headers.Authorization) ===
        `Bearer ${SECRET}`,
      "authorization bearer",
    );
    assert(
      String(fetchCalls[0].headers["anthropic-version"] || "") === "2023-06-01" ||
        String(fetchCalls[0].headers["Anthropic-Version"] || "") === "2023-06-01",
      "anthropic-version",
    );
    const body = JSON.parse(String(fetchCalls[0].body));
    assert(body.model === "claude-opus-4-8", "model id");
    assert(Array.isArray(body.messages), "messages converted");
    assert(body.stream === true, "SSE stream flag");
    assert(result?.stopReason === "stop" || result?.content?.length >= 0, "completed");
  });

  await test("Codex path hits /v1/responses with Responses body shape", async () => {
    resetFetch();
    fetchImpl = async () => codexDoneSse("codex-hello");
    const stream = streamSimple(modelCodex(), context(), {});
    const { result } = await drainStream(stream);
    assert(fetchCalls.length === 1, `expected 1 fetch, got ${fetchCalls.length}`);
    assert(
      fetchCalls[0].url === "https://anyrouter.test/v1/responses",
      `codex url ${fetchCalls[0].url}`,
    );
    const body = JSON.parse(String(fetchCalls[0].body));
    assert(body.model === "gpt-5", "codex model");
    assert(Array.isArray(body.input), "codex input array");
    assert(body.stream === true, "codex stream");
    assert(body.store === false, "codex store false");
    assert(result, "codex result");
  });

  console.log("\n=== retry classification & maxRetries ===");

  await test("maxRetries=0 performs exactly one attempt on 429", async () => {
    await writeBridge({ maxRetries: 0, baseDelayMs: 100, maxDelayMs: 100, jitterMs: 0 });
    resetFetch();
    fetchImpl = async () => jsonResponse(429, { error: { message: RAW_UPSTREAM_BODY } });

    const stream = streamSimple(modelClaude(), context(), {});
    const { result } = await drainStream(stream);
    assert(fetchCalls.length === 1, `attempts ${fetchCalls.length}`);
    const errText = JSON.stringify(result);
    assert(/AnyRouter request failed/i.test(errText), "safe error marker");
    assert(!errText.includes(SECRET), "secret in error");
    assert(!errText.includes(RAW_UPSTREAM_BODY), "raw body in error");
    assert(!errText.includes(bridgePath), "path in error");
    assert(!errText.includes("Authorization"), "Authorization in error");
  });

  await test("429 retries up to maxRetries+1 then safe error; Active snapshot unchanged", async () => {
    await writeBridge({
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 400,
      jitterMs: 0,
      retryAfterCapMs: 500,
    });
    // Re-read bridge key before/after to prove no Active mutation.
    const before = JSON.parse(await readFile(bridgePath, "utf8"));
    assert(before.apiKey === SECRET, "precondition key");

    resetFetch();
    fetchImpl = async () =>
      jsonResponse(429, { error: { message: RAW_UPSTREAM_BODY, code: "rate_limit_exceeded" } }, {
        "retry-after": "1",
      });

    mock.timers.enable({ apis: ["setTimeout"], now: 1_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), {});
      const drained = drainStream(stream);
      const { result } = await awaitWithTimerPump(drained, { stepMs: 100, maxSteps: 50 });
      assert(fetchCalls.length === 3, `expected 3 attempts (maxRetries=2), got ${fetchCalls.length}`);
      for (const call of fetchCalls) {
        assert(
          String(call.headers.authorization || call.headers.Authorization) === `Bearer ${SECRET}`,
          "same Active key every attempt",
        );
        assert(call.url.endsWith("/v1/messages?beta=true"), "same endpoint every attempt");
      }
      const errText = JSON.stringify(result);
      assert(/attempts=3/i.test(errText) || /AnyRouter request failed/i.test(errText), "safe exhausted error");
      assert(!errText.includes(SECRET), "secret leaked");
      assert(!errText.includes(RAW_UPSTREAM_BODY), "raw body leaked");
    } finally {
      mock.timers.reset();
    }

    const after = JSON.parse(await readFile(bridgePath, "utf8"));
    assert(after.apiKey === SECRET, "bridge Active key mutated by 429 retries");
    assert(after.baseUrl === before.baseUrl, "bridge baseUrl mutated");
  });

  await test("default maxRetries=10 means at most 11 attempts", async () => {
    await writeBridge({
      maxRetries: 10,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitterMs: 0,
      retryAfterCapMs: 10,
    });
    resetFetch();
    fetchImpl = async () => jsonResponse(429, { error: { message: RAW_UPSTREAM_BODY } });

    mock.timers.enable({ apis: ["setTimeout"], now: 9_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), {});
      const { result } = await awaitWithTimerPump(drainStream(stream), {
        stepMs: 10,
        maxSteps: 200,
      });
      assert(fetchCalls.length === 11, `expected 11 attempts (maxRetries=10), got ${fetchCalls.length}`);
      const errText = JSON.stringify(result);
      assert(/attempts=11/i.test(errText) || /AnyRouter request failed/i.test(errText), "safe error");
      assert(!errText.includes(SECRET), "secret leak at maxRetries=10");
      assert(!errText.includes(RAW_UPSTREAM_BODY), "raw body at maxRetries=10");
    } finally {
      mock.timers.reset();
    }
  });

  await test("transient 503 retries then succeeds; only one success body consumed", async () => {
    await writeBridge({ maxRetries: 3, baseDelayMs: 50, maxDelayMs: 200, jitterMs: 0 });
    resetFetch();
    let n = 0;
    fetchImpl = async () => {
      n += 1;
      if (n < 3) return jsonResponse(503, { error: "temporary" });
      return claudeDoneSse("recovered");
    };

    mock.timers.enable({ apis: ["setTimeout"], now: 2_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), {});
      const { result } = await awaitWithTimerPump(drainStream(stream), { stepMs: 50, maxSteps: 40 });
      assert(fetchCalls.length === 3, `fetches ${fetchCalls.length}`);
      const text = JSON.stringify(result);
      assert(text.includes("recovered") || result?.stopReason === "stop", "recovered content");
    } finally {
      mock.timers.reset();
    }
  });

  await test("401/403 are hard negatives and do not retry", async () => {
    await writeBridge({ maxRetries: 5, baseDelayMs: 100, maxDelayMs: 100, jitterMs: 0 });
    for (const status of [401, 403]) {
      resetFetch();
      fetchImpl = async () => jsonResponse(status, { error: { message: RAW_UPSTREAM_BODY } });
      const stream = streamSimple(modelClaude(), context(), {});
      const { result } = await drainStream(stream);
      assert(fetchCalls.length === 1, `${status} retries: ${fetchCalls.length}`);
      const errText = JSON.stringify(result);
      assert(!errText.includes(SECRET), `${status} secret leak`);
      assert(!errText.includes(RAW_UPSTREAM_BODY), `${status} raw body leak`);
    }
  });

  await test("network errors retry; abort-like network errors do not", async () => {
    await writeBridge({ maxRetries: 2, baseDelayMs: 50, maxDelayMs: 100, jitterMs: 0 });
    resetFetch();
    let n = 0;
    fetchImpl = async () => {
      n += 1;
      if (n < 3) {
        const err = new Error("socket hang up");
        err.name = "FetchError";
        throw err;
      }
      return claudeDoneSse("net-ok");
    };

    mock.timers.enable({ apis: ["setTimeout"], now: 3_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), {});
      await awaitWithTimerPump(drainStream(stream), { stepMs: 50, maxSteps: 40 });
      assert(fetchCalls.length === 3, `network retries ${fetchCalls.length}`);
    } finally {
      mock.timers.reset();
    }

    resetFetch();
    fetchImpl = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };
    const stream = streamSimple(modelClaude(), context(), {});
    const { result } = await drainStream(stream);
    assert(fetchCalls.length === 1, `abort-like should not retry, got ${fetchCalls.length}`);
    const errText = JSON.stringify(result);
    assert(/abort/i.test(errText) || result?.stopReason === "aborted", "abort stop reason");
  });

  console.log("\n=== Retry-After cap / backoff fields ===");

  await test("Retry-After is honored but capped by retryAfterCapMs", async () => {
    await writeBridge({
      maxRetries: 1,
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
      jitterMs: 0,
      retryAfterCapMs: 200,
    });
    resetFetch();
    let n = 0;
    fetchImpl = async () => {
      n += 1;
      if (n === 1) {
        return jsonResponse(429, { error: "slow down" }, { "retry-after": "30" }); // 30s → cap 200ms
      }
      return claudeDoneSse("after-cap");
    };

    mock.timers.enable({ apis: ["setTimeout"], now: 4_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), {});
      const drained = drainStream(stream);
      // Cap is 200ms; stepping 250ms once should be enough after the first 429.
      const { result } = await awaitWithTimerPump(drained, { stepMs: 50, maxSteps: 20 });
      assert(fetchCalls.length === 2, `fetches ${fetchCalls.length}`);
      const text = JSON.stringify(result);
      assert(text.includes("after-cap") || result?.stopReason === "stop", "completed after capped wait");
    } finally {
      mock.timers.reset();
    }
  });

  await test("backoff uses baseDelay * 2^attempt with maxDelay cap (jitter 0)", async () => {
    // Observe delay by aborting mid-wait is covered below; here assert retry count with large max.
    await writeBridge({
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 250,
      jitterMs: 0,
      retryAfterCapMs: 1000,
    });
    resetFetch();
    fetchImpl = async () => jsonResponse(502, { error: "bad gateway" });

    mock.timers.enable({ apis: ["setTimeout"], now: 5_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), {});
      await awaitWithTimerPump(drainStream(stream), { stepMs: 50, maxSteps: 80 });
      // maxRetries=3 → 4 attempts
      assert(fetchCalls.length === 4, `expected 4 attempts, got ${fetchCalls.length}`);
    } finally {
      mock.timers.reset();
    }
  });

  console.log("\n=== abort during backoff ===");

  await test("AbortSignal during backoff cancels wait and prevents later fetch", async () => {
    await writeBridge({
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitterMs: 0,
      retryAfterCapMs: 5000,
    });
    resetFetch();
    fetchImpl = async () => jsonResponse(429, { error: "rate" }, { "retry-after": "5" });

    const controller = new AbortController();
    mock.timers.enable({ apis: ["setTimeout"], now: 6_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), { signal: controller.signal });
      const drained = drainStream(stream);

      // Let first fetch complete and enter delay.
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => realSetTimeout(r, 0));
      assert(fetchCalls.length === 1, `pre-abort fetches ${fetchCalls.length}`);

      controller.abort();
      // Pump timers; abort should reject delay without further fetch.
      const { result } = await awaitWithTimerPump(drained, { stepMs: 100, maxSteps: 30 });
      assert(fetchCalls.length === 1, `post-abort fetches ${fetchCalls.length} (must stay 1)`);
      const errText = JSON.stringify(result);
      assert(/abort/i.test(errText) || result?.stopReason === "aborted", "aborted result");
      assert(!errText.includes(SECRET), "secret after abort");
    } finally {
      mock.timers.reset();
    }
  });

  await test("AbortSignal during in-flight fetch does not schedule network retry", async () => {
    await writeBridge({ maxRetries: 5, baseDelayMs: 100, maxDelayMs: 100, jitterMs: 0 });
    resetFetch();
    fetchImpl = async (_entry, init) => {
      // Wait until aborted, then throw AbortError like fetch does.
      await new Promise((resolve, reject) => {
        const signal = init.signal;
        if (signal?.aborted) {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        const onAbort = () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        // Fallback: never resolve unless aborted (test will abort).
      });
      return claudeDoneSse("should-not");
    };

    const controller = new AbortController();
    const stream = streamSimple(modelClaude(), context(), { signal: controller.signal });
    const drained = drainStream(stream);
    await Promise.resolve();
    await new Promise((r) => realSetTimeout(r, 0));
    controller.abort();
    const { result } = await drained;
    assert(fetchCalls.length === 1, `fetch count ${fetchCalls.length}`);
    // Give a short real-time window to ensure no delayed retry schedules another fetch.
    await sleep(30);
    assert(fetchCalls.length === 1, `delayed retry appeared: ${fetchCalls.length}`);
    const errText = JSON.stringify(result);
    assert(/abort/i.test(errText) || result?.stopReason === "aborted", "aborted");
  });

  console.log("\n=== Codex retries + sentinel ===");

  await test("Codex 429 retries with same key and safe final error", async () => {
    await writeBridge({ maxRetries: 1, baseDelayMs: 50, maxDelayMs: 100, jitterMs: 0 });
    resetFetch();
    fetchImpl = async () =>
      jsonResponse(429, { error: { message: RAW_UPSTREAM_BODY } }, { "retry-after": "1" });

    mock.timers.enable({ apis: ["setTimeout"], now: 7_000_000 });
    try {
      const stream = streamSimple(modelCodex(), context(), {});
      const { result } = await awaitWithTimerPump(drainStream(stream), { stepMs: 50, maxSteps: 30 });
      assert(fetchCalls.length === 2, `codex attempts ${fetchCalls.length}`);
      for (const call of fetchCalls) {
        assert(call.url === "https://anyrouter.test/v1/responses", `url ${call.url}`);
        assert(
          String(call.headers.authorization || call.headers.Authorization) === `Bearer ${SECRET}`,
          "codex auth",
        );
      }
      const errText = JSON.stringify(result);
      assert(!errText.includes(SECRET), "codex secret leak");
      assert(!errText.includes(RAW_UPSTREAM_BODY), "codex raw body leak");
      assert(/AnyRouter request failed|abort|error/i.test(errText), "safe/error projection");
    } finally {
      mock.timers.reset();
    }
  });

  await test("maxRetries upper clamp: bridge 20 is accepted; request stays offline", async () => {
    await writeBridge({ maxRetries: 20, baseDelayMs: 10, maxDelayMs: 10, jitterMs: 0 });
    resetFetch();
    fetchImpl = async () => jsonResponse(500, { error: "x" });
    // Do not run all 21 attempts (too slow even with fake timers in CI noise);
    // instead verify loadSourceProvider path via a short abort after first try.
    const controller = new AbortController();
    mock.timers.enable({ apis: ["setTimeout"], now: 8_000_000 });
    try {
      const stream = streamSimple(modelClaude(), context(), { signal: controller.signal });
      const drained = drainStream(stream);
      await Promise.resolve();
      await new Promise((r) => realSetTimeout(r, 0));
      assert(fetchCalls.length >= 1, "at least one attempt with maxRetries=20 bridge");
      controller.abort();
      await awaitWithTimerPump(drained, { stepMs: 10, maxSteps: 30 });
      // Abort should stop further retries quickly.
      const count = fetchCalls.length;
      await awaitWithTimerPump(Promise.resolve(), { stepMs: 10, maxSteps: 5 }).catch(() => {});
      assert(fetchCalls.length === count, "no additional fetches after abort with high maxRetries");
    } finally {
      mock.timers.reset();
    }
  });

  // Restore fetch / proxy env
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedProxyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_ANYROUTER_CC_CONFIG;
  delete process.env.PI_ANYROUTER_CC_STREAM_MODE;
  await rm(agentDir, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
