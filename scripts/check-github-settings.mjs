import { execFileSync } from "node:child_process";

// Read-only. Run with a gh login that can read repository protection settings.
const repo = "JuanQuenga/Volt";
function get(path) {
  return JSON.parse(execFileSync("gh", ["api", `repos/${repo}/${path}`], { encoding: "utf8" }));
}
const protection = get("branches/main/protection");
const environment = get("environments/chrome-web-store");
const reviews = protection.required_pull_request_reviews;
const releaseReview = environment.protection_rules?.find((rule) => rule.type === "required_reviewers");
const checks = {
  "at least one approving review": reviews?.required_approving_review_count >= 1,
  "code owner review": reviews?.require_code_owner_reviews === true,
  "approval of the latest push": reviews?.require_last_push_approval === true,
  "stale approvals dismissed": reviews?.dismiss_stale_reviews === true,
  "admins follow branch protection": protection.enforce_admins?.enabled === true,
  "up-to-date CI required": protection.required_status_checks?.strict === true &&
    protection.required_status_checks.contexts?.includes("JavaScript and TypeScript"),
  "release requires maintainer approval": releaseReview?.reviewers?.some(
    ({ reviewer }) => reviewer.login === "JuanQuenga",
  ) === true,
  "release restricted to protected branches": environment.deployment_branch_policy?.protected_branches === true &&
    environment.deployment_branch_policy?.custom_branch_policies === false,
};
for (const [name, passed] of Object.entries(checks)) console.log(`${passed ? "ok" : "FAIL"} - ${name}`);
if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
