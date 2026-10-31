@echo off
echo ======================================================================
echo   OSSBridge - Starting Application
echo ======================================================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running!
    echo.
    echo Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

REM Check if .env exists
if not exist .env (
    echo WARNING: .env file not found!
    echo.
    echo Please copy .env.example to .env and set where the result tables are
    echo.
    pause
    exit /b 1
)

REM Start containers
echo Starting OSSBridge...
echo    Backend: http://localhost:5050
echo    Frontend: http://localhost:3000
echo.
echo Press Ctrl+C to stop
echo ======================================================================
echo.

docker-compose up

echo.
echo ======================================================================
echo   To stop completely, run: docker-compose down
echo ======================================================================
pause