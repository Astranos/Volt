import assert from "node:assert/strict";

const origin = process.env.SCANNER_SIGNAL_ORIGIN || "https://scanner-signal.vercel.app";
const teamId = process.env.APPLE_TEAM_ID || "GB5SPLUARQ";
const fullAppBundleId = process.env.IOS_BUNDLE_ID || "com.volt.mobile";
const appClipBundleId = process.env.IOS_APP_CLIP_BUNDLE_ID || "com.volt.mobile.Clip";
const clipModes = ["ocr", "barcode", "dictation"];

async function fetchJson(path, options) {
  const response = await fetch(`${origin}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function fetchText(path, options) {
  const response = await fetch(`${origin}${path}`, options);
  const body = await response.text();
  return { response, body };
}

function assertOk(response, label) {
  assert.equal(response.ok, true, `${label} returned ${response.status}`);
}

export function assertAssociationPayload(body, { teamId, fullAppBundleId, appClipBundleId }) {
  assert.deepEqual(body.appclips?.apps, [`${teamId}.${appClipBundleId}`]);
  const fullAppClipLinks = body.applinks?.details?.filter((detail) =>
    detail?.appIDs?.includes(`${teamId}.${fullAppBundleId}`)
  );
  assert.deepEqual(fullAppClipLinks, []);
}

export function assertClipFallbackHtml(body, { appClipBundleId, session }) {
  assert.match(body, new RegExp(`app-clip-bundle-id=${appClipBundleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(body, new RegExp(`Session ${session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
}

async function validateAssociation() {
  const { response, body } = await fetchJson("/.well-known/apple-app-site-association");
  assertOk(response, "AASA");
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  assertAssociationPayload(body, { teamId, fullAppBundleId, appClipBundleId });
}

async function validateClipPages() {
  for (const mode of clipModes) {
    const { response, body } = await fetchText(`/clip/${mode}?session=test123`);
    assertOk(response, `/clip/${mode}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assertClipFallbackHtml(body, { appClipBundleId, session: "test123" });
  }
}

async function validateRelayContract() {
  const { response: createResponse, body: createBody } = await fetchJson("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relay: true, mode: "barcode" }),
  });
  assertOk(createResponse, "relay create");
  assert.match(createBody.sessionId, /^[a-z0-9]{8}$/);

  const result = {
    id: `production-validation-${Date.now()}`,
    mode: "barcode",
    message: {
      barcode: "PRODUCTION-VALIDATION",
      format: "qr",
      insertIntoCursor: true,
      kind: "barcode",
    },
  };

  const { response: postResponse, body: postBody } = await fetchJson(
    `/api/signal/${createBody.sessionId}/result`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    }
  );
  assertOk(postResponse, "relay post");
  assert.deepEqual(postBody, { success: true });

  const { response: getResponse, body: getBody } = await fetchJson(
    `/api/signal/${createBody.sessionId}/result`
  );
  assertOk(getResponse, "relay get");
  assert.equal(getBody.result?.id, result.id);
  assert.equal(getBody.result?.mode, "barcode");
  assert.equal(getBody.result?.message?.barcode, "PRODUCTION-VALIDATION");
  assert.equal(getBody.result?.message?.insertIntoCursor, true);

  const { response: mismatchResponse, body: mismatchBody } = await fetchJson(
    `/api/signal/${createBody.sessionId}/result`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `production-validation-mismatch-${Date.now()}`,
        mode: "ocr",
        message: {
          barcode: "wrong mode",
          format: "live-text",
          insertIntoCursor: true,
          kind: "text",
        },
      }),
    }
  );
  assert.equal(mismatchResponse.status, 400);
  assert.deepEqual(mismatchBody, { error: "Result mode mismatch" });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await validateAssociation();
  await validateClipPages();
  await validateRelayContract();

  console.log(`Production scanner-signal validation passed for ${origin}`);
}
