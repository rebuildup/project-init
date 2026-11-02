#!/usr/bin/env pwsh
# script/link.ps1 — Windows-native adapter for the managed home/ entries.
#
#   link.ps1            plan only: report what would happen, change nothing
#   link.ps1 -Apply     create symlinks for entries whose target is absent
#
# This is NOT a port of script/link. The bash script assumes a fresh HOME and
# aborts on any conflict; a Windows machine that already has a .gitconfig,
# credentials and tool settings is the normal case, so this adapter is
# adoption-first:
#
#   * an existing file or directory is never replaced, moved or deleted
#   * a regular file with identical content is reported, not converted
#   * a file that differs, or a symlink to somewhere else, is a conflict and
#     is left alone for the user to merge
#   * no copy fallback when symlink creation is not permitted (Developer Mode
#     or an elevated shell is required); the entry is reported as an error
#
# Symlink entries are read from the git index (mode 120000), not from the
# working tree: with core.symlinks=false (the Git for Windows default without
# Developer Mode) they are checked out as plain files holding the link text.
#
# Entries that only make sense on POSIX are skipped explicitly.
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$HomeDir = $HOME,
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    [Console]::Error.WriteLine('link.ps1 targets Windows; use script/link on POSIX hosts.')
    exit 2
}

# Relative to home/. Reason is printed so the skip is never silent.
$PosixOnly = @{
    '.local/bin/devices'            = 'POSIX launcher; on Windows use script/devices.ps1'
    '.local/bin/agent'              = 'POSIX symlink to agent.ts; on Windows use script/agent.ps1 and `agent shortcuts create`'
    '.claude/statusline-command.sh' = 'bash status line renderer; not wired for Windows-native Claude Code'
}

$SourceRoot = Join-Path $RepoRoot 'home'
if (-not (Test-Path -LiteralPath $SourceRoot)) {
    [Console]::Error.WriteLine("missing managed source root: $SourceRoot")
    exit 1
}

# `git` missing from PATH is a terminating error under -Stop, so catch it and
# fail through the same path as an unreadable index.
$indexLines = @()
$gitOk = $false
try {
    $indexLines = @(& git -C $RepoRoot ls-files -s -- home 2>$null)
    $gitOk = ($LASTEXITCODE -eq 0)
}
catch {
    $gitOk = $false
}
if (-not $gitOk -or $indexLines.Count -eq 0) {
    [Console]::Error.WriteLine("cannot read managed entries from the git index of $RepoRoot")
    exit 1
}

# <mode> <sha> <stage>\t<path>
$entries = foreach ($line in $indexLines) {
    $meta, $path = $line -split "`t", 2
    [pscustomobject]@{ Mode = ($meta -split ' ')[0]; Relative = $path.Substring('home/'.Length) }
}

$results = [System.Collections.Generic.List[object]]::new()

function Add-Result {
    param([string]$State, [string]$Relative, [string]$Detail = '', [string]$Source = '', [bool]$IsDirectory = $false)
    $results.Add([pscustomobject]@{
            State = $State; Relative = $Relative; Detail = $Detail; Source = $Source; IsDirectory = $IsDirectory
        })
}

