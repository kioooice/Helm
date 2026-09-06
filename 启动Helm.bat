@echo off
chcp 65001 >nul
setlocal
set "EXE=%~dp0desktop\dist\win-unpacked\helm.exe"

if exist "%EXE%" (
  start "" "%EXE%"
  exit /b 0
)

echo [Helm] Standalone app not built yet. Falling back to dev mode...
echo [Helm] (Run 构建Helm.bat once to get the fast standalone launcher.)
cd /d "%~dp0desktop"
call npm run dev
