# Contributing to Volt

## Choose a change

Search [issues](https://github.com/juanquenga/Volt/issues) and pull requests before opening something new. Starter tasks include a [local Markdown link checker](https://github.com/juanquenga/Volt/issues/21) and an [extension environment example](https://github.com/juanquenga/Volt/issues/22). Check that an issue is still open, then comment to coordinate work. Discuss new product behavior or architecture changes before implementing them.

Keep each pull request focused on one change. Do not commit credentials, signing keys, generated builds, captured customer data, or local machine configuration. Report vulnerabilities through the [security policy](SECURITY.md), not a public issue.

## Install dependencies

Install Node.js 24, matching `.node-version`, then run these commands from the repository root:

```sh
corepack enable
pnpm install
```

Use pnpm for this workspace. Documentation and JavaScript-only tests need no Xcode, Apple signing credentials, or paid service account. On macOS, the mobile suite also executes Swift helper tests and requires an installed Xcode toolchain with its license accepted. On other platforms, those Swift tests are skipped.

## Work without service credentials

Start with a focused test suite:

```sh
pnpm --filter @volt/scanner-protocol test
pnpm test:convex
pnpm --filter @volt/extension test:scanner
pnpm --filter @volt/mobile test
pnpm test:web
```

The Convex suite uses a test backend rather than a live deployment. The mobile command runs static source contracts and, on macOS, executable Swift helper tests. It does not launch an iOS Simulator. These checks do not prove camera, sign-in, purchase, or cross-device delivery behavior. Describe any untested flows in your pull request.

## Configure interactive development

Use your own development Clerk instance and Convex deployment. Checked-in URL defaults and example URLs refer to the maintainer's deployments; replace them before testing signed-in or write flows. Root `.env.local` does not configure the web or extension workspace automatically.

### Backend

1. Follow [Clerk and Convex setup](docs/authentication-and-billing.md#clerk-and-convex) for the Clerk `convex` JWT template.
2. From the repository root, run `pnpm exec convex dev` and select your own development project. The CLI records its deployment configuration in root `.env.local`.
3. Set `CLERK_JWT_ISSUER_DOMAIN` on that development deployment to match your Clerk instance. If the first deployment stops because this value is missing, set it in the Convex dashboard and let the development command retry.
4. Use the deployment's `.convex.cloud` URL for the web client and `.convex.site` URL for HTTP actions.

For photo transfer, configure your own private R2 bucket and the four `R2_*` variables listed in [authentication and billing](docs/authentication-and-billing.md). For Pro-only cloud tests, grant your test account complimentary access on your own development deployment. StoreKit configuration is needed for purchase verification, not ordinary contribution checks. Never use `--prod` for contributor setup.

### Web app

Copy [apps/web/.env.example](apps/web/.env.example) to `apps/web/.env.local`. Replace both example values:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
VITE_CONVEX_URL=https://YOUR_DEPLOYMENT.convex.cloud
```

Run `pnpm dev:web` and open the local URL printed by Vite. Client variables are public build-time values. Do not add Clerk secret keys or R2 secrets to this file.

### Chrome extension

Create `packages/extension/.env.local` with your development values:

```dotenv
WXT_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
WXT_CLERK_SIGN_IN_URL=https://YOUR_CLERK_ACCOUNT_PORTAL/sign-in
WXT_SCANNER_SIGNAL_URL=https://YOUR_DEPLOYMENT.convex.site/api/signal
WXT_EXTENSION_PUBLIC_KEY=YOUR_CHROME_MANIFEST_PUBLIC_KEY
```

Follow the [extension authentication configuration](packages/extension/README.md#authentication-and-access-configuration) for the stable extension ID, allowed origins, Native API, and optional sync host. Use a development Clerk key that matches the backend issuer.

Run `pnpm dev:extension`. To load it manually, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `packages/extension/.output/volt`.

### iPhone app

Use macOS and Xcode. Open Xcode once to install its components and review and accept its license yourself.

The workspace still includes CocoaPods-generated configuration, even though its Podfile currently declares no third-party pods. Install the version recorded in `apps/mobile/ios/Podfile.lock`, then generate those files before opening the workspace:

```sh
gem install cocoapods -v 1.16.2
cd apps/mobile/ios
pod _1.16.2_ install
cd ../../..
```

Use a writable Ruby installation if the system Ruby requires administrator privileges. Do not commit the generated `Pods` directory.

Open `apps/mobile/ios/Volt.xcworkspace` and configure your own development signing team and the `VOLT_*` build settings described in [authentication and billing](docs/authentication-and-billing.md#clerk-and-convex). Do not commit personal signing changes.

Run `pnpm dev:mobile` for the default iPhone 17 Pro Max simulator. To use another installed simulator, list them with `xcrun simctl list devices available` and run `pnpm dev:mobile -- --id=YOUR_SIMULATOR_ID`.

Camera and real cross-device behavior need a physical iPhone. Find its ID with `xcrun devicectl list devices`, then run:

```sh
pnpm dev:mobile:device -- --id=YOUR_DEVICE_ID
```

For the App Clip, use `pnpm dev:mobile:appclip` or `pnpm dev:mobile:appclip:device -- --id=YOUR_DEVICE_ID`. App Clip invocation and associated domains need separate Apple configuration; a simulator launch alone does not verify QR invocation.

## Check your change

Run the checks relevant to the files you changed. These commands run from the repository root:

| Change | Checks |
| --- | --- |
| Documentation or repository tooling | `git diff --check` and verify edited links |
| Shared scanner protocol | `pnpm --filter @volt/scanner-protocol test` and `pnpm --filter @volt/scanner-protocol typecheck` |
| Convex functions | `pnpm test:convex` |
| Extension | `pnpm --filter @volt/extension test:scanner` and `pnpm --filter @volt/extension compile` |
| Web | `pnpm test:web` |
| Mobile helpers | `pnpm --filter @volt/mobile test` |

`pnpm test` runs the repository test suites. Run `pnpm check:repo-health` to check maintainability limits. For native compilation, use `pnpm --filter @volt/mobile build:ios`, which targets a generic iOS Simulator and needs no personal device ID. When build verification is relevant, use `pnpm build:extension` or `pnpm build:web`. Root `pnpm build` includes iOS and requires Xcode.

For UI or cross-device changes, include the tested browser/device, steps, expected result, and actual result. Add screenshots for visual changes. Test scanner retries and account boundaries when those behaviors change.

## Submit a pull request

- Explain the user-facing change and why it is needed.
- Link the issue, if there is one.
- Add regression tests for protocol, scanner session, or authorization changes.
- List the checks you ran and any checks you could not run.
- Update setup or architecture documentation when behavior changes.

Follow the existing TypeScript, React, and Swift patterns in the package you touch. Prefer small, reviewable changes over broad rewrites. Keep releases separate from contribution work. Publishing instructions live in the [extension release guide](packages/extension/docs/RELEASE_PROCESS.md) and [iOS release guide](apps/mobile/RELEASING.md).

CodeRabbit reviews run on non-draft pull requests when its GitHub App is installed. Maintainers can request another pass with `@coderabbitai review` or a fresh full review with `@coderabbitai full review`.
