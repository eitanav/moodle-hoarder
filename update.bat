@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Moodle Hoarder - update from GitHub (main)
echo ============================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] This folder is NOT a git repo.
  echo.
  echo You probably downloaded a ZIP instead of cloning. To fix once:
  echo   1^) Delete this folder.
  echo   2^) Open CMD where you want it and run:
  echo        git clone https://github.com/eitanav/moodle-hoarder.git
  echo   3^) In chrome://extensions load the new folder ^(Load unpacked^).
  echo   4^) From then on just double-click this update.bat.
  echo.
  pause
  exit /b 1
)

echo Fetching latest from GitHub...
git fetch origin
echo.
echo Forcing local files to EXACTLY match GitHub main ^(discards local edits^)...
git reset --hard origin/main
git clean -fd -e .venv/ -e .venv/** -e transcriber/.venv/ -e transcriber/.venv/**
echo.
echo --------------------------------------------
echo Updated. Installed version is now:
findstr /C:"\"version\"" manifest.json
echo --------------------------------------------
echo.
echo NEXT: open chrome://extensions and click the RELOAD icon
echo on Moodle Hoarder ^(or Remove + Load unpacked if it still looks old^).
echo.
pause
