#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'
& bun (Join-Path $PSScriptRoot 'devices.ts') @args
exit $LASTEXITCODE
