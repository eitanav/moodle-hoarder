@echo off
rem Launcher for the Moodle Hoarder native messaging host. Chrome invokes this
rem and talks to it over stdio. It just hands control to the Python host.
rem Requires Python on PATH (the transcriber setup already installs it).
python "%~dp0mh_updater.py" %*
