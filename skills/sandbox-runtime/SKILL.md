---
name: sandbox-runtime
description: implementation worker用の独立sandboxを作成・検証し、macOS / WSL/Linux / remote provider差を吸収する時に使用する。
---

# Sandbox Runtime

## Invariants

- 1 implementation worker = 1 isolated workspace/runtime。
- mutable runtime stateはworker間で共有しない。
- 同一内部portは使用してよい。host公開port / preview routeはruntime側で一意化する。
- host Docker socketやmaster credentialをworkerへ渡さない。
- immutable/cacheable stateのみ共有する。
- provider差はadapterへ閉じ込め、project semanticsを変えない。

## Isolate

最低限:

- repository checkout
- process boundary
- network / port mapping
- writable filesystem
- DB / Redis / queue
- application local state
- test artifacts
- mutable build output

## macOS

- Apple Silicon `arm64`を第一級targetとして扱う。
- binary / dependency / container imageのarm64対応を確認する。
- x86_64 emulationを暗黙前提にしない。
- portable Web/backend taskは原則Linux sandboxで実行する。
- Apple-native toolingが必要なtaskだけmacOS-native workerを許可する。
- Docker Desktopを必須にしない。

## Windows + WSL2

- Linux-oriented repoはWSL Linux filesystemを優先する。
- `/mnt/c`等を高頻度build/watchの標準workspaceにしない。
- WSL自体をworker isolationとみなさない。
- permission / symlink / executable bit / line ending差を検証する。
- port forwardingはSupervisor/runtime側で抽象化する。

## Portability

Apple Silicon localとx86_64 CI/remoteが混在する場合、architecture-sensitive dependency install/build/testを検証する。

## Reproducibility target

```text
clone
-> bootstrap
-> sandbox create
-> dependency install
-> migrate / seed
-> app/test start
-> validation
```
