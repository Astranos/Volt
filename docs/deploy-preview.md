# Deploy an HTTPS dashboard preview

Use the existing `volt-scanner` Vercel project. Run commands from the repository root, not `apps/web`.

## Check the preview configuration

1. Verify that the Vercel CLI is installed and authenticated with `vercel whoami`.
2. Check `.vercel/project.json` for the linked `volt-scanner` project. If the checkout is unlinked, run `vercel link --project volt-scanner` and select the existing project.
3. Keep the Vercel project root at the repository root. The root `vercel.json` runs `pnpm --filter @volt/web build:static` and publishes `apps/web/dist`.
4. Set `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_CONVEX_URL` in the project's **Preview** environment. Use development credentials and a development Convex deployment.
5. Verify that the Clerk key's instance matches the deployment's `CLERK_JWT_ISSUER_DOMAIN`. Verify that Clerk has a JWT template named `convex` with audience `convex`.

Do not assume that a Convex deployment uses development Clerk credentials because the deployment is named development. Stop if the issuer does not match. Get approval before changing a shared deployment's issuer. Existing development clients can lose access.

Set `VITE_CONVEX_URL` explicitly. A Vercel preview runs a production-mode Vite build, so the app's fallback otherwise selects production Convex. Use a `.convex.cloud` URL, not `.convex.site`.

Do not upload a Clerk secret key. The web app is static and only needs the publishable key. `.vercelignore` excludes local environment files from CLI uploads. Keep preview values in Vercel, not in committed files.

## Deploy the current checkout

Run the preview command from the repository root:

```sh
pnpm deploy:preview
```

The script explicitly uses `vercel deploy --target preview`, including when the checkout is on `main`. The command uploads the current files and returns an HTTPS URL without pushing Git commits or replacing production.

Open the returned URL at `/sign-in`. Sign in and verify that `/dashboard` loads account data without a Convex authentication error. Check `/manifest.webmanifest` and `/sw.js` when testing PWA installation.

## Use automatic branch previews

The project already connects to `JuanQuenga/Volt` on GitHub, with deployments enabled and `main` as the production branch. Push an approved non-production branch to create its preview deployment. Do not open a pull request just to create a preview.

Do not push `main` to test this workflow. A push to the configured production branch can deploy production. For an HTTPS preview of a local `main` checkout, use `pnpm deploy:preview` instead.

After changing Preview environment variables, create a new preview. Vite embeds the public values during the build.

Vercel currently protects preview URLs with Vercel Authentication. Sign into Vercel before testing the app's separate Clerk login. Leave deployment protection and Production environment settings unchanged.
