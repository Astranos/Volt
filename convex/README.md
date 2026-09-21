# Volt backend

Convex owns account authorization, scanner workspace metadata, device enrollment, cursor delivery, product catalog data, and legacy signaling. Clients upload photo bytes directly to private Cloudflare R2 storage through short-lived signed URLs; Convex stores metadata and checks access.

## Entry points

| File | Responsibility |
| --- | --- |
| [schema.ts](schema.ts) | Tables and indexes for workspace, access, catalog, and signaling data. |
| [http.ts](http.ts) | HTTP route registration. |
| [auth.config.ts](auth.config.ts) | Clerk JWT issuer and `convex` audience. |
| [cloudWorkspace.ts](cloudWorkspace.ts) | Workspace devices, capture results, and delivery operations. |
| [access.ts](access.ts) | Account access and entitlement handling. |
| [crons.ts](crons.ts) | Scheduled cleanup. |

The current installed app and App Clip use cloud delivery. Legacy signaling tables and routes remain for older clients; their presence does not make WebRTC the current scanner architecture. See [project context](../CONTEXT.md) for domain terms.

## Development

Follow the [contributor backend setup](../CONTRIBUTING.md#backend) to use your own development deployment and Clerk instance. Configuration for R2 and StoreKit is in [authentication and billing](../docs/authentication-and-billing.md). Never copy production credentials into a contributor environment.

From the repository root, run the isolated backend tests:

```sh
pnpm test:convex
```

These tests use `convex-test`; no live deployment is needed. When changing a backend contract, add coverage for authorization, cross-workspace access, and retries where relevant. Test real network integrations separately against your own development services.

`_generated` contains Convex-generated bindings. Change the source functions or schema and use the Convex CLI to regenerate bindings rather than editing them by hand.

## Workspace snapshot pagination

`cloudWorkspace.workspaceSnapshotPage` reads one of three workspace-scoped streams: `batches`, `results`, or `deliveries`. Start each stream with `{ kind, cursor: null }`, then pass its `continueCursor` until `isDone` is true. Cursors are scoped to the authenticated workspace and stream. Result pages include deletion tombstones.

Each query reads at most 100 stream documents and sets a 128 KiB database read threshold. Convex may cross that byte threshold by one document, which is limited to 1 MiB by the platform. Pages also enforce a 7 MiB serialized response ceiling. No page reads child collections for every batch.

The web app and extension use the shared `subscribeWorkspaceSnapshot` controller. Every loaded page remains subscribed. When a page boundary changes, the controller replaces its later subscriptions and publishes only after all three streams are complete. Signing out or changing accounts cancels the old controller. One-shot callers use `fetchWorkspaceSnapshot` to drain every stream.

HTTP clients use `/api/workspace/snapshot?kind=results` and add a URL-encoded `cursor` on continuation requests. Fetch the batch and delivery streams the same way before joining results by batch ID.

Roll out the backend indexes and page endpoint before the updated web and extension clients. The legacy `workspaceSnapshot({})` query and HTTP request without `kind` still return complete small snapshots. They throw an explicit pagination-required error when the combined read exceeds 100 documents or 128 KiB. They never label truncated history as complete. Older installed extensions need an update to read larger workspaces. These changes do not deploy either service or publish an extension release.
