@echo off
rem One-click start for Windows: checks Node, installs dependencies once, opens the console.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist .env if exist .env.example copy .env.example .env >nul

if "%PORT%"=="" set PORT=3000
start "" "http://localhost:%PORT%/app/"
node server.js
pause
