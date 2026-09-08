param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$Version = $Version.TrimStart('v')
if ($Version -notmatch '^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$') { throw "Invalid version: $Version" }

$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$desktopRoot = Join-Path $RepositoryRoot 'desktop-client'
$runtimeSource = Join-Path $desktopRoot 'dist\win-unpacked'
$packageRoot = Join-Path $desktopRoot 'dist\portable-package'
$runtimeRoot = Join-Path $packageRoot '程序文件'
$compatibilityApp = Join-Path $packageRoot 'resources\app'
$launcher = Join-Path $packageRoot '豌豆AI工具.exe'
$webLauncher = Join-Path $packageRoot '网页版.html'
$guide = Join-Path $packageRoot '使用说明.txt'
$releaseRoot = Join-Path $RepositoryRoot 'dist'
$zip = Join-Path $releaseRoot 'wandou-ai-tools-windows-x64.zip'

if (-not (Test-Path -LiteralPath (Join-Path $runtimeSource '豌豆AI工具.exe'))) {
    throw 'Electron win-unpacked build is missing.'
}

if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -Path (Join-Path $runtimeSource '*') -Destination $runtimeRoot -Recurse -Force
Remove-Item -LiteralPath (Join-Path $runtimeRoot 'wandou-ai-update.log') -Force -ErrorAction SilentlyContinue

& $compiler /nologo /target:winexe /optimize+ "/win32icon:$RepositoryRoot\app\logo.ico" "/out:$launcher" (Join-Path $desktopRoot 'portable-launcher.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcher)) { throw 'Portable launcher compilation failed.' }

Copy-Item -LiteralPath (Join-Path $desktopRoot 'web-launcher.html') -Destination $webLauncher
New-Item -ItemType Directory -Path $compatibilityApp -Force | Out-Null
Set-Content -LiteralPath (Join-Path $compatibilityApp 'VERSION.txt') -Value "v$Version" -Encoding ASCII
@"
豌豆AI工具 v$Version

文件夹中只有三个日常入口：
1. “豌豆AI工具.exe”：启动桌面软件。
2. “网页版.html”：不启动桌面外壳，直接打开本地网页版。
3. “使用说明.txt”：本说明文件。

“程序文件”和“resources”是隐藏的运行目录，请勿移动或删除。
软件无需安装；检测到新版本时，先保存画布，再点击更新即可自动覆盖并重新启动。
图片默认保存到软件设置中选择的本地文件夹，透明图片保持 PNG 透明通道。
"@ | Set-Content -LiteralPath $guide -Encoding UTF8

# 兼容旧更新器需要保留外层 resources/VERSION.txt，但把所有运行内容隐藏，
# 因此资源管理器默认只展示启动器、网页版和说明三个入口。
[IO.File]::SetAttributes($runtimeRoot, [IO.File]::GetAttributes($runtimeRoot) -bor [IO.FileAttributes]::Hidden)
$compatibilityResources = Join-Path $packageRoot 'resources'
[IO.File]::SetAttributes($compatibilityResources, [IO.File]::GetAttributes($compatibilityResources) -bor [IO.FileAttributes]::Hidden)

$visible = @(Get-ChildItem -LiteralPath $packageRoot -Force | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Hidden) } | Select-Object -ExpandProperty Name | Sort-Object)
$expected = @('使用说明.txt', '网页版.html', '豌豆AI工具.exe') | Sort-Object
if (($visible -join '|') -ne ($expected -join '|')) {
    throw "Portable package exposes unexpected root entries: $($visible -join ', ')"
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'resources\app\VERSION.txt'))) {
    throw 'Internal runtime version file is missing.'
}
if ((Get-Content -LiteralPath (Join-Path $runtimeRoot 'resources\app\VERSION.txt') -TotalCount 1).Trim() -ne "v$Version") {
    throw 'Internal runtime version does not match the release version.'
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $names = @($archive.Entries | Select-Object -ExpandProperty FullName)
    foreach ($required in @(
        '豌豆AI工具.exe',
        '网页版.html',
        '使用说明.txt',
        'resources/app/VERSION.txt',
        '程序文件/豌豆AI工具.exe',
        '程序文件/resources/app/VERSION.txt',
        '程序文件/resources/app/index.html'
    )) {
        if ($names -notcontains $required) { throw "Portable archive is missing: $required" }
    }
} finally {
    $archive.Dispose()
}

Write-Output "Portable package created: $zip"
