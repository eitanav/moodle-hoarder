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
  rem Refresh packaging tools first so a corrupted distutils-precedence.pth /
  rem _distutils_hack does not keep crashing python at startup.
  python -m pip install --upgrade pip setuptools wheel
  python -m pip install --upgrade --force-reinstall -r requirements.txt
  if errorlevel 1 (
    rem --force-reinstall uninstalls each package before reinstalling it, but
    rem that uninstall fails outright ("no RECORD file was found") if a package
    rem (commonly av, faster-whisper's PyAV dep) was left in a state pip can't
    rem account for. --ignore-installed skips the uninstall step entirely and
    rem just overwrites the files, which recovers from that case.
    echo [Moodle Hoarder Transcriber] force-reinstall failed - retrying with --ignore-installed...
    python -m pip install --upgrade --ignore-installed -r requirements.txt
    if errorlevel 1 goto :err
  )
  echo [Moodle Hoarder Transcriber] Verifying audio decoder...
  rem Run the probe visibly this time so a genuine PyAV failure shows its
  rem real traceback instead of silently launching a broken GUI.
  python -c "from mh_transcriber.engine import _prime_pyav_audio_namespace; _prime_pyav_audio_namespace()"
  if errorlevel 1 goto :err
)

python run_gui.py
if errorlevel 1 goto :err
exit /b 0

:err
echo.
echo Moodle Hoarder Transcriber failed to start.
echo Try running setup_windows.bat manually, then run_gui_windows.bat again.
echo If that still fails, delete the .venv folder and run setup_windows.bat
echo for a completely clean environment.
pause
exit /b 1
