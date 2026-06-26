import assert from "node:assert/strict";
import test from "node:test";

import { SCANNER_SIGNAL_URL_DEV } from "@volt/scanner-protocol";
import { MobileScannerSignalClient, signalFetch } from "./mobile-scanner-signal-client.ts";

test("signalFetch retries transient server failures", async () => {
  const originalFetch = globalThis.fetch;
  const statuses = [502, 200];
  const calls = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init);
    return new Response("{}", { status: statuses.shift() });
  };

  try {
    const response = await signalFetch("https://signal.example.test/attempt", {
      retryDelayMs: 1,
      timeoutMs: 100,
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signalFetch does not retry non-transient client failures", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("{}", { status: 400 });
  };

  try {
    const response = await signalFetch("https://signal.example.test/bad-request", {
      retryDelayMs: 1,
      timeoutMs: 100,
    });

    assert.equal(response.status, 400);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signalFetch aborts and retries hung requests", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCount += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  };

  try {
    await assert.rejects(
      signalFetch("https://signal.example.test/hung", {
        retries: 1,
        retryDelayMs: 1,
        timeoutMs: 5,
      }),
      /timed out/,
    );
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createJoinWindow fallback QR includes the signal URL that minted the token", async () => {
  const originalFetch = globalThis.fetch;
  const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
  const sessionId = "session_1234";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ token, sessionId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const client = new MobileScannerSignalClient(120_000);
    const window = await client.createJoinWindow({ sessionId, deviceLabel: "Chrome Dev" });
    const url = new URL(window.qrCodeUrl);

    assert.equal(url.origin, "https://volt-scanner.vercel.app");
    assert.equal(url.pathname, "/session");
    assert.equal(url.searchParams.get("token"), token);
    assert.equal(url.searchParams.get("sessionId"), sessionId);
    assert.equal(url.searchParams.get("signalUrl"), SCANNER_SIGNAL_URL_DEV);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
