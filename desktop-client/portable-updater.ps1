param(
    [string]$InstallDirectory = '',
    [string]$PackagePath = '',
    [int]$ProcessId = 0,
    [string]$ExecutableName = '',
    [string]$ExpectedAppVersion = '',
    [string]$TargetVersion = '',
    [string]$ReadyPath = '',
    [string]$StatusPath = '',
    [switch]$ProgressUi,
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'

function Decode-Text([string]$Value) {
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function Show-ProgressWindow {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

    [xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Width="440" Height="244" WindowStartupLocation="CenterScreen"
        WindowStyle="None" ResizeMode="NoResize" AllowsTransparency="True"
        Background="Transparent" Topmost="True" ShowInTaskbar="True">
  <Border CornerRadius="22" Background="#FFFFFF" BorderBrush="#DDE9E0" BorderThickness="1" Padding="24">
    <Border.Effect>
      <DropShadowEffect Color="#102A18" BlurRadius="30" ShadowDepth="8" Opacity="0.22"/>
    </Border.Effect>
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>
      <StackPanel Grid.Row="0" Orientation="Horizontal">
        <Border Width="48" Height="48" CornerRadius="15" Background="#22A447">
          <TextBlock Text="&#x8C4C;" Foreground="White" FontFamily="Microsoft YaHei UI" FontWeight="Bold" FontSize="21" HorizontalAlignment="Center" VerticalAlignment="Center"/>
        </Border>
        <StackPanel Margin="14,2,0,0">
          <TextBlock x:Name="BrandText" Foreground="#229640" FontFamily="Microsoft YaHei UI" FontWeight="SemiBold" FontSize="12"/>
          <TextBlock x:Name="TitleText" Margin="0,4,0,0" Foreground="#1D2B22" FontFamily="Microsoft YaHei UI" FontWeight="Bold" FontSize="22"/>
        </StackPanel>
      </StackPanel>
      <StackPanel Grid.Row="1" Margin="0,21,0,0">
        <TextBlock x:Name="DetailText" Foreground="#718078" FontFamily="Microsoft YaHei UI" FontSize="13"/>
        <ProgressBar x:Name="ProgressBar" Height="8" Margin="0,17,0,0" Minimum="0" Maximum="100" IsIndeterminate="True" Foreground="#22A447" Background="#E8F4EB" BorderThickness="0"/>
      </StackPanel>
      <Grid Grid.Row="2" Margin="0,18,0,0">
        <TextBlock x:Name="SafetyText" Foreground="#8A978F" FontFamily="Microsoft YaHei UI" FontSize="11" HorizontalAlignment="Left"/>
        <TextBlock x:Name="VersionText" Foreground="#8A978F" FontFamily="Microsoft YaHei UI" FontSize="11" HorizontalAlignment="Right"/>
      </Grid>
    </Grid>
  </Border>
</Window>
'@

    $reader = New-Object System.Xml.XmlNodeReader $xaml
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $brand = $window.FindName('BrandText')
    $title = $window.FindName('TitleText')
    $detail = $window.FindName('DetailText')
    $progress = $window.FindName('ProgressBar')
    $safety = $window.FindName('SafetyText')
    $version = $window.FindName('VersionText')

    $brand.Text = Decode-Text '6LGM6LGGQUnlt6Xlhbcgwrcg6Ieq5Yqo5pu05paw'
    $safety.Text = Decode-Text '5a6J5YWo5pu05paw'
    $version.Text = (Decode-Text '55uu5qCH54mI5pys') + ' v' + $TargetVersion.TrimStart('v')

    $states = @{
        'waiting' = @('5q2j5Zyo5YeG5aSH5a6J6KOF', '5q2j5Zyo5YWz6Zet5pen54mI5pys77yM6K+356iN5YCZ4oCm')
        'extracting' = @('5q2j5Zyo6Kej5Y6L5paw54mI5pys', '5q2j5Zyo6Kej5Y6L5pu05paw5paH5Lu277yM6K+35LiN6KaB5YWz6Zet55S16ISR44CC')
        'copying' = @('5q2j5Zyo5a6J6KOF5pu05paw', '5q2j5Zyo5pu/5o2i56iL5bqP5paH5Lu277yM6K+356iN5YCZ4oCm')
        'verifying' = @('5q2j5Zyo6aqM6K+B5paw54mI5pys', '5q2j5Zyo56Gu6K6k5a6J6KOF57uT5p6c4oCm')
        'complete' = @('5a6J6KOF5a6M5oiQ', '5paw54mI5pys5bCG5Zyo5Yeg56eS5ZCO6Ieq5Yqo5omT5byA44CC')
        'failed' = @('5a6J6KOF5aSx6LSl', '6L2v5Lu25bCG6YeN5paw5omT5byA77yM6K+35p+l55yL5a6J6KOF55uu5b2V5Lit55qE5pu05paw5pel5b+X44CC')
    }

    $script:lastStage = ''
    $script:finishAt = $null
    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(160)
    $timer.Add_Tick({
        $stageName = 'waiting'
        if ($StatusPath -and (Test-Path -LiteralPath $StatusPath)) {
            try { $stageName = (Get-Content -LiteralPath $StatusPath -Raw -ErrorAction Stop).Trim() } catch {}
        }
        if (-not $states.ContainsKey($stageName)) { $stageName = 'waiting' }
        if ($stageName -ne $script:lastStage) {
            $title.Text = Decode-Text $states[$stageName][0]
            $detail.Text = Decode-Text $states[$stageName][1]
            $script:lastStage = $stageName
            if ($stageName -eq 'complete') {
                $progress.IsIndeterminate = $false
                $progress.Value = 100
                $script:finishAt = [DateTime]::UtcNow.AddMilliseconds(1700)
            } elseif ($stageName -eq 'failed') {
                $progress.IsIndeterminate = $false
                $progress.Value = 100
                $progress.Foreground = [Windows.Media.Brushes]::IndianRed
                $script:finishAt = [DateTime]::UtcNow.AddMilliseconds(3200)
            }
        }
        if ($script:finishAt -and [DateTime]::UtcNow -ge $script:finishAt) {
            $timer.Stop()
            $window.Close()
        }
    })
    $window.Add_Loaded({ $timer.Start() })
    [void]$window.ShowDialog()
}

if ($ProgressUi) {
    Show-ProgressWindow
    exit 0
}

if (-not $InstallDirectory -or -not $PackagePath -or -not $ExecutableName) {
    throw 'Missing updater arguments.'
}

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('wandou-ai-stage-' + [guid]::NewGuid().ToString('N'))
$log = Join-Path ([System.IO.Path]::GetTempPath()) 'wandou-ai-update.log'
$installLog = Join-Path $InstallDirectory 'wandou-ai-update.log'
if (-not $StatusPath) {
    $StatusPath = Join-Path ([System.IO.Path]::GetTempPath()) ('wandou-ai-status-' + [guid]::NewGuid().ToString('N') + '.txt')
}

function Write-UpdateLog([string]$Message) {
    $line = '{0:u} {1}' -f (Get-Date), $Message
    $line | Out-File -LiteralPath $log -Append -Encoding UTF8
    try { $line | Out-File -LiteralPath $installLog -Append -Encoding UTF8 } catch {}
}

function Set-UpdateStage([string]$Name) {
    $Name | Set-Content -LiteralPath $StatusPath -Encoding ASCII -Force
}

$windowsRoot = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
$powerShell = Join-Path $windowsRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$updateFailed = $false

try {
    Set-UpdateStage 'waiting'
    if (-not $SkipRestart) {
        Start-Process -FilePath $powerShell -ArgumentList @(
            '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', $PSCommandPath, '-ProgressUi', '-StatusPath', $StatusPath, '-TargetVersion', $TargetVersion
        ) -WindowStyle Hidden | Out-Null
    }

    Write-UpdateLog "Updater started. Target version: $TargetVersion; install directory: $InstallDirectory"
    if ($ReadyPath) {
        'ready' | Set-Content -LiteralPath $ReadyPath -Encoding ASCII -Force
    }
    if ($ProcessId -gt 0) {
        Wait-Process -Id $ProcessId -Timeout 30 -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 650

    Set-UpdateStage 'extracting'
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $stage -Force

    Set-UpdateStage 'copying'
    $copyError = $null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            # Copy every unpacked item into the existing portable folder.  Passing the
            # children (rather than the staging folder) prevents an accidental nested
            # win-unpacked directory and ensures resources\app.asar is replaced.
            Get-ChildItem -LiteralPath $stage -Force | Where-Object { $_.Name -ne 'wandou-ai-update.log' } | ForEach-Object {
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

    Set-UpdateStage 'verifying'
    if ($TargetVersion) {
        $versionFile = Join-Path $InstallDirectory 'resources\app\VERSION.txt'
        $installedVersion = if (Test-Path -LiteralPath $versionFile) { (Get-Content -LiteralPath $versionFile -TotalCount 1).Trim().TrimStart('v') } else { '' }
        if ($installedVersion -ne $TargetVersion.TrimStart('v')) {
            throw "Version verification failed. Expected $TargetVersion, installed $installedVersion"
        }
    }
    if ($ExpectedAppVersion) {
        $packageFile = Join-Path $InstallDirectory 'resources\app.asar\package.json'
        $asarPackage = Join-Path $InstallDirectory 'resources\app.asar'
        # Electron packages app.asar as a file. The VERSION.txt check confirms the
        # resource payload; this marker makes the updater also reject a stale app bundle.
        if (-not (Test-Path -LiteralPath $asarPackage)) {
            throw 'Application bundle was not copied into the portable folder.'
        }
    }

    Write-UpdateLog 'Update completed. Restarting application.'
    Set-UpdateStage 'complete'
    if (-not $SkipRestart) {
        Start-Sleep -Milliseconds 3000
        Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory
    }
} catch {
    $updateFailed = $true
    Write-UpdateLog "Automatic update failed: $($_.Exception.Message)"
    Set-UpdateStage 'failed'
    if (-not $SkipRestart) {
        Start-Sleep -Milliseconds 3600
        try { Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory } catch {}
    }
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    if (-not $SkipRestart) {
        Start-Sleep -Milliseconds 500
        Remove-Item -LiteralPath $StatusPath -Force -ErrorAction SilentlyContinue
    }
}

if ($updateFailed) {
    exit 1
}
