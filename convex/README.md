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
