import { describe, expect, test, vi } from "vitest";
import {
  adSenseConfiguration,
  consentGrantsAds,
  requestAdSenseSlot,
  subscribeToAdConsent,
  type AdSenseBrowser,
  type TcfApi,
} from "./adsense";

const env = {
  VITE_ADSENSE_ENABLED: "true",
  VITE_ADSENSE_PUBLISHER_ID: "ca-pub-1234567890123456",
  VITE_ADSENSE_PUBLIC_SEARCH_SLOT: "1234567890",
  VITE_ADSENSE_CERTIFIED_CMP_ID: "300",
};
const consent = {
  cmpId: 300,
  cmpStatus: "loaded",
  eventStatus: "useractioncomplete",
  tcString: "TC-string-from-the-CMP",
  isServiceSpecific: true,
  listenerId: 42,
  vendor: { consents: { 755: true }, disclosedVendors: { 755: true } },
  purpose: { consents: { 1: true, 2: true, 7: true, 9: true, 10: true } },
};

describe("AdSense configuration and consent", () => {
  test("defaults off and validates all public identifiers", () => {
    expect(adSenseConfiguration({})).toBeNull();
    expect(adSenseConfiguration(env)).toEqual({
      publisher: env.VITE_ADSENSE_PUBLISHER_ID,
      slot: env.VITE_ADSENSE_PUBLIC_SEARCH_SLOT,
      certifiedCmpId: 300,
    });
    for (const change of [
      { VITE_ADSENSE_ENABLED: "false" },
      { VITE_ADSENSE_PUBLISHER_ID: "ca-pub-test" },
      { VITE_ADSENSE_PUBLIC_SEARCH_SLOT: "<script>" },
      { VITE_ADSENSE_CERTIFIED_CMP_ID: "0" },
    ])
      expect(adSenseConfiguration({ ...env, ...change })).toBeNull();
  });

  test("requires ready consent from the configured CMP and disclosure of Google", () => {
    expect(consentGrantsAds(consent, 300)).toBe(true);
    for (const change of [
      { cmpId: 301 },
      { cmpStatus: "stub" },
      { eventStatus: "cmpuishown" },
      { tcString: "" },
      { isServiceSpecific: false },
      { vendor: { consents: { 755: true } } },
      { vendor: { consents: { 755: false }, disclosedVendors: { 755: true } } },
    ])
      expect(consentGrantsAds({ ...consent, ...change }, 300)).toBe(false);
    expect(consentGrantsAds(null, 300)).toBe(false);
    expect(consentGrantsAds({}, 300)).toBe(false);
  });

  test("requires explicit consent for each purpose and respects publisher restrictions", () => {
    for (const purpose of [1, 2, 7, 9, 10]) {
      expect(
        consentGrantsAds(
          {
            ...consent,
            purpose: {
              consents: { ...consent.purpose.consents, [purpose]: false },
            },
          },
          300,
        ),
      ).toBe(false);
      for (const restriction of [0, 2]) {
        expect(
          consentGrantsAds(
            {
              ...consent,
              publisher: { restrictions: { [purpose]: { 755: restriction } } },
            },
            300,
          ),
        ).toBe(false);
      }
    }
  });

  test("denies unavailable CMPs and responds to consent withdrawal", () => {
    const states: boolean[] = [];
    subscribeToAdConsent(undefined, 300, (value) => states.push(value))();
    expect(states).toEqual([false]);
    let callback: Parameters<TcfApi>[2] | undefined;
    const api: TcfApi = (command, _version, next) => {
      if (command === "addEventListener") callback = next;
    };
    const dispose = subscribeToAdConsent(api, 300, (value) =>
      states.push(value),
    );
    callback?.(consent, true);
    callback?.({ ...consent, purpose: { consents: {} } }, true);
    callback?.(consent, false);
    expect(states).toEqual([false, false, true, false, false]);
    dispose();
  });

  test("removes listeners on disposal and ignores late callbacks", () => {
    let callback: Parameters<TcfApi>[2] | undefined;
    const remove = vi.fn();
    const api: TcfApi = (command, _version, next, listenerId) => {
      if (command === "addEventListener") callback = next;
      else remove(listenerId);
    };
    const change = vi.fn();
    const dispose = subscribeToAdConsent(api, 300, change);
    dispose();
    callback?.(consent, true);
    callback?.(consent, true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith(42);
  });

  test("a throwing CMP cannot authorize advertising", () => {
    const change = vi.fn();
    subscribeToAdConsent(
      () => {
        throw new Error("CMP unavailable");
      },
      300,
      change,
    )();
    expect(change.mock.calls.every(([allowed]) => allowed === false)).toBe(
      true,
    );
  });
});

function adDocument() {
  const handlers = new Map<string, () => void>();
  const script = {
    async: false,
    crossOrigin: "",
    src: "",
    setAttribute: vi.fn(),
    remove: vi.fn(),
    addEventListener: (event: string, callback: () => void) =>
      handlers.set(event, callback),
  };
  const append = vi.fn();
  const document = {
    createElement: () => script,
    head: { appendChild: append },
  } as unknown as Document;
  const slot = { isConnected: true, dataset: {} } as unknown as HTMLElement;
  const push = vi.fn();
  const browser: AdSenseBrowser = { adsbygoogle: { push } };
  return {
    document,
    slot,
    push,
    browser,
    script,
    append,
    load: () => handlers.get("load")?.(),
  };
}

describe("AdSense tag lifecycle", () => {
  test("uses the validated publisher and disables personalization, requesting a slot once", async () => {
    const page = adDocument();
    requestAdSenseSlot(
      page.browser,
      page.document,
      page.slot,
      env.VITE_ADSENSE_PUBLISHER_ID,
    );
    requestAdSenseSlot(
      page.browser,
      page.document,
      page.slot,
      env.VITE_ADSENSE_PUBLISHER_ID,
    );
    expect(page.append).toHaveBeenCalledTimes(1);
    expect(page.script.src).toBe(
      `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${env.VITE_ADSENSE_PUBLISHER_ID}`,
    );
    expect(page.script.setAttribute).toHaveBeenCalledWith(
      "data-privacy-treatments",
      "disablePersonalization",
    );
    expect(page.push).not.toHaveBeenCalled();
    page.load();
    await Promise.resolve();
    expect(page.push).toHaveBeenCalledExactlyOnceWith({});
  });

  test("does not request an ad after consent or the placement was removed before script load", async () => {
    const page = adDocument();
    const dispose = requestAdSenseSlot(
      page.browser,
      page.document,
      page.slot,
      env.VITE_ADSENSE_PUBLISHER_ID,
    );
    dispose();
    page.load();
    await Promise.resolve();
    expect(page.push).not.toHaveBeenCalled();
  });
});
