param(
    [Parameter(Mandatory=$true)][string]$PackageZip,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$RepositoryRoot=''
)
$ErrorActionPreference='Stop'
if (-not $RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$Version=$Version.TrimStart('v')
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Installer version must be x.y.z'}
$repo=[IO.Path]::GetFullPath($RepositoryRoot)
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $output.StartsWith($repo.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'OutputDirectory must stay inside this reviewed source tree.'}
$package=(Resolve-Path -LiteralPath $PackageZip).Path
function Get-Sha256([string]$File) {
    $stream=[IO.File]::OpenRead($File)
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
}
$sha=Get-Sha256 $package
New-Item -ItemType Directory -Path $output -Force | Out-Null
$metadata=Join-Path $output 'installer-build-metadata.cs'
$manifest=Join-Path $output 'installer.manifest'
$installer=Join-Path $output "wandou-ai-tools-setup-$Version.exe"
@"
using System.Reflection;
[assembly: AssemblyTitle("豌豆 AI 安装程序")]
[assembly: AssemblyProduct("豌豆AI工具")]
[assembly: AssemblyVersion("$Version.0")]
[assembly: AssemblyFileVersion("$Version.0")]
[assembly: AssemblyInformationalVersion("$Version")]
internal static class InstallBuild { public const string Version="$Version"; public const string Sha256="$sha"; }
"@ | Set-Content -LiteralPath $metadata -Encoding UTF8
@'
<?xml version="1.0" encoding="utf-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
 <assemblyIdentity version="1.0.0.0" name="Wandou.LocalInstaller"/>
 <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
 <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware></windowsSettings></application>
</assembly>
'@ | Set-Content -LiteralPath $manifest -Encoding UTF8
$compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/win32manifest:$manifest" "/win32icon:$repo\app\logo.ico" "/resource:$package,wandou.package.zip" "/out:$installer" "$repo\desktop-client\local-installer.cs" $metadata
if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $installer)){throw 'Installer compilation failed'}
Write-Output ('Installer SHA256: '+(Get-Sha256 $installer))
Write-Output "Unsigned local installer created: $installer"
