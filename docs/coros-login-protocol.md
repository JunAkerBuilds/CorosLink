# COROS Training Hub login investigation

Investigated on 2026-09-04 for [issue #110](https://github.com/JunAkerBuilds/CorosLink/issues/110).
The report describes `trainingHub:login` failing with `Parameter input error`
on an unchanged v0.1.28 installation and after upgrading to v0.1.30.

## Evidence from the production site

[Training Hub](https://training.coros.com/) advertised version 2.12.0 with an
application start date of 2026-08-25. Its public
[main bundle](https://static.coros.com/coros-traininghub-v2/assets/main-GmCs789j.js)
and [login bundle](https://static.coros.com/coros-traininghub-v2/assets/index-TlPrbmEM.js)
show the following protocol:

- Password login still posts `account`, `accountType: 2`, a bcrypt hash of the
  MD5 password digest (`p1`), and the bcrypt salt (`p2`) to `/account/login`.
  Remembering the login adds `rmbm: 1`.
- A two-factor challenge supplies `loginTicket`, `appKey`, `account`,
  `accountType2fa`, and `regionId`. The returned `account` is a verification
  identifier and must be kept separate from the email used for password login.
- Both `/account/captcha` and `/account/2fa/login/verify` use the challenge's
  `regionId` through the site's `tempRegion` request option.
- Production region IDs map to these servers:

| ID | Region | API host |
| --- | --- | --- |
| 1 | US/global | `teamapi.coros.com` |
| 2 | China | `teamcnapi.coros.com` |
| 3 | Europe | `teameuapi.coros.com` |
| 4 | Singapore | `teamsgapi.coros.com` |

Requests using an intentionally nonexistent `example.invalid` account and
CorosLink's password payload returned result `1030` (credentials do not match)
on all four production servers. This verifies that the request shape reaches
credential validation; it does not verify successful account authentication.
The former `teamapiap.coros.com` fallback could not be reached during the check.

## Defects corrected

1. Verification requests used the initial login host even when COROS returned
   a different account region. Region IDs 2 and 3 were also mapped incorrectly,
   and the Singapore fallback host was obsolete.
2. Successful two-factor verification saved the challenge's `account` in place
   of the original login email. Later reconnects then used the wrong identifier.
3. Development builds sent stale July preview-routing cookies, which meant they
   exercised different server routing from packaged builds.
4. All login stages surfaced bare API messages. Region fallback could replace a
   useful credential rejection with a later parameter or transport error.

The updated flow uses the advertised account region, preserves the email for
display and remembered credentials, uses production routing in development,
and includes the failing step and COROS result code in errors. If account
probes temporarily fail, it retains the preferred regional host.

## Verification and remaining uncertainty

`npm run test:coros-login` mocks the network, database, and credential store. It
covers two-factor login and reconnect in all four regions, opaque verification
identifiers, resend, invalid-code retry, cancellation, login without two-factor
authentication, Singapore fallback, missing/unknown regions, failed region
probes, and error reporting. The added flow tests failed against the old code
for region routing and preservation of the original email.

No successful login with the affected user's account was performed. The report
does not establish whether two-factor authentication is enabled or which region
owns the account. These defects can explain login/reconnect failures, but the
exact cause of issue #110 remains unconfirmed until the affected account is
tested. A previously saved verification identifier cannot be converted back
to the original email; signing in with email and password again after this fix
will replace it when Remember me is selected.
