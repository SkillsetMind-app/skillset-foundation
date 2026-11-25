# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. This repository is public, and a public
report tells an attacker where to look before the fix is live.

Report it privately instead, in either of these two ways:

- **GitHub:** open the **Security** tab of this repository and choose **Report a vulnerability**.
- **Email:** write to `support@skillsetmind.com` with "Security" in the subject line.

A useful report says what you found, where (the page or the route), the steps to reproduce it, and
what an attacker could do with it. Please do not include other people's personal data: describe how
you reached it instead.

## Scope

- The production site, `skillsetmind.com` and its subdomains.
- The code in this repository.

Please do not test in ways that affect other people's accounts, payments or data, and do not run
load or denial-of-service tests against production.

## What is already in place

Every change goes through automated checks before it can be merged: static analysis, secret
scanning, a dependency audit and database access-rule tests. The workflows live in
`.github/workflows/`.
