import { describe, expect, test } from "vitest";

import { isAuthorizedPayMoreProductUrl } from "./catalog/hosts";
import { mapPayMoreApiItems } from "./catalog/paymoreApi";
import type { CatalogProduct } from "./catalog/types";

const COLLECTION = "used-video-games-us";

const GAME_FILTER_ATTRIBUTES = {
  Platform: "Super Nintendo SNES",
  "Game Name": "The Legend of Zelda: A Link to the Past",
  Condition: "CIB",
  UPC: "045496733971",
  Brand: "Nintendo",
  Model: "SNS-P-ZL",
};

const GAME_OTHER_ATTRIBUTES = {
  Publisher: "Nintendo",
  Genre: "Adventure",
  "ESRB Rating": "E - Everyone",
  "Release Year": "1992",
  "Graded?": "No",
  "Case/Box?": "Yes",
  "Manual?": "Yes",
  "Inserts?": "No",
  "Downloadable Content?": "No",
  "This will go at the end of the title": "Game Only",
};

const IPHONE_FILTER_ATTRIBUTES = {
  Brand: "Apple",
  Model: "iPhone 14 Pro Max",
  MPN: "MQ8R3LL/A",
  "Storage Size": "128GB",
  Condition: "Good",
  "iOS Version": "17.5",
  "Screen Size": "6.7\"",
  "Carrier Service": "Unlocked",
  Color: "Deep Purple",
  "Battery Health": "89%",
  "Serial#": "F2LX1AB2C3D4",
};

const IPHONE_OTHER_ATTRIBUTES = {
  "Sim Card Slot": "Dual SIM",
  "Lock Status": "Unlocked",
  IMEI: "356728110123456",
  "MFG Warranty?": "No",
  Password: "1234",
  "AppleCare Status": "Expired",
  "Operating System": "iOS 26",
};

type FixtureOverrides = {
  p_id?: string;
  p_title?: string;
  p_image?: string;
  filter_attributes?: Record<string, unknown>;
  other_attributes?: Record<string, unknown>;
  shopify_collection?: Array<{ id: number; name: string }>;
};

function gameItem(overrides: FixtureOverrides = {}) {
  return {
    p_id: overrides.p_id ?? "15872618299678",
    p_title:
      overrides.p_title ??
      "Factory Unlocked Nintendo The Legend of Zelda: A Link to the Past Super Nintendo SNES Game 045496733971",
    filter_attributes: overrides.filter_attributes ?? GAME_FILTER_ATTRIBUTES,
    other_attributes: overrides.other_attributes ?? GAME_OTHER_ATTRIBUTES,
    // Raw API marketplace metrics; the spec-only catalog ignores these.
    v_price: 449.99,
    v_qty: 1,
    shop_name: "paymore-hermitage",
    p_image:
      overrides.p_image ??
      "https://paymore.com/cdn/shop/files/zelda-a-link-to-the-past-snes.jpg",
    p_tags: ["Games"],
    shopify_collection: overrides.shopify_collection ?? [{ id: 123456, name: "Video Games" }],
  };
}

function iphoneItem(overrides: FixtureOverrides = {}) {
  return {
    p_id: overrides.p_id ?? "15872618299679",
    p_title:
      overrides.p_title ??
      "Factory Unlocked Apple iPhone 14 Pro Max 128GB Deep Purple MQ8R3LL/A",
    filter_attributes: overrides.filter_attributes ?? IPHONE_FILTER_ATTRIBUTES,
    other_attributes: overrides.other_attributes ?? IPHONE_OTHER_ATTRIBUTES,
    v_price: 449.99,
    v_qty: 1,
    shop_name: "paymore-hermitage",
    p_tags: ["Phones"],
    shopify_collection: overrides.shopify_collection ?? [{ id: 456789, name: "Apple iPhone" }],
  };
}

function firstProduct(products: CatalogProduct[]): CatalogProduct {
  const product = products[0];
  if (!product) throw new Error("expected at least one mapped product");
  return product;
}

function allAttributeKeys(product: CatalogProduct): string[] {
  return [
    ...Object.keys(product.attributes),
    ...product.listings.flatMap((listing) => Object.keys(listing.attributes)),
  ];
}

