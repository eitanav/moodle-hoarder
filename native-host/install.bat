@echo off
chcp 65001 >nul
setlocal EnableExtensions

echo ============================================
echo   Moodle Hoarder - one-time updater setup
echo ============================================
echo.

rem --- Paths (this folder) ---
set "HOSTDIR=%~dp0"
set "BATPATH=%HOSTDIR%mh_updater.bat"
set "JSONPATH=%HOSTDIR%com.moodle_hoarder.updater.json"

rem --- Sanity checks ---
where git >nul 2>&1 || (echo [ERROR] git is not on PATH. Install Git first. & pause & exit /b 1)
where python >nul 2>&1 || (echo [ERROR] python is not on PATH. Install Python first. & pause & exit /b 1)

rem --- Generate the native-messaging host manifest with an absolute path
rem     (JSON needs backslashes doubled) ---
set "ESCBAT=%BATPATH:\=\\%"
> "%JSONPATH%" echo {
>>"%JSONPATH%" echo   "name": "com.moodle_hoarder.updater",
>>"%JSONPATH%" echo   "description": "Moodle Hoarder updater",
>>"%JSONPATH%" echo   "path": "%ESCBAT%",
>>"%JSONPATH%" echo   "type": "stdio",
>>"%JSONPATH%" echo   "allowed_origins": [
>>"%JSONPATH%" echo     "chrome-extension://najfelnccehphphopjpgeomihocoinfk/"
>>"%JSONPATH%" echo   ]
>>"%JSONPATH%" echo }

rem --- Register for Chromium-based browsers (current user, no admin needed) ---
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.moodle_hoarder.updater" /ve /t REG_SZ /d "%JSONPATH%" /f >nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.moodle_hoarder.updater" /ve /t REG_SZ /d "%JSONPATH%" /f >nul
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.moodle_hoarder.updater" /ve /t REG_SZ /d "%JSONPATH%" /f >nul

echo Installed the updater host:
echo   %JSONPATH%
echo.
echo NEXT:
echo   1) Fully close and reopen your browser (so it picks up the host).
echo   2) Open Moodle Hoarder. When an update is available, click
echo      "Update now" - it will pull the new version, then click "Reload".
echo.
pause
