import assert from "node:assert/strict";
import test from "node:test";

import associationHandler, { buildAssociationPayload } from "./apple-app-site-association.ts";
import clipHandler from "./clip.ts";
import signalHandler from "./signal.ts";

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function makeRequest({ method = "GET", path, query = {}, body } = {}) {
  return {
    method,
    query: path ? { ...query, path } : query,
    body,
    url: path ? `/api/signal/${path}` : "/api/signal",
  };
}

test("clip fallback page preserves App Clip metadata and escapes session values", () => {
  const response = makeResponse();

  clipHandler(
    makeRequest({
      path: "ocr",
      query: { session: "abc_123-safe" },
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.body, /app-clip-bundle-id=com\.volt\.mobile\.Clip/);
  assert.match(response.body, /Volt OCR scanning/);
  assert.match(response.body, /Open App Clip/);
  assert.match(response.body, /href="\/clip\/ocr\?session=abc_123-safe"/);
  assert.match(response.body, /Session abc_123-safe/);
});

test("clip fallback page renders mode-specific fallback copy for every App Clip mode", () => {
  for (const [mode, expectedCopy] of [
    ["ocr", "Scan printed text with your iPhone camera."],
    ["barcode", "Scan a UPC, EAN, or QR code with your iPhone camera."],
    ["dictation", "Speak a short note and send the final transcript back to Chrome."],
    ["photo", "Capture a photo with your iPhone camera and send it back to Chrome."],
  ]) {
    const response = makeResponse();

    clipHandler(makeRequest({ path: mode, query: { session: "abc123" } }), response);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, new RegExp(expectedCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(response.body.includes(`href="/clip/${mode}?session=abc123"`));
  }
});

test("clip fallback rejects missing, unsupported, or invalid-format invocations", () => {
  for (const request of [
    makeRequest({ path: "photos", query: { session: "abc123" } }),
    makeRequest({ path: "barcode" }),
    makeRequest({ path: "ocr", query: { session: `abc"><script>alert(1)</script>` } }),
    makeRequest({ path: "ocr", query: { session: "abc" } }),
    makeRequest({ path: "ocr", query: { session: "x".repeat(81) } }),
  ]) {
    const response = makeResponse();
    clipHandler(request, response);
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, "Not found");
  }
});

test("apple-app-site-association advertises App Clip ids without stealing /clip links for the full app", () => {
  const response = makeResponse();

  associationHandler(makeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(response.body.appclips.apps, ["GB5SPLUARQ.com.volt.mobile.Clip"]);
  assert.deepEqual(response.body.applinks.details, []);
});

test("apple-app-site-association payload supports environment-backed ids", () => {
  const payload = buildAssociationPayload({
    appClipBundleId: "com.example.mobile.Clip",
    fullAppBundleId: "com.example.mobile",
    teamId: "TEAM123456",
  });

  assert.deepEqual(payload.appclips.apps, ["TEAM123456.com.example.mobile.Clip"]);
  assert.deepEqual(payload.applinks.details, []);
});

test("apple-app-site-association can opt into full-app /clip universal links", () => {
  const payload = buildAssociationPayload({
    appClipBundleId: "com.example.mobile.Clip",
    fullAppBundleId: "com.example.mobile",
    includeFullAppClipLinks: true,
    teamId: "TEAM123456",
  });

  assert.deepEqual(payload.appclips.apps, ["TEAM123456.com.example.mobile.Clip"]);
  assert.deepEqual(payload.applinks.details[0].appIDs, ["TEAM123456.com.example.mobile"]);
  assert.deepEqual(payload.applinks.details[0].components[0]["/"], "/clip/*");
});

test("signal relay creates a session, stores one App Clip result, and reads it back", async () => {
  const createResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "barcode" } }), createResponse);

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.headers["cache-control"], "no-store");
  assert.match(createResponse.body.sessionId, /^[a-z0-9]{8}$/);

  const result = {
    id: "clip-result-1",
    mode: "barcode",
    message: {
      barcode: "012345678905",
      format: "ean-13",
      insertIntoCursor: true,
      kind: "barcode",
    },
  };
  const postResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: result,
    }),
    postResponse
  );

  assert.equal(postResponse.statusCode, 200);
  assert.deepEqual(postResponse.body, { success: true });

  const getResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "GET",
      path: `${createResponse.body.sessionId}/result`,
    }),
    getResponse
  );

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.headers["cache-control"], "no-store");
  assert.equal(getResponse.body.result.id, result.id);
  assert.equal(getResponse.body.result.mode, result.mode);
  assert.equal(getResponse.body.result.message.barcode, result.message.barcode);
  assert.equal(getResponse.body.result.message.insertIntoCursor, true);
  assert.equal(getResponse.body.result.message.kind, "barcode");
  assert.match(getResponse.body.result.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("signal relay stores and updates App Clip session target metadata", async () => {
  const createResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      body: {
        relay: true,
        mode: "dictation",
        target: {
          browser: "Chrome",
          tabTitle: "Original field",
          url: "https://example.com/a",
          cursor: "Search box",
        },
      },
    }),
    createResponse
  );

  const firstGet = makeResponse();
  await signalHandler(makeRequest({ method: "GET", path: createResponse.body.sessionId }), firstGet);
  assert.equal(firstGet.statusCode, 200);
  assert.equal(firstGet.body.target.tabTitle, "Original field");
  assert.equal(firstGet.body.target.cursor, "Search box");

  const updateResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/target`,
      body: {
        target: {
          browser: "Chrome",
          tabTitle: "New field",
          url: "https://example.com/b",
          cursor: "Notes",
        },
      },
    }),
    updateResponse
  );
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.target.tabTitle, "New field");

  const secondGet = makeResponse();
  await signalHandler(makeRequest({ method: "GET", path: createResponse.body.sessionId }), secondGet);
  assert.equal(secondGet.body.target.tabTitle, "New field");
  assert.equal(secondGet.body.target.cursor, "Notes");
});

test("signal relay records when an App Clip opens a session", async () => {
  const createResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      body: {
        relay: true,
        mode: "dictation",
      },
    }),
    createResponse
  );

  const connectResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/connect`,
      body: { openedAt: "2026-05-25T15:00:00.000Z" },
    }),
    connectResponse
  );

  assert.equal(connectResponse.statusCode, 200);
  assert.match(connectResponse.body.connectedAt, /^\d{4}-\d{2}-\d{2}T/);

  const getResponse = makeResponse();
  await signalHandler(makeRequest({ method: "GET", path: createResponse.body.sessionId }), getResponse);
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.body.connectedAt, connectResponse.body.connectedAt);
});

