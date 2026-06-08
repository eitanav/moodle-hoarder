@echo off
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\activate.bat (
  echo [Moodle Hoarder Transcriber] Creating local Python environment...
  call setup_windows.bat
  if errorlevel 1 goto :err
)

call .venv\Scripts\activate.bat

python -c "import faster_whisper, imageio_ffmpeg" >nul 2>nul
if errorlevel 1 (
  echo [Moodle Hoarder Transcriber] Installing missing Python dependencies...
  python -m pip install -r requirements.txt
  if errorlevel 1 goto :err
)

python run_gui.py
if errorlevel 1 goto :err
exit /b 0

:err
echo.
echo Moodle Hoarder Transcriber failed to start.
echo Try running setup_windows.bat manually, then run_gui_windows.bat again.
pause
exit /b 1
