param(
  [switch]$IncludeLiveApi
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

$requiredTests = @(
  "tests/canvas-interaction-regression.test.cjs",
  "tests/node-media-actions-and-grok-regression.test.cjs",
  "tests/prompt-composer-regression.test.cjs",
  "tests/project-cover-and-compact-save.test.cjs",
  "tests/project-open-recovery-regression.test.cjs",
  "tests/project-switch-media-persistence.test.cjs",
  "tests/save-before-close-regression.test.cjs",
  "tests/local-disk-storage-regression.test.cjs",
  "tests/api-settings-quota-and-feedback.test.cjs",
  "tests/audio-node-browser.test.cjs",
  "tests/vector-svg-export.test.cjs",
  "tests/psd-layer-export-browser.test.cjs",
  "tests/asset-ordering-regression.test.cjs",
  "tests/dark-ui-regression.test.cjs",
  "tests/light-theme-button-regression.test.cjs",
  "tests/fullscreen-and-neutral-ui-browser-regression.test.cjs"
)

$liveApiTests = @(
  "tests/live-api-node-smoke.cjs",
  "tests/grok-live-api.test.cjs",
  "tests/real-api-image-ratios.test.cjs"
)

if ($IncludeLiveApi) {
  $requiredTests += $liveApiTests
}

Push-Location $repoRoot
try {
  $failures = @()

  foreach ($testFile in $requiredTests) {
    if (-not (Test-Path -LiteralPath $testFile)) {
      $failures += "$testFile (missing)"
      Write-Host "Missing required regression test: $testFile" -ForegroundColor Red
      continue
    }

    Write-Host "`n[UI V3 gate] $testFile" -ForegroundColor Cyan
    & node $testFile
    if ($LASTEXITCODE -ne 0) {
      $failures += $testFile
      Write-Host "Regression failed: $testFile" -ForegroundColor Red
    }
  }

  if ($failures.Count -gt 0) {
    throw "UI V3 regression gate failed ($($failures.Count)/$($requiredTests.Count)): $($failures -join ', ')"
  }

  Write-Host "`nUI V3 regression gate passed ($($requiredTests.Count) tests)." -ForegroundColor Green
}
finally {
  Pop-Location
}
