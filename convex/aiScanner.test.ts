import { describe, expect, test, vi } from "vitest";

import {
  buildOpenRouterCatalogRequest,
  buildOpenRouterRequest,
  catalogIdentityMatchScore,
  isValidUPCA,
  normalizeItemName,
  normalizeUPCA,
  parseAIResponse,
  requestOpenRouterAnalysis,
  verifyPriceChartingUPC,
} from "./aiScanner";
describe("AI scanner parsing", () => {
  test("validates UPC-A and normalizes a valid leading-zero EAN-13", () => {
    expect(isValidUPCA("036000291452")).toBe(true);
    expect(normalizeUPCA("036000291452")).toBe("036000291452");
    expect(normalizeUPCA("0036000291452")).toBe("036000291452");
    expect(normalizeUPCA("036000291453")).toBeNull();
    expect(normalizeUPCA("03600029145")).toBeNull();
  });

  test("normalizes names and rejects generic or oversized answers", () => {
    expect(normalizeItemName("  Super   Mario\n64  ")).toBe("Super Mario 64");
    expect(normalizeItemName("unknown")).toBeNull();
    expect(normalizeItemName("x".repeat(201))).toBeNull();
  });

  test("matches catalog identities by title and rejects a conflicting platform", () => {
    const identity = {
      name: "Grand Theft Auto: San Andreas",
      platform: "PS2",
      edition: null,
      region: "US",
    };
    expect(catalogIdentityMatchScore(identity, {
      title: "Grand Theft Auto San Andreas",
      platform: "Sony PlayStation 2",
      edition: null,
    })).toBeGreaterThan(0);
    expect(catalogIdentityMatchScore(identity, {
      title: "Grand Theft Auto San Andreas",
      platform: "Xbox One",
      edition: null,
    })).toBeNull();
  });

  test("parses strict mode-specific JSON and returns null for invalid values", () => {
    expect(parseAIResponse("upc", '{"upc":"0036000291452"}')).toEqual({
      mode: "upc",
      value: "036000291452",
      format: "upc_a",
      identifiedName: null,
      platform: null,
    });
    expect(parseAIResponse("name", '```json\n{"name":"Unknown"}\n```')).toEqual({
      mode: "name",
      value: null,
      format: "item-name",
    });
    expect(parseAIResponse("name", '{"name":"Back 4 Blood"}\n\nReasoning omitted')).toEqual({
      mode: "name",
      value: "Back 4 Blood",
      format: "item-name",
    });
  });

  test("sends the configured model, JSON mode, and a JPEG data URL once", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"name":"Metroid Prime"}' } }] }), { status: 200 }),
    );
    const result = await requestOpenRouterAnalysis("name", Uint8Array.from([1, 2, 3]).buffer, {
      apiKey: "server-only-key",
      fetchImpl,
    });
    expect(result.value).toBe("Metroid Prime");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer server-only-key" });
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe("z-ai/glm-5.3-flash");
    expect(body.response_format.type).toBe("json_object");
    expect(body.messages[0].content[1].image_url?.url).toBe("data:image/jpeg;base64,AQID");
    expect(buildOpenRouterRequest("name", new ArrayBuffer(0))).toContain("image/jpeg");
  });

  test("identifies from the image before a bounded catalog search and PriceCharting verification", async () => {
    let openRouterCallCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        openRouterCallCount += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: openRouterCallCount === 1
            ? '{"name":"Grand Theft Auto: San Andreas","platform":"PS2","edition":null,"region":"US"}'
            : '{"upc":"710425274107"}' } }],
        }), { status: 200 });
      }
      return new Response(null, {
        status: 307,
        headers: { location: "https://www.pricecharting.com/game/playstation-2/grand-theft-auto-san-andreas?q=710425274107" },
      });
    });
    const result = await requestOpenRouterAnalysis("upc", Uint8Array.from([1, 2, 3]).buffer, {
      apiKey: "server-only-key",
      fetchImpl,
    });
    expect(result.value).toBe("710425274107");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const visionBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as {
      tools?: unknown;
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(visionBody.tools).toBeUndefined();
    expect(visionBody.messages[0].content.map((part) => part.type)).toEqual(["text", "image_url"]);
    const catalogBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)) as {
      tools: Array<{ type: string; parameters: { max_uses: number } }>;
      max_tool_calls: number;
      messages: Array<{ content: string }>;
    };
    expect(catalogBody.tools[0]).toMatchObject({ type: "openrouter:web_search", parameters: { max_uses: 2 } });
    expect(catalogBody.max_tool_calls).toBe(2);
    expect(catalogBody.messages[0].content).toContain("Grand Theft Auto: San Andreas");
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(buildOpenRouterCatalogRequest({
      name: "Grand Theft Auto: San Andreas",
      platform: "PS2",
      edition: null,
      region: "US",
    })).not.toContain("image_url");
  });

  test("returns a production catalog UPC without running the web-search fallback", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"name":"Galaxian","platform":"Atari 5200","edition":null,"region":"US"}' } }],
      }), { status: 200 }),
    );
    const trace: unknown[] = [];
    const result = await requestOpenRouterAnalysis("upc", Uint8Array.from([1, 2, 3]).buffer, {
      apiKey: "server-only-key",
      fetchImpl,
      catalogLookup: async () => ({
        upc: "077000052063",
        title: "Galaxian",
        platform: "Atari 5200",
        edition: null,
      }),
      onTrace: (event) => trace.push(event),
    });

    expect(result).toMatchObject({ value: "077000052063", identifiedName: "Galaxian" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(trace).toContainEqual(expect.objectContaining({
      stage: "catalog",
      outcome: "candidate",
      source: "product-catalog",
      upc: "077000052063",
    }));
  });

  test("stops after image identification when no game can be identified", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"name":null,"platform":null,"edition":null,"region":null}' } }] }), { status: 200 }),
    );
    const trace: unknown[] = [];
    const result = await requestOpenRouterAnalysis("upc", Uint8Array.from([1, 2, 3]).buffer, {
      apiKey: "server-only-key",
      fetchImpl,
      onTrace: (event) => trace.push(event),
    });
    expect(result.value).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(trace).toEqual([expect.objectContaining({ stage: "identity", outcome: "unresolved" })]);
  });

  test("rejects PriceCharting no-results and conflicting product redirects", async () => {
    const noResultFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 307,
      headers: { location: "https://www.pricecharting.com/search-products?category=no-results&q=710425274107&type=prices" },
    }));
    await expect(verifyPriceChartingUPC("710425274107", "Grand Theft Auto: San Andreas", "PS2", noResultFetch)).resolves.toBeNull();

    const wrongProductFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 307,
      headers: { location: "https://www.pricecharting.com/game/playstation-2/bully?q=710425274107" },
    }));
    await expect(verifyPriceChartingUPC("710425274107", "Grand Theft Auto: San Andreas", "PS2", wrongProductFetch)).resolves.toBeNull();
  });
});
