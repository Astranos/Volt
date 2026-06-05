import assert from "node:assert/strict";

const origin = process.env.SCANNER_SIGNAL_ORIGIN || "https://scanner-signal.vercel.app";

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

export function assertAssociationPayload(body) {
  assert.deepEqual(body.appclips?.apps, []);
  assert.deepEqual(body.applinks?.details, []);
}

export function assertClipObsoleteResponse(response, body) {
  assert.equal(response.status, 410);
  assert.match(body, /obsolete/i);
  assert.doesNotMatch(body, /app-clip-bundle-id/i);
}

async function validateAssociation() {
  const { response, body } = await fetchJson("/.well-known/apple-app-site-association");
  assertOk(response, "AASA");
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  assertAssociationPayload(body);
}

async function validateClipIsObsolete() {
  const { response, body } = await fetchText("/clip/ocr?session=test123");
  assertClipObsoleteResponse(response, body);
}

async function validateJoinTokenSignaling() {
  const sessionId = `production-session-${Date.now()}`;
  const browserClaim = `browser-${Date.now()}`;
  const { response: createResponse, body: createBody } = await fetchJson("/api/signal/join-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browserClaim, sessionId, ttlMs: 30_000 }),
  });
  assertOk(createResponse, "join-token create");
  assert.equal(createBody.sessionId, sessionId);
  assert.match(createBody.token, /^[a-zA-Z0-9_-]{32,}$/);

  const { response: attemptResponse, body: attemptBody } = await fetchJson(
    `/api/signal/join-token/${encodeURIComponent(createBody.token)}/attempt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contributorId: "production-validator",
        deviceLabel: "Production Validator",
        protocolVersion: "1.0.0",
        capabilities: ["ocr", "barcode", "dictation", "photo"],
      }),
    }
  );
  assertOk(attemptResponse, "join attempt create");
  assert.equal(attemptBody.attempt?.status, "waiting_for_offer");

  const offer = JSON.stringify({ type: "offer", sdp: "production-validation-offer" });
  const { response: offerResponse } = await fetchJson(
    `/api/signal/join-token/${encodeURIComponent(createBody.token)}/attempt/${encodeURIComponent(attemptBody.attempt.id)}/offer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserClaim, offer }),
    }
  );
  assertOk(offerResponse, "offer post");

  const { response: pollOfferResponse, body: pollOfferBody } = await fetchJson(
    `/api/signal/join-token/${encodeURIComponent(createBody.token)}/attempt/${encodeURIComponent(attemptBody.attempt.id)}/offer`
  );
  assertOk(pollOfferResponse, "offer poll");
  assert.equal(pollOfferBody.offer, offer);

  const answer = JSON.stringify({ type: "answer", sdp: "production-validation-answer" });
  const { response: answerResponse } = await fetchJson(
    `/api/signal/join-token/${encodeURIComponent(createBody.token)}/attempt/${encodeURIComponent(attemptBody.attempt.id)}/answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    }
  );
  assertOk(answerResponse, "answer post");

  const { response: pollAnswerResponse, body: pollAnswerBody } = await fetchJson(
    `/api/signal/join-token/${encodeURIComponent(createBody.token)}/attempt/${encodeURIComponent(attemptBody.attempt.id)}/answer`,
    {
      headers: { "X-Volt-Browser-Claim": browserClaim },
    }
  );
  assertOk(pollAnswerResponse, "answer poll");
  assert.equal(pollAnswerBody.answer, answer);
}

export async function validateProduction() {
  await validateAssociation();
  await validateClipIsObsolete();
  await validateJoinTokenSignaling();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateProduction()
    .then(() => {
      console.log(`scanner-signal production validation passed for ${origin}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
