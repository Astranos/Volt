# Extension Release Process

Chrome Web Store releases use the V2 API. Nobody chooses or edits the release
version manually.

## What the release command does

`packages/extension/package.json` is the only checked-in version source. WXT
reads it when generating `manifest.json`.

For every release, the CLI:

1. Fetches the published and submitted versions from Chrome Web Store.
2. Treats the checked-in package version as a floor and finds the first version
   newer than every store revision.
3. Normally increments the patch component, respecting Chrome's `0..65535`
   limits.
4. Writes that version to `package.json` and creates a production zip.
5. Verifies the built manifest, uploads the zip, and submits it for review.
6. Keeps the bump only after Chrome accepts the upload. Build or upload failures
   restore the original package version.

A pending-review or staged submission blocks another release instead of
replacing it unexpectedly.

## One-time Google setup

Use a service account so local agents and GitHub Actions only receive
short-lived access tokens. Do not create or commit a long-lived JSON key.

1. In a Google Cloud project, enable **Chrome Web Store API**.
2. Create a service account, for example `volt-chrome-web-store`.
3. In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/),
   open **Account** and add the service-account email. Chrome currently allows
   one service account per publisher.
4. Copy `.env.cws.example` to `.env.cws` and fill in the publisher ID and
   service-account email. The Volt item ID is already present.
5. Grant each local operator `roles/iam.serviceAccountTokenCreator` on that
   service account, then authenticate `gcloud` normally.

The publisher ID is shown in the Developer Dashboard under **Publisher >
Settings**. `.env.cws` is ignored by Git.

## Local commands

From the repository root:

```sh
pnpm status:extension-store
pnpm release:extension:dry-run
pnpm release:extension
```

`release:extension:dry-run` authenticates and prints the version it would use,
but does not change files, build, upload, or submit anything.

`release:extension` uploads the new package and requests immediate publication
after Chrome review. Useful alternatives:

```sh
pnpm release:extension -- --upload-only
pnpm release:extension -- --publish-type=STAGED_PUBLISH
pnpm release:extension -- --skip-review
```

Use `--skip-review` only when Chrome says the update is eligible. The API will
reject it otherwise.

## GitHub Actions

The **Publish Chrome Extension** workflow is manual, serialized, and always
releases the current `main` branch. Configure these GitHub repository variables:

- `CWS_EXTENSION_ID`
- `CWS_PUBLISHER_ID`
- `GCP_SERVICE_ACCOUNT`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `WXT_CLERK_PUBLISHABLE_KEY` (the production `pk_live_...` key)
- `WXT_EXTENSION_PUBLIC_KEY` (the manifest public key that resolves to `CWS_EXTENSION_ID`)

Configure Google Workload Identity Federation for the `JuanQuenga/Volt`
repository and grant that identity `roles/iam.workloadIdentityUser` on the
service account. The workflow uses GitHub OIDC to mint a short-lived Chrome Web
Store access token; no Google credential is stored in GitHub.

The release command rejects missing or test Clerk credentials, mismatched
extension identities, and artifacts that omit either production value.

After an accepted upload, the workflow commits the generated package version
back to `main`. If that commit ever fails, the next run still queries the store
and chooses a version above the uploaded one.

Use a GitHub environment named `chrome-web-store` if release approvals are
desired. The workflow already targets that environment.

## Verification

The workflow runs these checks before publishing:

```sh
pnpm --filter @volt/extension test:release
pnpm --filter @volt/extension test:scanner
pnpm --filter @volt/extension compile
```

The generated zip is also retained as a workflow artifact.

## Rolling back a bad release

The Chrome Web Store API has no rollback endpoint, so rollback only exists in
the Developer Dashboard. It always republishes the previously published version
under a new, higher version number, goes live in about a minute without review,
and discards any pending or staged submission.

Package page:
<https://chrome.google.com/webstore/devconsole/54967cb5-3a3c-4361-b5cd-27bc34b1f4ea/bmgghhmlflbhlnomgnoodpidekpaaifk/edit/package>

Check the live version without signing in:

```sh
curl -s "https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=140.0&acceptformat=crx3&x=id%3Dbmgghhmlflbhlnomgnoodpidekpaaifk%26uc" | grep -o 'version="[^"]*"'
```

### Agent procedure

Agents do not perform the rollback. The maintainer does it from their phone.
When a release needs rolling back, send them this message (push notification
when available):

> Roll back Volt on your phone:
> 1. Open https://chrome.google.com/webstore/devconsole/54967cb5-3a3c-4361-b5cd-27bc34b1f4ea/bmgghhmlflbhlnomgnoodpidekpaaifk/edit/package
>    (switch the browser to desktop site if the layout is cramped).
> 2. Tap **Roll back to previous version**.
> 3. Enter a version one patch above the highest Published or Draft version
>    on that page, and a short reason.
> 4. Tap **Roll back**, then **Confirm**.
>
> If the dialog says a pending submission will be discarded, rolling back
> cancels that review and the fix has to be resubmitted.

Afterwards, confirm the new version with the `curl` check.

### Resubmitting the fix

Run the **Publish Chrome Extension** workflow on `main` again. The release
script picks a version above the rollback automatically. The
`chrome-web-store` environment waits for the maintainer's approval; tell them to
approve it from the GitHub app unless they explicitly asked the agent to.

## References

- [Chrome Web Store API V2 guide](https://developer.chrome.com/docs/webstore/using-api)
- [Chrome Web Store service accounts](https://developer.chrome.com/docs/webstore/service-accounts)
- [Chrome Web Store API V2 reference](https://developer.chrome.com/docs/webstore/api/reference/rest)
- [Google GitHub Actions authentication](https://github.com/google-github-actions/auth)
