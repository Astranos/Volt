import type { VercelRequest, VercelResponse } from "@vercel/node";

export function buildAssociationPayload() {
  return {
    applinks: {
      apps: [],
      details: [],
    },
  };
}

export default function handler(_request: VercelRequest, response: VercelResponse) {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "public, max-age=300");
  response.status(200).json(buildAssociationPayload());
}
