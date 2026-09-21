import test from "node:test";
import assert from "node:assert/strict";
import { createAgentBrowser, agentPage } from "./browser.ts";
import { DANGEROUS_WORDS } from "./policy.ts";

function fakeChrome(t) {
  const previous = globalThis.chrome;
  const tab = { id: 1, active: true, status: "complete", url: "https://www.ebay.com/" };
  const calls = [];
  globalThis.chrome = { tabs: { query: async () => [tab], get: async () => tab }, scripting: { executeScript: async (request) => {
    calls.push(request);
    return [{ result: { documentId: "doc", url: tab.url, title: "eBay", text: "", truncated: false, step: 0, candidates: [] } }];
  } } };
  t.after(() => { globalThis.chrome = previous; });
  return { tab, calls };
}
test("active tab only with no new tabs or broad frame injection", async (t) => {
  const f = fakeChrome(t), signal = new AbortController().signal;
  const browser = await createAgentBrowser(signal);
  await browser.observe('Search "camera"', 0, signal);
  assert.deepEqual(f.calls[0].target, { tabId: 1 });
  f.tab.active = false;
  await assert.rejects(browser.observe("Find cameras", 1, signal), /active tab changed/);
  browser.close();
});
test("navigation race or cancellation prevents execution", async (t) => {
  const f = fakeChrome(t), controller = new AbortController();
  const browser = await createAgentBrowser(controller.signal);
  const observation = await browser.observe("Find cameras", 0, controller.signal);
  f.tab.url = "https://www.ebay.com/new";
  await assert.rejects(browser.execute(observation, "one", controller.signal), /navigated/);
  controller.abort();
  await assert.rejects(browser.observe("Find cameras", 1, controller.signal));
  assert.equal(f.calls.length, 1);
});
test("isolated executor rejects stale document identity before touching actions", (t) => {
  const originals = Object.fromEntries(["window", "location", "document"].map((key) => [key, globalThis[key]]));
  globalThis.location = { href: "https://www.ebay.com/" };
  globalThis.document = { title: "eBay", body: { innerText: "Search" } };
  globalThis.window = { __voltAgent: { documentId: "old", url: location.href, actions: new Map() } };
  t.after(() => { Object.assign(globalThis, originals); });
  assert.throws(() => agentPage({ kind: "execute", documentId: "new", url: location.href, candidateId: "one", dangerousWords: DANGEROUS_WORDS }), /page changed/);
});
