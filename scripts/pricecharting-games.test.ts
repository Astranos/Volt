import { describe, expect, test } from "vitest";

import {
  extractConsoleSlugs,
  looksLikeChallenge,
  parseConsoleProductsPayload,
  redactSecret,
} from "./pricecharting-games";

const CATEGORY_HTML = [
  "<nav>",
  '  <a href="/console/funko-pop-games">Funko Pop Games</a>',
  '  <a href="/console/lego-star-wars">LEGO Star Wars</a>',
  "</nav>",
  "<section>",
  "  <h2>Browse Popular Video Game Systems</h2>",
  '  <div class="home-box all">',
  '    <a href="/console/nintendo-64">Nintendo 64</a>',
  '    <a href="/console/game-&amp;-watch">Game &amp; Watch</a>',
  '    <a href="https://www.pricecharting.com/console/super-nintendo?sort=name">SNES</a>',
  "  </div>",
  "</section>",
].join("\n");

describe("PriceCharting crawl boundaries", () => {
  test("extracts console slugs only from the video-game systems grid", () => {
    expect(extractConsoleSlugs(CATEGORY_HTML)).toEqual([
      "game-&-watch",
      "nintendo-64",
      "super-nintendo",
    ]);
  });

  test("fails console discovery when the authoritative grid marker is absent", () => {
    expect(() => extractConsoleSlugs('<a href="/console/nintendo-64">Nintendo 64</a>'))
      .toThrow(/Browse Popular Video Game Systems/);
  });

  test("parses product rows and a non-terminal cursor", () => {
    const payload = JSON.stringify({
      cursor: "150",
      products: [
        { consoleUri: "nintendo-64", productUri: "super-mario-64" },
        { consoleUri: "game-&-watch", productUri: "8bitdo-sn30-pro+" },
      ],
    });

    expect(parseConsoleProductsPayload(payload)).toEqual({
      cursor: "150",
      gameUrls: [
        "https://www.pricecharting.com/game/nintendo-64/super-mario-64",
        "https://www.pricecharting.com/game/game-&-watch/8bitdo-sn30-pro+",
      ],
    });
  });

  test("normalizes null, empty, and missing terminal cursors", () => {
    expect(parseConsoleProductsPayload('{"cursor":null,"products":[]}').cursor).toBeNull();
    expect(parseConsoleProductsPayload('{"cursor":"","products":[]}').cursor).toBeNull();
    expect(parseConsoleProductsPayload('{"products":[]}').cursor).toBeNull();
  });

  test("rejects malformed JSON", () => {
    expect(() => parseConsoleProductsPayload("{")).toThrow();
  });

  test("rejects malformed rows so retries cannot silently drop games", () => {
    expect(() =>
      parseConsoleProductsPayload(
        JSON.stringify({
          cursor: null,
          products: [{ consoleUri: "nintendo-64", productUri: "" }],
        }),
      )
    ).toThrow(/row 0/);
  });

  test("detects Cloudflare challenge pages without flagging normal pages", () => {
    expect(looksLikeChallenge(403, "<html>_cf_chl_opt = {};</html>")).toBe(true);
    expect(
      looksLikeChallenge(
        200,
        "<div>Just a moment...</div><script>challenge-platform</script>",
      ),
    ).toBe(true);
    expect(looksLikeChallenge(200, "<html><h1>Super Mario 64</h1></html>")).toBe(false);
  });

  test("redacts every occurrence of the crawl secret from subprocess failures", () => {
    expect(redactSecret("secret-value failed: secret-value", "secret-value"))
      .toBe("[REDACTED] failed: [REDACTED]");
  });
});
