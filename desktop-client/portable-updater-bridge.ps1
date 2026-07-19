param(
    [string]$InstallDirectory = '',
    [string]$PackagePath = '',
    [int]$ProcessId = 0,
    [string]$ExecutableName = '',
    [string]$ExpectedAppVersion = '',
    [string]$TargetVersion = '',
    [string]$ReadyPath = ''
)

$ErrorActionPreference = 'Stop'
$nativeSource = Join-Path $InstallDirectory 'resources\portable-updater.exe'
$nativeCopy = Join-Path (Split-Path -Parent $PSCommandPath) 'portable-updater.exe'

if (-not (Test-Path -LiteralPath $nativeSource)) { throw 'Native updater is missing.' }
Copy-Item -LiteralPath $nativeSource -Destination $nativeCopy -Force

$arguments = @(
    '--install', ('"' + $InstallDirectory + '"'),
    '--package', ('"' + $PackagePath + '"'),
    '--parent', [string]$ProcessId,
    '--exe', ('"' + $ExecutableName + '"'),
    '--ready', ('"' + $ReadyPath + '"'),
    '--target', ('"' + $TargetVersion + '"')
)

Start-Process -FilePath $nativeCopy -ArgumentList $arguments -WindowStyle Hidden | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(8)
do {
    if (Test-Path -LiteralPath $ReadyPath) { exit 0 }
    Start-Sleep -Milliseconds 120
} while ([DateTime]::UtcNow -lt $deadline)

throw 'Native updater did not accept the update request.'
