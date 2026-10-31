import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import ShopifyAuditReview from "./ShopifyAuditReview";
import { SHOPIFY_AUDIT_REVIEW_KEY, type ShopifyAuditReview as Review } from "../../domain/shopify-audit";

// Exercise the real component's click handlers without a browser DOM. Slots
// retain hook state between renders; effects hydrate it from mocked Chrome storage.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
}));
vi.mock("../../shopify-audit/use-shopify-stores", () => ({ useShopifyStores: () => ({ connection: null }) }));

const products = [1, 2, 3].map((id) => ({
  id: `gid://shopify/Product/${id}`, title: `Product ${id}`, status: "ACTIVE",
  url: `https://admin.shopify.com/store/sample/products/${id}`,
}));
const initial: Review = {
  shop: "sample.myshopify.com", date: "2026-10-30", days: 1,
  products, marks: {}, currentId: products[0].id, tabId: 7,
};

function button(tree: ReactNode, label: string): () => void {
  let click: (() => void) | undefined;
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode; title?: string; onClick?: () => void }>(child)) return;
      if (child.type === "button" && child.props.title === label) click = child.props.onClick;
      visit(child.props.children);
    });
  }
  visit(tree);
  if (!click) throw new Error(`Missing button: ${label}`);
  return click;
}

type Probe = { path: string; old: boolean } | null;

// A fake review tab. routeTo moves its address like pushState (or, with
// `hardLoad`, Shopify loads the product itself and the injection is lost); each
// readRoute answers with `probe(path)`; tabs.update with a url is a full load.
async function setup({ url = products[0].url, reusable = true, hardLoad = false, probe = (path: string): Probe => ({ path, old: false }) } = {}) {
  let saved = structuredClone(initial);
  let tabUrl = url;
  let pendingUrl: string | undefined;
  const get = vi.fn(async () => reusable ? { id: 7, url: tabUrl, pendingUrl, status: "complete" } : { id: 7, url: "https://example.com" });
  const update = vi.fn(async (_id: number, props: { url?: string; active?: boolean }) => {
    if (props.url) tabUrl = props.url;
  });
  const create = vi.fn(async () => ({ id: 8 }));
  const executeScript = vi.fn(async ({ func, args }: { func: { name: string }; args: string[] }) => {
    if (func.name === "routeTo") {
      if (hardLoad) {
        pendingUrl = `${args[0]}${args[2]}`;
        throw new Error("Frame with ID 0 was removed.");
      }
      tabUrl = `${args[0]}${args[2]}`;
      return [{ result: true }];
    }
    const result = probe(new URL(tabUrl).pathname);
    if (result === null) pendingUrl = tabUrl;
    return [{ result }];
  });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://ext${path}` },
    storage: {
      local: {
        get: async () => ({ [SHOPIFY_AUDIT_REVIEW_KEY]: saved }),
        set: vi.fn(async (values: Record<string, Review>) => { saved = values[SHOPIFY_AUDIT_REVIEW_KEY]; }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { get, update, create },
    windows: { getCurrent: async () => ({ id: 5 }) },
    scripting: { executeScript },
  });
  ShopifyAuditReview({});
  for (const effect of hooks.effects.splice(0)) effect();
  await Promise.resolve();
  hooks.cursor = 0;
  const tree = ShopifyAuditReview({});
  return { tree, get, update, create, executeScript, saved: () => saved };
}

afterEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.unstubAllGlobals();
});

test.each(["Next product you haven't viewed", "Product 2"])("%s swaps the product in place and marks it, without a reload", async (label) => {
  const app = await setup();
  button(app.tree, label)();
  await vi.waitFor(() => expect(app.saved().currentId).toBe(products[1].id));
  expect(app.saved().marks[products[1].id]).toBe("done");
  expect(app.update).toHaveBeenCalledExactlyOnceWith(7, { active: true });
  expect(app.create).not.toHaveBeenCalled();
});

test("Shopify ignoring the route gets exactly one normal load", async () => {
  const app = await setup({ probe: (path) => ({ path, old: true }) });
  button(app.tree, "Product 2")();
  await vi.waitFor(() => expect(app.update).toHaveBeenCalledOnce(), { timeout: 6_000 });
  expect(app.update).toHaveBeenCalledWith(7, { active: true, url: products[1].url });
  expect(app.saved().currentId).toBe(products[1].id);
}, 10_000);

test.each([
  ["mid-swap", { probe: () => null }],
  ["while routing", { hardLoad: true }],
])("Shopify loading the product itself %s isn't loaded a second time", async (_, options) => {
  const app = await setup(options);
  button(app.tree, "Product 2")();
  await vi.waitFor(() => expect(app.saved().currentId).toBe(products[1].id));
  expect(app.update).toHaveBeenCalledExactlyOnceWith(7, { active: true });
});

test("Shopify's unsaved-changes prompt puts the selection back", async () => {
  const app = await setup({ probe: () => ({ path: "/store/sample/products/1", old: true }) });
  button(app.tree, "Product 2")();
  await vi.waitFor(() => expect(app.update).toHaveBeenCalledOnce());
  expect(app.update).toHaveBeenCalledWith(7, { active: true });
  expect(app.saved().currentId).toBe(products[0].id);
  expect(app.saved().marks[products[1].id]).toBeUndefined();
});

test("clicking the same product preserves its editor parameters without reloading", async () => {
  const app = await setup({ url: `${products[0].url}?context=editor` });
  button(app.tree, "Product 1")();
  await vi.waitFor(() => expect(app.update).toHaveBeenCalledOnce());
  expect(app.update).toHaveBeenCalledWith(7, { active: true });
  expect(app.executeScript).not.toHaveBeenCalled();
});

test("a review tab taken elsewhere is left alone and a new product tab is tracked", async () => {
  const app = await setup({ reusable: false });
  button(app.tree, "Product 2")();
  await vi.waitFor(() => expect(app.saved().tabId).toBe(8));
  expect(app.create).toHaveBeenCalledExactlyOnceWith({ url: products[1].url, active: true, windowId: 5 });
  expect(app.update).not.toHaveBeenCalled();
});

test("quick Next clicks advance through the latest review in the same tab", async () => {
  const app = await setup();
  const next = button(app.tree, "Next product you haven't viewed");
  next();
  next();
  await vi.waitFor(() => expect(app.saved().currentId).toBe(products[2].id));
  await vi.waitFor(() => expect(app.update).toHaveBeenCalledTimes(2));
  expect(app.executeScript.mock.calls.filter(([call]) => call.func.name === "routeTo").map(([call]) => call.args[2]))
    .toEqual(["/store/sample/products/2", "/store/sample/products/3"]);
  expect(app.update.mock.calls).toEqual([[7, { active: true }], [7, { active: true }]]);
  expect(app.saved().marks).toEqual({ [products[1].id]: "done", [products[2].id]: "done" });
});
