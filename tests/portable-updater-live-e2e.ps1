param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$LockInstallDirectory
)

$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('wandou-updater-live-e2e-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $testRoot '豌豆AI工具'
$packageSource = Join-Path $testRoot 'package-source'
$package = Join-Path $testRoot 'release.zip'
$ready = Join-Path $testRoot 'ready.txt'
$log = Join-Path $testRoot 'wandou-ai-update.log'
$updater = Join-Path $RepositoryRoot 'desktop-client\portable-updater.exe'
$parentSource = Join-Path $RepositoryRoot 'tests\updater-e2e-parent.cs'
$appSource = Join-Path $RepositoryRoot 'tests\updater-test-app.cs'
$parentExe = Join-Path $testRoot 'updater-e2e-parent.exe'
$testApp = Join-Path $testRoot 'test-app.exe'
$directoryLock = $null

function Stop-TestProcesses {
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $processPath = $_.MainModule.FileName
            if ($processPath -and $processPath.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase)) {
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }
}

try {
    New-Item -ItemType Directory -Path (Join-Path $install 'resources\app') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $packageSource 'resources\app') -Force | Out-Null

    & $compiler /nologo /target:winexe /optimize+ /out:$testApp $appSource
    if ($LASTEXITCODE -ne 0) { throw 'Failed to compile updater test application.' }
    & $compiler /nologo /target:winexe /optimize+ /out:$parentExe $parentSource
    if ($LASTEXITCODE -ne 0) { throw 'Failed to compile updater test parent.' }

    Copy-Item -LiteralPath $testApp -Destination (Join-Path $install '豌豆AI工具.exe')
    Copy-Item -LiteralPath $testApp -Destination (Join-Path $install 'crashpad_handler.exe')
    Set-Content -LiteralPath (Join-Path $install 'resources\app\VERSION.txt') -Value 'v1.0.54' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $install 'old-marker.txt') -Value 'old' -Encoding ASCII
    $stalePrevious = Join-Path $testRoot '豌豆AI工具.previous-20200101-000000'
    New-Item -ItemType Directory -Path $stalePrevious -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $stalePrevious 'stale-marker.txt') -Value 'stale' -Encoding ASCII

    Copy-Item -LiteralPath $testApp -Destination (Join-Path $packageSource '豌豆AI工具.exe')
    Copy-Item -LiteralPath $testApp -Destination (Join-Path $packageSource 'crashpad_handler.exe')
    Set-Content -LiteralPath (Join-Path $packageSource 'resources\app\VERSION.txt') -Value 'v1.0.57' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $packageSource 'new-marker.txt') -Value 'new' -Encoding ASCII
    Compress-Archive -Path (Join-Path $packageSource '*') -DestinationPath $package -CompressionLevel Optimal

    if ($LockInstallDirectory) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class UpdateDirectoryLock {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
}
'@
        $directoryLock = [UpdateDirectoryLock]::CreateFile($install, 2147483648, 3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
        if ($directoryLock.IsInvalid) { throw 'Cannot acquire test directory lock.' }
    }

    $arguments = @($updater, $install, $package, '豌豆AI工具.exe', $ready, '1.0.57', 'crashpad_handler.exe')
    Start-Process -FilePath $parentExe -ArgumentList $arguments -WorkingDirectory $install -WindowStyle Hidden | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(50)
    do {
        Start-Sleep -Milliseconds 300
        $versionFile = Join-Path $install 'resources\app\VERSION.txt'
        $installedVersion = if (Test-Path -LiteralPath $versionFile) { (Get-Content -LiteralPath $versionFile -TotalCount 1).Trim() } else { '' }
        if ($installedVersion -eq 'v1.0.57' -and (Test-Path -LiteralPath (Join-Path $install 'new-marker.txt'))) { break }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($installedVersion -ne 'v1.0.57') { throw "Live updater test timed out; installed version is '$installedVersion'." }
    if (-not $LockInstallDirectory -and (Test-Path -LiteralPath (Join-Path $install 'old-marker.txt'))) { throw 'Old installation marker survived the directory swap.' }
    $logText = Get-Content -LiteralPath $log -Raw
    if ($logText -notmatch 'crashpad_handler\.exe') { throw 'The install-scoped helper process was not stopped.' }
    if ($logText -notmatch 'Native update completed') { throw 'The updater did not report completion.' }
    if ($LockInstallDirectory -and $logText -notmatch 'using journaled file replacement') { throw 'Locked directory fallback was not tested.' }

    $restartDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 300
        $logText = Get-Content -LiteralPath $log -Raw
    } while ($logText -notmatch 'Application restart launched process (\d+)' -and [DateTime]::UtcNow -lt $restartDeadline)
    if ($logText -notmatch 'Application restart launched process (\d+)') { throw 'Application was not restarted.' }
    $restarted = Get-Process -Id ([int]$Matches[1]) -ErrorAction Stop
    if ($restarted.Path -ne (Join-Path $install '豌豆AI工具.exe')) { throw 'Restarted the wrong executable.' }
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 300
        $previous = @(Get-ChildItem -LiteralPath $testRoot -Directory -Filter '豌豆AI工具.previous-*')
    } while ($previous.Count -ne 0 -and [DateTime]::UtcNow -lt $cleanupDeadline)
    if ($previous.Count -ne 0) { throw "Expected previous installations to be cleaned, found $($previous.Count)." }
    $logText = Get-Content -LiteralPath $log -Raw
    if ($logText -match 'Warning: previous installation remains') { throw 'The updater left a previous installation behind.' }
    Write-Output "PASS: installed v1.0.57 and verified restarted process; locked directory: $LockInstallDirectory."
}
finally {
    if ($directoryLock) { $directoryLock.Dispose() }
    Stop-TestProcesses
    Start-Sleep -Milliseconds 300
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
