# Free scanning and paid workspace rollout

Volt serves small businesses and resellers first, and developers integrating product data second. The workplace workflow is the pilot. The next business milestone is three paying external businesses.

## Current milestone: free workspace pilot

Every signed-in account can scan locally, sync captures, enroll devices, and open the dashboard without a paid entitlement. The mobile app has no new purchase or upgrade prompts. Existing App Store purchases can still be restored and managed, and verified legacy entitlements continue to determine existing AI allowances. Free accounts retain the configurable monthly AI allowance, initially 10 analyses. Ordinary barcode and text capture do not use that allowance.

Cloud access uses `capabilities.cloudWorkspace`. Legacy `plan`, `hasFullAppAccess`, and anonymous session-trial fields remain compatible with old clients and do not control cloud access. Authentication, workspace ownership, device revocation, and guest grant expiration still apply.

This milestone does not activate scan expiration, storage quotas, advertising, new web payments, or paid API enforcement. Existing records remain intact. App Store products and existing renewals require a separate external transition.

Deploy the backend access change before releasing the updated web and iOS clients. Older backends still require a paid entitlement for cloud sync. Limit the pilot to monitored usage until storage quotas and cleanup are implemented.

## Proposed offers

Prices are hypotheses to validate with pilot customers, not live checkout offers.

| Offer | Starting price | Planned value |
| --- | --- | --- |
| Free | $0 | Mobile scanning, dashboard sync, seven-day cloud history, basic export |
| Workspace | $12 per business per month | Persistent cloud history while subscribed, collections, richer exports, ad-free dashboard |
| API pilot | $29 per month | Product lookup with a defined monthly allowance, keys, and usage reporting |

The existing workspace belongs to one Clerk user. Charging per business requires a deliberate business membership and shared workspace model before selling multi-user access. Several devices on one account are not a substitute for separate employee identities.

Do not set paid record or photo limits until the pilot measures record volume, object storage, transfer, database operations, and support costs. API pricing also depends on data rights, coverage, and cost per lookup.

## Retention contract for the next milestone

- Free cloud captures expire seven days after server receipt. Local device history has its own lifecycle.
- Paid captures remain while the subscription is active, up to explicit record and photo limits. Do not promise permanent storage.
- Warn before storage limits. Let users export, delete, or upgrade instead of silently deleting paid history.
- Cancellation includes a proposed 30-day read-only export period before cleanup.
- An upgrade can preserve captures that have not expired. Deleted captures cannot be recovered by purchasing a plan.
- Apply a communicated migration grace period to existing captures. Never retroactively expire old rows by assuming missing policy fields mean free.
- Enforce quotas transactionally across every capture path, including guest grants, retries, batch appends, and restores.
- Delete R2 objects through an auditable retryable cleanup path. Soft deletion alone does not free object storage.
- Use server-calculated text sizes and validated photo sizes. Signed upload URLs must enforce upload bounds before claiming a hard physical storage cap.

Implement the policy and lifecycle together. A history filter does not establish physical deletion or bounded storage.

## API and advertising prerequisites

The product API already exposes search and UPC lookup with revocable keys and rate limits. Add monthly usage accounting, verified billing entitlements, explicit spending limits, and documented charging rules before selling a plan. Ordinary first-party scanning must not require an API subscription.

Catalog imports include PayMore and PriceCharting records. Confirm commercial display and redistribution permissions for each source and field, including images, before offering the data commercially. Keep private captures separate from the public catalog. Benchmark coverage and completeness against representative customer barcodes.

Start advertising on useful public product pages after AdSense site review, publisher configuration, consent handling, and privacy updates. Dashboard advertising is a later experiment. Avoid advertising on empty search, account, billing, or scan-entry screens. Paid workspaces will be ad-free when advertising launches.

## Rollout order and evidence

1. Ship the free workspace pilot. Verify free enrollment, capture, finalization, history, photo access, and computer presence, with cross-account and revoked-device access denied.
2. Measure workplace usage and demonstrate the workflow to five similar businesses. Record time saved and ask for actual paid pilot commitments.
3. Implement business ownership, web billing, quota accounting, migration grace, and retention cleanup. Test upgrade, cancellation, failed payment, export, expiry, and retries before enabling deletion.
4. Pilot the API with two developers after rights and coverage are established. Choose allowances using observed costs.
5. Add public-page advertising and measure revenue against page speed and task completion.

Track active businesses, weekly repeat usage, paid conversion, cancellations, cost per account, and product match rate. Advertising revenue is additional income until traffic and measured earnings justify relying on it.
