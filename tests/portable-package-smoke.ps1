param(
    [Parameter(Mandatory = $true)]
    [string]$Package
)

$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('wandou-package-smoke-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $testRoot '豌豆AI工具'
$runtimeExecutable = Join-Path $install '程序文件\豌豆AI工具.exe'
$launcherProcess = $null

function Get-RuntimeProcesses {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.MainModule.FileName -eq $runtimeExecutable } catch { $false }
    })
}

try {
    New-Item -ItemType Directory -Path $install -Force | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $Package).Path, $install)
    if (-not (Test-Path -LiteralPath $runtimeExecutable)) { throw 'Internal Electron runtime is missing.' }
    # Simulate files left at the outer level by an old updater's locked-directory
    # fallback. The new launcher must keep them out of the user's three-entry view.
    New-Item -ItemType Directory -Path (Join-Path $install 'locales') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $install 'chrome_100_percent.pak') -Value 'legacy' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $install 'd3dcompiler_47.dll') -Value 'legacy' -Encoding ASCII

    $previousUserData = $env:WANDOU_TEST_USER_DATA_DIR
    $previousCloseDelay = $env:WANDOU_TEST_CLOSE_AFTER_MS
    $env:WANDOU_TEST_USER_DATA_DIR = Join-Path $testRoot 'user-data'
    $env:WANDOU_TEST_CLOSE_AFTER_MS = '8000'
    try {
        $launcherProcess = Start-Process -FilePath (Join-Path $install '豌豆AI工具.exe') -WorkingDirectory $install -WindowStyle Hidden -PassThru
    } finally {
        $env:WANDOU_TEST_USER_DATA_DIR = $previousUserData
        $env:WANDOU_TEST_CLOSE_AFTER_MS = $previousCloseDelay
    }

    $startDeadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $runtimeProcesses = Get-RuntimeProcesses
    } while ($runtimeProcesses.Count -eq 0 -and [DateTime]::UtcNow -lt $startDeadline)
    if ($runtimeProcesses.Count -eq 0) { throw 'The outer launcher did not start the Electron runtime.' }

    $visible = @(Get-ChildItem -LiteralPath $install -Force | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) } | Select-Object -ExpandProperty Name | Sort-Object)
    $expected = @('使用说明.txt', '网页版.html', '豌豆AI工具.exe') | Sort-Object
    if (($visible -join '|') -ne ($expected -join '|')) { throw "Unexpected visible outer entries after launch: $($visible -join ', ')." }

    $exitDeadline = [DateTime]::UtcNow.AddSeconds(35)
    do {
        Start-Sleep -Milliseconds 400
        $runtimeProcesses = Get-RuntimeProcesses
    } while ($runtimeProcesses.Count -gt 0 -and [DateTime]::UtcNow -lt $exitDeadline)
    if ($runtimeProcesses.Count -gt 0) { throw 'The packaged app did not complete its normal save-and-close flow.' }
    Write-Output 'PASS: packaged launcher starts, hides legacy root files, shows three entries, and exits through verified save flow.'
}
finally {
    foreach ($process in (Get-RuntimeProcesses)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    if ($launcherProcess -and -not $launcherProcess.HasExited) { Stop-Process -Id $launcherProcess.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 300
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
