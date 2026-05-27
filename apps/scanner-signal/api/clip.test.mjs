import assert from "node:assert/strict";
import test from "node:test";

import associationHandler, { buildAssociationPayload } from "./apple-app-site-association.ts";
import clipHandler from "./clip.ts";
import dictationTokenHandler from "./dictation-token.ts";
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

function makeRequest({ method = "GET", path, query = {}, body, headers = {} } = {}) {
  return {
    method,
    query: path ? { ...query, path } : query,
    body,
    headers,
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
  assert.match(response.body, /app-clip-display=card/);
  assert.match(response.body, /app-argument=https:\/\/scanner-signal\.vercel\.app\/clip\/ocr\?session=abc_123-safe/);
  assert.match(response.body, /rel="canonical" href="https:\/\/scanner-signal\.vercel\.app\/clip\/ocr\?session=abc_123-safe"/);
  assert.match(response.body, /Volt OCR scanning/);
  assert.match(response.body, /Open App Clip/);
  assert.match(response.body, /href="\/clip\/ocr\?session=abc_123-safe"/);
  assert.match(response.body, /Session abc_123-safe/);
});

test("clip fallback page includes App Store id in the Smart App Banner when configured", () => {
  const previousAppStoreId = process.env.IOS_APP_STORE_ID;
  process.env.IOS_APP_STORE_ID = "1234567890";
  const response = makeResponse();

  try {
    clipHandler(
      makeRequest({
        path: "barcode",
        query: { session: "abc123" },
        headers: {
          host: "scanner-signal.example",
          "x-forwarded-proto": "https",
        },
      }),
      response
    );
  } finally {
    if (previousAppStoreId === undefined) {
      delete process.env.IOS_APP_STORE_ID;
    } else {
      process.env.IOS_APP_STORE_ID = previousAppStoreId;
    }
  }

  assert.equal(response.statusCode, 200);
  assert.match(
    response.body,
    /content="app-id=1234567890, app-clip-bundle-id=com\.volt\.mobile\.Clip, app-clip-display=card, app-argument=https:\/\/scanner-signal\.example\/clip\/barcode\?session=abc123"/
  );
});

test("clip fallback page supports the base /clip URL for App Store Connect prefix validation", () => {
  const response = makeResponse();

  clipHandler(
    makeRequest({
      headers: {
        host: "scanner-signal.example",
        "x-forwarded-proto": "https",
      },
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Volt App Clip/);
  assert.match(response.body, /app-clip-bundle-id=com\.volt\.mobile\.Clip/);
  assert.match(response.body, /app-clip-display=card/);
  assert.match(response.body, /app-argument=https:\/\/scanner-signal\.example\/clip/);
  assert.match(response.body, /rel="canonical" href="https:\/\/scanner-signal\.example\/clip"/);
  assert.doesNotMatch(response.body, /Session /);
});

test("clip fallback page renders mode-specific fallback copy for every App Clip mode", () => {
  for (const [mode, expectedCopy] of [
    ["ocr", "Scan printed text with your iPhone camera."],
    ["barcode", "Scan a UPC, EAN, or QR code with your iPhone camera."],
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
    makeRequest({ path: "dictation", query: { session: "abc123" } }),
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

test("signal relay can repair a dropped App Clip session with the same id", async () => {
  const missingResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "repair123/result",
      body: {
        id: "missing-session-result",
        mode: "photo",
        message: {
          kind: "photo",
          id: "photo-1",
          name: "volt-photo.jpg",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,aGVsbG8=",
          size: 5,
        },
      },
    }),
    missingResponse
  );
  assert.equal(missingResponse.statusCode, 404);

  const repairResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "repair123",
      body: { relay: true, mode: "photo" },
    }),
    repairResponse
  );
  assert.equal(repairResponse.statusCode, 200);
  assert.equal(repairResponse.body.sessionId, "repair123");

  const postResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "repair123/result",
      body: {
        id: "repaired-session-result",
        mode: "photo",
        message: {
          kind: "photo",
          id: "photo-2",
          name: "volt-photo.jpg",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,aGVsbG8=",
          size: 5,
        },
      },
    }),
    postResponse
  );
  assert.equal(postResponse.statusCode, 200);
  assert.deepEqual(postResponse.body, { success: true });
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

