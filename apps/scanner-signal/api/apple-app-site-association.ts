import type { VercelRequest, VercelResponse } from "@vercel/node";

const TEAM_ID = process.env.APPLE_TEAM_ID || "GB5SPLUARQ";
const FULL_APP_BUNDLE_ID = process.env.IOS_BUNDLE_ID || "com.volt.mobile";
const APP_CLIP_BUNDLE_ID =
  process.env.IOS_APP_CLIP_BUNDLE_ID || "com.volt.mobile.Clip";
const INCLUDE_FULL_APP_CLIP_LINKS = process.env.IOS_INCLUDE_FULL_APP_CLIP_LINKS === "1";

type AssociationConfig = {
  appClipBundleId?: string;
  fullAppBundleId?: string;
  includeFullAppClipLinks?: boolean;
  teamId?: string;
};

export function buildAssociationPayload({
  appClipBundleId = APP_CLIP_BUNDLE_ID,
  fullAppBundleId = FULL_APP_BUNDLE_ID,
  includeFullAppClipLinks = INCLUDE_FULL_APP_CLIP_LINKS,
  teamId = TEAM_ID,
}: AssociationConfig = {}) {
  return {
    applinks: {
      apps: [],
      details: includeFullAppClipLinks
        ? [
            {
              appIDs: [`${teamId}.${fullAppBundleId}`],
              components: [
                {
                  "/": "/clip/*",
                  comment: "Open Volt capture links in the installed app.",
                },
              ],
            },
          ]
        : [],
    },
    appclips: {
      apps: [`${teamId}.${appClipBundleId}`],
    },
  };
}

export default function handler(_request: VercelRequest, response: VercelResponse) {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "public, max-age=300");
  response.status(200).json(buildAssociationPayload());
}
