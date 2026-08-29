import { describe, expect, test, vi } from "vitest";

import {
  buildOpenRouterRequest,
  isValidUPCA,
  normalizeItemName,
  normalizeUPCA,
  parseAIResponse,
  requestOpenRouterAnalysis,
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

  test("parses strict mode-specific JSON and returns null for invalid values", () => {
    expect(parseAIResponse("upc", '{"upc":"0036000291452"}')).toEqual({
      mode: "upc",
      value: "036000291452",
      format: "upc_a",
    });
    expect(parseAIResponse("name", '```json\n{"name":"Unknown"}\n```')).toEqual({
      mode: "name",
      value: null,
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
});
