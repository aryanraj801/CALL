@echo off
:: ============================================================================
::  NexaLink - Stop All Services
::  Kills all running NexaLink processes by port number.
:: ============================================================================

title NexaLink - Stop All Services

echo.
echo  ===========================================================================
echo   N E X A L I N K   ^|   Stopping All Services
echo  ===========================================================================
echo.

:: Kill processes on each port
call :KillPort 8000 "Signalling Server"
call :KillPort 8001 "API Gateway"
call :KillPort 8002 "AI Sidecar"
call :KillPort 3000 "React Client Vite"
:: Also kill any stray Electron processes
tasklist /fi "imagename eq electron.exe" 2>nul | find /i "electron.exe" >nul
if not errorlevel 1 (
    echo   Stopping Desktop Agent Electron...
    taskkill /f /im electron.exe >nul 2>&1
    echo   [STOPPED] Desktop Agent
) else (
    echo   [SKIP] Desktop Agent not running
)
echo.
echo  All NexaLink services stopped.
echo.
if "%~1"=="/nopause" goto :skip_pause
if "%~1"=="-nopause" goto :skip_pause
pause
:skip_pause
exit /b 0

:: ============================================================================
:: Subroutine: Kill process listening on a given port
:: Usage: call :KillPort <PORT> <SERVICE_NAME>
:: ============================================================================
:KillPort
set "PORT=%~1"
set "SVC=%~2"

for /f "tokens=5" %%a in ('netstat -aon ^| find ":%PORT% " ^| find "LISTENING" 2^>nul') do (
    if not "%%a"=="" (
        echo   Stopping %SVC% - PID %%a on port %PORT%...
        taskkill /f /pid %%a >nul 2>&1
        echo   [STOPPED] %SVC%
        goto :eof
    )
)
echo   [SKIP] %SVC% not running on port %PORT%
goto :eof