describe("mapPayMoreApiItems", () => {
  test("maps a game item with a valid UPC into a catalog product", () => {
    const result = mapPayMoreApiItems([gameItem()], COLLECTION);
    expect(result.products).toHaveLength(1);
    expect(result.skippedNoUpc).toBe(0);
    expect(result.skippedNoTitle).toBe(0);

    const product = firstProduct(result.products);
    expect(product.upc).toBe("045496733971");
    expect(product.title).toBe(
      "Factory Unlocked Nintendo The Legend of Zelda: A Link to the Past Super Nintendo SNES Game 045496733971",
    );
    expect(product.platform).toBe("Super Nintendo SNES");
    expect(product.edition).toBeNull();
    expect(product.collection).toBe(COLLECTION);
    expect(product.brand).toBe("Nintendo");
    expect(product.publisher).toBe("Nintendo");
    expect(product.genre).toBe("Adventure");
    expect(product.rating).toBe("E - Everyone");
    expect(product.releaseYear).toBe("1992");
  });

  test("keeps typed fields out of product.attributes and condition on the listing", () => {
    const product = firstProduct(mapPayMoreApiItems([gameItem()], COLLECTION).products);
    expect(product.attributes).not.toHaveProperty("publisher");
    expect(product.attributes).not.toHaveProperty("platform");
    expect(product.attributes).not.toHaveProperty("upc");
    expect(product.attributes).not.toHaveProperty("thisWillGoAtTheEndOfTheTitle");

    expect(product.listings).toEqual([
      {
        sourceUrl: "https://paymore.com/shop/product/15872618299678",
        condition: "CIB",
        attributes: {
          condition: "CIB",
          graded: "No",
          hasCase: "Yes",
          hasManual: "Yes",
          hasInserts: "No",
          hasDlc: "No",
        },
        imageUrl: "https://paymore.com/cdn/shop/files/zelda-a-link-to-the-past-snes.jpg",
      },
    ]);

    const noisy = allAttributeKeys(product).join(" ").toLowerCase();
    expect(noisy).not.toMatch(
      /serial|imei|battery|lock|ios version|os version|operating system|warrant|applecare|password/,
    );
  });

  test("ignores per-listing price, quantity, and store fields from the API item", () => {
    const product = firstProduct(mapPayMoreApiItems([gameItem()], COLLECTION).products);
    const listing = product.listings[0];
    expect(listing).not.toHaveProperty("price");
    expect(listing).not.toHaveProperty("quantity");
    expect(listing).not.toHaveProperty("storeName");
    expect(listing?.imageUrl).toBe(
      "https://paymore.com/cdn/shop/files/zelda-a-link-to-the-past-snes.jpg",
    );
  });

  test("leaves imageUrl undefined when the API item omits or blanks p_image", () => {
    const item = gameItem();
    const bare: Record<string, unknown> = { ...item };
    delete bare.p_image;

    const product = firstProduct(mapPayMoreApiItems([bare], COLLECTION).products);
    const listing = product.listings[0];
    expect(listing?.imageUrl).toBeUndefined();
    expect(listing?.sourceUrl).toBe("https://paymore.com/shop/product/15872618299678");
  });

  test("ignores blank p_image strings", () => {
    const product = firstProduct(
      mapPayMoreApiItems([gameItem({ p_image: "  " })], COLLECTION).products,
    );
    expect(product.listings[0]?.imageUrl).toBeUndefined();
  });

  test("skips phone items without a UPC", () => {
    const result = mapPayMoreApiItems([iphoneItem()], COLLECTION);
    expect(result.products).toEqual([]);
    expect(result.skippedNoUpc).toBe(1);
    expect(result.skippedNoTitle).toBe(0);
  });

  test("reads the UPC from other attributes for device categories", () => {
    const result = mapPayMoreApiItems(
      [
        iphoneItem({
          other_attributes: {
            ...IPHONE_OTHER_ATTRIBUTES,
            UPC: "195950642834",
          },
        }),
      ],
      "apple-iphones",
    );
    expect(result.skippedNoUpc).toBe(0);
    expect(firstProduct(result.products)).toMatchObject({
      upc: "195950642834",
      brand: "Apple",
      model: "iPhone 14 Pro Max",
    });
    expect(firstProduct(result.products).attributes).not.toHaveProperty("upc");
  });

  test("skips items with a failed UPC check digit", () => {
    const result = mapPayMoreApiItems(
      [
        gameItem({
          filter_attributes: { ...GAME_FILTER_ATTRIBUTES, UPC: "123456789010" },
        }),
      ],
      COLLECTION,
    );
    expect(result.products).toEqual([]);
    expect(result.skippedNoUpc).toBe(1);
  });

  test("keeps the MPN when an item carries both a UPC and an MPN", () => {
    const result = mapPayMoreApiItems(
      [
        gameItem({
          p_id: "15872618299680",
          p_title: "Nintendo Switch OLED Console White Joy-Con HEG-001-01 045496590628",
          filter_attributes: {
            Platform: "Nintendo Switch",
            "Game Name": "Nintendo Switch Console",
            UPC: "045496590628",
            MPN: "HEGSKAAAA",
            Brand: "Nintendo",
            Model: "Switch OLED",
            Condition: "Good",
          },
          other_attributes: {},
        }),
      ],
      COLLECTION,
    );
    expect(result.products).toHaveLength(1);
    const product = firstProduct(result.products);
    expect(product.upc).toBe("045496590628");
    expect(product.mpn).toBe("HEGSKAAAA");
  });

  test("builds an authorized /shop/product source URL from p_id", () => {
    const product = firstProduct(mapPayMoreApiItems([gameItem()], COLLECTION).products);
    expect(product.listings[0]?.sourceUrl).toBe(
      "https://paymore.com/shop/product/15872618299678",
    );
    expect(product.sourceUrls).toEqual(["https://paymore.com/shop/product/15872618299678"]);
    expect(isAuthorizedPayMoreProductUrl(product.listings[0]?.sourceUrl ?? "")).toBe(true);
  });

  test("falls back to Game Name when p_title is missing", () => {
    const result = mapPayMoreApiItems(
      [gameItem({ p_title: "" })],
      COLLECTION,
    );
    expect(result.skippedNoTitle).toBe(0);
    expect(firstProduct(result.products).title).toBe(
      "The Legend of Zelda: A Link to the Past",
    );
  });

  test("reports a missing title after both fallbacks are empty", () => {
    const result = mapPayMoreApiItems(
      [
        gameItem({
          p_title: "",
          filter_attributes: { ...GAME_FILTER_ATTRIBUTES, "Game Name": "" },
        }),
      ],
      COLLECTION,
    );
    expect(result.products).toEqual([]);
    expect(result.skippedNoTitle).toBe(1);
  });

  test("drops unit-only fields from a phone item that has a UPC", () => {
    const result = mapPayMoreApiItems(
      [
        iphoneItem({
          filter_attributes: { ...IPHONE_FILTER_ATTRIBUTES, UPC: "195950642834" },
        }),
      ],
      "apple-iphone-us",
    );
    expect(result.products).toHaveLength(1);
    const product = firstProduct(result.products);
    expect(product.upc).toBe("195950642834");
    expect(product.mpn).toBe("MQ8R3LL/A");
    expect(product.storage).toBe("128GB");
    expect(product.carrier).toBe("Unlocked");
    expect(product.attributes).toEqual({ screenSize: "6.7\"", simSlot: "Dual SIM" });
    expect(product.listings[0]?.condition).toBe("Good");

    const noisy = allAttributeKeys(product).join(" ").toLowerCase();
    expect(noisy).not.toMatch(
      /serial|imei|battery|lock|ios version|os version|operating system|warrant|applecare|password/,
    );
  });

  test("carries collections extracted from shopify_collection names", () => {
    const product = firstProduct(mapPayMoreApiItems([gameItem()], COLLECTION).products);
    expect(product.collections).toEqual(["Video Games"]);

    const dedupedTrimmed = firstProduct(
      mapPayMoreApiItems(
        [
          gameItem({
            shopify_collection: [
              { id: 1, name: " Video Games " },
              { id: 2, name: "Video Games" },
              { id: 3, name: "Phones" },
            ],
          }),
        ],
        COLLECTION,
      ).products,
    );
    expect(dedupedTrimmed.collections).toEqual(["Video Games", "Phones"]);
  });

  test("falls back to the collection slug when shopify_collection is absent", () => {
    const { shopify_collection: _absent, ...withoutCollections } = gameItem();
    const product = firstProduct(mapPayMoreApiItems([withoutCollections], COLLECTION).products);
    expect(product.collections).toEqual([COLLECTION]);

    const emptyNames = firstProduct(
      mapPayMoreApiItems(
        [gameItem({ shopify_collection: [{ id: 1, name: "   " }] })],
        COLLECTION,
      ).products,
    );
    expect(emptyNames.collections).toEqual([COLLECTION]);
  });
});
