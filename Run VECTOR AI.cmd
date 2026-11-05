@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" -X utf8 scripts/run-parallel.py --count 1 %*
pause
