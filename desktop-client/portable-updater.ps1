param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExecutableName,
    [string]$TargetVersion = '',
    [string]$ReadyPath = '',
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("wandou-ai-stage-" + [guid]::NewGuid().ToString('N'))
$log = Join-Path ([System.IO.Path]::GetTempPath()) 'wandou-ai-update.log'
$installLog = Join-Path $InstallDirectory 'wandou-ai-update.log'

function Write-UpdateLog([string]$Message) {
    $line = "{0:u} {1}" -f (Get-Date), $Message
    $line | Out-File -LiteralPath $log -Append -Encoding UTF8
    try { $line | Out-File -LiteralPath $installLog -Append -Encoding UTF8 } catch {}
}

try {
    Write-UpdateLog "Updater started. Target version: $TargetVersion; install directory: $InstallDirectory"
    if ($ReadyPath) {
        'ready' | Set-Content -LiteralPath $ReadyPath -Encoding ASCII -Force
    }
    Wait-Process -Id $ProcessId -Timeout 30 -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $stage -Force

    $copyError = $null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            Get-ChildItem -LiteralPath $stage -Force | ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $InstallDirectory -Recurse -Force
            }
            $copyError = $null
            break
        } catch {
            $copyError = $_
            Write-UpdateLog "Copy attempt $attempt failed: $($_.Exception.Message)"
            Start-Sleep -Milliseconds 750
        }
    }
    if ($copyError) { throw $copyError }

    if ($TargetVersion) {
        $versionFile = Join-Path $InstallDirectory 'resources\app\VERSION.txt'
        $installedVersion = if (Test-Path -LiteralPath $versionFile) { (Get-Content -LiteralPath $versionFile -TotalCount 1).Trim().TrimStart('v') } else { '' }
        if ($installedVersion -ne $TargetVersion.TrimStart('v')) {
            throw "Version verification failed. Expected $TargetVersion, installed $installedVersion"
        }
    }

    Write-UpdateLog "Update completed. Restarting application."
    if (-not $SkipRestart) {
        Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory
    }
} catch {
    Write-UpdateLog "Automatic update failed: $($_.Exception.Message)"
    if (-not $SkipRestart) {
        try { Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory } catch {}
    }
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("Automatic update failed. The application was reopened.`nLog: $installLog", 'Wandou AI Tools') | Out-Null
    } catch {}
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
