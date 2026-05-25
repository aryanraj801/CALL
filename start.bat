@echo off
setlocal EnableDelayedExpansion

:: --------------------------------------------------------------------
::  NexaLink - Full-Stack Dev Launcher
:: --------------------------------------------------------------------
title NexaLink Launcher

:: Resolve project root (same folder as this .bat file)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

cls
echo.
echo =========================================================================
echo   N E X A L I N K   ^|   Full-Stack Dev Launcher
echo =========================================================================
echo.

:: -------------------------------------------------------------
::  Pre-flight checks (node, npm, python, ports)
:: -------------------------------------------------------------

echo  [Pre-flight] Checking dependencies...
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] node not found on PATH. Install Node.js from https://nodejs.org
    pause & exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] npm not found on PATH. Install Node.js from https://nodejs.org
    pause & exit /b 1
)
where python >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] python not found on PATH. Install Python 3.10+ from https://python.org
    pause & exit /b 1
)

echo   OK node:
node --version
echo   OK python:
python --version
echo.

:: -------------------------------------------------------------
::  Port collision check
:: -------------------------------------------------------------
set "COLLISION=0"
for %%p in (8000 8001 8002 3000) do (
    netstat -ano | find ":%%p " | find "LISTENING" >nul 2>&1
    if not errorlevel 1 (
        set "COLLISION=1"
        echo   [WARNING] Port %%p is already in use.
    )
)
if "%COLLISION%"=="1" (
    echo.
    echo   PORT COLLISION DETECTED
    echo   One or more required ports are in use. Run stop.bat first.
    pause & exit /b 1
)

:: ============================================================================
::  AUTO DEPENDENCY SETUP
:: ============================================================================
echo.
echo  [Setup] Verifying environment and dependencies...

:: 1. Signalling Server node_modules
if not exist "%ROOT%\signalling\node_modules" (
    echo   [Setup] Installing signalling dependencies...
    cd /d "%ROOT%\signalling"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [ERROR] Failed to install signalling dependencies.
        pause & exit /b 1
    )
    cd /d "%ROOT%"
)

:: 2. API Gateway Python venv
if not exist "%ROOT%\server\venv" (
    echo   [Setup] Creating Python venv for server...
    python -m venv "%ROOT%\server\venv"
    if errorlevel 1 (
        echo   [ERROR] Failed to create Python venv for server.
        pause & exit /b 1
    )
    echo   [Setup] Installing server requirements...
    call "%ROOT%\server\venv\Scripts\activate.bat"
    pip install --upgrade pip --quiet
    pip install -r "%ROOT%\server\requirements.txt" --quiet
    call deactivate
)

:: 3. AI Sidecar Python venv
if not exist "%ROOT%\ai-sidecar\venv" (
    echo   [Setup] Creating Python venv for ai-sidecar...
    python -m venv "%ROOT%\ai-sidecar\venv"
    if errorlevel 1 (
        echo   [ERROR] Failed to create Python venv for ai-sidecar.
        pause & exit /b 1
    )
    echo   [Setup] Installing ai-sidecar requirements...
    call "%ROOT%\ai-sidecar\venv\Scripts\activate.bat"
    pip install --upgrade pip --quiet
    pip install -r "%ROOT%\ai-sidecar\requirements.txt" --quiet
    call deactivate
)

:: 4. React Client node_modules
if not exist "%ROOT%\client\node_modules" (
    echo   [Setup] Installing client dependencies...
    cd /d "%ROOT%\client"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [ERROR] Failed to install client dependencies.
        pause & exit /b 1
    )
    cd /d "%ROOT%"
)

:: 5. Desktop Agent node_modules
if not exist "%ROOT%\desktop-agent\node_modules" (
    echo   [Setup] Installing desktop-agent dependencies...
    cd /d "%ROOT%\desktop-agent"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [ERROR] Failed to install desktop-agent dependencies.
        pause & exit /b 1
    )
    cd /d "%ROOT%"
)

echo   [Setup] All dependencies verified.
echo.

:: -------------------------------------------------------------
::  Service 1 - Signalling Server (Socket.IO) - port 8000
:: -------------------------------------------------------------
echo [1/5] Starting Signalling Server on :8000 ...
start "NexaLink Signalling" cmd /k "color 3E && title NexaLink Signalling :8000 && cd /d "%ROOT%\signalling" && node server.js"

:: -------------------------------------------------------------
::  Service 2 - API Gateway (FastAPI) - port 8001
:: -------------------------------------------------------------
echo [2/5] Starting API Gateway on :8001 ...
start "NexaLink API Gateway" cmd /k "color 5E && title NexaLink API Gateway :8001 && cd /d "%ROOT%\server" && call venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8001 --reload"

:: -------------------------------------------------------------
::  Service 3 - AI Sidecar (FastAPI) - port 8002
:: -------------------------------------------------------------
echo [3/5] Starting AI Sidecar on :8002 ...
start "NexaLink AI Sidecar" cmd /k "color 6E && title NexaLink AI Sidecar :8002 && cd /d "%ROOT%\ai-sidecar" && call venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8002 --reload"

:: -------------------------------------------------------------
::  Service 4 - React Client (Vite) - port 3000
:: -------------------------------------------------------------
echo [4/5] Starting React Client on :3000 ...
start "NexaLink React Client" cmd /k "color 1E && title NexaLink React Client :3000 && cd /d "%ROOT%\client" && npm run dev"

:: -------------------------------------------------------------
::  Service 5 - Desktop Agent (Electron)
:: -------------------------------------------------------------
echo [5/5] Starting Desktop Agent ...
start "NexaLink Desktop Agent" cmd /k "color 4E && title NexaLink Desktop Agent && cd /d "%ROOT%\desktop-agent" && npm start"

:: --------------------------------------------------------------------
::  Summary
:: --------------------------------------------------------------------
echo.
echo =========================================================================
echo   All services launched in separate windows!
echo   Signalling Server  ws://localhost:8000
echo   API Gateway        http://localhost:8001  (Swagger: /docs)
echo   AI Sidecar         http://localhost:8002  (Swagger: /docs)
echo   React Client       http://localhost:3000
echo   Desktop Agent      Electron window
echo =========================================================================
echo   TIP: Open http://localhost:3000 to use NexaLink.
echo   TIP: Run stop.bat to shut everything down.
echo.

timeout /t 4 /nobreak >nul
start "" "http://localhost:3000"

pause
endlocal
