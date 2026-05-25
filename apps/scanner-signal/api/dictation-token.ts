import type { VercelRequest, VercelResponse } from "@vercel/node";

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}

function clientSecretValue(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as {
    value?: unknown;
    client_secret?: { value?: unknown };
    session?: { client_secret?: { value?: unknown } };
  };
  if (typeof value.value === "string") return value.value;
  if (typeof value.client_secret?.value === "string") return value.client_secret.value;
  if (typeof value.session?.client_secret?.value === "string") return value.session.client_secret.value;
  return null;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(500).json({ error: "Realtime transcription is not configured" });
    return;
  }

  const openaiResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            noise_reduction: {
              type: "near_field",
            },
            transcription: {
              model: "gpt-4o-transcribe",
              language: "en",
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        },
      },
    }),
  });

  const payload = await openaiResponse.json().catch(() => null);
  if (!openaiResponse.ok) {
    response.status(openaiResponse.status).json({ error: "Failed to create realtime transcription token" });
    return;
  }

  const value = clientSecretValue(payload);
  if (!value) {
    response.status(502).json({ error: "Realtime transcription token response was invalid" });
    return;
  }

  response.status(200).json({ value });
}
