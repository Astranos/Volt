import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_request: VercelRequest, response: VercelResponse) {
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(410).send("Volt App Clip scanner links are obsolete. Pair the full mobile app from the Chrome extension QR code.");
}
