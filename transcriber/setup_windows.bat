@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher ^(py^) was not found. Install Python 3.10+ from python.org.
  goto :err
)

py -3 -m venv .venv
if errorlevel 1 goto :err
call .venv\Scripts\activate.bat
rem Upgrade packaging tools too: a stale setuptools/_distutils_hack leaves a
rem broken distutils-precedence.pth that crashes every python call at startup
rem (site addpackage AttributeError / UnicodeDecodeError on non-UTF-8 locales).
python -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :err
python -m pip install -r requirements.txt
if errorlevel 1 goto :err

echo.
echo Setup complete. Run run_gui_windows.bat to start Moodle Hoarder Transcriber.
exit /b 0

:err
echo.
echo Setup failed. Make sure Python 3.10+ is installed and available as py -3.
pause
exit /b 1
