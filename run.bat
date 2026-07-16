@echo off
REM jousting3d playtest. English-only, CRLF.
cd /d "%~dp0"
echo Starting Jousting 3D ...
if not exist "node_modules" call npm install
call npm run dev -- --open
pause
