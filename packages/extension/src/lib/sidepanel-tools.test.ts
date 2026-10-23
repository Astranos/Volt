import { describe, expect, test } from "vitest";
import { getToolLabel, isSidepanelToolId, SIDEPANEL_TOOLS } from "./sidepanel-tools";

describe("sidepanel tools", () => {
  test("registers the handbook as the third tab", () => {
    expect(SIDEPANEL_TOOLS.map((tool) => tool.id)).toEqual(["top-offers", "mobile-scanner", "handbook"]);
    expect(isSidepanelToolId("handbook")).toBe(true);
    expect(getToolLabel("handbook")).toBe("Handbook");
  });

  test("rejects unknown tool ids", () => {
    expect(isSidepanelToolId("handbook-editor")).toBe(false);
  });
});
