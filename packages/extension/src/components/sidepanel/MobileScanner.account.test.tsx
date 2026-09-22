import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import MobileScanner from "./MobileScanner";
import { useMobileScannerHistory } from "../../hooks/useMobileScannerHistory";

vi.mock("../../hooks/useCloudWorkspaceSnapshot", () => ({ useCloudWorkspaceSnapshot: () => ({ historyReady: false, status: "loading", error: null, version: 0 }) }));
vi.mock("../access/ExtensionAccess", () => ({ useSidepanelSignedIn: () => true, useSidepanelUserId: () => "bob" }));
vi.mock("../../hooks/useMobileScannerHistory", () => ({ useMobileScannerHistory: vi.fn(() => { throw new Error("Persisted Alice history must not load before ownership verification"); }) }));

test("cold account binding does not mount the persisted timeline or old previews", () => {
  const html = renderToStaticMarkup(<MobileScanner />);
  expect(useMobileScannerHistory).not.toHaveBeenCalled();
  expect(html).not.toContain("Alice");
  expect(html).not.toContain("Undo");
});
