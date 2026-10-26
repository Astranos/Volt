import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { REOPEN_NEW_TAB_AFTER_UPDATE_KEY } from "../../domain/extension-update";
import { restartVoltForUpdate } from "./UpdateReadyButton";

const currentUrl = "chrome-extension://volt/newtab.html";
const current = { contextType: "TAB", tabId: 1, documentUrl: currentUrl };
const getContexts = vi.fn(async () => [current]);
const getCurrent = vi.fn<() => Promise<{ id: number; url: string } | undefined>>(async () => ({ id: 1, url: currentUrl }));
const confirm = vi.fn(() => true);
const reload = vi.fn();
const set = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  getContexts.mockResolvedValue([current]);
  getCurrent.mockResolvedValue({ id: 1, url: currentUrl });
  confirm.mockReturnValue(true);
  vi.stubGlobal("window", { location: { href: currentUrl }, confirm });
  vi.stubGlobal("chrome", {
    runtime: { getContexts, reload },
    tabs: { getCurrent },
    storage: { local: { set } },
  });
});

afterEach(() => vi.unstubAllGlobals());

test("restarts without confirmation when only the current document is open", async () => {
  await restartVoltForUpdate();
  expect(getContexts).toHaveBeenCalledWith({ contextTypes: ["TAB", "SIDE_PANEL", "POPUP"] });
  expect(confirm).not.toHaveBeenCalled();
  expect(set).toHaveBeenCalledWith({ [REOPEN_NEW_TAB_AFTER_UPDATE_KEY]: true });
  expect(reload).toHaveBeenCalledOnce();
});

test.each([
  [[{ contextType: "TAB", tabId: 2, documentUrl: currentUrl }], "1 other Volt tab"],
  [[{ contextType: "SIDE_PANEL", tabId: 1, documentUrl: "chrome-extension://volt/sidepanel.html" }], "the Volt side panel"],
  [[{ contextType: "POPUP", tabId: -1, documentUrl: "chrome-extension://volt/popup.html" }], "a Volt popup"],
  [[{ contextType: "TAB", tabId: 2, documentUrl: "chrome-extension://volt/handbook.html" }, { contextType: "TAB", tabId: 3, documentUrl: currentUrl }, { contextType: "SIDE_PANEL", tabId: -1, documentUrl: "chrome-extension://volt/sidepanel.html" }], "2 other Volt tabs and the Volt side panel"],
])("warns about the other extension contexts: %j", async (others, description) => {
  getContexts.mockResolvedValue([current, ...others]);
  confirm.mockReturnValue(false);
  await restartVoltForUpdate();
  expect(confirm).toHaveBeenCalledWith(`Restarting Volt closes ${description}. Unsaved handbook edits there will be lost. Restart now?`);
  expect(set).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

test("only saves the reopen flag and reloads after confirmation", async () => {
  getContexts.mockResolvedValue([current, { ...current, tabId: 2 }]);
  await restartVoltForUpdate();
  expect(confirm).toHaveBeenCalledOnce();
  expect(set).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
  expect(set.mock.invocationCallOrder[0]).toBeGreaterThan(confirm.mock.invocationCallOrder[0]);
  expect(reload.mock.invocationCallOrder[0]).toBeGreaterThan(set.mock.invocationCallOrder[0]);
});

test.each(["unavailable", "failed", "no current tab"])("uses a generic confirmation when context lookup is %s", async (reason) => {
  if (reason === "unavailable") vi.stubGlobal("chrome", { ...chrome, runtime: { reload } });
  if (reason === "failed") getContexts.mockRejectedValueOnce(new Error("Unavailable"));
  if (reason === "no current tab") getCurrent.mockResolvedValueOnce(undefined);
  confirm.mockReturnValue(false);
  await restartVoltForUpdate();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Unsaved handbook edits there will be lost."));
  expect(reload).not.toHaveBeenCalled();
});
