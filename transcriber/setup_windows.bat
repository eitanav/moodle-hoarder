@echo off
setlocal
cd /d "%~dp0"
py -3 -m venv .venv
if errorlevel 1 goto :err
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto :err
echo.
echo Setup complete. Run run_gui_windows.bat to start Moodle Hoarder Transcriber.
exit /b 0
:err
echo.
echo Setup failed. Make sure Python 3.10+ is installed and available as py -3.
exit /b 1
