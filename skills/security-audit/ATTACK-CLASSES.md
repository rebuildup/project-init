# Security Audit Attack Classes

このcatalogは `security-audit` のPhase 1 reconnaissance結果から適用するclassだけを選ぶためのものです。generic checklistとして全項目を機械的に実行しません。

各classでlower-trust principal、accepted input/action、守るべきsecurity invariant、control、source trace、minimum boundary resultを明示します。

## Injection / unsafe sink
SQL/NoSQL query、shell/process invocation、template/HTML、filesystem path、redirect、LDAP/XPath、log/search/analytics等。valueだけでなくkey/header/metadata、stored inputの再利用、parser/canonicalization差も追跡する。

## Authentication / session / recovery
login、token、cookie、JWT、OAuth/OIDC/SAML、MFA/passkey、account recovery/linking、API key。identity proof、session establishment、expiration/revocation/rotation、fallback/recovery pathが同じinvariantを守るか確認する。

## Authorization / ownership / tenant isolation
authenticationだけでresource authorizationを代替していないか、requested ID/body fieldでowner/tenant scopeを書き換えられないか、batch/export/import/legacy pathでper-resource checkが抜けないか確認する。

## Business logic / state machine
step skip、replay、backward transition、partial failure/rollback、duplicate approval、double spend、negative/zero/max/precision quantity、stale/revoked stateを確認する。

## Resource / file / archive handling
path traversal、symlink/TOCTOU、archive extraction、temp file、unsafe deserialization、upload/download。validation時とuse時のresolved object差、encoded/canonicalized path、archive member/linkを確認する。

## SSRF / outbound trust
redirect後のallowlist、hostname/IP/parser canonicalization、internal metadata/control-plane destination、user-controlled callback/webhook targetのauthorityを確認する。

## Cryptography / secrets
randomness、secret comparison、verification failure、nonce/IV/key reuse、integrity、secret logging/URL/client response、fail-openを確認する。

## Parser / protocol disagreement
frontend/backend/proxy間のframing/length/canonicalization、duplicate field/header、integer/unit/encoding、invalid-input fallback、serializer/deserializer assumptionを確認する。

## Browser / client-side
DOM rendering、origin、postMessage、CORS、WebSocket、service worker、browser storage、extension/webview bridge。sender/source/origin、UI actionとauthorized resourceのbinding、persistent client stateを確認する。

## Native / memory / FFI / ABI
C/C++、Rust unsafe、FFI、binary parser、native plugin。bounds/lifetime/ownership、integer truncation/overflow/sign conversion、ABI/layout/alignment、unsafe precondition、error/cancellation pathを確認する。

## Concurrency / TOCTOU
check-then-act、lock/transaction scope、cancellation/retry、stale cache/version、lost update、privilege resurrectionを確認する。

## Dependency / generated input / plugin / extension
package resolution/lock/source pin、generated input、plugin authority、build-time execution、dependency substitution、untrusted contributionからtrusted buildへのpathを確認する。

## CI / release / signing / update
untrusted PRからsecret/release authorityへのpath、workflow event/permission、artifact provenance/promotion、mutable ref、signing/update authority、release sourceとpublished artifact identityを確認する。

## Cloud / deployment / IAM
IaC、container、Kubernetes、serverless/edge、ingress、IAM。principal/resource selector、default/fallback policy、secret/config injection、public/private exposureを確認する。sourceから決まらないdeployment factは `needs_validation`。

## RPC / messaging / webhook
peer identity/signature/replay、schema/version disagreement、per-message authorization、topic scope、retry/dead-letter、streaming lifecycleを確認する。

## Resource exhaustion / quota / operator spend
shared CPU/memory/disk/socket/worker/queue/quota、amplification、per-principal isolation、backpressure/cancellation、paid provider callを確認する。availability testはlive/shared processへ行わない。

## Data isolation / lifecycle
cache/search/index、analytics、export、backup、migration、deletion、restore。derived copyのtenant isolation、deletion propagation、restore/export authority、migration old/new pathを確認する。

## Desktop / mobile / local IPC
deep link、exported component、webview bridge、daemon/helper、Unix socket/XPC/Binder/D-Bus。caller identity、exported surface、argument validation、privileged helper authorityを確認する。

## AI / LLM / agent / MCP
untrusted contentとsystem/tool authorityのseparation、persistent memory poisoning、model outputとauthorized actionのbinding、tool schema、MCP identity/permission、retrieved contentによるpolicy拡張、model-generated selectorのauthorizationを確認する。prompt injection文字列だけをfindingにせず具体的boundary/resultまで示す。

## Wildcard pass
catalog外でもreconnaissanceで固有boundaryが見つかった場合はproject-specific classを追加できる。名前より invariant / principal / boundary / result をcanonicalにする。
