# Volt monetization rollout

Volt serves small businesses/resellers and product-data developers. The workplace is the first pilot; aim for three external paying accounts before expanding the offers.

| Offer | Initial price | Implemented allowance |
| --- | --- | --- |
| Free scanner | $0 | Free mobile scanning, account sync and export; 7-day cloud history, 1,000 records, 100 MiB |
| Workspace | $12/month/account | History while paid, up to 25,000 records and 1 GiB |
| Product API | $29/month/account | 5,000 successful requests per UTC calendar month |
| API evaluation | $0 | 100 successful requests total across all account keys |

Prices and limits are pilot hypotheses. Workspace ownership is currently one Clerk account; shared employee identities, team seats, collections and richer exports are future work. API access is separate from workspace billing. Legacy verified App Store/manual entitlements retain workspace privileges and their existing AI allowances; ordinary capture remains free. AI analysis still has a separate allowance.

## What ships disabled

Stripe and AdSense accounts do not exist yet. Checkout, ads, retention enforcement and API allowance enforcement default off. `/billing` shows actual usage and clearly labels pilot behavior. Usage accounting still measures successful API traffic.

Existing scan rows without `storageManaged` are preserved and excluded from managed counters. Enabling retention only enrolls newly accepted captures. This is deliberate migration protection, not a complete bound on existing database/storage costs. Communicate and implement an explicit legacy migration before claiming every record is managed.

## Storage lifecycle

Free managed captures expire seven days after server receipt. Paid history remains while paid within caps. When paid access ends, a 30-day read-only export period precedes expiration. Immediate cancellation starts that period at the subscription end; scheduled cancellation follows the paid period. Upgrade can preserve unswept data; retention tombstones cannot be restored.

Quota reservations are transactional across device/guest upload, append and restore paths. Text size is calculated from UTF-8 content. Photos require a positive declared size of at most 10 MiB and an exact HEAD size match at finalization. Caps bound validated logical storage: presigned PUT does not impose a hard R2 payload limit. Rejected/unfinalized oversized objects need operational monitoring; a bounded upload gateway and orphan-object sweep remain follow-up work.

User deletion releases record allowance immediately, retains byte allowance during the 30-day undo period, then schedules purge. Retention expiry permits no undo. R2 deletion retries on failure; bytes are released only after successful cleanup. A ten-minute delay allows existing five-minute signed URLs to expire. Minimal sync tombstones remain for idempotency; metadata pruning is future work. Cleanup is bounded (100 expiry rows / sweep, 25 objects / purge run) and should be monitored against ingestion volume.

## API charging contract

One successful UPC lookup or nonempty search response counts as one request. Invalid inputs, misses, empty searches, rate-limited requests and server failures do not consume the allowance. Per-key rate limits still apply to attempts. Atomic reservations prevent concurrent keys exceeding the account allowance; retries of reservation/settlement are idempotent, and abandoned reservations expire. A late response after refund returns a retryable error instead of unmetered data. HTTP retrying a completed successful call is a new billable request.

Monthly paid allowance resets on UTC calendar months, independently of Stripe renewal day. Evaluation allowance never resets. No automatic paid overages. Internal scanner catalog access does not consume external API allowance.

Confirm redistribution/commercial rights for each imported source and images before selling API access. `PRODUCT_API_COMMERCIAL_ENABLED` defaults off and gates paid API checkout/access. Public data availability does not prove resale rights.

## Stripe setup and activation

1. Create a Stripe account and start in test mode. Create separate licensed USD monthly prices: Workspace $12 and API $29. The server validates these amounts and intervals.
2. Configure Convex environment values: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WORKSPACE_PRICE_ID`, `STRIPE_API_PRICE_ID`, and `APP_URL` (exact site origin). Never expose secret keys in `VITE_*` variables.
3. Register the Convex HTTP endpoint `/api/billing/stripe/webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Enable the Stripe customer portal.
4. Set `BILLING_ENABLED=true` in test environment. Verify checkout, portal, duplicate webhook delivery, failed renewal, scheduled/immediate cancellation and separate product ownership. Access comes from signed webhooks plus canonical paid invoice proof, never the checkout return URL.
5. Communicate free retention and migration terms. Test export, expiry and R2 purge using disposable test records. Enable `WORKSPACE_STORAGE_POLICY_ENABLED=true` only after this review. Paid API additionally requires confirmed data rights and `PRODUCT_API_COMMERCIAL_ENABLED=true`; enable `PRODUCT_API_METERING_ENABLED=true` after client notices and boundary tests.
6. Repeat verified configuration with live Stripe credentials and prices when ready to sell. No accounts, products, deployments or deletion policies were activated by this code change.

Optional server limits: `WORKSPACE_FREE_RECORD_LIMIT`, `WORKSPACE_PAID_RECORD_LIMIT`, `WORKSPACE_FREE_BYTE_LIMIT`, `WORKSPACE_PAID_BYTE_LIMIT`, `PRODUCT_API_EVALUATION_LIMIT`, `PRODUCT_API_MONTHLY_LIMIT`. If changing defaults, update advertised offer copy at the same time.

Track weekly repeat use, conversion, cancellations, product match rate, storage/transfer/database costs and support time. Treat ads as supplemental revenue until traffic demonstrates meaningful earnings.
