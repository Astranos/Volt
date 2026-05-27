export const PHOTO_DROP_MIME = "application/x-volt-mobile-photos";
const IMAGE_FILE_EXTENSIONS = /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i;

export type MobilePhoto = {
  id: string;
  kind: "photo";
  name: string;
  mimeType: string;
  dataUrl?: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  sessionId?: string;
  downloadId?: number;
  downloadFilename?: string;
};

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
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}

export function normalizeImageFilename(filename: string, mimeType: string) {
  const cleanName = filename.trim().replace(/[^\w.\-]+/g, "-") || "volt-photo";
  const extension = extensionForMimeType(mimeType);
  if (IMAGE_FILE_EXTENSIONS.test(cleanName)) {
    return cleanName.replace(IMAGE_FILE_EXTENSIONS, `.${extension}`);
  }
  return `${cleanName}.${extension}`;
}

export function dataUrlToFile(
  dataUrl: string,
  filename: string,
  mimeType: string,
) {
  const [header, base64] = dataUrl.split(",");
  if (!header || !base64) return null;
  const headerMimeType = header.match(/^data:([^;]+)/)?.[1];
  const normalizedMimeType = normalizeImageMimeType(headerMimeType || mimeType);
  const normalizedFilename = normalizeImageFilename(filename, normalizedMimeType);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], normalizedFilename, {
    type: normalizedMimeType,
    lastModified: Date.now(),
  });
}

export async function dataUrlToPngBlob(dataUrl: string) {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Image decode failed"));
  });
  image.src = dataUrl;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) {
    throw new Error("Image canvas failed");
  }

  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("PNG conversion failed");
  return blob;
}

export function formatPhotoSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Installs a drag-and-drop bridge into the active tab so dragged Volt photos
 * are turned into real files for any file input on the page.
 *
 * NOTE: this function is serialized and executed in another document, so it
 * must be fully self-contained (no outside references).
 */
export function installPhotoDropBridge(dropMime: string) {
  const root = window as typeof window & {
    __voltPhotoDropBridgeInstalled?: boolean;
  };

  if (root.__voltPhotoDropBridgeInstalled) return;

  const normalizeImageMimeTypeInPage = (mimeType: string) => {
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
  };

  const extensionForMimeTypeInPage = (mimeType: string) => {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/gif") return "gif";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/avif") return "avif";
    if (mimeType === "image/heic") return "heic";
    if (mimeType === "image/heif") return "heif";
    return "jpg";
  };

  const normalizeImageFilenameInPage = (filename: string, mimeType: string) => {
    const cleanName =
      filename.trim().replace(/[^\w.\-]+/g, "-") || "volt-photo";
    const extension = extensionForMimeTypeInPage(mimeType);
    if (/\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(cleanName)) {
      return cleanName.replace(
        /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i,
        `.${extension}`,
      );
    }
    return `${cleanName}.${extension}`;
  };

  const dataUrlToFileInPage = (
    dataUrl: string,
    filename: string,
    mimeType: string,
  ) => {
    const [header, base64] = dataUrl.split(",");
    if (!header || !base64) return null;
    const headerMimeType = header.match(/^data:([^;]+)/)?.[1];
    const normalizedMimeType = normalizeImageMimeTypeInPage(
      headerMimeType || mimeType,
    );
    const normalizedFilename = normalizeImageFilenameInPage(
      filename,
      normalizedMimeType,
    );
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], normalizedFilename, {
      type: normalizedMimeType,
      lastModified: Date.now(),
    });
  };

  const findFileInput = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : document.activeElement;
    const closestInput = element?.closest?.("input[type='file']");
    if (closestInput instanceof HTMLInputElement) return closestInput;

    const closestContainer = element?.closest?.(
      "form, [role='button'], label, div",
    );
    const localInput = closestContainer?.querySelector?.(
      "input[type='file']",
    );
    if (localInput instanceof HTMLInputElement) return localInput;

    return document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement | null;
  };

  document.addEventListener(
    "dragover",
    (event) => {
      const hasVoltPhotos = Array.from(event.dataTransfer?.types ?? []).includes(
        dropMime,
      );
      if (!hasVoltPhotos) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    true,
  );

  document.addEventListener(
    "drop",
    (event) => {
      const rawPayload = event.dataTransfer?.getData(dropMime);
      if (!rawPayload) return;

      type DropPayload = {
        dataUrl: string;
        name: string;
        mimeType: string;
      };

      let photos: DropPayload[] = [];
      try {
        const parsed = JSON.parse(rawPayload);
        photos = Array.isArray(parsed) ? parsed : [];
      } catch (_err) {
        return;
      }

      const files = photos
        .map((photo) =>
          dataUrlToFileInPage(photo.dataUrl, photo.name, photo.mimeType),
        )
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) return;

      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));

      event.preventDefault();
      event.stopPropagation();

      const target = event.target instanceof Element ? event.target : document.body;
      const fileInput = findFileInput(target);
      if (fileInput) {
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    },
    true,
  );

  root.__voltPhotoDropBridgeInstalled = true;
}