test("signal relay supports generic App Clip sessions and rejects unsupported modes", async () => {
  const genericResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true } }), genericResponse);
  assert.equal(genericResponse.statusCode, 200);
  assert.match(genericResponse.body.sessionId, /^[a-z0-9]+$/);

  const unsupportedResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "photos" } }), unsupportedResponse);
  assert.equal(unsupportedResponse.statusCode, 200);
  assert.match(unsupportedResponse.body.sessionId, /^[a-z0-9]+$/);
});

test("signal relay rejects App Clip results that do not match their mode contract", async () => {
  const createResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "ocr" } }), createResponse);

  const invalidResults = [
    {
      id: "bad-ocr",
      mode: "ocr",
      message: { barcode: "012345678905", format: "ean-13", kind: "barcode" },
    },
    {
      id: "bad-barcode",
      mode: "barcode",
      message: { barcode: "words", format: "live-text", kind: "text" },
    },
    {
      id: "bad-dictation",
      mode: "dictation",
      message: { barcode: "partial words", format: "dictation", kind: "text", dictationPhase: "partial" },
    },
  ];

  for (const result of invalidResults) {
    const response = makeResponse();
    await signalHandler(
      makeRequest({
        method: "POST",
        path: `${createResponse.body.sessionId}/result`,
        body: result,
      }),
      response
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { error: "Invalid result" });
  }
});

test("signal relay rejects wrong bound modes and queues multiple generic relay results", async () => {
  const createResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "barcode" } }), createResponse);

  const ocrResult = {
    id: "wrong-mode",
    mode: "ocr",
    message: {
      barcode: "words",
      format: "live-text",
      insertIntoCursor: true,
      kind: "text",
    },
  };
  const mismatchResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: ocrResult,
    }),
    mismatchResponse
  );

  assert.equal(mismatchResponse.statusCode, 400);
  assert.deepEqual(mismatchResponse.body, { error: "Result mode mismatch" });

  const firstResult = {
    id: "first-result",
    mode: "barcode",
    message: {
      barcode: "012345678905",
      format: "ean-13",
      insertIntoCursor: true,
      kind: "barcode",
    },
  };
  const firstResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: firstResult,
    }),
    firstResponse
  );

  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(firstResponse.body, { success: true });

  const duplicateResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: firstResult,
    }),
    duplicateResponse
  );

  assert.equal(duplicateResponse.statusCode, 200);
  assert.deepEqual(duplicateResponse.body, { success: true });

  const secondResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: {
        ...firstResult,
        id: "second-result",
        message: { ...firstResult.message, barcode: "999999999999" },
      },
    }),
    secondResponse
  );

  assert.equal(secondResponse.statusCode, 200);
  assert.deepEqual(secondResponse.body, { success: true });

  const getResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "GET",
      path: `${createResponse.body.sessionId}/result`,
    }),
    getResponse
  );

  assert.equal(getResponse.body.result.id, "second-result");
  assert.equal(getResponse.body.result.message.barcode, "999999999999");
  assert.equal(getResponse.body.results.length, 2);
  assert.equal(getResponse.body.results[1].id, "second-result");
  assert.equal(getResponse.body.results[1].message.barcode, "999999999999");
});
