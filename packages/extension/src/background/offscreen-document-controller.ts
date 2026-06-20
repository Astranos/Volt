import type { LogFn } from "./runtime-action-registry";

type RuntimePath =
  | `/install.html${string}`
  | `/mobile-scanner-popup.html${string}`
  | `/offscreen.html${string}`
  | `/options.html${string}`;
type OffscreenContext = { documentUrl?: string };
type OffscreenCreateParameters = Parameters<typeof chrome.offscreen.createDocument>[0];
type ServiceWorkerClient = { url: string };

declare const clients:
  | {
      matchAll: () => Promise<ServiceWorkerClient[]>;
    }
  | undefined;

type OffscreenDocumentOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  runtimeUrl: (path: RuntimePath) => string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOffscreenDocumentController({
  chromeApi,
  log,
  runtimeUrl,
}: OffscreenDocumentOptions) {
  let createPromise: Promise<boolean> | null = null;
  const documentPath = "offscreen.html";

  async function createOffscreenDocument() {
    if (createPromise) {
      return createPromise;
    }

    createPromise = createOffscreenDocumentOnce().finally(() => {
      createPromise = null;
    });
    return createPromise;
  }

  async function getOffscreenContexts(): Promise<OffscreenContext[]> {
    if (!chromeApi.runtime.getContexts) {
      const matchedClients = (await clients?.matchAll?.()) ?? [];
      return matchedClients
        .filter((client) => client.url.includes(chromeApi.runtime.id))
        .map((client) => ({ documentUrl: client.url }));
    }

    return chromeApi.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
  }

  async function createOffscreenDocumentOnce() {
    const offscreenUrl = runtimeUrl("/offscreen.html");
    const existingContexts = await getOffscreenContexts();
    const matchingContext = existingContexts.find(
      (context) => context.documentUrl === offscreenUrl
    );

    if (matchingContext) {
      return true;
    }

    if (existingContexts.length > 0) {
      log(
        "Non-matching offscreen document already exists",
        existingContexts.map((context) => context.documentUrl)
      );
      return true;
    }

    try {
      const createOptions: OffscreenCreateParameters = {
        url: documentPath,
        reasons: ["DOM_SCRAPING", "CLIPBOARD", "WEB_RTC"],
        justification:
          "Gamepad detection, clipboard fallback, and the mobile scanner connection run without visible extension UI",
      };
      try {
        await chromeApi.offscreen.createDocument(createOptions);
      } catch (reasonError) {
        if (errorMessage(reasonError).includes("Only a single offscreen document")) {
          log("Offscreen document already exists");
          return true;
        }

        log(
          "Offscreen create with extended reasons failed, retrying with DOM_SCRAPING",
          errorMessage(reasonError)
        );
        try {
          await chromeApi.offscreen.createDocument({
            ...createOptions,
            reasons: ["DOM_SCRAPING"],
          });
        } catch (fallbackError) {
          if (
            errorMessage(fallbackError).includes("Only a single offscreen document")
          ) {
            log("Offscreen document already exists");
            return true;
          }
          throw fallbackError;
        }
      }
      log("Offscreen document created");
      return true;
    } catch (error) {
      log("Failed to create offscreen document:", error);
      return false;
    }
  }

  return {
    createOffscreenDocument,
    getOffscreenContexts,
  };
}
