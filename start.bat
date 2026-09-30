@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Meeting Assistant AI
cd /d "%~dp0"

echo.
echo ========================================
echo   Meeting Assistant AI
echo ========================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 goto :node_missing

node.exe -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=22?0:1)" >nul 2>nul
if errorlevel 1 goto :node_old

if not exist "dist\server\index.js" goto :files_missing
if not exist "scripts\local-server.mjs" goto :files_missing
if not exist "scripts\local-api.mjs" goto :files_missing
if not exist "scripts\local-store.mjs" goto :files_missing

echo Runtime files verified.
echo Starting the app. The browser will open when ready.
echo Keep this window open while using the app.
echo.

node.exe "scripts\local-server.mjs"
set "APP_EXIT=%ERRORLEVEL%"

echo.
if "%APP_EXIT%"=="0" goto :normal_stop
echo [ERROR] The app stopped unexpectedly. Exit code: %APP_EXIT%
echo Keep this window open and send a screenshot of the last 20 lines.
echo.
pause
exit /b %APP_EXIT%

:normal_stop
echo The app has stopped.
echo.
pause
exit /b 0

:node_missing
echo [ERROR] Node.js was not found.
echo Install Node.js 22 LTS, then run start.bat again.
echo Download: https://nodejs.org/
goto :startup_failed

:node_old
echo [ERROR] Node.js 22 or newer is required.
echo Current version:
node.exe --version
echo Download: https://nodejs.org/
goto :startup_failed

:files_missing
echo [ERROR] Runtime files are missing.
echo Extract the whole ZIP into a new folder before running start.bat.
goto :startup_failed

:startup_failed
echo.
echo Keep this window open and send a screenshot of this message.
echo.
pause
exit /b 1
