import { describe, expect, test } from "vitest";

import { SUPER_MARIO_64_HTML } from "./fixtures";
import { isAuthorizedPriceChartingGameUrl } from "./hosts";
import {
  mapPriceChartingGameDetails,
  mapPriceChartingGameRecord,
  parseGamePage,
} from "./pricecharting";

const GAME_URL = "https://www.pricecharting.com/game/nintendo-64/super-mario-64";

const NO_UPC_HTML = SUPER_MARIO_64_HTML
  .replace(
    /<tr>\s*<td class="title">UPC:<\/td>[\s\S]*?<\/tr>/,
    "",
  );

describe("PriceCharting game page parsing", () => {
  test("parses the heading, cover image, and details table", () => {
    const record = parseGamePage(SUPER_MARIO_64_HTML, GAME_URL);
    expect(record).toEqual({
      sourceUrl: GAME_URL,
      upc: "045496870010",
      title: "Super Mario 64",
      consoleName: "Nintendo 64",
      consoleSlug: "nintendo-64",
      genre: "Platformer",
      releaseDate: "September 29, 1996",
      esrbRating: "E - Everyone",
      publisher: "Nintendo",
      developer: "Nintendo EAD",
      modelNumber: null,
      playerCount: null,
      alsoCompatibleOn: null,
      notes: null,
      asin: "B00000F1GM",
      epid: "1103",
      priceChartingId: "3924",
      imageUrl: "https://storage.googleapis.com/images.pricecharting.com/ae4kxgfleqkdugjq/240.jpg",
    });
  });

  test("returns null when the page has no usable UPC", () => {
    expect(parseGamePage(NO_UPC_HTML, GAME_URL)).toBeNull();
  });

  test("normalizes UPC values with spaces", () => {
    const html = SUPER_MARIO_64_HTML.replace("045496870010", " 045496870010 ");
    expect(parseGamePage(html, GAME_URL)?.upc).toBe("045496870010");
  });
});

describe("PriceCharting catalog URL authorization", () => {
  test("accepts game pages with encoded slug characters", () => {
    expect(isAuthorizedPriceChartingGameUrl(
      "https://www.pricecharting.com/game/nintendo-64/conker%27s-bad-fur-day",
    )).toBe(true);
  });

  test("rejects non-game and non-PriceCharting URLs", () => {
    expect(isAuthorizedPriceChartingGameUrl("https://www.pricecharting.com/console/nintendo-64")).toBe(false);
    expect(isAuthorizedPriceChartingGameUrl("https://paymore.com/products/galaxian")).toBe(false);
    expect(isAuthorizedPriceChartingGameUrl("http://www.pricecharting.com/game/nintendo-64/x")).toBe(false);
  });
});

describe("PriceCharting record mapping", () => {
  const parsed = parseGamePage(SUPER_MARIO_64_HTML, GAME_URL);
  if (!parsed) throw new Error("fixture must parse");
  const record = parsed;

  test("maps a parsed record into a catalog product", () => {
    expect(record).not.toBeNull();
    const mapped = mapPriceChartingGameRecord(record);
    expect(mapped).toMatchObject({
      product: {
        upc: "045496870010",
        title: "Super Mario 64",
        platform: "Nintendo 64",
        edition: null,
        collection: "nintendo-64",
        publisher: "Nintendo",
        genre: "Platformer",
        rating: "E - Everyone",
        releaseYear: "1996",
        mpn: null,
        attributes: {
          asin: "B00000F1GM",
          epid: "1103",
          developer: "Nintendo EAD",
          priceChartingId: "3924",
          releaseDate: "September 29, 1996",
        },
        collections: ["Nintendo 64"],
        sourceUrls: [GAME_URL],
      },
    });
  });

  test("splits edition variants out of the title", () => {
    const editionRecord = {
      ...record,
      title: "The Legend of Zelda: Ocarina of Time [Collector's Edition]",
    };
    expect(mapPriceChartingGameRecord(editionRecord)).toMatchObject({
      product: { edition: "Collector's Edition" },
    });
  });

  test("counts skips for missing UPC, title, and invalid source", () => {
    expect(mapPriceChartingGameRecord({ ...record, upc: "not-a-upc" })).toEqual({ skipped: "no-upc" });
    expect(mapPriceChartingGameRecord({ ...record, title: "  " })).toEqual({ skipped: "no-title" });
    expect(mapPriceChartingGameRecord({ ...record, sourceUrl: "https://example.com/game/x/y" }))
      .toEqual({ skipped: "invalid-source" });
    expect(mapPriceChartingGameRecord(null)).toEqual({ skipped: "invalid-source" });
  });

  test("maps batches with per-skip counts", () => {
    const mapping = mapPriceChartingGameDetails([
      record,
      { ...record, upc: "nope" },
      { ...record, sourceUrl: "https://example.com/game/x/y" },
      "junk",
    ]);
    expect(mapping).toEqual({
      products: [expect.objectContaining({ upc: "045496870010" })],
      skippedNoUpc: 1,
      skippedNoTitle: 0,
      skippedInvalidSource: 2,
    });
  });
});