function Test-SameLinkTarget {
    param([string]$Actual, [string]$Expected)
    $normalize = { param($p) [System.IO.Path]::GetFullPath($p).TrimEnd('\').ToLowerInvariant() }
    return (& $normalize $Actual) -eq (& $normalize $Expected)
}

foreach ($entry in $entries) {
    $relative = $entry.Relative

    if ($PosixOnly.ContainsKey($relative)) {
        Add-Result -State 'skip' -Relative $relative -Detail $PosixOnly[$relative]
        continue
    }

    $workingCopy = Join-Path $SourceRoot ($relative -replace '/', '\')
    $isDirectoryLink = $false

    if ($entry.Mode -eq '120000') {
        if ($relative.Contains('/')) {
            Add-Result -State 'skip' -Relative $relative -Detail 'nested symlink entries are not supported by the Windows adapter'
            continue
        }
        # Plain file holding the link text (core.symlinks=false) or a real link.
        # A missing/unreadable working copy (sparse checkout, deleted file) must
        # skip this entry, not abort the whole plan.
        try {
            $linkItem = Get-Item -LiteralPath $workingCopy -Force -ErrorAction Stop
            $linkText = if ($linkItem.LinkType) { [string]($linkItem.Target | Select-Object -First 1) } else { (Get-Content -LiteralPath $workingCopy -Raw -ErrorAction Stop).Trim() }
            $resolved = [System.IO.Path]::GetFullPath((Join-Path $SourceRoot $linkText))
            $hasContent = (Test-Path -LiteralPath $resolved -PathType Container) -and
            [bool](Get-ChildItem -LiteralPath $resolved -Force -ErrorAction Stop | Select-Object -First 1)
        }
        catch {
            Add-Result -State 'skip' -Relative $relative -Detail "cannot read symlink entry: $($_.Exception.Message)"
            continue
        }
        if (-not $hasContent) {
            Add-Result -State 'skip' -Relative $relative -Detail "link target $resolved is missing or empty (submodule not initialized?)"
            continue
        }
        $source = $resolved
        $isDirectoryLink = $true
    }
    elseif ($entry.Mode -eq '160000') {
        continue
    }
    else {
        $source = $workingCopy
    }

    $target = Join-Path $HomeDir ($relative -replace '/', '\')
    $existing = Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue

    if (-not $existing) {
        Add-Result -State 'absent' -Relative $relative -Source $source -IsDirectory $isDirectoryLink
        continue
    }

    if ($existing.LinkType -eq 'SymbolicLink') {
        $actual = [string]($existing.Target | Select-Object -First 1)
        if (-not [System.IO.Path]::IsPathRooted($actual)) { $actual = Join-Path (Split-Path -Parent $target) $actual }
        if (Test-SameLinkTarget -Actual $actual -Expected $source) {
            Add-Result -State 'linked' -Relative $relative
        }
        else {
            Add-Result -State 'conflict' -Relative $relative -Detail "symlink points to $actual (expected $source)"
        }
        continue
    }

    # A locked or unreadable file (e.g. a credentials file held open) cannot be
    # proven identical, so it is a conflict rather than a fatal error.
    $same = $false
    if (-not $isDirectoryLink -and -not $existing.PSIsContainer) {
        try { $same = (Get-FileHash -LiteralPath $target -ErrorAction Stop).Hash -eq (Get-FileHash -LiteralPath $source -ErrorAction Stop).Hash }
        catch { $same = $false }
    }
    if ($same) {
        Add-Result -State 'identical' -Relative $relative -Detail 'unmanaged copy with identical content; left as is'
        continue
    }

    Add-Result -State 'conflict' -Relative $relative -Detail 'exists and differs from the managed source; left untouched'
}

$failed = 0
foreach ($result in $results) {
    $line = $result.Relative
    switch ($result.State) {
        'absent' {
            if (-not $Apply) {
                Write-Host ("would-link {0}" -f $line)
                break
            }
            $target = Join-Path $HomeDir ($line -replace '/', '\')
            try {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
                New-Item -ItemType SymbolicLink -Path $target -Target $result.Source -ErrorAction Stop | Out-Null
                Write-Host ("linked     {0} -> {1}" -f $line, $result.Source)
            }
            catch {
                Write-Host ("error      {0}: {1} (enable Developer Mode or use an elevated shell)" -f $line, $_.Exception.Message)
                $failed++
            }
        }
        'linked' { Write-Host ("ok         {0}" -f $line) }
        'identical' { Write-Host ("identical  {0}  ({1})" -f $line, $result.Detail) }
        'skip' { Write-Host ("skip       {0}  ({1})" -f $line, $result.Detail) }
        'conflict' { Write-Host ("conflict   {0}  ({1})" -f $line, $result.Detail); $failed++ }
    }
}

if (-not $Apply) {
    Write-Host 'plan only; nothing was changed. Re-run with -Apply to link absent entries.'
    exit 0
}

# Safe entries were linked above. Conflicts and errors are reported through the
# exit status so a caller never mistakes a partial adoption for a complete one.
exit ([int]($failed -gt 0))
