@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-game.ps1" -Replay
if errorlevel 1 pause