/**
 * Inserts photos into the active tab's first matching file input.
 *
 * NOTE: serialized & executed in another document — keep self-contained.
 */
export async function insertPhotosIntoPage(
  photos: Array<{
    dataUrl: string;
    name: string;
    mimeType: string;
  }>,
) {
  const normalizeImageMimeTypeInPage = (mimeType: string) => {
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
  };

  const extensionForMimeTypeInPage = (mimeType: string) => {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/gif") return "gif";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/avif") return "avif";
    if (mimeType === "image/heic") return "heic";
    if (mimeType === "image/heif") return "heif";
    return "jpg";
  };

  const normalizeImageFilenameInPage = (filename: string, mimeType: string) => {
    const cleanName =
      filename.trim().replace(/[^\w.\-]+/g, "-") || "volt-photo";
    const extension = extensionForMimeTypeInPage(mimeType);
    if (/\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(cleanName)) {
      return cleanName.replace(
        /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i,
        `.${extension}`,
      );
    }
    return `${cleanName}.${extension}`;
  };

  const dataUrlToFileInPage = (
    dataUrl: string,
    filename: string,
    mimeType: string,
  ) => {
    const [header, base64] = dataUrl.split(",");
    if (!header || !base64) return null;
    const headerMimeType = header.match(/^data:([^;]+)/)?.[1];
    const normalizedMimeType = normalizeImageMimeTypeInPage(
      headerMimeType || mimeType,
    );
    const normalizedFilename = normalizeImageFilenameInPage(
      filename,
      normalizedMimeType,
    );
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], normalizedFilename, {
      type: normalizedMimeType,
      lastModified: Date.now(),
    });
  };

  const dataUrlToShopifyJpegFile = async (
    dataUrl: string,
    filename: string,
  ) => {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decode failed"));
    });
    image.src = dataUrl;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) {
      throw new Error("Image canvas failed");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) throw new Error("JPEG conversion failed");

    return new File(
      [blob],
      normalizeImageFilenameInPage(filename, "image/jpeg"),
      {
        type: "image/jpeg",
        lastModified: Date.now(),
      },
    );
  };

  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };

  const activeElement = document.activeElement;
  const focusedInput =
    activeElement instanceof HTMLInputElement && activeElement.type === "file"
      ? activeElement
      : null;
  const fileInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[type='file']"),
  );
  const acceptsImages = (input: HTMLInputElement) => {
    const accept = input.accept.toLowerCase();
    return (
      !accept ||
      accept.includes("image") ||
      accept.includes(".jpg") ||
      accept.includes(".jpeg") ||
      accept.includes(".png") ||
      accept.includes(".webp")
    );
  };
  const shopifyMediaInput = fileInputs.find((input) => {
    const field = [
      input.accept,
      input.name,
      input.id,
      input.getAttribute("aria-label") ?? "",
      input
        .closest("[data-testid], [data-polaris-dropzone], form, section")
        ?.textContent ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return (
      acceptsImages(input) &&
      (field.includes("image") ||
        field.includes("media") ||
        field.includes("photo") ||
        field.includes("file upload"))
    );
  });
  const fileInput =
    focusedInput ??
    shopifyMediaInput ??
    fileInputs.find(
      (input) => acceptsImages(input) && input.multiple && isVisible(input),
    ) ??
    fileInputs.find((input) => acceptsImages(input) && isVisible(input)) ??
    fileInputs.find((input) => acceptsImages(input) && input.multiple) ??
    fileInputs.find(acceptsImages) ??
    fileInputs.find((input) => input.multiple && isVisible(input)) ??
    fileInputs.find((input) => isVisible(input)) ??
    fileInputs.find((input) => input.multiple) ??
    fileInputs[0] ??
    null;

  const isShopifyAdmin =
    location.hostname === "admin.shopify.com" ||
    location.hostname.endsWith(".myshopify.com");
  const files = (
    isShopifyAdmin
      ? await Promise.all(
          photos.map((photo) =>
            dataUrlToShopifyJpegFile(photo.dataUrl, photo.name).catch(() =>
              dataUrlToFileInPage(photo.dataUrl, photo.name, photo.mimeType),
            ),
          ),
        )
      : photos.map((photo) =>
          dataUrlToFileInPage(photo.dataUrl, photo.name, photo.mimeType),
        )
  ).filter((file): file is File => Boolean(file));

  if (!fileInput || files.length === 0) {
    return {
      inserted: false,
      reason: fileInput ? "no_files" : "no_file_input",
    };
  }

  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;

  const eventOptions = { bubbles: true, cancelable: true };
  fileInput.dispatchEvent(new Event("input", eventOptions));
  fileInput.dispatchEvent(new Event("change", eventOptions));

  const dropTarget =
    fileInput.closest("label, form, [role='button'], [data-testid], div") ??
    document.body;
  dropTarget.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }),
  );

  return { inserted: true, count: files.length };
}
