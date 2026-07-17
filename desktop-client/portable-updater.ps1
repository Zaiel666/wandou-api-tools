param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExecutableName
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("wandou-ai-stage-" + [guid]::NewGuid().ToString('N'))
$log = Join-Path ([System.IO.Path]::GetTempPath()) 'wandou-ai-update.log'

try {
    Wait-Process -Id $ProcessId -Timeout 30 -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $stage -Force
    Get-ChildItem -LiteralPath $stage -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $InstallDirectory -Recurse -Force
    }
    Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory
} catch {
    ("{0:u} {1}" -f (Get-Date), $_.Exception.Message) | Out-File -LiteralPath $log -Append -Encoding UTF8
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("自动更新失败。请把这个日志发给开发者：`n$log", '豌豆AI工具') | Out-Null
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
