@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\resources"

echo [Helm] Building frozen RapidOCR sidecar (rapid-ocr-server.exe)...
python -m PyInstaller --onefile --name rapid-ocr-server --distpath . ^
  --workpath ..\.pyinstaller-build --specpath ..\.pyinstaller-build ^
  --collect-all rapidocr_onnxruntime rapid-ocr-server.py
if errorlevel 1 (
  echo [Helm] Build FAILED.
  exit /b 1
)
echo [Helm] Done: %~dp0..\resources\rapid-ocr-server.exe
