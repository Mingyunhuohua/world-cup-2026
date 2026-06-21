@echo off
cd /d "%~dp0"

echo ============================================
echo   World Cup 2026 Predictor - Starting
echo ============================================
echo.

if not exist "node_modules" (
    echo First run detected, installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo.
        echo Dependency install failed. Check your network and try again.
        pause
        exit /b 1
    )
)

netstat -ano | findstr ":5183" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo Server is already running. Opening the page directly.
) else (
    echo Starting local server...
    start "WorldCup2026-Server (keep this window open)" cmd /k "npm run dev"
    echo Waiting for server to be ready...
    timeout /t 4 /nobreak >nul
)

start http://127.0.0.1:5183/

echo.
echo Opened http://127.0.0.1:5183/ in your browser.
echo If the page does not load, wait a few seconds and refresh.
echo To stop the program later, close the "Server" window.
echo.
pause
