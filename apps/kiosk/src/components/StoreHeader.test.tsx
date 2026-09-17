import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import type { Store } from "../catalog";
import { StoreHeader } from "./StoreHeader";

const store: Store = {
  slug: "taylormi",
  name: "Taylor",
  region: "Michigan",
  address: "",
  storefrontUrl: "https://taylormi.paymore.com",
};

describe("StoreHeader", () => {
  it.each(["catalog", "requests"] as const)("shares store identity and navigation on %s", (page) => {
    const html = renderToStaticMarkup(page === "catalog"
      ? <StoreHeader slug={store.slug} store={store} page="catalog" onReset={() => {}} />
      : <StoreHeader slug={store.slug} store={store} page="requests" />);
    const $ = load(html);
    expect($(".store-location").text()).toBe("Taylor, Michigan");
    expect($("header").text()).not.toContain("taylormi");
    expect($("img").attr("src")).toBe("/paymore-logo.png");
    expect($("nav a").map((_, link) => $(link).attr("href")).get()).toEqual(["/taylormi", "/taylormi/requests"]);
    expect($("nav [aria-current=page]").text()).toBe(page === "catalog" ? "Products" : "Requests");
    expect($("nav [aria-current]")).toHaveLength(1);
    expect($("button[aria-label='Start over']")).toHaveLength(page === "catalog" ? 1 : 0);
  });

  it("falls back to the requested store slug while metadata loads", () => {
    const $ = load(renderToStaticMarkup(<StoreHeader slug="northcentraltx" store={null} page="requests" />));
    expect($(".store-location").text()).toBe("northcentraltx");
    expect($("nav a").first().attr("href")).toBe("/northcentraltx");
  });

  it("does not leave a separator when the store has no region", () => {
    const $ = load(renderToStaticMarkup(<StoreHeader slug={store.slug} store={{ ...store, region: "" }} page="requests" />));
    expect($(".store-location").text()).toBe("Taylor");
  });
});
