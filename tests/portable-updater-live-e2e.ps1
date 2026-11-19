param([string]$RepositoryRoot=(Split-Path -Parent $PSScriptRoot),[switch]$LockInstallDirectory)
$ErrorActionPreference='Stop'
# Actual protocol-2 executable cases include normal parent exit, commit/cancel,
# checksum rejection and rollback. The protocol never renames the install root.
& node --test --test-name-pattern='actual|retired' (Join-Path $RepositoryRoot 'tests/safe-updater-protocol-v223.test.cjs')
if($LASTEXITCODE -ne 0){throw 'Safe updater executable regression failed.'}
