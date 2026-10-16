$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
    $directorBlender = Get-Command blender.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
    if (-not $directorBlender) {
        $directorBlender = Get-ChildItem -LiteralPath 'C:\Program Files\Blender Foundation' -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'blender.exe' } |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $directorBlender) { throw 'Blender was not found. Install Blender or export a GLB manually.' }
    $directorOpen = New-Object System.Windows.Forms.OpenFileDialog
    $directorOpen.Title = 'Select Blender project (original will not be modified)'
    $directorOpen.Filter = 'Blender project (*.blend)|*.blend'
    if ($directorOpen.ShowDialog() -ne 'OK') { exit }
    $directorSave = New-Object System.Windows.Forms.SaveFileDialog
    $directorSave.Title = 'Save a NEW GLB file for the director canvas'
    $directorSave.Filter = 'Binary glTF (*.glb)|*.glb'
    $directorSave.FileName = [IO.Path]::GetFileNameWithoutExtension($directorOpen.FileName) + '-director.glb'
    $directorSave.InitialDirectory = [IO.Path]::GetDirectoryName($directorOpen.FileName)
    if ($directorSave.ShowDialog() -ne 'OK') { exit }
    if (Test-Path -LiteralPath $directorSave.FileName) { throw 'Please choose a new filename. Existing files are not overwritten.' }
    $directorScript = Join-Path $PSScriptRoot 'convert-blend.py'
    Write-Host 'Converting locally with Blender. Please wait; the original project is not modified.'
    $directorArguments = @('--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',('"' + $directorScript + '"'),'--',('"' + $directorOpen.FileName + '"'),('"' + $directorSave.FileName + '"'))
    $directorProcess = Start-Process -FilePath $directorBlender -ArgumentList $directorArguments -WindowStyle Hidden -Wait -PassThru
    if ($directorProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $directorSave.FileName)) { throw 'Conversion failed. Open the project in Blender and export glTF 2.0 / GLB manually.' }
    [System.Windows.Forms.MessageBox]::Show(('GLB saved. Import this file in the director canvas:' + [Environment]::NewLine + $directorSave.FileName), 'Director conversion') | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Director conversion') | Out-Null
    exit 1
}