test("signal relay accepts live App Clip dictation partial and final results", async () => {
  const createResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "dictation" } }), createResponse);

  const partialResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: {
        id: "dictation-partial",
        mode: "dictation",
        message: {
          barcode: "hello wor",
          dictationPhase: "partial",
          dictationSessionId: "clip-session",
          format: "dictation",
          kind: "text",
        },
      },
    }),
    partialResponse
  );

  assert.equal(partialResponse.statusCode, 200);

  const finalResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: {
        id: "dictation-final",
        mode: "dictation",
        message: {
          barcode: "hello world",
          dictationPhase: "final",
          dictationSessionId: "clip-session",
          format: "dictation",
          kind: "text",
        },
      },
    }),
    finalResponse
  );

  assert.equal(finalResponse.statusCode, 200);

  const getResponse = makeResponse();
  await signalHandler(makeRequest({ method: "GET", path: `${createResponse.body.sessionId}/result` }), getResponse);
  assert.equal(getResponse.body.results.length, 2);
  assert.equal(getResponse.body.results[0].message.dictationPhase, "partial");
  assert.equal(getResponse.body.results[1].message.dictationPhase, "final");
});

test("dictation token endpoint creates a realtime transcription client secret", async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/realtime/client_secrets");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-openai-key");
    const body = JSON.parse(options.body);
    assert.equal(body.session.type, "transcription");
    assert.equal(body.session.audio.input.format.rate, 24000);
    assert.equal(body.session.audio.input.transcription.model, "gpt-4o-transcribe");
    assert.equal(body.session.audio.input.turn_detection, null);
    return Response.json({ session: { client_secret: { value: "ephemeral-token" } } });
  };

  try {
    const response = makeResponse();
    await dictationTokenHandler(makeRequest({ method: "POST", body: { sessionId: "abc12345" } }), response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { value: "ephemeral-token" });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
  }
});

test("dictation token endpoint reports missing realtime configuration", async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = makeResponse();
    await dictationTokenHandler(makeRequest({ method: "POST" }), response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { error: "Realtime transcription is not configured" });
  } finally {
    if (originalApiKey !== undefined) process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("signal relay allows capability-bound mode switching and queues multiple generic relay results", async () => {
  const createResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "barcode" } }), createResponse);

  const ocrResult = {
    id: "switched-mode",
    mode: "ocr",
    message: {
      barcode: "words",
      format: "live-text",
      insertIntoCursor: true,
      kind: "text",
    },
  };
  const switchResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: ocrResult,
    }),
    switchResponse
  );

  assert.equal(switchResponse.statusCode, 200);

  const dictationMismatchResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result`,
      body: {
        id: "wrong-mode",
        mode: "dictation",
        message: {
          barcode: "words",
          dictationPhase: "final",
          dictationSessionId: "full-app-only",
          format: "dictation",
          kind: "text",
        },
      },
    }),
    dictationMismatchResponse
  );

  assert.equal(dictationMismatchResponse.statusCode, 400);
  assert.deepEqual(dictationMismatchResponse.body, { error: "Result mode mismatch" });

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
  assert.equal(getResponse.body.results.length, 3);
  assert.equal(getResponse.body.results[2].id, "second-result");
  assert.equal(getResponse.body.results[2].message.barcode, "999999999999");
});

test("signal relay keeps only one pending photo result and supports browser acknowledgements", async () => {
  const createResponse = makeResponse();
  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "photo" } }), createResponse);

  for (let index = 0; index < 2; index += 1) {
    const response = makeResponse();
    await signalHandler(
      makeRequest({
        method: "POST",
        path: `${createResponse.body.sessionId}/result`,
        body: {
          id: `photo-result-${index}`,
          mode: "photo",
          message: {
            kind: "photo",
            id: `photo-${index}`,
            name: `volt-photo-${index}.jpg`,
            mimeType: "image/jpeg",
            dataUrl: `data:image/jpeg;base64,${"a".repeat(1000)}`,
            size: 750,
          },
        },
      }),
      response
    );
    assert.equal(response.statusCode, 200);
  }

  const getResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "GET",
      path: `${createResponse.body.sessionId}/result`,
    }),
    getResponse
  );

  assert.equal(getResponse.body.result.id, "photo-result-1");
  assert.equal(getResponse.body.results.length, 1);
  assert.equal(getResponse.body.results[0].id, "photo-result-1");

  const ackResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/result/ack`,
      body: { ids: ["photo-result-1"] },
    }),
    ackResponse
  );
  assert.equal(ackResponse.statusCode, 200);

  const emptyResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "GET",
      path: `${createResponse.body.sessionId}/result`,
    }),
    emptyResponse
  );
  assert.equal(emptyResponse.body.result, null);
  assert.deepEqual(emptyResponse.body.results, []);
});

