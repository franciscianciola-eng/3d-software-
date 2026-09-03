@echo off
setlocal
cd /d "%~dp0"

set "URL=http://localhost:8080"
echo.
echo   Easy3D Studio - starting local server...
echo   Keep this window open. The app runs at %URL%
echo   (if the browser opens too fast and shows an error, just refresh)
echo.

where py >nul 2>nul
if not errorlevel 1 goto py
where python >nul 2>nul
if not errorlevel 1 goto python
where node >nul 2>nul
if not errorlevel 1 goto node

echo   This app needs Python or Node.js installed (either one works).
echo   Get one from  https://www.python.org  or  https://nodejs.org
echo   then double-click start.bat again.
echo.
pause
exit /b 1

:py
start "" "%URL%"
py -m http.server 8080
exit /b

:python
start "" "%URL%"
python -m http.server 8080
exit /b

:node
start "" "%URL%"
node serve.mjs
exit /b
