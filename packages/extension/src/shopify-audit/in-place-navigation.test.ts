import { expect, test, vi } from "vitest";
import { openProductInPlace } from "./in-place-navigation";

const product = (id: number, title = `Product ${id}`, store = "sample") => ({
  id: `gid://shopify/Product/${id}`, title, status: "ACTIVE", url: `https://admin.shopify.com/store/${store}/products/${id}`,
});
const from = product(1, "Canon EF 50mm Lens");
const to = product(2, "Sony WH-1000XM4");
const noWait = async () => undefined;

// A fake page: routeTo calls report started; readRoute calls answer from `probes` in order.
function page(probes: Array<{ path: string; shown: boolean }>) {
  const calls: string[] = [];
  const scripting = {
    executeScript: vi.fn(async ({ func }: { func: (...args: never[]) => unknown }) => {
      calls.push(func.name);
      if (func.name === "routeTo") return [{ result: true }];
      return [{ result: probes.shift() ?? { path: "/store/sample/products/2", shown: false } }];
    }),
  };
  return { scripting: scripting as unknown as typeof chrome.scripting, calls };
}

test("swaps the product in place once Shopify shows the new title", async () => {
  const { scripting, calls } = page([{ path: "/store/sample/products/2", shown: false }, { path: "/store/sample/products/2", shown: true }]);
  await expect(openProductInPlace(scripting, 7, from.url, from, to, noWait)).resolves.toBe(true);
  expect(calls).toEqual(["routeTo", "readRoute", "readRoute"]);
});

test("falls back to a full load when the page never shows the new product", async () => {
  const { scripting } = page([]);
  await expect(openProductInPlace(scripting, 7, from.url, from, to, noWait)).resolves.toBe(false);
});

test("leaves Shopify's unsaved-changes prompt alone instead of forcing a reload", async () => {
  const { scripting } = page([{ path: "/store/sample/products/1", shown: false }]);
  await expect(openProductInPlace(scripting, 7, from.url, from, to, noWait)).resolves.toBe(true);
});

test("only tries within the same store's admin and with distinguishable titles", async () => {
  const { scripting, calls } = page([]);
  await expect(openProductInPlace(scripting, 7, "chrome://newtab/", from, to, noWait)).resolves.toBe(false);
  await expect(openProductInPlace(scripting, 7, product(1, "x", "other").url, from, to, noWait)).resolves.toBe(false);
  await expect(openProductInPlace(scripting, 7, from.url, from, product(3, " canon ef 50mm lens "), noWait)).resolves.toBe(false);
  await expect(openProductInPlace(scripting, 7, from.url, undefined, to, noWait)).resolves.toBe(false);
  expect(calls).toEqual([]);
});

test("a page that can't be scripted falls back to a full load", async () => {
  const scripting = { executeScript: vi.fn(async () => { throw new Error("Cannot access contents of the page"); }) };
  await expect(openProductInPlace(scripting as unknown as typeof chrome.scripting, 7, from.url, from, to, noWait)).resolves.toBe(false);
});
