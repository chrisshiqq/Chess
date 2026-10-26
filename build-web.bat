@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  Chinese Chess - Web Build
echo ========================================
echo.

if not exist "src\App.tsx" (
  echo [ERROR] src\App.tsx not found
  goto :fail
)
if not exist "src\worker\chess-worker.ts" (
  echo [ERROR] src\worker\chess-worker.ts not found
  goto :fail
)
if not exist "package.json" (
  echo [ERROR] package.json not found
  goto :fail
)

REM Prefer local node if present
set "NODE_CMD=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles(x86)%\nodejs\node.exe"

where node >nul 2>nul
if errorlevel 1 (
  if not exist "%NODE_CMD%" (
    echo [ERROR] node.exe not found in PATH
    echo         Install Node.js or add it to PATH
    goto :fail
  )
) else (
  set "NODE_CMD=node"
)

if not exist "node_modules\" (
  echo [INFO] node_modules missing, running npm install...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    goto :fail
  )
  echo.
)

echo [1/1] Building web bundle ...
call npm.cmd run build
if errorlevel 1 (
  echo [ERROR] web build failed
  goto :fail
)

echo.
echo ========================================
echo  Build OK
echo  Output: docs\index.html
echo ========================================
pause
exit /b 0

:fail
echo.
echo Web build failed.
pause
exit /b 1
