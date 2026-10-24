import { afterEach, expect, test, vi } from "vitest";
import { openProductInPlace, readRoute, routeTo } from "./in-place-navigation";

const product = (id: number, title = `Product ${id}`, store = "sample") => ({
  id: `gid://shopify/Product/${id}`, title, status: "ACTIVE", url: `https://admin.shopify.com/store/${store}/products/${id}`,
});
const from = product(1, "Canon EF 50mm Lens");
const to = product(2, "Sony WH-1000XM4");
const noWait = async () => undefined;

// A fake page: routeTo reports started; readRoute answers from `probes` in order.
function page(probes: Array<{ path: string; shown: boolean } | null>) {
  const calls: string[] = [];
  const scripting = {
    executeScript: vi.fn(async ({ func }: { func: (...args: never[]) => unknown }) => {
      calls.push(func.name);
      if (func.name === "routeTo") return [{ result: true }];
      return [{ result: probes.length ? probes.shift() : { path: "/store/sample/products/2", shown: false } }];
    }),
  };
  return { scripting: scripting as unknown as typeof chrome.scripting, calls };
}

test("swaps the product in place once Shopify shows the new title", async () => {
  const { scripting, calls } = page([{ path: "/store/sample/products/2", shown: false }, { path: "/store/sample/products/2", shown: true }]);
  await expect(openProductInPlace(scripting, 7, from.url, from, to, noWait)).resolves.toBe("done");
  expect(calls).toEqual(["routeTo", "readRoute", "readRoute"]);
});

test("falls back to a full load when the page never shows the new product", async () => {
  await expect(openProductInPlace(page([]).scripting, 7, from.url, from, to, noWait)).resolves.toBe("fallback");
});

test("reports Shopify's unsaved-changes prompt as blocked so the selection doesn't move", async () => {
  await expect(openProductInPlace(page([{ path: "/store/sample/products/1", shown: false }]).scripting, 7, from.url, from, to, noWait)).resolves.toBe("blocked");
});

test("a page that was replaced mid-way falls back", async () => {
  await expect(openProductInPlace(page([null]).scripting, 7, from.url, from, to, noWait)).resolves.toBe("fallback");
});

test("only tries from the product on screen, within one store, and with distinguishable titles", async () => {
  const { scripting, calls } = page([]);
  await expect(openProductInPlace(scripting, 7, "chrome://newtab/", from, to, noWait)).resolves.toBe("fallback");
  await expect(openProductInPlace(scripting, 7, product(1, "x", "other").url, from, to, noWait)).resolves.toBe("fallback");
  await expect(openProductInPlace(scripting, 7, product(9).url, from, to, noWait)).resolves.toBe("fallback");
  await expect(openProductInPlace(scripting, 7, from.url, from, product(3, " canon ef 50mm lens "), noWait)).resolves.toBe("fallback");
  await expect(openProductInPlace(scripting, 7, from.url, undefined, to, noWait)).resolves.toBe("fallback");
  expect(calls).toEqual([]);
});

test("a page that can't be scripted falls back", async () => {
  const scripting = { executeScript: vi.fn(async () => { throw new Error("Cannot access contents of the page"); }) };
  await expect(openProductInPlace(scripting as unknown as typeof chrome.scripting, 7, from.url, from, to, noWait)).resolves.toBe("fallback");
});

// The injected functions themselves, against a minimal stand-in for Shopify's page.
function fakeShopifyPage(origin: string, pathname: string, headings: string[]) {
  const location = { origin, pathname };
  const win: Record<string, unknown> = { dispatchEvent: vi.fn() };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", win);
  vi.stubGlobal("PopStateEvent", class { constructor(public type: string) {} });
  vi.stubGlobal("history", { pushState: (_: unknown, __: string, path: string) => { location.pathname = path; } });
  vi.stubGlobal("document", { querySelectorAll: () => headings.map((textContent) => ({ textContent })) });
  return { location, win };
}
afterEach(() => vi.unstubAllGlobals());

test("routeTo refuses a tab that moved off the expected Shopify product", () => {
  const { location, win } = fakeShopifyPage("https://example.com", "/store/sample/products/1", []);
  expect(routeTo("https://admin.shopify.com", "/store/sample/products/1", "/store/sample/products/2", "m1")).toBe(false);
  expect(location.pathname).toBe("/store/sample/products/1");
  expect(win.dispatchEvent).not.toHaveBeenCalled();
});

test("readRoute needs an exact heading match and the same marked page", () => {
  fakeShopifyPage("https://admin.shopify.com", "/store/sample/products/1", ["Blue Shirt Large Active"]);
  expect(routeTo("https://admin.shopify.com", "/store/sample/products/1", "/store/sample/products/2", "m1")).toBe(true);
  // The old product's heading merely contains the new title: not shown yet.
  expect(readRoute("https://admin.shopify.com", "m1", "Blue Shirt")).toEqual({ path: "/store/sample/products/2", shown: false });
  expect(readRoute("https://admin.shopify.com", "m1", "Blue Shirt Large")).toEqual({ path: "/store/sample/products/2", shown: true });
  // A different page (another marker) or another site isn't ours to judge.
  expect(readRoute("https://admin.shopify.com", "m2", "Blue Shirt Large")).toBeNull();
  expect(readRoute("https://example.com", "m1", "Blue Shirt Large")).toBeNull();
});
