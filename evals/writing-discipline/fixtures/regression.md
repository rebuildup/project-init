## 概要

productionとlocal developmentで異なるsession cookie名を、同じauthentication pathで扱えるようにします。

## 変更

`normalizeSessionCookieName` がrequest boundaryで `__Secure-better-auth.session_token` と `better-auth.session_token` をcanonical identityへ正規化します。最初にLoginScreenを変更しましたが原因ではなかったためrevertしました。

## Validation

`tests/auth-cookie.test.ts`: 12/12 pass

current HEADはabc123で17 commits aheadです。CodeRabbitはDraftのためskipped、child agent auth-e2eはrunningなのでnext stepはresult待ちです。
