@echo off
chcp 65001 >nul
echo Removing the Moodle Hoarder updater host registration...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.moodle_hoarder.updater" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.moodle_hoarder.updater" /f >nul 2>&1
reg delete "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.moodle_hoarder.updater" /f >nul 2>&1
del "%~dp0com.moodle_hoarder.updater.json" >nul 2>&1
echo Done.
pause
