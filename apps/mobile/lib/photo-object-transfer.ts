import { SCANNER_SIGNAL_URL } from "@volt/scanner-protocol";

type UploadPhotoInput = {
  sessionId: string;
  contributorId: string;
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
};

function photoEndpoint(sessionId: string, path: string) {
  return `${SCANNER_SIGNAL_URL}/${encodeURIComponent(sessionId)}/photo/${path}`;
}

// Historical App Clip-only path. The full mobile app uses WebRTC photo transfer.
export async function uploadPhotoObjectTransfer(input: UploadPhotoInput) {
  const grantResponse = await fetch(photoEndpoint(input.sessionId, "grant"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contributorId: input.contributorId,
      filename: input.name,
      mimeType: input.mimeType,
      size: input.size,
      width: input.width,
      height: input.height,
    }),
  });

  if (!grantResponse.ok) {
    throw new Error("Browser photo transfer is unavailable.");
  }

  const { grant } = (await grantResponse.json()) as {
    grant?: {
      id: string;
      uploadUrl: string;
      manifestUrl: string;
      headers?: Record<string, string>;
    };
  };
  if (!grant?.id || !grant.uploadUrl || !grant.manifestUrl) {
    throw new Error("Browser photo transfer grant was invalid.");
  }

  const uploadResponse = await fetch(grant.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl: input.dataUrl }),
  });
  if (!uploadResponse.ok) {
    throw new Error("Photo upload failed.");
  }

  const manifestResponse = await fetch(grant.manifestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: input.id,
      grantId: grant.id,
      capturedAt: input.capturedAt,
    }),
  });
  if (!manifestResponse.ok) {
    throw new Error("Photo upload finished, but Chrome was not notified.");
  }

  return manifestResponse.json();
}
