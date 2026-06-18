import type { VercelRequest, VercelResponse } from "@vercel/node";

import { setCors } from "./scanner-signal/request.ts";
import { handleJoinTokenRoute, handlePairingRoute, handlePushRoute } from "./scanner-signal/routes.ts";
import { ensureSignalStorage } from "./scanner-signal/storage.ts";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  try {
    ensureSignalStorage();

    if (await handleJoinTokenRoute(request, response)) return;
    if (await handlePushRoute(request, response)) return;
    if (await handlePairingRoute(request, response)) return;

    response.status(404).json({ error: "Not found" });
  } catch (error) {
    console.error("Scanner signal storage error", error);
    response.status(500).json({ error: "Signal storage unavailable" });
  }
}