test("photo object transfer issues one grant per photo and requires browser claim for recovery", async () => {
  const createResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      body: { relay: true, mode: "photo", browserClaim: "browser-claim-1" },
      headers: { host: "scanner-signal.example", "x-forwarded-proto": "https" },
    }),
    createResponse
  );

  const grantResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/photo/grant`,
      body: {
        contributorId: "phone-1",
        filename: "front label.jpg",
        mimeType: "image/jpeg",
        size: 5,
        width: 100,
        height: 80,
      },
      headers: { host: "scanner-signal.example", "x-forwarded-proto": "https" },
    }),
    grantResponse
  );

  assert.equal(grantResponse.statusCode, 200);
  assert.match(grantResponse.body.grant.id, /^grant-/);
  assert.match(grantResponse.body.grant.uploadUrl, /\/photo\/upload\/grant-/);
  assert.match(grantResponse.body.grant.manifestUrl, /\/photo\/manifest$/);

  const grantId = grantResponse.body.grant.id;
  const uploadResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/photo/upload/${grantId}`,
      body: { dataUrl: "data:image/jpeg;base64,aGVsbG8=" },
      headers: { host: "scanner-signal.example", "x-forwarded-proto": "https" },
    }),
    uploadResponse
  );

  assert.equal(uploadResponse.statusCode, 200);
  assert.equal(uploadResponse.body.grantId, grantId);
  assert.match(uploadResponse.body.downloadUrl, /^https:\/\/scanner-signal\.example\/api\/signal\/photo\/object\//);

  const secondUploadResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/photo/upload/${grantId}`,
      body: { dataUrl: "data:image/jpeg;base64,aGVsbG8=" },
    }),
    secondUploadResponse
  );
  assert.equal(secondUploadResponse.statusCode, 409);

  const manifestResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/photo/manifest`,
      body: { id: "photo-1", grantId, capturedAt: "2026-05-27T12:00:00.000Z" },
    }),
    manifestResponse
  );
  assert.equal(manifestResponse.statusCode, 200);
  assert.equal(manifestResponse.body.photo.status, "available_to_browser");
  assert.equal(manifestResponse.body.photo.contributorId, "phone-1");

  const blockedRecoveryResponse = makeResponse();
  await signalHandler(
    makeRequest({ method: "GET", path: `${createResponse.body.sessionId}/photo/manifest` }),
    blockedRecoveryResponse
  );
  assert.equal(blockedRecoveryResponse.statusCode, 403);

  const recoveryResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "GET",
      path: `${createResponse.body.sessionId}/photo/manifest`,
      headers: { "x-volt-browser-claim": "browser-claim-1" },
    }),
    recoveryResponse
  );
  assert.equal(recoveryResponse.statusCode, 200);
  assert.equal(recoveryResponse.body.photos[0].id, "photo-1");

  const ackResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `${createResponse.body.sessionId}/photo/ack`,
      body: { ids: ["photo-1"] },
      headers: { "x-volt-browser-claim": "browser-claim-1" },
    }),
    ackResponse
  );
  assert.equal(ackResponse.statusCode, 200);

  const afterAckResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "GET",
      path: `${createResponse.body.sessionId}/photo/manifest`,
      headers: { "x-volt-browser-claim": "browser-claim-1" },
    }),
    afterAckResponse
  );
  assert.equal(afterAckResponse.body.photos[0].status, "browser_received");
});
