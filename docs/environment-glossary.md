# Environments and shared terms

An **environment** is a compatible set of client configuration, identity service, backend deployment, and storage. Use a name for each part of a setup. A build running on your computer is not necessarily connected to development services, and two clients are not in the same environment merely because both are called "dev."

## Deployment stages

| Term | Meaning in Volt | Use it for |
| --- | --- | --- |
| **Local** | A process or build running on a contributor's computer or device. | The Vite web server at `localhost:5173`, an unpacked Chrome extension, or an app installed from Xcode. Always name the services it connects to. |
| **Development (dev)** | Non-production Clerk, Convex, and storage resources used for interactive work. Contributors should use their own development resources. | Testing sign-in, cloud sync, and cross-device behavior without touching production data. |
| **Preview** | A temporary web deployment for reviewing a branch or checkout. Volt's Vercel previews use development credentials and a development Convex deployment. | An HTTPS web review URL. A preview is not a separate backend stage. |
| **Staging** | A persistent, isolated stack that mirrors production across the web app, extension, iPhone app, Clerk, Convex, and storage. | Reserve this word for such a stack if Volt provisions one. Do not call the current web previews staging. |
| **Production (prod)** | The live services and published clients used by customers. | The production website, Chrome Web Store release, App Store release, production Clerk instance, Convex deployment, and storage. |

**Build mode is a separate axis.** `Debug` and `Release` are Xcode configurations. WXT and Vite also have development and production build modes. These describe how a client was built, not which Clerk instance or Convex deployment it calls. A Vercel preview is a production-mode Vite build configured with development services.

**Release channel is separate too.** An unpacked extension, a TestFlight build, and a store release describe how a client reached a tester. State its backend stage separately. A local iPhone build can call production if configured that way.

**A Git branch is a code version, not an environment.** Pushing `main` can trigger a production web deployment, while a local checkout of `main` can run against development services.

## Services and identity

| Term | Meaning in Volt |
| --- | --- |
| **Clerk instance** | The identity system in one stage. Development and production instances have different users, sessions, publishable keys, and frontend API domains. |
| **Clerk account** | A user within one Clerk instance, identified by its Clerk user ID. The same email in two instances is not the same account or workspace. |
| **Clerk session** | A client's signed-in state for a Clerk account. Chrome and iPhone each hold their own session. A valid session does not itself grant Pro features. |
| **Clerk JWT** | A short-lived token issued from Volt's `convex` template. Convex checks its issuer against `CLERK_JWT_ISSUER_DOMAIN`. The extension's cookie mirror helps Clerk sign-in reach the side panel; it is not a workspace record. |
| **Convex deployment** | One backend instance with its own functions, data, and environment variables. A `.convex.cloud` URL is for Convex clients; the matching `.convex.site` URL serves HTTP actions. |
| **Cloudflare R2 bucket** | Private storage for photo bytes. Convex holds photo metadata and grants short-lived upload or download URLs. |
| **Pro entitlement** | Server-verified permission from StoreKit or complimentary access. Convex turns it into capabilities such as `cloudWorkspace`. Signed in and Pro are different states. |

## Product and repository terms

| Term | Meaning in Volt |
| --- | --- |
| **Repository workspace** | A package or app in this monorepo, such as `apps/web` or `packages/extension`. Say "package" or "checkout" when that is clearer. |
| **Cloud Scanner Workspace** | The account-owned data space in Convex. It holds registered devices, capture metadata, presence, and delivery state. One Clerk account owns one Cloud Scanner Workspace within a deployment. |
| **Enrolled Computer** | A signed-in Chrome installation registered in a Cloud Scanner Workspace. It can see synchronized captures. |
| **Enrolled Mobile Device** | An iPhone app installation with a revocable Device Credential for that workspace. The app obtains it after Clerk sign-in. |
| **Live Computer Target** | An enrolled computer selected on the iPhone for optional text or barcode insertion at the cursor. Captures still save and sync when no computer is selected. |
| **Cloud sync** | Moving capture metadata through Convex and private photo bytes through R2 so the account's computers can see them. It is distinct from cursor insertion into one selected computer. |
| **App Clip guest grant** | Short-lived access to a signed-in Chrome account's workspace from a QR code. The App Clip does not hold a Clerk session or durable Device Credential. |

The product domain definitions, including Result Batch, Capture Result, and Cursor Delivery, live in [Volt Context](../CONTEXT.md#domain-terms).

## How to describe a setup or bug

Name the client, its delivery or build mode, its Clerk instance, and its Convex deployment. Include the Cloud Scanner Workspace or Clerk user ID only when an account mismatch matters. Do not share tokens, cookies, device secrets, or full environment files.

> iPhone app: local Debug build; development Clerk; development Convex. Chrome extension: unpacked development build; the same Clerk instance and Convex deployment. Both are signed into the same Clerk user, but the iPhone does not list the Enrolled Computer.

That report separates four checks: whether each client has a Clerk session, whether Convex accepts its token, whether the account has the `cloudWorkspace` capability, and whether both devices belong to the same Cloud Scanner Workspace. For setup details, see the [contributor guide](../CONTRIBUTING.md#configure-interactive-development) and [authentication and billing](authentication-and-billing.md#clerk-and-convex).
