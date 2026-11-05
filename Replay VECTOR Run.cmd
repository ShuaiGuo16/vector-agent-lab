@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-replay.ps1" -RunId "%~1"
if errorlevel 1 pause
