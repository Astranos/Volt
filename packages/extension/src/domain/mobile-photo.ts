export const PHOTO_DROP_MIME = "application/x-volt-mobile-photos";
export const IMAGE_FILE_EXTENSIONS = /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i;

export type MobilePhoto = {
  id: string;
  kind: "photo";
  photoBatchId?: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  blob?: Blob;
  contributorId?: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  sessionId?: string;
  status?: "available_to_browser" | "browser_received" | "download_failed";
  downloadId?: number;
  downloadFilename?: string;
};

function clampString(value: unknown, maxLength = 300) {
  const str = typeof value === "string" ? value : "";
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeImageMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().trim();
  if (normalized === "image/jpg") return "image/jpeg";
  if (
    normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/gif" ||
    normalized === "image/webp" ||
    normalized === "image/avif" ||
    normalized === "image/heic" ||
    normalized === "image/heif"
  ) {
    return normalized;
  }
  return "image/jpeg";
}

export function extensionForMimeType(mimeType: string) {
  const normalized = normalizeImageMimeType(mimeType);
  if (normalized === "image/png") return "png";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/avif") return "avif";
  if (normalized === "image/heic") return "heic";
  if (normalized === "image/heif") return "heif";
  return "jpg";
}

export function sanitizeDownloadPathSegment(value: unknown, fallback: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"\\|?*\x00-\x1F]+/g, "-")
    .replace(/^\.+$/, "")
    .replace(/\/+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 96);
  return cleaned || fallback;
}

export function normalizeImageFilename(filename: string, mimeType: string) {
  const cleanName = filename.trim().replace(/[^\w.\-]+/g, "-") || "volt-photo";
  const extension = extensionForMimeType(mimeType);
  if (IMAGE_FILE_EXTENSIONS.test(cleanName)) {
    return cleanName.replace(IMAGE_FILE_EXTENSIONS, `.${extension}`);
  }
  return `${cleanName}.${extension}`;
}

export function normalizeMobilePhoto(photo: unknown): MobilePhoto | null {
  if (
    !photo ||
    typeof photo !== "object" ||
    typeof (photo as { dataUrl?: unknown }).dataUrl !== "string" ||
    !(photo as { dataUrl: string }).dataUrl.startsWith("data:image/") ||
    typeof (photo as { mimeType?: unknown }).mimeType !== "string"
  ) {
    return null;
  }

  const source = photo as Partial<MobilePhoto>;
  const id =
    typeof source.id === "string" && source.id
      ? source.id
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mimeType = normalizeImageMimeType(source.mimeType || "image/jpeg");

  return {
    id,
    kind: "photo",
    photoBatchId:
      typeof source.photoBatchId === "string" && source.photoBatchId
        ? clampString(source.photoBatchId, 120)
        : undefined,
    name:
      typeof source.name === "string" && source.name
        ? normalizeImageFilename(clampString(source.name, 120), mimeType)
        : `volt-photo-${id}.${extensionForMimeType(mimeType)}`,
    mimeType: clampString(mimeType, 64),
    dataUrl: source.dataUrl,
    contributorId: typeof source.contributorId === "string" ? clampString(source.contributorId, 120) : undefined,
    size: Math.max(0, toFiniteNumber(source.size, 0)),
    width: source.width ? Math.max(0, Math.floor(toFiniteNumber(source.width, 0))) : undefined,
    height: source.height ? Math.max(0, Math.floor(toFiniteNumber(source.height, 0))) : undefined,
    capturedAt:
      typeof source.capturedAt === "string"
        ? source.capturedAt
        : new Date().toISOString(),
    sessionId:
      typeof source.sessionId === "string" && source.sessionId
        ? clampString(source.sessionId, 80)
        : undefined,
    status:
      source.status === "available_to_browser" ||
      source.status === "browser_received" ||
      source.status === "download_failed"
        ? source.status
        : undefined,
    downloadId: typeof source.downloadId === "number" ? source.downloadId : undefined,
    downloadFilename:
      typeof source.downloadFilename === "string" && source.downloadFilename
        ? clampString(source.downloadFilename, 240)
        : undefined,
  };
}

export function buildMobilePhotoDownloadFilename(
  photo: Pick<MobilePhoto, "id" | "mimeType" | "name" | "photoBatchId" | "sessionId">,
) {
  const sessionFolder = sanitizeDownloadPathSegment(photo.sessionId, "unpaired-session");
  const batchFolder = sanitizeDownloadPathSegment(photo.photoBatchId, "unbatched");
  const filename = normalizeImageFilename(photo.name || photo.id || "volt-photo", photo.mimeType);
  return `Volt Photos/${sessionFolder}/${batchFolder}/${filename}`;
}
