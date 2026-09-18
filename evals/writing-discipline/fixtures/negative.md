## 概要

userとの会話で「そこではない」と言われたので調査しました。最初にLoginScreenを変更してrevertし、その後call site側でcookie prefixを分岐する案も試しました。

## 変更

current HEADはabc123、17 commits aheadです。CodeRabbitはDraftなのでskippedです。normalizeSessionCookieNameでは__Secure-better-auth.session_tokenとbetter-auth.session_tokenを扱っています。

## Validation

tests/auth-cookie.test.tsは12/12 passです。child agent auth-e2eがrunningで、next stepは完了後に統合することです。
