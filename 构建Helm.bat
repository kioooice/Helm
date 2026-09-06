@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0desktop"

set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo [Helm] Building standalone app (first run downloads tools, please wait)...
call npm run build:unpack
if errorlevel 1 (
  echo.
  echo [Helm] Build FAILED. Check messages above.
  pause
  exit /b 1
)

echo.
echo [Helm] Build OK: %~dp0desktop\dist\win-unpacked\helm.exe
echo [Helm] You can now double-click 启动Helm.bat or the desktop shortcut.
pause
