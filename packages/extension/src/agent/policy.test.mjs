import test from "node:test";
import assert from "node:assert/strict";
import { safeAgentUrl, taskCandidates } from "./policy.ts";

test("navigation accepts public HTTP(S) and excludes privileged/sensitive destinations", () => {
  assert.equal(safeAgentUrl("https://www.ebay.com/sch/i.html"), "https://www.ebay.com/sch/i.html");
  for (const url of ["chrome://settings", "javascript:alert(1)", "http://localhost", "https://127.0.0.1", "https://shop.local", "https://u:p@shop.com", "https://shop.com:8443", "https://shop.com/checkout", "https://shop.com/%61ccount"]) assert.equal(safeAgentUrl(url), null, url);
});
test("candidate values come only from bounded task text and URLs", () => {
  const result = taskCandidates('Visit https://www.ebay.com/ and search "Canon EOS"');
  assert.deepEqual(result.urls, ["https://www.ebay.com/"]);
  assert.ok(result.values.includes("Canon EOS"));
  assert.ok(!taskCandidates('use "password secret"').values.includes("password secret"));
  assert.ok(taskCandidates('"one" "two" "three" "four" "five" "six" "seven"').values.length <= 6);
});
