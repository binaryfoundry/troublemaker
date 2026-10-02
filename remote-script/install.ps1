<#
.SYNOPSIS
    Installs the TroubleMaker Remote Script into Ableton Live's User Library.

.DESCRIPTION
    Live scans <User Library>\Remote Scripts for control-surface scripts at
    startup. This copies (or junctions) the TroubleMaker package there.

    Live only re-reads the folder on launch, so restart Live afterwards and
    select "TroubleMaker" as a Control Surface in
    Preferences > Link/Tempo/MIDI.

.PARAMETER UserLibrary
    Override the detected Ableton User Library path.

.PARAMETER Link
    Create a directory junction instead of copying, so edits to the repo take
    effect on the next Live restart without reinstalling. Handy while
    developing.

.PARAMETER Uninstall
    Remove a previously installed copy.
#>
[CmdletBinding()]
param(
    [string]$UserLibrary,
    [switch]$Link,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$scriptName = 'TroubleMaker'
$sourceDir = Join-Path $PSScriptRoot $scriptName

function Resolve-UserLibrary {
    if ($UserLibrary) { return $UserLibrary }
    $candidates = @(
        (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Ableton\User Library'),
        (Join-Path $env:USERPROFILE 'Documents\Ableton\User Library')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "Could not find the Ableton User Library. Pass -UserLibrary '<path>'. In Live it is shown under Preferences > Library > Location of User Library."
}

$library = Resolve-UserLibrary
$remoteScriptsDir = Join-Path $library 'Remote Scripts'
$targetDir = Join-Path $remoteScriptsDir $scriptName

if ($Uninstall) {
    if (Test-Path -LiteralPath $targetDir) {
        $item = Get-Item -LiteralPath $targetDir -Force
        if ($item.LinkType) {
            # Remove the junction without following it into the repo.
            [System.IO.Directory]::Delete($targetDir)
        } else {
            Remove-Item -LiteralPath $targetDir -Recurse -Force
        }
        Write-Host "Removed $targetDir" -ForegroundColor Green
    } else {
        Write-Host "Nothing installed at $targetDir" -ForegroundColor Yellow
    }
    Write-Host 'Restart Ableton Live to finish uninstalling.'
    return
}

if (-not (Test-Path -LiteralPath $sourceDir)) {
    throw "Source folder not found: $sourceDir"
}

if (-not (Test-Path -LiteralPath $remoteScriptsDir)) {
    New-Item -ItemType Directory -Path $remoteScriptsDir -Force | Out-Null
    Write-Host "Created $remoteScriptsDir"
}

if (Test-Path -LiteralPath $targetDir) {
    $existing = Get-Item -LiteralPath $targetDir -Force
    if ($existing.LinkType) {
        [System.IO.Directory]::Delete($targetDir)
    } else {
        Remove-Item -LiteralPath $targetDir -Recurse -Force
    }
    Write-Host "Replaced the previous install at $targetDir"
}

if ($Link) {
    New-Item -ItemType Junction -Path $targetDir -Target $sourceDir | Out-Null
    Write-Host "Linked $targetDir -> $sourceDir" -ForegroundColor Green
} else {
    # Create the target first and copy the CONTENTS into it. Copying the
    # folder itself with -Recurse into a non-existent destination silently
    # skips subdirectories, which leaves handlers/ behind and breaks the load.
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceDir '*') -Destination $targetDir -Recurse -Force

    # Stale bytecode from another Python version confuses Live's loader.
    Get-ChildItem -LiteralPath $targetDir -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq '__pycache__' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $copied = (Get-ChildItem -LiteralPath $targetDir -Recurse -File -Filter '*.py').Count
    $expected = (Get-ChildItem -LiteralPath $sourceDir -Recurse -File -Filter '*.py' |
        Where-Object { $_.FullName -notmatch '__pycache__' }).Count
    if ($copied -ne $expected) {
        throw "Install incomplete: copied $copied of $expected Python files to $targetDir"
    }
    Write-Host "Installed $copied Python files to $targetDir" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Restart Ableton Live (it only scans Remote Scripts at startup).'
Write-Host '  2. Preferences > Link/Tempo/MIDI > Control Surface: choose "TroubleMaker".'
Write-Host '     Leave Input and Output set to None.'
Write-Host '  3. The status bar should read "TroubleMaker bridge listening on port 9877".'
Write-Host '  4. Start the bridge:  npm run bridge'
