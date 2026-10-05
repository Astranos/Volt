export type AdSenseConfiguration = {
  publisher: string;
  slot: string;
  certifiedCmpId: number;
};

export function adSenseConfiguration(
  env: Record<string, unknown>,
): AdSenseConfiguration | null {
  const publisher = env.VITE_ADSENSE_PUBLISHER_ID;
  const slot = env.VITE_ADSENSE_PUBLIC_SEARCH_SLOT;
  const cmp = env.VITE_ADSENSE_CERTIFIED_CMP_ID;
  if (
    env.VITE_ADSENSE_ENABLED !== "true" ||
    typeof publisher !== "string" ||
    !/^ca-pub-\d{16}$/.test(publisher) ||
    typeof slot !== "string" ||
    !/^\d{10}$/.test(slot) ||
    typeof cmp !== "string" ||
    !/^[1-9]\d{0,5}$/.test(cmp)
  )
    return null;
  return { publisher, slot, certifiedCmpId: Number(cmp) };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

// Deliberately conservative: only explicit consent, even where a CMP could
// establish a different legal basis. Google still validates the TC string.
export function consentGrantsAds(
  value: unknown,
  certifiedCmpId: number,
): boolean {
  const data = record(value);
  if (
    data.cmpId !== certifiedCmpId ||
    data.cmpStatus !== "loaded" ||
    !["tcloaded", "useractioncomplete"].includes(String(data.eventStatus)) ||
    typeof data.tcString !== "string" ||
    data.tcString.length === 0 ||
    data.isServiceSpecific !== true
  )
    return false;
  const vendor = record(data.vendor);
  if (
    record(vendor.consents)["755"] !== true ||
    record(vendor.disclosedVendors)["755"] !== true
  )
    return false;
  const purposes = record(record(data.purpose).consents);
  const restrictions = record(record(data.publisher).restrictions);
  return [1, 2, 7, 9, 10].every((purpose) => {
    const restriction = record(restrictions[String(purpose)])["755"];
    return (
      purposes[String(purpose)] === true &&
      restriction !== 0 &&
      restriction !== 2
    );
  });
}

export type TcfApi = (
  command: "addEventListener" | "removeEventListener",
  version: 2,
  callback: (data: unknown, success: boolean) => void,
  listenerId?: number,
) => void;

export function subscribeToAdConsent(
  api: TcfApi | undefined,
  certifiedCmpId: number,
  onChange: (allowed: boolean) => void,
): () => void {
  let disposed = false;
  let listenerId: number | undefined;
  const removed = new Set<number>();
  const remove = () => {
    if (listenerId === undefined || removed.has(listenerId)) return;
    removed.add(listenerId);
    try {
      api?.("removeEventListener", 2, () => {}, listenerId);
    } catch {
      /* No ads remain mounted. */
    }
  };
  onChange(false);
  try {
    api?.("addEventListener", 2, (data, success) => {
      const id = record(data).listenerId;
      if (typeof id === "number" && Number.isSafeInteger(id)) listenerId = id;
      if (disposed) {
        remove();
        return;
      }
      onChange(success === true && consentGrantsAds(data, certifiedCmpId));
    });
  } catch {
    onChange(false);
  }
  return () => {
    disposed = true;
    remove();
  };
}

export type AdSenseBrowser = Pick<Window, "__tcfapi" | "adsbygoogle">;

declare global {
  interface Window {
    __tcfapi?: TcfApi;
    adsbygoogle?: { push: (request: Record<string, never>) => unknown };
  }
}

const scripts = new WeakMap<
  Document,
  { publisher: string; loaded: Promise<void> }
>();
function loadAdSenseScript(
  document: Document,
  publisher: string,
): Promise<void> {
  const existing = scripts.get(document);
  if (existing)
    return existing.publisher === publisher
      ? existing.loaded
      : Promise.reject(new Error("AdSense publisher mismatch"));
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}`;
  script.setAttribute("data-privacy-treatments", "disablePersonalization");
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        scripts.delete(document);
        script.remove();
        reject(new Error("AdSense unavailable"));
      },
      { once: true },
    );
  });
  scripts.set(document, { publisher, loaded });
  document.head.appendChild(script);
  return loaded;
}

export function requestAdSenseSlot(
  browser: AdSenseBrowser,
  document: Document,
  slot: HTMLElement,
  publisher: string,
): () => void {
  let active = true;
  void loadAdSenseScript(document, publisher)
    .then(() => {
      if (!active || !slot.isConnected || slot.dataset.adRequested === "true")
        return;
      slot.dataset.adRequested = "true";
      const pending: Array<Record<string, never>> = [];
      const queue = browser.adsbygoogle ?? pending;
      browser.adsbygoogle = queue;
      queue.push({});
    })
    .catch(() => {
      /* Ad blockers and network failures leave the slot empty. */
    });
  return () => {
    active = false;
  };
}
