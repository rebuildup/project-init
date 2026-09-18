## 概要

productionとlocal developmentで異なるsession cookie名を、同じauthentication pathで扱えるようにします。

## 変更

`normalizeSessionCookieName` がrequest boundaryで `__Secure-better-auth.session_token` と `better-auth.session_token` をcanonical identityへ正規化し、call siteごとのenvironment-specific branchingを不要にします。

## Validation

`tests/auth-cookie.test.ts`: 12/12 pass
