@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
if not exist "%~dp0desktop-client\node_modules\electron\dist\electron.exe" (
  echo Electron test runtime is missing. Please restore desktop-client dependencies.
  pause
  exit /b 1
)
start "" "%~dp0desktop-client\node_modules\electron\dist\electron.exe" "%~dp0desktop-client\director-test-main.cjs"
