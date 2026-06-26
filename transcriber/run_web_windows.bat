@echo off
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\activate.bat (
  echo [Moodle Hoarder Transcriber] Creating local Python environment...
  call setup_windows.bat
  if errorlevel 1 goto :err
)

call .venv\Scripts\activate.bat

python -c "import faster_whisper, imageio_ffmpeg, huggingface_hub, tqdm; from mh_transcriber.engine import _prime_pyav_audio_namespace; _prime_pyav_audio_namespace()" >nul 2>nul
if errorlevel 1 (
  echo [Moodle Hoarder Transcriber] Installing/repairing Python dependencies...
  python -m pip install --upgrade pip setuptools wheel
  python -m pip install --upgrade --force-reinstall -r requirements.txt
  if errorlevel 1 (
    echo [Moodle Hoarder Transcriber] force-reinstall failed - retrying with --ignore-installed...
    python -m pip install --upgrade --ignore-installed -r requirements.txt
    if errorlevel 1 goto :err
  )
  echo [Moodle Hoarder Transcriber] Verifying audio decoder...
  python -c "from mh_transcriber.engine import _prime_pyav_audio_namespace; _prime_pyav_audio_namespace()"
  if errorlevel 1 goto :err
)

echo [Moodle Hoarder Transcriber] Starting the web UI. A browser tab will open at http://127.0.0.1:8765/
echo Keep this window open while you work. Close it (or press Ctrl+C) to stop the app.
python run_web.py
if errorlevel 1 goto :err
exit /b 0

:err
echo.
echo Moodle Hoarder Transcriber failed to start.
echo Try running setup_windows.bat manually, then run_web_windows.bat again.
echo If that still fails, delete the .venv folder and run setup_windows.bat
echo for a completely clean environment.
pause
exit /b 1
