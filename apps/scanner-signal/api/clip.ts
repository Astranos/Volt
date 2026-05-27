import type { VercelRequest, VercelResponse } from "@vercel/node";

const CLIP_MODES = new Set(["ocr", "barcode", "photo"]);
const DEFAULT_APP_CLIP_BUNDLE_ID = "com.volt.mobile.Clip";
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;
const APP_STORE_ID_PATTERN = /^\d+$/;

const MODE_COPY = {
  ocr: {
    title: "OCR scanning",
    action: "Scan printed text with your iPhone camera.",
  },
  barcode: {
    title: "Barcode scanner",
    action: "Scan a UPC, EAN, or QR code with your iPhone camera.",
  },
  photo: {
    title: "Photo capture",
    action: "Capture a photo with your iPhone camera and send it back to Chrome.",
  },
} as const;

const BASE_COPY = {
  title: "App Clip",
  action: "Open Volt from a Chrome pairing QR code.",
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

function originFromRequest(request: VercelRequest) {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "https";
  const hostValue = Array.isArray(host) ? host[0] : host;
  const protoValue = Array.isArray(proto) ? proto[0] : proto;

  return hostValue ? `${protoValue}://${hostValue}` : "https://scanner-signal.vercel.app";
}

function smartBannerContent({
  appStoreId,
  clipBundleId,
  invocationUrl,
}: {
  appStoreId?: string;
  clipBundleId: string;
  invocationUrl: string;
}) {
  const parts = [];
  if (appStoreId && APP_STORE_ID_PATTERN.test(appStoreId)) {
    parts.push(`app-id=${appStoreId}`);
  }
  parts.push(`app-clip-bundle-id=${clipBundleId}`);
  parts.push("app-clip-display=card");
  parts.push(`app-argument=${invocationUrl}`);
  return parts.join(", ");
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  const mode = modeFromRequest(request);
  const session = Array.isArray(request.query.session)
    ? request.query.session[0]
    : request.query.session;
  const path = Array.isArray(request.query.path) ? request.query.path[0] : request.query.path;
  const isBaseClipRequest = !mode && !session && (!path || path === "/");

  if (
    !isBaseClipRequest &&
    ((path && !mode) || typeof session !== "string" || !SESSION_ID_PATTERN.test(session))
  ) {
    response.status(404).send("Not found");
    return;
  }

  const fallbackPath =
    session && mode
      ? `/clip/${mode}?session=${encodeURIComponent(session)}`
      : session
        ? `/clip?session=${encodeURIComponent(session)}`
        : "/clip";
  const fallbackUrl = escapeHtml(fallbackPath);
  const rawInvocationUrl = `${originFromRequest(request)}${fallbackPath}`;
  const invocationUrl = escapeHtml(rawInvocationUrl);
  const bannerContent = escapeHtml(
    smartBannerContent({
      appStoreId: process.env.IOS_APP_STORE_ID,
      clipBundleId: process.env.IOS_APP_CLIP_BUNDLE_ID || DEFAULT_APP_CLIP_BUNDLE_ID,
      invocationUrl: rawInvocationUrl,
    })
  );
  const safeSession = typeof session === "string" ? escapeHtml(session) : null;
  const copy = mode ? MODE_COPY[mode] : BASE_COPY;

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="apple-itunes-app" content="${bannerContent}" />
    <link rel="canonical" href="${invocationUrl}" />
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
      ${safeSession ? `<div class="session" aria-label="Session code">Session ${safeSession}</div>` : ""}
      <p class="note">Keep the Chrome tab open until the capture is sent. If this page stays open, the App Clip may not be configured for this device or domain yet.</p>
    </main>
  </body>
</html>`);
}
