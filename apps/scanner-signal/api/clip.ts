import type { VercelRequest, VercelResponse } from "@vercel/node";

const CLIP_MODES = new Set(["ocr", "barcode", "dictation"]);
const DEFAULT_APP_CLIP_BUNDLE_ID = "com.volt.mobile.Clip";
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;

const MODE_COPY = {
  ocr: {
    title: "OCR scanning",
    action: "Scan printed text with your iPhone camera.",
  },
  barcode: {
    title: "Barcode scanner",
    action: "Scan a UPC, EAN, or QR code with your iPhone camera.",
  },
  dictation: {
    title: "Dictation",
    action: "Speak a short note and send the final transcript back to Chrome.",
  },
} as const;

function modeFromRequest(request: VercelRequest) {
  const path = request.query.path;
  const value = typeof path === "string" ? path.split("/")[0] : undefined;
  return CLIP_MODES.has(value || "") ? value : null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  const mode = modeFromRequest(request);
  const session = Array.isArray(request.query.session)
    ? request.query.session[0]
    : request.query.session;

  if (!mode || typeof session !== "string" || !SESSION_ID_PATTERN.test(session)) {
    response.status(404).send("Not found");
    return;
  }

  const clipBundleId = escapeHtml(process.env.IOS_APP_CLIP_BUNDLE_ID || DEFAULT_APP_CLIP_BUNDLE_ID);
  const fallbackUrl = escapeHtml(`/clip/${mode}?session=${encodeURIComponent(session)}`);
  const safeSession = escapeHtml(session);
  const copy = MODE_COPY[mode];

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="apple-itunes-app" content="app-clip-bundle-id=${clipBundleId}" />
    <title>Open Volt ${escapeHtml(copy.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #111827;
      }

      body {
        margin: 0;
      }

      main {
        box-sizing: border-box;
        min-height: 100vh;
        display: grid;
        align-content: center;
        gap: 20px;
        width: min(100%, 560px);
        margin: 0 auto;
        padding: 32px 20px;
      }

      h1 {
        margin: 0;
        font-size: clamp(32px, 9vw, 54px);
        line-height: 0.96;
        letter-spacing: 0;
      }

      p {
        margin: 0;
        color: #475569;
        font-size: 17px;
        line-height: 1.5;
      }

      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border-radius: 8px;
        background: #111827;
        color: #ffffff;
        font-weight: 700;
        text-decoration: none;
      }

      .session {
        width: fit-content;
        max-width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #ffffff;
        color: #334155;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .note {
        font-size: 14px;
        color: #64748b;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Volt ${escapeHtml(copy.title)}</h1>
      <p>${escapeHtml(copy.action)}</p>
      <a href="${fallbackUrl}">Open App Clip</a>
      <div class="session" aria-label="Session code">Session ${safeSession}</div>
      <p class="note">Keep the Chrome tab open until the capture is sent. If this page stays open, the App Clip may not be configured for this device or domain yet.</p>
    </main>
  </body>
</html>`);
}
