import type { RuntimeActionRegistry } from "./runtime-action-registry";

type DisabledSiteControllerOptions = {
  chromeApi: typeof chrome;
  registry: RuntimeActionRegistry;
};

function readDisabledSites(cfg: { disabledSites?: unknown }) {
  return Array.isArray(cfg.disabledSites)
    ? cfg.disabledSites.filter((site): site is string => typeof site === "string")
    : [];
}

function broadcastDisabledSites(chromeApi: typeof chrome, disabledSites: unknown[]) {
  chromeApi.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      try {
        if (typeof tab.id === "number") {
          chromeApi.tabs.sendMessage(tab.id, {
            action: "pm-settings-changed",
            disabledSites,
          });
        }
      } catch (_) {}
    });
  });
}

export function registerDisabledSiteActions({
  chromeApi,
  registry,
}: DisabledSiteControllerOptions) {
  registry.register("checkSiteStatus", (message, _sender, sendResponse) => {
    const domain = message.domain;
    if (!domain) {
      sendResponse({ success: false, error: "missing_domain" });
      return true;
    }

    chromeApi.storage.local.get(
      { disabledSites: [], globalEnabled: true },
      (cfg) => {
        const disabledSites = readDisabledSites(cfg);
        const isDisabled =
          !cfg.globalEnabled ||
          disabledSites.some(
            (site) => domain === site || domain.endsWith(`.${site}`)
          );

        sendResponse({
          success: true,
          disabled: isDisabled,
          globalEnabled: cfg.globalEnabled,
          disabledSites,
        });
      }
    );
    return true;
  });

  registry.register("updateDisabledSites", (message, _sender, sendResponse) => {
    const sites = message.sites;
    if (!Array.isArray(sites)) {
      sendResponse({ success: false, error: "invalid_sites_array" });
      return true;
    }

    chromeApi.storage.local.set({ disabledSites: sites }, () => {
      broadcastDisabledSites(chromeApi, sites);
      sendResponse({ success: true });
    });
    return true;
  });

  registry.register("toggleCurrentSite", (message, _sender, sendResponse) => {
    const enabled = message.enabled;
    const domain = message.domain;

    if (typeof enabled !== "boolean" || !domain) {
      sendResponse({ success: false, error: "invalid_parameters" });
      return true;
    }

    chromeApi.storage.local.get({ disabledSites: [] }, (cfg) => {
      const disabledSites = readDisabledSites(cfg);
      const updatedSites = enabled
        ? disabledSites.filter((site) => site !== domain)
        : [...disabledSites, domain];

      chromeApi.storage.local.set({ disabledSites: updatedSites }, () => {
        broadcastDisabledSites(chromeApi, updatedSites);
        sendResponse({ success: true, disabledSites: updatedSites });
      });
    });
    return true;
  });
}
