# Security Policy

## Reporting a Vulnerability

Please do not report suspected vulnerabilities in public issues.

Use GitHub private vulnerability reporting if it is enabled for this repository. If it is not enabled, contact a maintainer privately before publishing details.

Include:

- Affected package or app.
- Steps to reproduce.
- Impact and likely affected users.
- Any relevant logs, screenshots, or proof-of-concept details.

## Secret Handling

Never commit `.env` files, API keys, tokens, private keys, provisioning profiles, signing certificates, or production service credentials.

The repository includes example environment files with variable names only. Keep real values in local environment files or the deployment platform secret store.
